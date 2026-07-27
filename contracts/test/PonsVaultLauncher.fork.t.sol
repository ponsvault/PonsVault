// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/token/ERC20/IERC20.sol";

import {PonsAddresses} from "../src/PonsAddresses.sol";
import {PonsTemplates} from "../src/PonsTemplates.sol";
import {PonsVaultLauncher} from "../src/PonsVaultLauncher.sol";
import {PonsVaultRegistry} from "../src/PonsVaultRegistry.sol";
import {IPonsLaunchpad, IPonsToken} from "../src/interfaces/IPonsLaunchpad.sol";
import {IPonsLocker} from "../src/interfaces/IPonsLocker.sol";
import {ISwapRouter02} from "../src/interfaces/IUniswapV3.sol";
import {PonsBuybackBurnVault} from "../src/vaults/PonsBuybackBurnVault.sol";
import {PonsStakingVault} from "../src/vaults/PonsStakingVault.sol";
import {PonsBuybackBurnVaultFactory} from "../src/factories/PonsBuybackBurnVaultFactory.sol";
import {PonsStakingVaultFactory} from "../src/factories/PonsStakingVaultFactory.sol";

/// @dev Launch path: the launcher performs the launch, so it becomes the token's on-chain deployer
///      and can wire the fee redirect plus expose a permissionless sweep. This is the configuration
///      where buyback-and-burn runs with no privileged party in the loop.
contract PonsVaultLauncherForkTest is Test {
    IPonsLaunchpad constant LAUNCHPAD = IPonsLaunchpad(0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB);

    PonsVaultLauncher launcher;
    PonsVaultRegistry registry;
    PonsBuybackBurnVaultFactory vaultFactory;

    address creator = makeAddr("creator");
    address treasury = makeAddr("treasury");

    function setUp() public {
        vm.createSelectFork("robinhood");

        registry = new PonsVaultRegistry();
        vaultFactory = new PonsBuybackBurnVaultFactory();
        registry.register(PonsTemplates.BUYBACK_BURN, address(vaultFactory));
        registry.register(PonsTemplates.STAKING, address(new PonsStakingVaultFactory()));

        launcher = new PonsVaultLauncher(LAUNCHPAD, PonsAddresses.PONS_ACTIVE_LOCKER, registry);
        vm.deal(creator, 10 ether);
    }

    function _launch(bytes32 salt) internal returns (address token, address vault) {
        uint256 fee = LAUNCHPAD.launchFee();
        vm.prank(creator);
        return launcher.launchWithVault{value: fee + 0.05 ether}(
            _metadata(), 0, 0, salt, PonsTemplates.BUYBACK_BURN, abi.encode(_config())
        );
    }

    function _metadata() internal pure returns (IPonsLaunchpad.TokenMetadata memory m) {
        m.name = "PonsVault Test";
        m.symbol = "PVT";
        m.logo = "ipfs://placeholder";
        m.description = "PonsVault buyback and burn template";
        m.socials = IPonsLaunchpad.Socials({twitter: "", telegram: "", discord: "", website: "", farcaster: ""});
        m.feeWallet = address(0);
    }

    function _config() internal view returns (PonsBuybackBurnVault.Config memory) {
        return PonsBuybackBurnVault.Config({burnBps: 10_000, treasury: treasury, minHarvestWei: 1});
    }

    function test_launchWiresVaultToCreatorFees() public {
        assertTrue(LAUNCHPAD.launchEnabled(), "pons launches should be enabled");

        (address token, address vault) = _launch(keccak256("pons-vault-salt-1"));

        console.log("token :", token);
        console.log("vault :", vault);

        assertEq(IPonsToken(token).deployer(), address(launcher), "launcher must be the on-chain deployer");
        assertEq(
            IPonsLocker(PonsAddresses.PONS_ACTIVE_LOCKER).feeRedirects(token),
            vault,
            "creator fees must route to the vault"
        );
        assertEq(vaultFactory.vaultOf(token), vault, "factory should index the vault");
        assertEq(launcher.vaultOf(token), vault, "launcher should index the vault");
        assertEq(launcher.templateOf(token), PonsTemplates.BUYBACK_BURN, "template recorded");
        assertEq(launcher.creatorOf(token), creator, "creator attribution preserved");
        assertEq(PonsBuybackBurnVault(vault).collector(), address(launcher), "launcher is the vault's collector");
    }

    function test_fullyPermissionlessBuybackAfterTrades() public {
        (address token, address vaultAddr) = _launch(keccak256("pons-vault-salt-2"));
        PonsBuybackBurnVault vault = PonsBuybackBurnVault(vaultAddr);

        // Move past the launch's anti-bot restriction window before trading, otherwise the token's
        // per-transaction and per-wallet caps make the pool transfer fail with `TF`.
        vm.roll(block.number + 100_000);
        vm.warp(block.timestamp + 200_000);

        // Generate LP fees with real trades, spread across wallets to stay clear of any wallet cap.
        for (uint256 i = 0; i < 3; i++) {
            address trader = makeAddr(string.concat("trader", vm.toString(i)));
            vm.deal(trader, 1 ether);
            vm.prank(trader);
            ISwapRouter02(PonsAddresses.SWAP_ROUTER_02).exactInputSingle{value: 0.05 ether}(
                ISwapRouter02.ExactInputSingleParams({
                    tokenIn: PonsAddresses.WETH,
                    tokenOut: token,
                    fee: PonsAddresses.POOL_FEE,
                    recipient: trader,
                    amountIn: 0.05 ether,
                    amountOutMinimum: 0,
                    sqrtPriceLimitX96: 0
                })
            );
            vm.roll(block.number + 1);
            vm.warp(block.timestamp + 12);
        }

        uint256 deadBefore = IERC20(token).balanceOf(PonsAddresses.BURN_ADDRESS);

        // No privileged caller anywhere in this flow.
        vm.prank(makeAddr("randomKeeper"));
        (uint256 wethSpent, uint256 tokensBurned) = vault.run(0);

        console.log("weth harvested :", vault.totalWethHarvested());
        console.log("weth spent     :", wethSpent);
        console.log("tokens burned  :", tokensBurned);

        assertGt(vault.totalWethHarvested(), 0, "launcher sweep should have pulled fees into the vault");
        assertGt(tokensBurned, 0, "tokens should have been burned");
        assertEq(IERC20(token).balanceOf(PonsAddresses.BURN_ADDRESS) - deadBefore, tokensBurned, "burn accounted");
        assertEq(vault.totalTreasuryPaid(), 0, "burnBps 10000 leaves nothing for treasury");
    }

    /// @dev pons pays a launch's initial buy to `metadata.feeWallet`, not to the caller. The launcher
    ///      used to name itself there, so the creator paid for tokens that landed in a contract with
    ///      no way to move an ERC-20 and no way to be replaced. Every launch in this suite passes a
    ///      dev buy and none of them checked where it went, which is how that survived.
    function test_devBuyReachesTheCreator() public {
        (address token,) = _launch(keccak256("pons-vault-salt-devbuy"));

        assertGt(IERC20(token).balanceOf(creator), 0, "creator must receive the initial buy they paid for");
        assertEq(IERC20(token).balanceOf(address(launcher)), 0, "launcher must never hold the initial buy");
    }

    /// @dev Naming the creator as fee wallet seeds the locker's redirect with their wallet, so the
    ///      launch has to overwrite it. If it ever failed to, fees would silently pay the creator
    ///      directly and the vault would never see a thing — which looks fine until nothing burns.
    function test_devBuyToCreatorStillLeavesFeesGoingToTheVault() public {
        (address token, address vault) = _launch(keccak256("pons-vault-salt-devbuy-redirect"));

        assertEq(
            IPonsLocker(PonsAddresses.PONS_ACTIVE_LOCKER).feeRedirects(token),
            vault,
            "redirect must end up at the vault, not the creator who received the dev buy"
        );
        assertTrue(vault != creator, "sanity: vault is not the creator");
    }

    function test_launchWithoutDevBuyMovesNothing() public {
        uint256 fee = LAUNCHPAD.launchFee();
        vm.prank(creator);
        (address token,) = launcher.launchWithVault{value: fee}(
            _metadata(), 0, 0, keccak256("pons-vault-salt-nodevbuy"), PonsTemplates.BUYBACK_BURN, abi.encode(_config())
        );

        assertEq(IERC20(token).balanceOf(creator), 0, "no buy means no tokens");
        assertEq(IERC20(token).balanceOf(address(launcher)), 0, "and nothing held back");
    }

    /// @dev The insurance path. Anyone may trigger it; only the recorded creator can receive it.
    function test_sweepToCreatorPaysTheCreatorNotTheCaller() public {
        (address token,) = _launch(keccak256("pons-vault-salt-sweep"));

        // Stand in for tokens reaching the launcher by some route the launch path does not create.
        deal(token, address(launcher), 1_000e18);
        uint256 creatorBefore = IERC20(token).balanceOf(creator);

        address opportunist = makeAddr("opportunist");
        vm.prank(opportunist);
        uint256 swept = launcher.sweepToCreator(token);

        assertEq(swept, 1_000e18, "sweep moves the whole held balance");
        assertEq(IERC20(token).balanceOf(creator) - creatorBefore, 1_000e18, "creator receives it");
        assertEq(IERC20(token).balanceOf(opportunist), 0, "the caller receives nothing");
        assertEq(IERC20(token).balanceOf(address(launcher)), 0, "nothing left behind");
    }

    function test_sweepRejectsTokensThisLauncherDidNotLaunch() public {
        vm.expectRevert(abi.encodeWithSelector(PonsVaultLauncher.NotLaunchedHere.selector, PonsAddresses.WETH));
        launcher.sweepToCreator(PonsAddresses.WETH);
    }

    function test_sweepRevertsWhenNothingIsHeld() public {
        (address token,) = _launch(keccak256("pons-vault-salt-empty-sweep"));

        vm.expectRevert(PonsVaultLauncher.NothingToSweep.selector);
        launcher.sweepToCreator(token);
    }

    function test_collectIsPermissionless() public {
        (address token,) = _launch(keccak256("pons-vault-salt-3"));

        vm.prank(makeAddr("anyone"));
        launcher.collect(token);
    }

    /// @dev The point of the registry: an unregistered template must fail before the launch, not
    ///      after, or the caller pays the pons launch fee for a token with no vault attached.
    function test_unknownTemplateRevertsBeforeLaunching() public {
        uint256 fee = LAUNCHPAD.launchFee();
        // forge-lint: disable-next-line(unsafe-typecast)
        bytes32 unknown = bytes32("unknown-template");

        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(PonsVaultRegistry.UnknownTemplate.selector, unknown));
        launcher.launchWithVault{value: fee + 0.01 ether}(
            _metadata(), 0, 0, keccak256("pons-vault-salt-4"), unknown, abi.encode(_config())
        );
    }

    /// @dev Retiring stops new launches choosing a template without disturbing its live vaults.
    function test_retiredTemplateCannotBeLaunched() public {
        (address token, address vault) = _launch(keccak256("pons-vault-salt-5"));

        registry.retire(PonsTemplates.BUYBACK_BURN);

        uint256 fee = LAUNCHPAD.launchFee();
        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(PonsVaultRegistry.TemplateNotAvailable.selector, PonsTemplates.BUYBACK_BURN)
        );
        launcher.launchWithVault{value: fee + 0.01 ether}(
            _metadata(), 0, 0, keccak256("pons-vault-salt-6"), PonsTemplates.BUYBACK_BURN, abi.encode(_config())
        );

        assertEq(launcher.vaultOf(token), vault, "existing vault still resolves after retirement");
    }

    /// @dev The whole reason the registry exists: a template can be added to a live stack without
    ///      redeploying the launcher, and tokens launched before it are untouched.
    function test_newTemplateNeedsNoLauncherRedeploy() public {
        (address existingToken, address existingVault) = _launch(keccak256("pons-vault-salt-7"));
        address launcherBefore = address(launcher);

        // Stands in for a template that does not exist yet. Registering it is one transaction.
        // forge-lint: disable-next-line(unsafe-typecast)
        bytes32 newTemplate = bytes32("staking-v2");
        registry.register(newTemplate, address(new PonsStakingVaultFactory()));

        uint256 fee = LAUNCHPAD.launchFee();
        vm.prank(creator);
        (address token, address vault) = launcher.launchWithVault{value: fee + 0.01 ether}(
            _metadata(),
            0,
            0,
            keccak256("pons-vault-salt-8"),
            newTemplate,
            abi.encode(PonsStakingVault.Config({lockPeriod: 0, minHarvestWei: 1}))
        );

        assertEq(address(launcher), launcherBefore, "launcher address unchanged");
        assertEq(launcher.templateOf(token), newTemplate, "new template recorded");
        assertEq(
            IPonsLocker(PonsAddresses.PONS_ACTIVE_LOCKER).feeRedirects(token), vault, "fees routed to the new vault"
        );
        assertEq(launcher.vaultOf(existingToken), existingVault, "earlier launches unaffected");
    }
}
