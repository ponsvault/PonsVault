// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/utils/cryptography/MerkleProof.sol";
import {Strings} from "@openzeppelin/utils/Strings.sol";

import {PonsAddresses} from "../PonsAddresses.sol";
import {ISwapRouter02, IUniswapV3Factory, IUniswapV3Pool} from "../interfaces/IUniswapV3.sol";
import {PonsVaultBase} from "./PonsVaultBase.sol";

/// @title PonsRwaVault
/// @notice PonsVault template that turns a pons token's creator LP fees into a tokenised
///         real-world asset — a Robinhood stock token such as NVDA — and pays it to the people
///         holding the token. Holding is the only requirement: there is nothing to stake, nothing
///         to lock, and the tokens never leave their owner's wallet.
///
/// @dev The pitch is "hold the meme, earn the stock". Trading funds a standing bid for a real
///      equity, and holders receive that equity rather than more of the token they already own.
///
///      Why a swap rather than an operator delivering the asset: Robinhood stock tokens are
///      ordinary ERC-20s with live Uniswap V3 liquidity against WETH, so the vault buys them on the
///      open market in the same transaction that harvests the fees. Nobody has to be trusted to
///      deliver an asset, quote a price, or show up. It also means no price oracle is needed: the
///      pool is the price. That half of this contract is as trustless as the other templates.
///
///      Why the payout needs a merkle root, and what that costs. Paying holders automatically
///      would require the token to notify this contract whenever a balance moves. Pons tokens are
///      plain ERC-20s with no transfer hook and no historical balance lookup, so on-chain there is
///      no way to learn who held what, or when. Any hold-based payout therefore has to be computed
///      off-chain from `Transfer` logs and committed as a root.
///
///      That introduces the one trusted step in this design: whoever posts a round's root decides
///      how that round splits. It is deliberately bounded:
///
///        - No principal is ever at risk, because nobody deposits anything. The only thing a bad
///          root can misdirect is one round's dividends.
///        - A round's payout is capped at the RWA that round's own {run} bought. The distributor
///          sets the split, never the size, so a root cannot mint a claim on anything else in here
///          — including other rounds' unclaimed balances.
///        - Each round records the block it was computed at, and roots are write-once. Anyone can
///          replay the public `Transfer` logs to that block and check the root independently.
///
///      Token-side LP fees are burned rather than paid out. A Uniswap position accrues both sides,
///      and handing holders back the token they already hold adds a second currency to every leaf
///      to no real benefit. Burning reaches every holder at once, in proportion to what they hold,
///      and needs no claim at all.
///
///      The RWA is a single asset fixed at launch, not a basket. A basket needs a rebalancing
///      policy and a way to price the mix, and neither can be made permissionless as cheaply as
///      one pool lookup.
contract PonsRwaVault is PonsVaultBase {
    using SafeERC20 for IERC20;

    error InvalidRwaAsset();
    error RwaPoolNotFound(address rwaAsset, uint24 poolFee);
    error RwaPoolEmpty(address pool);
    error NothingBought();
    error NotDistributor(address caller, address distributor);
    error NoSuchRound(uint256 roundId);
    error RootAlreadyPosted(uint256 roundId);
    error RootNotPosted(uint256 roundId);
    error AlreadyClaimed(uint256 roundId, address account);
    error InvalidProof(uint256 roundId, address account);
    error RoundExhausted(uint256 roundId, uint256 remaining, uint256 requested);
    error RoundNotExpired(uint256 roundId, uint256 expiresAt);
    error NothingToReclaim(uint256 roundId);
    error LengthMismatch();

    event Configured(address rwaAsset, uint24 rwaPoolFee, uint256 minHarvestWei, address distributor);
    event RwaPurchased(uint256 wethSpent, uint256 rwaBought);
    event RoundOpened(uint256 indexed roundId, uint256 amount, uint256 snapshotBlock);
    event RootPosted(uint256 indexed roundId, bytes32 root);
    event Claimed(uint256 indexed roundId, address indexed account, uint256 amount);
    event RoundReclaimed(uint256 indexed roundId, uint256 amount);
    event DistributorChanged(address indexed from, address indexed to);

    /// @dev How long a round stays claimable. Past this anyone may return whatever is left to the
    ///      undistributed pool, where the next {run} folds it into a fresh round. Long enough that
    ///      an inattentive holder is not punished, short enough that a round abandoned by everyone
    ///      — or one whose root was never posted — cannot strand value here forever.
    uint256 public constant CLAIM_WINDOW = 90 days;

    /// @param rwaAsset Tokenised real-world asset holders are paid in. Fixed forever at launch.
    /// @param rwaPoolFee Fee tier of the WETH/`rwaAsset` pool the vault buys through. Also fixed:
    ///        the deepest tier for one asset is not the deepest for another, so it cannot be
    ///        assumed, and letting a caller pass it per run would let them route a purchase
    ///        through an empty pool of their choosing.
    /// @param minHarvestWei Minimum WETH a harvest must yield before {run} will act. The only
    ///        pacing control: a run spends everything it harvests, so the next cannot happen until
    ///        trading has accrued this much again.
    struct Config {
        address rwaAsset;
        uint24 rwaPoolFee;
        uint256 minHarvestWei;
    }

    /// @param root Allocation for this round. Zero until posted; write-once thereafter.
    /// @param total RWA this round may pay out in aggregate.
    /// @param claimed Paid out so far.
    /// @param snapshotBlock Block the holder set must be read at. Fixed when the round opens, so
    ///        the root is reproducible by anyone and cannot be quietly recomputed on newer data.
    /// @param openedAt Start of the claim window.
    /// @param reclaimed Whether the remainder has been returned to the undistributed pool.
    struct Round {
        bytes32 root;
        uint128 total;
        uint128 claimed;
        uint64 snapshotBlock;
        uint64 openedAt;
        bool reclaimed;
    }

    Config public config;

    /// @notice May post allocation roots. Not the vault owner and not the token creator: a creator
    ///         who could shape the split could pay the whole dividend to themselves, which would
    ///         make the vault a promise rather than a guarantee. Set by the factory to the protocol
    ///         keeper, and only ever rotatable by itself.
    address public distributor;

    Round[] private _rounds;

    mapping(uint256 roundId => mapping(address account => bool)) public hasClaimed;

    /// @notice RWA allocated to rounds and not yet claimed.
    /// @dev Held on holders' behalf, so it is not this vault's to hand to a later round. The
    ///      difference between this and the RWA balance is what {run} may distribute.
    uint256 public rwaReserved;

    /// @notice Lifetime WETH converted into the RWA.
    uint256 public totalWethConverted;

    /// @notice Lifetime RWA allocated to rounds.
    uint256 public totalRwaDistributed;

    /// @notice Lifetime RWA actually claimed by holders.
    uint256 public totalRwaClaimed;

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _token,
        address _locker,
        address _collector,
        address _distributor,
        Config calldata _config
    ) external initializer {
        __PonsVaultBase_init(_token, _locker, _collector);

        if (_distributor == address(0) || _config.rwaAsset == address(0)) revert ZeroAddress();
        // Paying out the token itself would make this a rebate rather than a dividend, and paying
        // out WETH is a different template. Both would also break the accounting below, which
        // assumes the three assets are distinct.
        if (_config.rwaAsset == _token || _config.rwaAsset == PonsAddresses.WETH) revert InvalidRwaAsset();

        // The route is fixed at launch and this contract is immutable, so an unroutable asset is
        // not a bad first run — it is a vault that can never pay anything for as long as it
        // exists, quietly accruing fees it cannot spend. Both halves are worth paying for: the
        // pool must exist, and it must have depth. Several stock tokens on this chain have a
        // deployed WETH pool that was never funded, which is exactly the pairing that looks valid
        // and reverts on every swap.
        address route = IUniswapV3Factory(PonsAddresses.V3_FACTORY).getPool(
            PonsAddresses.WETH, _config.rwaAsset, _config.rwaPoolFee
        );
        if (route == address(0)) revert RwaPoolNotFound(_config.rwaAsset, _config.rwaPoolFee);
        // Point-in-time. Liquidity can leave later and this cannot promise otherwise — it rules
        // out launching against a pool that is already dead.
        if (IUniswapV3Pool(route).liquidity() == 0) revert RwaPoolEmpty(route);

        config = _config;
        distributor = _distributor;
        emit Configured(_config.rwaAsset, _config.rwaPoolFee, _config.minHarvestWei, _distributor);
    }

    /* ---------------------------------------------------------------------- */
    /* buying                                                                 */
    /* ---------------------------------------------------------------------- */

    /// @notice Harvest creator fees, convert the WETH into the RWA, and open a round over it.
    /// @dev Permissionless, like every template here. Opening the round is all this does with the
    ///      proceeds: who receives what is decided by the root posted afterwards, against the
    ///      holder set at this block.
    ///
    ///      Distributes everything present that no round already has a claim on, rather than only
    ///      what this call produced. {PonsVaultLauncher-collect} is public, so anyone can make the
    ///      locker pay this vault without going through {run}; keying off a delta would buy nothing
    ///      in that case and leave the money here permanently. The same treatment sweeps up RWA
    ///      sent here directly and anything returned by {reclaimExpired}.
    /// @param minRwaOut Floor on the RWA received, for the caller's own protection against a pool
    ///        moved within the block. Zero accepts the pool price, which is what the keeper uses.
    /// @return roundId The round just opened.
    /// @return amount RWA allocated to it.
    function run(uint256 minRwaOut) external nonReentrant returns (uint256 roundId, uint256 amount) {
        Config memory cfg = config;

        _harvest();

        // WETH is never owed to anyone here — every run spends all of it — so the whole balance is
        // fresh fees.
        uint256 wethToSpend = IERC20(PonsAddresses.WETH).balanceOf(address(this));
        if (wethToSpend < cfg.minHarvestWei || wethToSpend == 0) revert NothingToHarvest();

        _swapWethForRwa(cfg, wethToSpend, minRwaOut);

        // Measured against the balance rather than the swap's return value, so that RWA which
        // arrived by any other route is folded in too. See the note on out-of-band funds above.
        amount = IERC20(cfg.rwaAsset).balanceOf(address(this)) - rwaReserved;
        if (amount == 0) revert NothingBought();

        // The token side is burned rather than paid out: it reaches every holder at once, in
        // proportion to what they hold, without anyone having to claim it.
        _burnAllTokens();

        lastRunAt = block.timestamp;
        runCount += 1;

        roundId = _rounds.length;
        _rounds.push(
            Round({
                root: bytes32(0),
                total: uint128(amount),
                claimed: 0,
                snapshotBlock: uint64(block.number),
                openedAt: uint64(block.timestamp),
                reclaimed: false
            })
        );

        rwaReserved += amount;
        totalRwaDistributed += amount;

        emit RoundOpened(roundId, amount, block.number);
    }

    /* ---------------------------------------------------------------------- */
    /* allocating                                                             */
    /* ---------------------------------------------------------------------- */

    /// @notice Commit the allocation for a round.
    /// @dev Write-once. A root that could be replaced would let the split be rewritten after
    ///      holders had already checked it, which is the whole thing anyone is trusting here.
    ///      Leaves are `keccak256(bytes.concat(keccak256(abi.encode(account, amount))))` over the
    ///      token's holders at the round's `snapshotBlock`.
    function postRoot(uint256 roundId, bytes32 root) external {
        if (msg.sender != distributor) revert NotDistributor(msg.sender, distributor);
        if (roundId >= _rounds.length) revert NoSuchRound(roundId);
        if (root == bytes32(0)) revert RootNotPosted(roundId);

        Round storage round = _rounds[roundId];
        if (round.root != bytes32(0)) revert RootAlreadyPosted(roundId);

        round.root = root;
        emit RootPosted(roundId, root);
    }

    /// @notice Hand the root-posting key to a replacement.
    /// @dev Only the holder of the key may rotate it, so a compromised or retired keeper can be
    ///      replaced without granting anybody else the ability to seize the role.
    function setDistributor(address next) external {
        if (msg.sender != distributor) revert NotDistributor(msg.sender, distributor);
        if (next == address(0)) revert ZeroAddress();

        emit DistributorChanged(distributor, next);
        distributor = next;
    }

    /* ---------------------------------------------------------------------- */
    /* claiming                                                               */
    /* ---------------------------------------------------------------------- */

    /// @notice Collect `account`'s share of a round.
    /// @dev Callable by anyone, since the proof fixes both the recipient and the amount and the
    ///      payment goes to `account` regardless of who paid the gas. That lets a holder be paid
    ///      without ever transacting themselves.
    function claim(uint256 roundId, address account, uint256 amount, bytes32[] calldata proof)
        external
        nonReentrant
    {
        _claim(roundId, account, amount, proof);
    }

    /// @notice Collect several rounds at once.
    /// @dev Holders accumulate one entry per run, so by the time anyone looks there are usually
    ///      many small ones. Claiming them individually costs a transaction each.
    function claimMany(
        uint256[] calldata roundIds,
        address account,
        uint256[] calldata amounts,
        bytes32[][] calldata proofs
    ) external nonReentrant {
        if (roundIds.length != amounts.length || roundIds.length != proofs.length) revert LengthMismatch();

        for (uint256 i = 0; i < roundIds.length; ++i) {
            _claim(roundIds[i], account, amounts[i], proofs[i]);
        }
    }

    /// @notice Return an expired round's unclaimed remainder to the undistributed pool.
    /// @dev Permissionless, and the money never leaves the vault — the next {run} folds it into a
    ///      fresh round over a current holder set. Also the escape hatch for a round whose root was
    ///      never posted: with no root nothing was ever claimable, so the whole amount comes back.
    function reclaimExpired(uint256 roundId) external nonReentrant returns (uint256 amount) {
        if (roundId >= _rounds.length) revert NoSuchRound(roundId);

        Round storage round = _rounds[roundId];
        uint256 expiresAt = uint256(round.openedAt) + CLAIM_WINDOW;
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < expiresAt) revert RoundNotExpired(roundId, expiresAt);

        amount = uint256(round.total) - uint256(round.claimed);
        if (round.reclaimed || amount == 0) revert NothingToReclaim(roundId);

        round.reclaimed = true;
        rwaReserved -= amount;
        // Not lifetime-distributed any more: it is about to be allocated again, and counting it
        // twice would overstate what this vault has actually paid out.
        totalRwaDistributed -= amount;

        emit RoundReclaimed(roundId, amount);
    }

    /* ---------------------------------------------------------------------- */
    /* views                                                                  */
    /* ---------------------------------------------------------------------- */

    /// @notice Whether {run} would currently succeed, and why not if it would not.
    /// @dev Only reports what this contract can see. Almost all pending value sits in the locker
    ///      rather than here, and only {run} can measure it, so `true` means "nothing structural
    ///      is in the way" rather than "there are fees to convert". Callers needing a definitive
    ///      answer should simulate {run}.
    function canRun() external view returns (bool ready, string memory reason) {
        if (IERC20(PonsAddresses.WETH).balanceOf(address(this)) < config.minHarvestWei) {
            return (false, "Insufficient accrued fees (harvest may still be pending in the locker)");
        }
        return (true, "");
    }

    function roundCount() external view returns (uint256) {
        return _rounds.length;
    }

    function rounds(uint256 roundId) external view returns (Round memory) {
        if (roundId >= _rounds.length) revert NoSuchRound(roundId);
        return _rounds[roundId];
    }

    /// @notice Rounds that have been opened but have no allocation yet.
    /// @dev What the distributor's own tooling watches, and what a UI should surface as "payout
    ///      pending" so a root that never arrives is visible rather than silent.
    function roundsAwaitingRoot() external view returns (uint256[] memory ids) {
        uint256 total = _rounds.length;
        uint256 pending;
        for (uint256 i = 0; i < total; ++i) {
            if (_rounds[i].root == bytes32(0) && !_rounds[i].reclaimed) pending++;
        }

        ids = new uint256[](pending);
        uint256 cursor;
        for (uint256 i = 0; i < total; ++i) {
            if (_rounds[i].root == bytes32(0) && !_rounds[i].reclaimed) ids[cursor++] = i;
        }
    }

    /// @notice RWA sitting here that no round has a claim on, and which the next run will allocate.
    function undistributedRwa() public view returns (uint256) {
        uint256 balance = IERC20(config.rwaAsset).balanceOf(address(this));
        return balance > rwaReserved ? balance - rwaReserved : 0;
    }

    /// @notice The WETH pool this vault buys the RWA through.
    function rwaPool() external view returns (address) {
        return IUniswapV3Factory(PonsAddresses.V3_FACTORY).getPool(
            PonsAddresses.WETH, config.rwaAsset, config.rwaPoolFee
        );
    }

    /// @notice The leaf a proof must reproduce, so callers cannot disagree with this contract
    ///         about the encoding.
    function leafFor(address account, uint256 amount) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(account, amount))));
    }

    /// @inheritdoc PonsVaultBase
    function template() external pure override returns (string memory) {
        return "rwa";
    }

    /// @inheritdoc PonsVaultBase
    function description() external view override returns (string memory) {
        return string.concat(
            "PonsRwaVault: creator fees buy ",
            Strings.toHexString(config.rwaAsset),
            " and pay it to holders. Converted: ",
            Strings.toString(totalWethConverted),
            " wei WETH across ",
            Strings.toString(runCount),
            " runs, in ",
            Strings.toString(_rounds.length),
            " rounds."
        );
    }

    /* ---------------------------------------------------------------------- */
    /* internals                                                              */
    /* ---------------------------------------------------------------------- */

    function _claim(uint256 roundId, address account, uint256 amount, bytes32[] calldata proof) private {
        if (roundId >= _rounds.length) revert NoSuchRound(roundId);

        Round storage round = _rounds[roundId];
        if (round.root == bytes32(0)) revert RootNotPosted(roundId);
        if (hasClaimed[roundId][account]) revert AlreadyClaimed(roundId, account);
        if (!MerkleProof.verify(proof, round.root, leafFor(account, amount))) {
            revert InvalidProof(roundId, account);
        }

        // The distributor sets the split, never the size. An over-allocated root cannot reach past
        // its own round into another's unclaimed balance; it just runs out.
        uint256 remaining = uint256(round.total) - uint256(round.claimed);
        if (amount > remaining) revert RoundExhausted(roundId, remaining, amount);

        hasClaimed[roundId][account] = true;
        round.claimed = uint128(uint256(round.claimed) + amount);
        rwaReserved -= amount;
        totalRwaClaimed += amount;

        IERC20(config.rwaAsset).safeTransfer(account, amount);
        emit Claimed(roundId, account, amount);
    }

    /// @dev Buys the RWA into this vault. Unlike {PonsVaultBase-_buyback} the output is a third
    ///      party's token on its own pool and fee tier, so the route comes from config rather than
    ///      the pons defaults.
    function _swapWethForRwa(Config memory cfg, uint256 wethAmount, uint256 minRwaOut)
        private
        returns (uint256 bought)
    {
        IERC20(PonsAddresses.WETH).forceApprove(PonsAddresses.SWAP_ROUTER_02, wethAmount);

        bought = ISwapRouter02(PonsAddresses.SWAP_ROUTER_02).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: PonsAddresses.WETH,
                tokenOut: cfg.rwaAsset,
                fee: cfg.rwaPoolFee,
                recipient: address(this),
                amountIn: wethAmount,
                amountOutMinimum: minRwaOut,
                sqrtPriceLimitX96: 0
            })
        );

        // Cleared so a partially-spending router cannot leave a standing approval behind.
        IERC20(PonsAddresses.WETH).forceApprove(PonsAddresses.SWAP_ROUTER_02, 0);

        totalWethConverted += wethAmount;
        emit RwaPurchased(wethAmount, bought);
    }
}
