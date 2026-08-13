// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {ROBINHOOD_FORK_BLOCK} from "./fixtures/ForkBlock.sol";
import {IERC20} from "@openzeppelin/token/ERC20/IERC20.sol";

import {PonsAddresses} from "../src/PonsAddresses.sol";
import {PonsTemplates} from "../src/PonsTemplates.sol";
import {PonsVaultLauncher} from "../src/PonsVaultLauncher.sol";
import {PonsVaultRegistry} from "../src/PonsVaultRegistry.sol";
import {IPonsLaunchpad} from "../src/interfaces/IPonsLaunchpad.sol";
import {IPonsLocker} from "../src/interfaces/IPonsLocker.sol";
import {ISwapRouter02} from "../src/interfaces/IUniswapV3.sol";
import {PonsVaultBase} from "../src/vaults/PonsVaultBase.sol";
import {PonsRwaVault} from "../src/vaults/PonsRwaVault.sol";
import {PonsRwaVaultFactory} from "../src/factories/PonsRwaVaultFactory.sol";

/// @dev Stands in for a pons token when a config needs rejecting before a real launch could
///      happen. Only `deployer()` matters: it is the one thing the factory authorises against.
contract MockPonsToken {
    address public deployer;

    constructor(address _deployer) {
        deployer = _deployer;
    }
}

/// @dev Exercises the RWA template end to end against live contracts: a real pons launch, real
///      trades generating real LP fees, a real Uniswap purchase of NVDA — a Robinhood stock token
///      — and holders claiming it against a merkle root without ever staking anything.
contract PonsRwaVaultForkTest is Test {
    IPonsLaunchpad constant LAUNCHPAD = IPonsLaunchpad(0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB);

    /// @dev NVIDIA. The only stock token on this chain with WETH liquidity worth routing through
    ///      at the time of writing; most others have a pool that was deployed and never funded.
    address constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    uint24 constant NVDA_FEE = 500;

    /// @dev Deployed but empty, which is the failure mode config validation exists to catch.
    uint24 constant NVDA_DEAD_FEE = 10_000;

    PonsVaultLauncher launcher;
    PonsVaultRegistry registry;
    PonsRwaVaultFactory rwaFactory;

    address creator = makeAddr("creator");
    address distributor = makeAddr("distributor");
    uint256 saltNonce;

    function setUp() public {
        vm.createSelectFork("robinhood", ROBINHOOD_FORK_BLOCK);

        registry = new PonsVaultRegistry();
        rwaFactory = new PonsRwaVaultFactory(distributor);
        registry.register(PonsTemplates.RWA, address(rwaFactory));

        launcher = new PonsVaultLauncher(LAUNCHPAD, PonsAddresses.PONS_ACTIVE_LOCKER, registry);
        vm.deal(creator, 10 ether);
    }

    /* ---------------------------------------------------------------------- */
    /* helpers                                                                */
    /* ---------------------------------------------------------------------- */

    function _metadata() internal pure returns (IPonsLaunchpad.TokenMetadata memory m) {
        m.name = "PonsVault RWA Test";
        m.symbol = "PVR";
        m.logo = "ipfs://placeholder";
        m.description = "PonsVault RWA template";
        m.socials = IPonsLaunchpad.Socials({twitter: "", telegram: "", discord: "", website: "", farcaster: ""});
        m.feeWallet = address(0);
    }

    function _config() internal pure returns (PonsRwaVault.Config memory) {
        return PonsRwaVault.Config({rwaAsset: NVDA, rwaPoolFee: NVDA_FEE, minHarvestWei: 1});
    }

    function _launch() internal returns (address token, PonsRwaVault vault) {
        uint256 fee = LAUNCHPAD.launchFee();
        saltNonce++;

        vm.prank(creator);
        (address tokenAddr, address vaultAddr) = launcher.launchWithVault{value: fee + 0.05 ether}(
            _metadata(),
            0,
            0,
            keccak256(abi.encode("pons-rwa-salt", saltNonce)),
            PonsTemplates.RWA,
            abi.encode(_config())
        );

        // Clear the launch's anti-bot window before any transfers: while it is active the token's
        // per-transaction and per-wallet caps make pool transfers fail with `TF`.
        vm.roll(block.number + 100_000);
        vm.warp(block.timestamp + 200_000);

        return (tokenAddr, PonsRwaVault(vaultAddr));
    }

    /// @dev Buys the token so `trader` becomes a holder, and leaves LP fees behind.
    function _buy(address token, address trader, uint256 amount) internal {
        vm.deal(trader, amount + 1 ether);
        vm.prank(trader);
        ISwapRouter02(PonsAddresses.SWAP_ROUTER_02).exactInputSingle{value: amount}(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: PonsAddresses.WETH,
                tokenOut: token,
                fee: PonsAddresses.POOL_FEE,
                recipient: trader,
                amountIn: amount,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 12);
    }

    /// @dev OpenZeppelin's MerkleProof hashes pairs in sorted order, so the tree must too.
    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }

    /// @dev Computed here rather than read from the vault, so that building a root never makes an
    ///      external call. `vm.prank` applies to the next call of any kind, and a `leafFor` read
    ///      inside a `postRoot` argument silently spends it. {test_leafEncodingMatchesTheContract}
    ///      is what keeps this in step with the contract.
    function _leaf(address account, uint256 amount) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(account, amount))));
    }

    /// @dev A one-leaf tree: the root is the leaf and the proof is empty.
    function _soleRoot(address account, uint256 amount) internal pure returns (bytes32) {
        return _leaf(account, amount);
    }

    function _emptyProof() internal pure returns (bytes32[] memory) {
        return new bytes32[](0);
    }

    /// @dev A two-leaf tree, with the proof for each side.
    function _pairTree(address a, uint256 amountA, address b, uint256 amountB)
        internal
        pure
        returns (bytes32 root, bytes32[] memory proofA, bytes32[] memory proofB)
    {
        bytes32 leafA = _leaf(a, amountA);
        bytes32 leafB = _leaf(b, amountB);

        root = _hashPair(leafA, leafB);

        proofA = new bytes32[](1);
        proofA[0] = leafB;
        proofB = new bytes32[](1);
        proofB[0] = leafA;
    }

    /* ---------------------------------------------------------------------- */
    /* wiring                                                                 */
    /* ---------------------------------------------------------------------- */

    function test_launchWiresRwaVault() public {
        (address token, PonsRwaVault vault) = _launch();

        assertEq(
            IPonsLocker(PonsAddresses.PONS_ACTIVE_LOCKER).feeRedirects(token),
            address(vault),
            "creator fees must route to the RWA vault"
        );
        assertEq(vault.collector(), address(launcher), "launcher is the vault's collector");
        assertEq(vault.token(), token, "vault bound to the launched token");
        assertEq(launcher.vaultOf(token), address(vault), "launcher resolves RWA vaults");
        assertEq(vault.template(), "rwa", "template id must match the frontend");

        (address rwaAsset, uint24 poolFee,) = vault.config();
        assertEq(rwaAsset, NVDA, "configured RWA is what was passed at launch");
        assertEq(poolFee, NVDA_FEE, "configured fee tier is what was passed at launch");
    }

    /// @dev Everything below builds roots with this file's own leaf encoding. If it ever drifts
    ///      from the contract's, every proof in the suite would still verify against a tree built
    ///      the same wrong way, and the tests would pass while real claims failed.
    function test_leafEncodingMatchesTheContract() public {
        (, PonsRwaVault vault) = _launch();

        address account = makeAddr("someHolder");
        assertEq(vault.leafFor(account, 1234e18), _leaf(account, 1234e18), "leaf encodings must agree");
        assertEq(vault.leafFor(address(0), 0), _leaf(address(0), 0), "including at the boundaries");
    }

    /// @dev The creator must not be able to name themselves as the party who decides the split,
    ///      or the vault stops being a guarantee. The factory supplies it, not the launch config.
    function test_creatorCannotChooseTheDistributor() public {
        (, PonsRwaVault vault) = _launch();

        assertEq(vault.distributor(), distributor, "distributor comes from the factory");
        assertTrue(vault.distributor() != creator, "and is emphatically not the creator");

        vm.prank(creator);
        vm.expectPartialRevert(PonsRwaVault.NotDistributor.selector);
        vault.postRoot(0, keccak256("creator's own allocation"));
    }

    /* ---------------------------------------------------------------------- */
    /* the core loop                                                          */
    /* ---------------------------------------------------------------------- */

    /// @dev The whole product in one test: someone buys the token, does nothing else at all, and
    ///      ends up holding NVDA.
    function test_holderEarnsTheStockWithoutStaking() public {
        (address token, PonsRwaVault vault) = _launch();

        address alice = makeAddr("alice");
        _buy(token, alice, 0.05 ether);
        _buy(token, makeAddr("trader1"), 0.05 ether);
        _buy(token, makeAddr("trader2"), 0.05 ether);

        assertEq(IERC20(NVDA).balanceOf(alice), 0, "precondition: holder owns no NVDA");
        uint256 heldBefore = IERC20(token).balanceOf(alice);

        vm.prank(makeAddr("randomKeeper"));
        (uint256 roundId, uint256 amount) = vault.run(0);

        console.log("NVDA bought    :", amount);
        console.log("WETH converted :", vault.totalWethConverted());
        assertEq(roundId, 0, "first run opens round zero");
        assertGt(amount, 0, "fees should have been converted into NVDA");

        PonsRwaVault.Round memory round = vault.rounds(0);
        assertEq(round.snapshotBlock, block.number, "the round pins the block its root is computed at");
        assertEq(round.root, bytes32(0), "and starts with no allocation");

        // The whole round goes to Alice.
        vm.prank(distributor);
        vault.postRoot(0, _soleRoot(alice, amount));

        // Anyone may pay the gas; the proof fixes who gets paid.
        vm.prank(makeAddr("bystander"));
        vault.claim(0, alice, amount, _emptyProof());

        assertEq(IERC20(NVDA).balanceOf(alice), amount, "the holder now owns NVDA");
        assertEq(IERC20(token).balanceOf(alice), heldBefore, "and never gave up custody of anything");
        assertEq(vault.rwaReserved(), 0, "nothing left owed");
        assertEq(vault.totalRwaClaimed(), amount, "lifetime claimed tracks it");
    }

    function test_twoHoldersSplitARound() public {
        (address token, PonsRwaVault vault) = _launch();

        address alice = makeAddr("alice");
        address bob = makeAddr("bob");
        _buy(token, alice, 0.06 ether);
        _buy(token, bob, 0.03 ether);

        (, uint256 amount) = vault.run(0);

        uint256 toAlice = (amount * 2) / 3;
        uint256 toBob = amount - toAlice;
        (bytes32 root, bytes32[] memory proofA, bytes32[] memory proofB) =
            _pairTree(alice, toAlice, bob, toBob);

        vm.prank(distributor);
        vault.postRoot(0, root);

        vault.claim(0, alice, toAlice, proofA);
        vault.claim(0, bob, toBob, proofB);

        assertEq(IERC20(NVDA).balanceOf(alice), toAlice, "alice paid her share");
        assertEq(IERC20(NVDA).balanceOf(bob), toBob, "bob paid his");
        assertEq(vault.rwaReserved(), 0, "the round is fully settled");
    }

    /// @dev No WETH may survive a run: every run converts the whole harvest, so a balance left
    ///      behind would be value no round can ever reach.
    function test_runConvertsEveryLastBitOfWeth() public {
        (address token, PonsRwaVault vault) = _launch();
        _buy(token, makeAddr("trader1"), 0.05 ether);

        vault.run(0);

        assertEq(IERC20(PonsAddresses.WETH).balanceOf(address(vault)), 0, "no WETH may survive a run");
    }

    /// @dev Token-side LP fees are burned rather than paid out, which reaches every holder at once
    ///      without anyone having to claim anything.
    function test_tokenSideFeesAreBurned() public {
        (address token, PonsRwaVault vault) = _launch();

        // Selling generates token-side fees, which buying alone does not.
        address seller = makeAddr("seller");
        _buy(token, seller, 0.05 ether);
        uint256 toSell = IERC20(token).balanceOf(seller);
        vm.startPrank(seller);
        IERC20(token).approve(PonsAddresses.SWAP_ROUTER_02, toSell);
        ISwapRouter02(PonsAddresses.SWAP_ROUTER_02).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: token,
                tokenOut: PonsAddresses.WETH,
                fee: PonsAddresses.POOL_FEE,
                recipient: seller,
                amountIn: toSell,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );
        vm.stopPrank();

        uint256 burnedBefore = vault.totalTokensBurned();
        vault.run(0);

        assertGt(vault.totalTokensBurned(), burnedBefore, "token-side fees should have been burned");
        assertEq(IERC20(token).balanceOf(address(vault)), 0, "and none left sitting in the vault");
    }

    function test_runRevertsWhenNothingHasAccrued() public {
        (address token, PonsRwaVault vault) = _launch();
        _buy(token, makeAddr("trader1"), 0.05 ether);

        vault.run(0);

        vm.expectRevert(PonsVaultBase.NothingToHarvest.selector);
        vault.run(0);
    }

    /// @dev `PonsVaultLauncher.collect` is public, so fees can land here without {run} fetching
    ///      them. A conversion keyed on the harvest delta would buy nothing and strand the money.
    function test_feesCollectedOutOfBandStillGetConverted() public {
        (address token, PonsRwaVault vault) = _launch();
        _buy(token, makeAddr("trader1"), 0.05 ether);

        vm.prank(makeAddr("bystander"));
        launcher.collect(token);

        uint256 sittingHere = IERC20(PonsAddresses.WETH).balanceOf(address(vault));
        assertGt(sittingHere, 0, "precondition: fees arrived without run() fetching them");

        (, uint256 amount) = vault.run(0);
        assertGt(amount, 0, "out-of-band fees must still be converted");
        assertEq(vault.totalWethConverted(), sittingHere, "and all of them spent, not just a delta");
    }

    /// @dev RWA sent here directly is folded into the next round rather than sitting untracked.
    function test_donatedRwaIsFoldedIntoTheNextRound() public {
        (address token, PonsRwaVault vault) = _launch();
        _buy(token, makeAddr("trader1"), 0.05 ether);

        uint256 gift = 1e18;
        deal(NVDA, address(this), gift);
        IERC20(NVDA).transfer(address(vault), gift);

        (, uint256 amount) = vault.run(0);
        assertGt(amount, gift, "the gift is allocated on top of what the run bought");
    }

    /* ---------------------------------------------------------------------- */
    /* the trusted step, and its limits                                       */
    /* ---------------------------------------------------------------------- */

    function test_onlyTheDistributorMayPostARoot() public {
        (address token, PonsRwaVault vault) = _launch();
        _buy(token, makeAddr("trader1"), 0.05 ether);
        vault.run(0);

        vm.prank(makeAddr("stranger"));
        vm.expectPartialRevert(PonsRwaVault.NotDistributor.selector);
        vault.postRoot(0, keccak256("mine now"));
    }

    /// @dev Write-once. A replaceable root would let the split be rewritten after holders had
    ///      already checked it, which is the whole thing anyone is trusting here.
    function test_rootCannotBeReplaced() public {
        (address token, PonsRwaVault vault) = _launch();
        _buy(token, makeAddr("trader1"), 0.05 ether);
        vault.run(0);

        vm.startPrank(distributor);
        vault.postRoot(0, keccak256("first"));
        vm.expectPartialRevert(PonsRwaVault.RootAlreadyPosted.selector);
        vault.postRoot(0, keccak256("second"));
        vm.stopPrank();
    }

    /// @dev The bound that makes the trusted step tolerable: a distributor sets the split, never
    ///      the size. An over-allocated root runs out inside its own round and cannot reach into
    ///      another round's unclaimed balance.
    function test_anOverAllocatedRootCannotReachOtherRounds() public {
        (address token, PonsRwaVault vault) = _launch();

        // Round 0, left unclaimed on purpose so there is something to try to steal.
        address victim = makeAddr("victim");
        _buy(token, victim, 0.05 ether);
        (, uint256 first) = vault.run(0);
        vm.prank(distributor);
        vault.postRoot(0, _soleRoot(victim, first));

        // Round 1, whose root tries to pay out far more than round 1 actually holds.
        _buy(token, makeAddr("trader2"), 0.05 ether);
        (uint256 roundId, uint256 second) = vault.run(0);
        assertEq(roundId, 1, "second run opens a second round");

        address thief = makeAddr("thief");
        uint256 greedy = first + second;
        vm.prank(distributor);
        vault.postRoot(1, _soleRoot(thief, greedy));

        vm.expectPartialRevert(PonsRwaVault.RoundExhausted.selector);
        vault.claim(1, thief, greedy, _emptyProof());

        // The victim's round is untouched and still fully claimable.
        vault.claim(0, victim, first, _emptyProof());
        assertEq(IERC20(NVDA).balanceOf(victim), first, "round zero survived intact");
    }

    function test_claimingTwicePaysOnce() public {
        (address token, PonsRwaVault vault) = _launch();

        address alice = makeAddr("alice");
        _buy(token, alice, 0.05 ether);
        (, uint256 amount) = vault.run(0);

        vm.prank(distributor);
        vault.postRoot(0, _soleRoot(alice, amount));

        vault.claim(0, alice, amount, _emptyProof());

        vm.expectPartialRevert(PonsRwaVault.AlreadyClaimed.selector);
        vault.claim(0, alice, amount, _emptyProof());
    }

    function test_aWrongProofIsRejected() public {
        (address token, PonsRwaVault vault) = _launch();

        address alice = makeAddr("alice");
        address bob = makeAddr("bob");
        _buy(token, alice, 0.05 ether);
        (, uint256 amount) = vault.run(0);

        vm.prank(distributor);
        vault.postRoot(0, _soleRoot(alice, amount));

        // Right round, wrong claimant.
        vm.expectPartialRevert(PonsRwaVault.InvalidProof.selector);
        vault.claim(0, bob, amount, _emptyProof());

        // Right claimant, inflated amount.
        vm.expectPartialRevert(PonsRwaVault.InvalidProof.selector);
        vault.claim(0, alice, amount + 1, _emptyProof());
    }

    function test_cannotClaimBeforeARootExists() public {
        (address token, PonsRwaVault vault) = _launch();

        address alice = makeAddr("alice");
        _buy(token, alice, 0.05 ether);
        (, uint256 amount) = vault.run(0);

        vm.expectPartialRevert(PonsRwaVault.RootNotPosted.selector);
        vault.claim(0, alice, amount, _emptyProof());
    }

    function test_distributorCanRotateItsOwnKeyAndNobodyElseCan() public {
        (, PonsRwaVault vault) = _launch();
        address next = makeAddr("nextKeeper");

        vm.prank(makeAddr("stranger"));
        vm.expectPartialRevert(PonsRwaVault.NotDistributor.selector);
        vault.setDistributor(next);

        vm.prank(distributor);
        vault.setDistributor(next);
        assertEq(vault.distributor(), next, "the key rotated");

        vm.prank(distributor);
        vm.expectPartialRevert(PonsRwaVault.NotDistributor.selector);
        vault.setDistributor(distributor);
    }

    /* ---------------------------------------------------------------------- */
    /* expiry                                                                 */
    /* ---------------------------------------------------------------------- */

    function test_unclaimedRoundsRollForwardAfterTheWindow() public {
        (address token, PonsRwaVault vault) = _launch();

        address alice = makeAddr("alice");
        _buy(token, alice, 0.05 ether);
        (, uint256 first) = vault.run(0);

        vm.prank(distributor);
        vault.postRoot(0, _soleRoot(alice, first));

        // Nobody claims.
        vm.expectPartialRevert(PonsRwaVault.RoundNotExpired.selector);
        vault.reclaimExpired(0);

        vm.warp(block.timestamp + vault.CLAIM_WINDOW());
        uint256 returned = vault.reclaimExpired(0);
        assertEq(returned, first, "the whole unclaimed round comes back");
        assertEq(vault.rwaReserved(), 0, "and is no longer owed to anyone");
        assertEq(vault.undistributedRwa(), first, "it is waiting for the next round");

        // And the next run allocates it again, on top of whatever it buys.
        _buy(token, makeAddr("trader2"), 0.05 ether);
        (, uint256 second) = vault.run(0);
        assertGt(second, first, "the rolled-forward balance is included in the new round");
    }

    /// @dev A round whose root never arrives must not strand value here forever. With no root
    ///      nothing was ever claimable, so the whole amount comes back.
    function test_aRoundWhoseRootNeverArrivesCanBeRecovered() public {
        (address token, PonsRwaVault vault) = _launch();
        _buy(token, makeAddr("trader1"), 0.05 ether);
        (, uint256 amount) = vault.run(0);

        vm.warp(block.timestamp + vault.CLAIM_WINDOW());
        assertEq(vault.reclaimExpired(0), amount, "an unallocated round is fully recoverable");
    }

    function test_aRoundCannotBeReclaimedTwice() public {
        (address token, PonsRwaVault vault) = _launch();
        _buy(token, makeAddr("trader1"), 0.05 ether);
        vault.run(0);

        vm.warp(block.timestamp + vault.CLAIM_WINDOW());
        vault.reclaimExpired(0);

        vm.expectPartialRevert(PonsRwaVault.NothingToReclaim.selector);
        vault.reclaimExpired(0);
    }

    /* ---------------------------------------------------------------------- */
    /* slippage floor                                                         */
    /* ---------------------------------------------------------------------- */

    function test_callerSuppliedFloorIsEnforced() public {
        (address token, PonsRwaVault vault) = _launch();
        _buy(token, makeAddr("trader1"), 0.05 ether);

        vm.expectRevert(bytes("Too little received"));
        vault.run(1_000_000e18);

        (, uint256 amount) = vault.run(0);
        assertGt(amount, 0, "the harvest was still intact after the reverted attempt");
    }

    /* ---------------------------------------------------------------------- */
    /* config validation                                                      */
    /* ---------------------------------------------------------------------- */

    /// @dev A vault's route is immutable, so a bad one is not a bad first run — it is a contract
    ///      that can never pay anything for as long as it exists. The mock is always deployed
    ///      before the revert is armed: `expectRevert` binds to the next call of any kind.
    function _create(MockPonsToken mock, PonsRwaVault.Config memory cfg) internal returns (address) {
        return rwaFactory.createVault(address(mock), PonsAddresses.PONS_ACTIVE_LOCKER, abi.encode(cfg));
    }

    function test_rejectsRwaPoolThatDoesNotExist() public {
        MockPonsToken mock = new MockPonsToken(address(this));
        PonsRwaVault.Config memory cfg = _config();
        cfg.rwaPoolFee = 100; // no NVDA/WETH pool was ever deployed at this tier

        vm.expectRevert(abi.encodeWithSelector(PonsRwaVault.RwaPoolNotFound.selector, NVDA, uint24(100)));
        _create(mock, cfg);
    }

    /// @dev The nastier of the two: the pool exists, so a naive existence check passes, and every
    ///      swap through it reverts forever.
    function test_rejectsRwaPoolThatExistsButIsEmpty() public {
        MockPonsToken mock = new MockPonsToken(address(this));
        PonsRwaVault.Config memory cfg = _config();
        cfg.rwaPoolFee = NVDA_DEAD_FEE;

        vm.expectPartialRevert(PonsRwaVault.RwaPoolEmpty.selector);
        _create(mock, cfg);
    }

    function test_rejectsWethAsTheRwaAsset() public {
        MockPonsToken mock = new MockPonsToken(address(this));
        PonsRwaVault.Config memory cfg = _config();
        cfg.rwaAsset = PonsAddresses.WETH;

        vm.expectRevert(PonsRwaVault.InvalidRwaAsset.selector);
        _create(mock, cfg);
    }

    function test_rejectsTheTokenItselfAsTheRwaAsset() public {
        MockPonsToken mock = new MockPonsToken(address(this));
        PonsRwaVault.Config memory cfg = _config();
        cfg.rwaAsset = address(mock);

        vm.expectRevert(PonsRwaVault.InvalidRwaAsset.selector);
        _create(mock, cfg);
    }

    function test_rejectsZeroRwaAsset() public {
        MockPonsToken mock = new MockPonsToken(address(this));
        PonsRwaVault.Config memory cfg = _config();
        cfg.rwaAsset = address(0);

        vm.expectRevert(PonsVaultBase.ZeroAddress.selector);
        _create(mock, cfg);
    }

    function test_acceptsAValidConfig() public {
        MockPonsToken mock = new MockPonsToken(address(this));
        address vault = _create(mock, _config());

        assertTrue(vault != address(0), "a well-formed config must be accepted");
        assertEq(PonsRwaVault(vault).rwaPool(), 0x62AB521f71431f78ac374CdbadC6cda3c8916b6C, "resolves its route");
        assertEq(PonsRwaVault(vault).distributor(), distributor, "factory stamps the distributor in");
    }

    /// @dev Only the token's deployer may create its vault, or anyone could front-run a launch and
    ///      bind a token to a vault paying out an asset of their choosing.
    function test_onlyTokenDeployerCanCreateVault() public {
        MockPonsToken mock = new MockPonsToken(address(this));

        vm.prank(makeAddr("stranger"));
        vm.expectPartialRevert(PonsRwaVaultFactory.NotTokenDeployer.selector);
        rwaFactory.createVault(address(mock), PonsAddresses.PONS_ACTIVE_LOCKER, abi.encode(_config()));
    }
}
