// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/token/ERC20/IERC20.sol";

import {PonsAddresses} from "../src/PonsAddresses.sol";
import {PonsTemplates} from "../src/PonsTemplates.sol";
import {PonsVaultLauncher} from "../src/PonsVaultLauncher.sol";
import {PonsVaultRegistry} from "../src/PonsVaultRegistry.sol";
import {IPonsLaunchpad} from "../src/interfaces/IPonsLaunchpad.sol";
import {IPonsLocker} from "../src/interfaces/IPonsLocker.sol";
import {ISwapRouter02} from "../src/interfaces/IUniswapV3.sol";
import {PonsStakingVault} from "../src/vaults/PonsStakingVault.sol";
import {PonsBuybackBurnVaultFactory} from "../src/factories/PonsBuybackBurnVaultFactory.sol";
import {PonsStakingVaultFactory} from "../src/factories/PonsStakingVaultFactory.sol";

/// @dev Exercises the staking template against live pons contracts: fees earned by a real Uniswap
///      position are swept by the launcher and split across real stakers.
contract PonsStakingVaultForkTest is Test {
    IPonsLaunchpad constant LAUNCHPAD = IPonsLaunchpad(0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB);

    PonsVaultLauncher launcher;
    PonsVaultRegistry registry;
    PonsStakingVaultFactory stakingFactory;

    address creator = makeAddr("creator");
    uint256 saltNonce;

    function setUp() public {
        vm.createSelectFork("robinhood");

        registry = new PonsVaultRegistry();
        stakingFactory = new PonsStakingVaultFactory();
        registry.register(PonsTemplates.STAKING, address(stakingFactory));
        registry.register(PonsTemplates.BUYBACK_BURN, address(new PonsBuybackBurnVaultFactory()));

        launcher = new PonsVaultLauncher(LAUNCHPAD, PonsAddresses.PONS_ACTIVE_LOCKER, registry);
        vm.deal(creator, 10 ether);
    }

    function _metadata() internal pure returns (IPonsLaunchpad.TokenMetadata memory m) {
        m.name = "PonsVault Staking Test";
        m.symbol = "PVS";
        m.logo = "ipfs://placeholder";
        m.description = "PonsVault staking template";
        m.socials = IPonsLaunchpad.Socials({twitter: "", telegram: "", discord: "", website: "", farcaster: ""});
        m.feeWallet = address(0);
    }

    function _config(uint32 lockPeriod) internal pure returns (PonsStakingVault.Config memory) {
        return PonsStakingVault.Config({lockPeriod: lockPeriod, minHarvestWei: 1, cooldown: 30 minutes});
    }

    function _launch(uint32 lockPeriod) internal returns (address token, PonsStakingVault vault) {
        uint256 fee = LAUNCHPAD.launchFee();
        saltNonce++;

        vm.prank(creator);
        (address tokenAddr, address vaultAddr) = launcher.launchWithVault{value: fee + 0.05 ether}(
            _metadata(),
            0,
            0,
            keccak256(abi.encode("pons-staking-salt", saltNonce)),
            PonsTemplates.STAKING,
            abi.encode(_config(lockPeriod))
        );

        // Clear the launch's anti-bot window before any transfers: while it is active the token's
        // per-transaction and per-wallet caps make pool transfers fail with `TF`.
        vm.roll(block.number + 100_000);
        vm.warp(block.timestamp + 200_000);

        return (tokenAddr, PonsStakingVault(vaultAddr));
    }

    /// @dev Buys the token so `trader` has a balance to stake, and leaves LP fees behind.
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

    function _stake(address token, PonsStakingVault vault, address account, uint256 amount) internal {
        vm.startPrank(account);
        IERC20(token).approve(address(vault), amount);
        vault.stake(amount);
        vm.stopPrank();
    }

    function test_launchWiresStakingVault() public {
        (address token, PonsStakingVault vault) = _launch(0);

        assertEq(
            IPonsLocker(PonsAddresses.PONS_ACTIVE_LOCKER).feeRedirects(token),
            address(vault),
            "creator fees must route to the staking vault"
        );
        assertEq(vault.collector(), address(launcher), "launcher is the vault's collector");
        assertEq(vault.token(), token, "vault bound to the launched token");
        assertEq(launcher.vaultOf(token), address(vault), "launcher resolves staking vaults too");
        assertEq(stakingFactory.vaultOf(token), address(vault), "factory should index the vault");
    }

    function test_runRevertsWhenNobodyStaked() public {
        (address token, PonsStakingVault vault) = _launch(0);
        _buy(token, makeAddr("trader"), 0.05 ether);

        vm.expectRevert(PonsStakingVault.NoStakers.selector);
        vault.run();

        // The revert must roll the harvest back rather than strand fees here, so the backlog is
        // still collectible once someone stakes.
        (uint256 idleWeth,) = vault.idleBalances();
        assertEq(idleWeth, 0, "failed run must not leave fees sitting in the vault");
    }

    function test_stakerEarnsAndClaimsFees() public {
        (address token, PonsStakingVault vault) = _launch(0);

        address alice = makeAddr("alice");
        _buy(token, alice, 0.05 ether);
        _stake(token, vault, alice, IERC20(token).balanceOf(alice));

        // Trades after the stake are what generate the fees being distributed.
        _buy(token, makeAddr("trader1"), 0.05 ether);
        _buy(token, makeAddr("trader2"), 0.05 ether);

        vm.prank(makeAddr("randomKeeper"));
        (uint256 wethDistributed, uint256 tokenDistributed) = vault.run();

        console.log("weth distributed :", wethDistributed);
        console.log("token distributed:", tokenDistributed);
        assertGt(wethDistributed, 0, "fees should have been swept and distributed");

        (uint256 pendingWeth,) = vault.pendingRewards(alice);
        assertApproxEqAbs(pendingWeth, wethDistributed, 1, "sole staker earns everything bar rounding dust");

        uint256 wethBefore = IERC20(PonsAddresses.WETH).balanceOf(alice);
        vm.prank(alice);
        (uint256 claimedWeth,) = vault.claim();

        assertEq(claimedWeth, pendingWeth, "claim pays exactly what was pending");
        assertEq(IERC20(PonsAddresses.WETH).balanceOf(alice) - wethBefore, claimedWeth, "WETH actually delivered");

        (uint256 stillPending,) = vault.pendingRewards(alice);
        assertEq(stillPending, 0, "nothing left after claiming");
    }

    /// @dev Claiming must advance the staker's baseline, not just pay out against it. Without that
    ///      the same rewards stay claimable on every call and one staker can drain the vault.
    function test_claimingTwicePaysOnce() public {
        (address token, PonsStakingVault vault) = _launch(0);

        address alice = makeAddr("alice");
        _buy(token, alice, 0.05 ether);
        _stake(token, vault, alice, IERC20(token).balanceOf(alice));

        _buy(token, makeAddr("trader1"), 0.05 ether);
        vault.run();

        vm.prank(alice);
        (uint256 first,) = vault.claim();
        assertGt(first, 0, "first claim pays");

        vm.prank(alice);
        (uint256 second,) = vault.claim();
        assertEq(second, 0, "a second claim with no new distribution pays nothing");
    }

    function test_rewardsSplitProRata() public {
        (address token, PonsStakingVault vault) = _launch(0);

        address alice = makeAddr("alice");
        address bob = makeAddr("bob");
        _buy(token, alice, 0.05 ether);
        _buy(token, bob, 0.05 ether);

        // Alice stakes twice what Bob does, so she should earn twice as much.
        uint256 bobStake = IERC20(token).balanceOf(bob) / 2;
        _stake(token, vault, alice, bobStake * 2);
        _stake(token, vault, bob, bobStake);

        _buy(token, makeAddr("trader1"), 0.08 ether);

        vault.run();

        (uint256 alicePending,) = vault.pendingRewards(alice);
        (uint256 bobPending,) = vault.pendingRewards(bob);

        assertGt(bobPending, 0, "both stakers earn");
        assertApproxEqRel(alicePending, bobPending * 2, 1e12, "double the stake earns double the fees");
    }

    function test_lateStakerEarnsNothingFromEarlierRun() public {
        (address token, PonsStakingVault vault) = _launch(0);

        address alice = makeAddr("alice");
        address bob = makeAddr("bob");
        _buy(token, alice, 0.05 ether);
        _buy(token, bob, 0.05 ether);

        _stake(token, vault, alice, IERC20(token).balanceOf(alice));
        _buy(token, makeAddr("trader1"), 0.05 ether);
        vault.run();

        _stake(token, vault, bob, IERC20(token).balanceOf(bob));

        (uint256 bobPending,) = vault.pendingRewards(bob);
        assertEq(bobPending, 0, "staking after a distribution must not claw back earlier fees");
    }

    function test_lockPreventsEarlyUnstake() public {
        (address token, PonsStakingVault vault) = _launch(7 days);

        address alice = makeAddr("alice");
        _buy(token, alice, 0.05 ether);
        uint256 amount = IERC20(token).balanceOf(alice);
        _stake(token, vault, alice, amount);

        (,,, uint256 unlockAt,) = vault.positionOf(alice);
        assertEq(unlockAt, block.timestamp + 7 days, "lock runs from the deposit");

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PonsStakingVault.StakeLocked.selector, unlockAt));
        vault.unstake(amount);

        vm.warp(unlockAt);
        vm.prank(alice);
        vault.unstake(amount);

        assertEq(IERC20(token).balanceOf(alice), amount, "principal returned in full");
        assertEq(vault.totalStaked(), 0, "stake accounting cleared");
    }

    function test_claimStaysOpenWhilePrincipalIsLocked() public {
        (address token, PonsStakingVault vault) = _launch(7 days);

        address alice = makeAddr("alice");
        _buy(token, alice, 0.05 ether);
        _stake(token, vault, alice, IERC20(token).balanceOf(alice));

        _buy(token, makeAddr("trader1"), 0.05 ether);
        vault.run();

        vm.prank(alice);
        (uint256 claimedWeth,) = vault.claim();
        assertGt(claimedWeth, 0, "rewards are never locked, only principal");
    }

    function test_unstakePreservesUnclaimedRewards() public {
        (address token, PonsStakingVault vault) = _launch(0);

        address alice = makeAddr("alice");
        _buy(token, alice, 0.05 ether);
        uint256 amount = IERC20(token).balanceOf(alice);
        _stake(token, vault, alice, amount);

        _buy(token, makeAddr("trader1"), 0.05 ether);
        vault.run();

        (uint256 pendingBefore,) = vault.pendingRewards(alice);

        vm.prank(alice);
        vault.unstake(amount);

        (uint256 pendingAfter,) = vault.pendingRewards(alice);
        assertEq(pendingAfter, pendingBefore, "unstaking must not forfeit already-earned rewards");

        vm.prank(alice);
        (uint256 claimedWeth,) = vault.claim();
        assertEq(claimedWeth, pendingBefore, "and they remain claimable afterwards");
    }

    /// @dev The staked token is also a reward token, so principal and rewards share one balance.
    ///      This is the case where confusing the two would let a staker withdraw someone else's
    ///      money, so it is worth pinning down explicitly.
    function test_principalIsNeverPaidOutAsRewards() public {
        (address token, PonsStakingVault vault) = _launch(0);

        address alice = makeAddr("alice");
        address bob = makeAddr("bob");
        _buy(token, alice, 0.05 ether);
        _buy(token, bob, 0.05 ether);

        uint256 aliceStake = IERC20(token).balanceOf(alice);
        uint256 bobStake = IERC20(token).balanceOf(bob);
        _stake(token, vault, alice, aliceStake);
        _stake(token, vault, bob, bobStake);

        _buy(token, makeAddr("trader1"), 0.05 ether);
        vault.run();

        vm.prank(alice);
        vault.claim();
        vm.prank(alice);
        vault.unstake(aliceStake);

        // Bob must still be able to take everything he is owed after Alice has fully exited.
        vm.prank(bob);
        vault.claim();
        vm.prank(bob);
        vault.unstake(bobStake);

        assertGe(IERC20(token).balanceOf(bob), bobStake, "bob recovers at least his principal");
        assertEq(vault.totalStaked(), 0, "no phantom stake left behind");
    }
}
