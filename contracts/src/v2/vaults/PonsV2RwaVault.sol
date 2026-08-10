// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/utils/cryptography/MerkleProof.sol";
import {Strings} from "@openzeppelin/utils/Strings.sol";

import {PonsAddresses} from "../../PonsAddresses.sol";
import {ISwapRouter02, IUniswapV3Factory, IUniswapV3Pool} from "../../interfaces/IUniswapV3.sol";
import {PonsV2VaultBase} from "./PonsV2VaultBase.sol";

/// @title PonsV2RwaVault
/// @notice v2 RWA Dividend: harvest creator fees in the launch quote asset, convert them into a
///         tokenized stock, and pay holders via merkle rounds — no staking required.
///
/// @dev Fees arrive as the pairing asset (AAPL, NVDA, USDG, …), not WETH. Routes:
///        - quote == rwaAsset: allocate quote directly (no swap)
///        - quote == WETH: single-hop WETH → rwa (same as v1)
///        - otherwise: quote → WETH → rwa via Uniswap V3 multihop
///
///      The merkle / distributor trust model is identical to {PonsRwaVault}.
contract PonsV2RwaVault is PonsV2VaultBase {
    using SafeERC20 for IERC20;

    error InvalidRwaAsset();
    error RwaPoolNotFound(address rwaAsset, uint24 poolFee);
    error RwaPoolEmpty(address pool);
    error QuotePoolNotFound(address quoteAsset);
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

    event Configured(
        address rwaAsset, uint24 rwaPoolFee, uint24 quoteWethPoolFee, uint256 minHarvestWei, address distributor
    );
    event RwaPurchased(uint256 quoteSpent, uint256 rwaBought);
    event RoundOpened(uint256 indexed roundId, uint256 amount, uint256 snapshotBlock);
    event RootPosted(uint256 indexed roundId, bytes32 root);
    event Claimed(uint256 indexed roundId, address indexed account, uint256 amount);
    event RoundReclaimed(uint256 indexed roundId, uint256 amount);
    event DistributorChanged(address indexed from, address indexed to);

    uint256 public constant CLAIM_WINDOW = 90 days;

    /// @param rwaAsset Tokenised stock holders are paid in. Fixed at launch.
    /// @param rwaPoolFee Fee tier of the WETH/`rwaAsset` pool (ignored when quote == rwa).
    /// @param minHarvestWei Minimum spendable quote before {run} acts. Named for ABI parity with
    ///        v1 / off-chain tooling; the unit is the launch quote asset, not necessarily WETH.
    struct Config {
        address rwaAsset;
        uint24 rwaPoolFee;
        uint256 minHarvestWei;
    }

    struct Round {
        bytes32 root;
        uint128 total;
        uint128 claimed;
        uint64 snapshotBlock;
        uint64 openedAt;
        bool reclaimed;
    }

    Config public config;

    /// @notice Fee tier of the quote/WETH pool used for the first hop. Zero when unused.
    uint24 public quoteWethPoolFee;

    address public distributor;

    Round[] private _rounds;

    mapping(uint256 roundId => mapping(address account => bool)) public hasClaimed;

    uint256 public rwaReserved;
    uint256 public totalQuoteConverted;
    uint256 public totalRwaDistributed;
    uint256 public totalRwaClaimed;

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _token,
        address _quoteAsset,
        address _distributor,
        Config calldata _config
    ) external initializer {
        __PonsV2VaultBase_init(_token, _quoteAsset);

        if (_distributor == address(0) || _config.rwaAsset == address(0)) revert ZeroAddress();
        if (_config.rwaAsset == _token) revert InvalidRwaAsset();

        uint24 quoteFee;
        if (_config.rwaAsset == _quoteAsset) {
            // Direct allocation — no DEX route required.
            quoteFee = 0;
        } else if (_quoteAsset == PonsAddresses.WETH) {
            _requireRwaPool(_config.rwaAsset, _config.rwaPoolFee);
            quoteFee = 0;
        } else {
            _requireRwaPool(_config.rwaAsset, _config.rwaPoolFee);
            quoteFee = _deepestPoolFee(_quoteAsset, PonsAddresses.WETH);
            if (quoteFee == 0) revert QuotePoolNotFound(_quoteAsset);
        }

        config = _config;
        quoteWethPoolFee = quoteFee;
        distributor = _distributor;
        emit Configured(_config.rwaAsset, _config.rwaPoolFee, quoteFee, _config.minHarvestWei, _distributor);
    }

    /* ---------------------------------------------------------------------- */
    /* buying                                                                 */
    /* ---------------------------------------------------------------------- */

    /// @notice Harvest fees, convert quote into the RWA (if needed), and open a round.
    function run(uint256 minRwaOut) external nonReentrant returns (uint256 roundId, uint256 amount) {
        Config memory cfg = config;

        _harvest();

        uint256 quoteToSpend = _spendableQuote(cfg.rwaAsset);
        if (quoteToSpend < cfg.minHarvestWei || quoteToSpend == 0) revert NothingToHarvest();

        if (cfg.rwaAsset == quoteAsset) {
            // Quote is the dividend asset — allocate it as-is.
            amount = quoteToSpend;
            totalQuoteConverted += quoteToSpend;
            emit RwaPurchased(quoteToSpend, amount);
        } else {
            _swapQuoteForRwa(cfg, quoteToSpend, minRwaOut);
            amount = IERC20(cfg.rwaAsset).balanceOf(address(this)) - rwaReserved;
            if (amount == 0) revert NothingBought();
        }

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

    function postRoot(uint256 roundId, bytes32 root) external {
        if (msg.sender != distributor) revert NotDistributor(msg.sender, distributor);
        if (roundId >= _rounds.length) revert NoSuchRound(roundId);
        if (root == bytes32(0)) revert RootNotPosted(roundId);

        Round storage round = _rounds[roundId];
        if (round.root != bytes32(0)) revert RootAlreadyPosted(roundId);

        round.root = root;
        emit RootPosted(roundId, root);
    }

    function setDistributor(address next) external {
        if (msg.sender != distributor) revert NotDistributor(msg.sender, distributor);
        if (next == address(0)) revert ZeroAddress();

        emit DistributorChanged(distributor, next);
        distributor = next;
    }

    /* ---------------------------------------------------------------------- */
    /* claiming                                                               */
    /* ---------------------------------------------------------------------- */

    function claim(uint256 roundId, address account, uint256 amount, bytes32[] calldata proof)
        external
        nonReentrant
    {
        _claim(roundId, account, amount, proof);
    }

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
        totalRwaDistributed -= amount;

        emit RoundReclaimed(roundId, amount);
    }

    /* ---------------------------------------------------------------------- */
    /* views                                                                  */
    /* ---------------------------------------------------------------------- */

    function canRun() external view returns (bool ready, string memory reason) {
        // Include unswept curve fees — they only hit the escrow after {run} sweeps.
        uint256 available = pendingQuote();
        if (available < config.minHarvestWei || available == 0) {
            return (false, "Insufficient accrued fees (may still be sitting on the curve)");
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

    function undistributedRwa() public view returns (uint256) {
        uint256 balance = IERC20(config.rwaAsset).balanceOf(address(this));
        return balance > rwaReserved ? balance - rwaReserved : 0;
    }

    function rwaPool() external view returns (address) {
        if (config.rwaAsset == quoteAsset) return address(0);
        return IUniswapV3Factory(PonsAddresses.V3_FACTORY).getPool(
            PonsAddresses.WETH, config.rwaAsset, config.rwaPoolFee
        );
    }

    function leafFor(address account, uint256 amount) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(account, amount))));
    }

    function template() external pure override returns (string memory) {
        return "rwa";
    }

    function description() external view override returns (string memory) {
        return string.concat(
            "PonsV2RwaVault: creator fees buy ",
            Strings.toHexString(config.rwaAsset),
            " and pay it to holders. Converted: ",
            Strings.toString(totalQuoteConverted),
            " quote across ",
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

        uint256 remaining = uint256(round.total) - uint256(round.claimed);
        if (amount > remaining) revert RoundExhausted(roundId, remaining, amount);

        hasClaimed[roundId][account] = true;
        round.claimed = uint128(uint256(round.claimed) + amount);
        rwaReserved -= amount;
        totalRwaClaimed += amount;

        IERC20(config.rwaAsset).safeTransfer(account, amount);
        emit Claimed(roundId, account, amount);
    }

    function _spendableQuote(address rwaAsset) private view returns (uint256) {
        uint256 bal = IERC20(quoteAsset).balanceOf(address(this));
        if (rwaAsset == quoteAsset) {
            return bal > rwaReserved ? bal - rwaReserved : 0;
        }
        return bal;
    }

    function _swapQuoteForRwa(Config memory cfg, uint256 quoteAmount, uint256 minRwaOut)
        private
        returns (uint256 bought)
    {
        IERC20(quoteAsset).forceApprove(PonsAddresses.SWAP_ROUTER_02, quoteAmount);

        if (quoteAsset == PonsAddresses.WETH) {
            bought = ISwapRouter02(PonsAddresses.SWAP_ROUTER_02).exactInputSingle(
                ISwapRouter02.ExactInputSingleParams({
                    tokenIn: PonsAddresses.WETH,
                    tokenOut: cfg.rwaAsset,
                    fee: cfg.rwaPoolFee,
                    recipient: address(this),
                    amountIn: quoteAmount,
                    amountOutMinimum: minRwaOut,
                    sqrtPriceLimitX96: 0
                })
            );
        } else {
            bytes memory path = abi.encodePacked(
                quoteAsset, quoteWethPoolFee, PonsAddresses.WETH, cfg.rwaPoolFee, cfg.rwaAsset
            );
            bought = ISwapRouter02(PonsAddresses.SWAP_ROUTER_02).exactInput(
                ISwapRouter02.ExactInputParams({
                    path: path,
                    recipient: address(this),
                    amountIn: quoteAmount,
                    amountOutMinimum: minRwaOut
                })
            );
        }

        IERC20(quoteAsset).forceApprove(PonsAddresses.SWAP_ROUTER_02, 0);

        totalQuoteConverted += quoteAmount;
        emit RwaPurchased(quoteAmount, bought);
    }

    function _requireRwaPool(address rwaAsset, uint24 poolFee) private view {
        address route =
            IUniswapV3Factory(PonsAddresses.V3_FACTORY).getPool(PonsAddresses.WETH, rwaAsset, poolFee);
        if (route == address(0)) revert RwaPoolNotFound(rwaAsset, poolFee);
        if (IUniswapV3Pool(route).liquidity() == 0) revert RwaPoolEmpty(route);
    }

    /// @dev Picks the deepest live fee tier between `a` and `b`. Returns 0 if none have liquidity.
    function _deepestPoolFee(address a, address b) private view returns (uint24 bestFee) {
        uint24[4] memory fees = [uint24(500), uint24(100), uint24(3000), uint24(10_000)];
        uint128 bestLiq;
        for (uint256 i = 0; i < fees.length; ++i) {
            address pool = IUniswapV3Factory(PonsAddresses.V3_FACTORY).getPool(a, b, fees[i]);
            if (pool == address(0)) continue;
            uint128 liq = IUniswapV3Pool(pool).liquidity();
            if (liq > bestLiq) {
                bestLiq = liq;
                bestFee = fees[i];
            }
        }
    }
}
