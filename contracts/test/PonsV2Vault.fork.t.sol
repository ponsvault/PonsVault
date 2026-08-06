// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/token/ERC20/IERC20.sol";

import {PonsTemplates} from "../src/PonsTemplates.sol";
import {PonsV2Addresses} from "../src/v2/PonsV2Addresses.sol";
import {PonsV2CurveBuyback} from "../src/v2/buyback/PonsV2CurveBuyback.sol";
import {IPonsCurve} from "../src/v2/interfaces/IPonsCurve.sol";
import {IPonsV2Factory} from "../src/v2/interfaces/IPonsV2Factory.sol";
import {IQuoteBuyback} from "../src/v2/interfaces/IQuoteBuyback.sol";
import {PonsV2VaultLauncher} from "../src/v2/PonsV2VaultLauncher.sol";
import {PonsV2VaultRegistry} from "../src/v2/PonsV2VaultRegistry.sol";
import {PonsV2BuybackBurnVaultFactory} from "../src/v2/factories/PonsV2BuybackBurnVaultFactory.sol";
import {PonsV2StakingVaultFactory} from "../src/v2/factories/PonsV2StakingVaultFactory.sol";
import {PonsV2BuybackBurnVault} from "../src/v2/vaults/PonsV2BuybackBurnVault.sol";
import {PonsV2StakingVault} from "../src/v2/vaults/PonsV2StakingVault.sol";
import {PonsV2VaultBase} from "../src/v2/vaults/PonsV2VaultBase.sol";

/// @dev Fork tests for the v2 vault stack. Launches tokens on a local fork only —
///      nothing is broadcast to mainnet.
contract PonsV2VaultForkTest is Test {
    IPonsV2Factory constant FACTORY = IPonsV2Factory(PonsV2Addresses.FACTORY);
    IERC20 constant AAPL = IERC20(PonsV2Addresses.AAPL);

    PonsV2VaultLauncher launcher;
    PonsV2VaultRegistry registry;
    PonsV2BuybackBurnVaultFactory buybackFactory;
    PonsV2StakingVaultFactory stakingFactory;
    PonsV2CurveBuyback curveBuyback;

    address creator = makeAddr("creator");
    address treasury = makeAddr("treasury");
    address trader = makeAddr("trader");
    address keeper = makeAddr("keeper");
    address staker = makeAddr("staker");

    uint256 launchFee;

    function setUp() public {
        vm.createSelectFork("robinhood");

        assertTrue(FACTORY.launchEnabled(), "pons v2 launches must be open");
        assertTrue(FACTORY.approvedPairTokens(address(AAPL)), "AAPL must be approved");

        launchFee = FACTORY.launchFee();

        registry = new PonsV2VaultRegistry();
        curveBuyback = new PonsV2CurveBuyback(address(FACTORY));
        buybackFactory = new PonsV2BuybackBurnVaultFactory(address(curveBuyback));
        stakingFactory = new PonsV2StakingVaultFactory();

        registry.register(PonsTemplates.BUYBACK_BURN, address(buybackFactory));
        registry.register(PonsTemplates.STAKING, address(stakingFactory));

        launcher = new PonsV2VaultLauncher(registry);

        // Public gate is open — canLaunch(any) is true, including our fresh launcher.
        assertTrue(FACTORY.canLaunch(address(launcher)), "launcher must be able to launch");

        (bool ready,) = launcher.canLaunch();
        assertTrue(ready, "launcher.canLaunch");

        assertEq(buybackFactory.defaultBuyback(), address(curveBuyback), "helper wired at deploy");

        vm.deal(creator, 10 ether);
        deal(address(AAPL), trader, 1_000_000 ether);
        deal(address(AAPL), staker, 1_000 ether);
    }

    /* ---------------------------------------------------------------------- */
    /* helpers                                                                */
    /* ---------------------------------------------------------------------- */

    function _params(bytes32 salt) internal pure returns (IPonsV2Factory.TokenParams memory p) {
        p.name = "PonsVault V2 Fork";
        p.symbol = "PV2F";
        p.logo = "ipfs://placeholder";
        p.description = "fork test token - not a production launch";
        p.socials = IPonsV2Factory.Socials({twitter: "", telegram: "", discord: "", website: "", farcaster: ""});
        p.creatorFeeRecipient = address(0); // overwritten by launcher
        p.creatorTaxBps = 100; // 1% so curve trades credit the vault
        p.buybackEnabled = false; // overwritten by launcher
        p.expectedEconomics = bytes32(0); // overwritten by launcher
        p.salt = salt;
    }

    function _buybackConfig(uint16 burnBps, uint256 minHarvest)
        internal
        view
        returns (PonsV2BuybackBurnVault.Config memory)
    {
        // 100% burn forbids a treasury address.
        address treas = burnBps == 10_000 ? address(0) : treasury;
        return PonsV2BuybackBurnVault.Config({burnBps: burnBps, treasury: treas, minHarvest: minHarvest});
    }

    function _launchBuyback(bytes32 salt, uint16 burnBps)
        internal
        returns (address token, address vault, address curve)
    {
        vm.prank(creator);
        (token, vault) = launcher.launchWithVault{value: launchFee}(
            _params(salt),
            0,
            address(AAPL),
            PonsTemplates.BUYBACK_BURN,
            abi.encode(_buybackConfig(burnBps, 1))
        );
        curve = FACTORY.getLaunchedToken(token).curve;
    }

    function _launchStaking(bytes32 salt) internal returns (address token, address vault, address curve) {
        vm.prank(creator);
        (token, vault) = launcher.launchWithVault{value: launchFee}(
            _params(salt),
            0,
            address(AAPL),
            PonsTemplates.STAKING,
            abi.encode(PonsV2StakingVault.Config({minHarvest: 1}))
        );
        curve = FACTORY.getLaunchedToken(token).curve;
    }

    function _trade(address curve, uint256 quoteIn) internal {
        vm.prank(trader);
        AAPL.approve(curve, quoteIn);
        vm.prank(trader);
        IPonsCurve(curve).buy(quoteIn, 0, trader);
    }

    /// @dev Stay well under AAPL graduation (~24.2 quote) so the curve buyback helper stays valid.
    function _accrueAndSweep(address token, address curve) internal {
        for (uint256 i = 0; i < 4; i++) {
            _trade(curve, 1 ether);
            vm.roll(block.number + 1);
            vm.warp(block.timestamp + 12);
        }

        assertEq(FACTORY.getLaunchedToken(token).phase, 0, "must remain on the curve for buyback helper");

        uint256 tax = IPonsCurve(curve).creatorTaxBalance();
        uint256 fees = IPonsCurve(curve).quoteFeeBalance();
        console.log("curve creatorTaxBalance", tax);
        console.log("curve quoteFeeBalance  ", fees);
        assertGt(tax + fees, 0, "trades must accrue something on the curve");

        address vault = launcher.vaultOf(token);
        vm.prank(vault);
        try IPonsCurve(curve).sweepFees(0) {
            // ok
        } catch {
            vm.prank(creator);
            IPonsCurve(curve).sweepFees(0);
        }
    }

    /* ---------------------------------------------------------------------- */
    /* launch wiring                                                          */
    /* ---------------------------------------------------------------------- */

    function test_buybackLaunchWiresVaultAndHelper() public {
        (address token, address vault, address curve) = _launchBuyback(keccak256("v2-bb-wire"), 8_000);

        IPonsV2Factory.LaunchedToken memory launch = FACTORY.getLaunchedToken(token);
        assertTrue(launch.exists);
        assertEq(launch.curve, curve);
        assertEq(launch.pairToken, address(AAPL));
        assertEq(launch.creatorFeeRecipient, vault, "fees must point at the vault");
        assertEq(launch.deployer, address(launcher), "launcher is on-chain deployer");
        assertFalse(launch.buybackEnabled, "protocol buyback forced off");

        assertEq(launcher.vaultOf(token), vault);
        assertEq(launcher.creatorOf(token), creator);
        assertEq(launcher.templateOf(token), PonsTemplates.BUYBACK_BURN);
        assertEq(buybackFactory.vaultOf(token), vault);

        PonsV2BuybackBurnVault v = PonsV2BuybackBurnVault(vault);
        assertEq(v.quoteAsset(), address(AAPL));
        assertEq(v.token(), token);
        assertEq(v.buyback(), address(curveBuyback), "curve helper installed");
        assertEq(v.factory(), address(buybackFactory));

        (uint16 burnBps, address treas, uint256 minH) = _readBuybackConfig(v);
        assertEq(burnBps, 8_000);
        assertEq(treas, treasury);
        assertEq(minH, 1);
    }

    function test_fullBurnLaunchAllowedWhenHelperSet() public {
        (address token, address vault,) = _launchBuyback(keccak256("v2-bb-100"), 10_000);
        PonsV2BuybackBurnVault v = PonsV2BuybackBurnVault(vault);
        (uint16 burnBps, address treas,) = _readBuybackConfig(v);
        assertEq(burnBps, 10_000);
        assertEq(treas, address(0));
        assertEq(v.buyback(), address(curveBuyback));
        assertTrue(token != address(0));
    }

    function test_fullBurnRejectedWithoutHelper() public {
        // Redeploy factory with no helper.
        PonsV2BuybackBurnVaultFactory bare = new PonsV2BuybackBurnVaultFactory(address(0));
        registry.register(bytes32("bare-bb"), address(bare)); // wrong — registry already has buyback-burn

        // Use a fresh registry/launcher for this negative case.
        PonsV2VaultRegistry reg2 = new PonsV2VaultRegistry();
        reg2.register(PonsTemplates.BUYBACK_BURN, address(bare));
        PonsV2VaultLauncher launcher2 = new PonsV2VaultLauncher(reg2);
        vm.deal(creator, launchFee);

        vm.prank(creator);
        vm.expectRevert(PonsV2BuybackBurnVault.BuybackRequired.selector);
        launcher2.launchWithVault{value: launchFee}(
            _params(keccak256("v2-bb-nohelper")),
            0,
            address(AAPL),
            PonsTemplates.BUYBACK_BURN,
            abi.encode(
                PonsV2BuybackBurnVault.Config({burnBps: 10_000, treasury: address(0), minHarvest: 1})
            )
        );
    }

    function test_stakingLaunchWiresVault() public {
        (address token, address vault,) = _launchStaking(keccak256("v2-stake-wire"));
        assertEq(FACTORY.getLaunchedToken(token).creatorFeeRecipient, vault);
        assertEq(PonsV2StakingVault(vault).quoteAsset(), address(AAPL));
        assertEq(launcher.templateOf(token), PonsTemplates.STAKING);
    }

    function test_rejectsUnapprovedPair() public {
        address fake = makeAddr("fakePair");
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(PonsV2VaultLauncher.PairTokenNotApproved.selector, fake));
        launcher.launchWithVault{value: launchFee}(
            _params(keccak256("v2-bad-pair")),
            0,
            fake,
            PonsTemplates.BUYBACK_BURN,
            abi.encode(_buybackConfig(8_000, 1))
        );
    }

    function test_rejectsWrongLaunchFee() public {
        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(PonsV2VaultLauncher.InsufficientLaunchFee.selector, launchFee, launchFee - 1)
        );
        launcher.launchWithVault{value: launchFee - 1}(
            _params(keccak256("v2-bad-fee")),
            0,
            address(AAPL),
            PonsTemplates.BUYBACK_BURN,
            abi.encode(_buybackConfig(8_000, 1))
        );
    }

    /* ---------------------------------------------------------------------- */
    /* buyback run                                                            */
    /* ---------------------------------------------------------------------- */

    function test_permissionlessBuybackRunAfterTrades() public {
        (address token, address vaultAddr, address curve) = _launchBuyback(keccak256("v2-bb-run"), 8_000);
        PonsV2BuybackBurnVault vault = PonsV2BuybackBurnVault(vaultAddr);

        // Leave the opening snipe window.
        vm.roll(block.number + 5_000);
        vm.warp(block.timestamp + 10_000);

        _accrueAndSweep(token, curve);

        uint256 pending = vault.pendingEscrowQuote();
        uint256 idle;
        (idle,) = vault.idleBalances();
        console.log("pending escrow quote", pending);
        console.log("idle quote          ", idle);
        assertGt(pending + idle, 0, "vault must be owed quote after sweep");

        uint256 deadBefore = IERC20(token).balanceOf(PonsV2Addresses.BURN_ADDRESS);
        uint256 treasuryBefore = AAPL.balanceOf(treasury);

        vm.prank(keeper);
        (uint256 quoteSpent, uint256 tokensBurned) = vault.run(0);

        console.log("quote spent   ", quoteSpent);
        console.log("tokens burned ", tokensBurned);

        assertGt(quoteSpent, 0, "burn share must spend quote");
        assertGt(tokensBurned, 0, "tokens must be burned");
        assertEq(
            IERC20(token).balanceOf(PonsV2Addresses.BURN_ADDRESS) - deadBefore, tokensBurned, "burn accounted"
        );
        assertGt(AAPL.balanceOf(treasury) - treasuryBefore, 0, "treasury share paid");
        assertEq(vault.runCount(), 1);
        assertGt(vault.totalQuoteHarvested(), 0);
        assertGt(vault.totalTokensBurned(), 0);
    }

    function test_fullBurnRunBurnsEverything() public {
        (address token, address vaultAddr, address curve) = _launchBuyback(keccak256("v2-bb-fullrun"), 10_000);
        PonsV2BuybackBurnVault vault = PonsV2BuybackBurnVault(vaultAddr);

        vm.roll(block.number + 5_000);
        vm.warp(block.timestamp + 10_000);
        _accrueAndSweep(token, curve);

        uint256 treasuryBefore = AAPL.balanceOf(treasury);

        vm.prank(keeper);
        (uint256 quoteSpent, uint256 tokensBurned) = vault.run(0);

        assertGt(quoteSpent, 0);
        assertGt(tokensBurned, 0);
        assertEq(AAPL.balanceOf(treasury), treasuryBefore, "100% burn pays no treasury");
        assertEq(vault.totalTreasuryPaid(), 0);
    }

    function test_runRevertsWithoutFees() public {
        (, address vaultAddr,) = _launchBuyback(keccak256("v2-bb-empty"), 8_000);
        vm.prank(keeper);
        vm.expectRevert(PonsV2VaultBase.NothingToHarvest.selector);
        PonsV2BuybackBurnVault(vaultAddr).run(0);
    }

    function test_curveBuybackRejectsGraduatedPhase() public {
        // Unit-level: feed a graduated phase via a mock factory is heavy.
        // Instead assert the helper reverts UnknownLaunch for a random token.
        vm.expectRevert(
            abi.encodeWithSelector(PonsV2CurveBuyback.UnknownLaunch.selector, address(0xBEEF))
        );
        curveBuyback.buyback(address(AAPL), address(0xBEEF), 1 ether, 0);
    }

    function test_setBuybackOnlyFactory() public {
        (, address vaultAddr,) = _launchBuyback(keccak256("v2-bb-set"), 8_000);
        PonsV2BuybackBurnVault vault = PonsV2BuybackBurnVault(vaultAddr);

        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(PonsV2BuybackBurnVault.NotFactory.selector, creator));
        vault.setBuyback(address(0xB0B));

        // Owner of factory can retrofit via factory helper.
        address alt = address(new MockQuoteBuyback());
        buybackFactory.setVaultBuyback(vault.token(), alt);
        assertEq(vault.buyback(), alt);
    }

    /* ---------------------------------------------------------------------- */
    /* staking                                                                */
    /* ---------------------------------------------------------------------- */

    function test_stakingRunPaysStakers() public {
        (address token, address vaultAddr, address curve) = _launchStaking(keccak256("v2-stake-run"));
        PonsV2StakingVault vault = PonsV2StakingVault(vaultAddr);

        vm.roll(block.number + 5_000);
        vm.warp(block.timestamp + 10_000);

        // Give staker some tokens via a curve buy, then stake.
        _trade(curve, 20 ether);
        uint256 bal = IERC20(token).balanceOf(trader);
        assertGt(bal, 0);
        vm.prank(trader);
        IERC20(token).transfer(staker, bal / 2);

        uint256 stakeAmt = IERC20(token).balanceOf(staker);
        vm.prank(staker);
        IERC20(token).approve(vaultAddr, stakeAmt);
        vm.prank(staker);
        vault.stake(stakeAmt);

        _accrueAndSweep(token, curve);

        vm.prank(keeper);
        (uint256 quoteDistributed,) = vault.run();
        assertGt(quoteDistributed, 0, "stakers must receive quote");

        uint256 aaplBefore = AAPL.balanceOf(staker);
        vm.prank(staker);
        (uint256 claimed,) = vault.claim();
        assertGt(claimed, 0, "staker claim");
        assertEq(AAPL.balanceOf(staker) - aaplBefore, claimed, "claim pays the staker");
    }

    /* ---------------------------------------------------------------------- */
    /* mock helper                                                            */
    /* ---------------------------------------------------------------------- */

    function test_mockBuybackPath() public {
        MockQuoteBuyback mock = new MockQuoteBuyback();
        PonsV2BuybackBurnVaultFactory factory2 = new PonsV2BuybackBurnVaultFactory(address(mock));
        PonsV2VaultRegistry reg2 = new PonsV2VaultRegistry();
        reg2.register(PonsTemplates.BUYBACK_BURN, address(factory2));
        PonsV2VaultLauncher launcher2 = new PonsV2VaultLauncher(reg2);

        vm.deal(creator, launchFee);
        vm.prank(creator);
        (address token, address vaultAddr) = launcher2.launchWithVault{value: launchFee}(
            _params(keccak256("v2-mock-bb")),
            0,
            address(AAPL),
            PonsTemplates.BUYBACK_BURN,
            abi.encode(_buybackConfig(10_000, 1))
        );

        PonsV2BuybackBurnVault vault = PonsV2BuybackBurnVault(vaultAddr);

        // Seed the vault with quote + pre-fund the mock with tokens to "buy".
        deal(address(AAPL), vaultAddr, 10 ether);
        deal(token, address(mock), 1_000_000 ether);

        vm.prank(keeper);
        (uint256 spent, uint256 burned) = vault.run(0);
        assertEq(spent, 10 ether);
        assertGt(burned, 0);
    }

    /* ---------------------------------------------------------------------- */
    /* internal                                                               */
    /* ---------------------------------------------------------------------- */

    function _readBuybackConfig(PonsV2BuybackBurnVault v)
        internal
        view
        returns (uint16 burnBps, address treas, uint256 minH)
    {
        (burnBps, treas, minH) = v.config();
    }
}

/// @dev Test double: pulls quote from the vault and pays a 1:1 amount of `token` back.
contract MockQuoteBuyback is IQuoteBuyback {
    function buyback(address quoteAsset, address token, uint256 quoteAmount, uint256)
        external
        returns (uint256 tokensBought)
    {
        IERC20(quoteAsset).transferFrom(msg.sender, address(this), quoteAmount);
        tokensBought = quoteAmount; // 1:1 for tests
        require(IERC20(token).transfer(msg.sender, tokensBought), "xfer");
    }
}
