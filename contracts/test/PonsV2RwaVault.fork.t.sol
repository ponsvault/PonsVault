// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/token/ERC20/IERC20.sol";

import {PonsAddresses} from "../src/PonsAddresses.sol";
import {PonsTemplates} from "../src/PonsTemplates.sol";
import {PonsV2Addresses} from "../src/v2/PonsV2Addresses.sol";
import {IPonsCurve} from "../src/v2/interfaces/IPonsCurve.sol";
import {IPonsV2Factory} from "../src/v2/interfaces/IPonsV2Factory.sol";
import {PonsV2VaultLauncher} from "../src/v2/PonsV2VaultLauncher.sol";
import {PonsV2VaultRegistry} from "../src/v2/PonsV2VaultRegistry.sol";
import {PonsV2BuybackBurnVaultFactory} from "../src/v2/factories/PonsV2BuybackBurnVaultFactory.sol";
import {PonsV2RwaVaultFactory} from "../src/v2/factories/PonsV2RwaVaultFactory.sol";
import {PonsV2RwaVault} from "../src/v2/vaults/PonsV2RwaVault.sol";
import {PonsV2VaultBase} from "../src/v2/vaults/PonsV2VaultBase.sol";

/// @dev Fork tests for the v2 RWA Dividend vault. Local fork only — no mainnet broadcasts.
contract PonsV2RwaVaultForkTest is Test {
    IPonsV2Factory constant FACTORY = IPonsV2Factory(PonsV2Addresses.FACTORY);
    IERC20 constant AAPL = IERC20(PonsV2Addresses.AAPL);
    /// @dev NVIDIA • Robinhood Token — curated RWA with a live WETH pool.
    address constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    uint24 constant NVDA_POOL_FEE = 500;

    PonsV2VaultLauncher launcher;
    PonsV2VaultRegistry registry;
    PonsV2RwaVaultFactory rwaFactory;

    address creator = makeAddr("creator");
    address trader = makeAddr("trader");
    address keeper = makeAddr("keeper");
    address holder = makeAddr("holder");

    uint256 launchFee;

    function setUp() public {
        vm.createSelectFork("robinhood");

        assertTrue(FACTORY.launchEnabled());
        assertTrue(FACTORY.approvedPairTokens(address(AAPL)));
        assertTrue(FACTORY.approvedPairTokens(NVDA));

        launchFee = FACTORY.launchFee();

        registry = new PonsV2VaultRegistry();
        // Buyback slot unused here but registry shape matches production.
        registry.register(
            PonsTemplates.BUYBACK_BURN, address(new PonsV2BuybackBurnVaultFactory(address(0)))
        );
        rwaFactory = new PonsV2RwaVaultFactory(keeper);
        registry.register(PonsTemplates.RWA, address(rwaFactory));

        launcher = new PonsV2VaultLauncher(registry);
        assertTrue(FACTORY.canLaunch(address(launcher)));

        vm.deal(creator, 10 ether);
        deal(address(AAPL), trader, 1_000_000 ether);
        deal(NVDA, trader, 1_000_000 ether);
    }

    function _params(bytes32 salt) internal pure returns (IPonsV2Factory.TokenParams memory p) {
        p.name = "PonsVault V2 RWA Fork";
        p.symbol = "PV2R";
        p.logo = "ipfs://placeholder";
        p.description = "fork test token - not a production launch";
        p.socials = IPonsV2Factory.Socials({twitter: "", telegram: "", discord: "", website: "", farcaster: ""});
        p.creatorFeeRecipient = address(0);
        p.creatorTaxBps = 100;
        p.buybackEnabled = false;
        p.expectedEconomics = bytes32(0);
        p.salt = salt;
    }

    function _rwaConfig(address rwaAsset, uint24 poolFee, uint256 minHarvest)
        internal
        pure
        returns (PonsV2RwaVault.Config memory)
    {
        return PonsV2RwaVault.Config({rwaAsset: rwaAsset, rwaPoolFee: poolFee, minHarvestWei: minHarvest});
    }

    function _launchRwa(bytes32 salt, address pair, address rwaAsset, uint24 poolFee)
        internal
        returns (address token, address vault, address curve)
    {
        vm.prank(creator);
        (token, vault) = launcher.launchWithVault{value: launchFee}(
            _params(salt), 0, pair, PonsTemplates.RWA, abi.encode(_rwaConfig(rwaAsset, poolFee, 1))
        );
        curve = FACTORY.getLaunchedToken(token).curve;
    }

    function _trade(address curve, IERC20 quote, uint256 quoteIn) internal {
        vm.prank(trader);
        quote.approve(curve, quoteIn);
        vm.prank(trader);
        IPonsCurve(curve).buy(quoteIn, 0, trader);
    }

    function _accrueAndSweep(address token, address curve, IERC20 quote) internal {
        for (uint256 i = 0; i < 4; i++) {
            _trade(curve, quote, 1 ether);
            vm.roll(block.number + 1);
            vm.warp(block.timestamp + 12);
        }

        address vault = launcher.vaultOf(token);
        vm.prank(vault);
        try IPonsCurve(curve).sweepFees(0) {
            // ok
        } catch {
            vm.prank(creator);
            IPonsCurve(curve).sweepFees(0);
        }
    }

    function test_rwaLaunchWiresVaultAndRoute() public {
        (address token, address vault,) = _launchRwa(keccak256("v2-rwa-wire"), address(AAPL), NVDA, NVDA_POOL_FEE);

        assertEq(FACTORY.getLaunchedToken(token).creatorFeeRecipient, vault);
        assertEq(launcher.templateOf(token), PonsTemplates.RWA);
        assertEq(rwaFactory.vaultOf(token), vault);

        PonsV2RwaVault v = PonsV2RwaVault(vault);
        assertEq(v.quoteAsset(), address(AAPL));
        assertEq(v.distributor(), keeper);
        assertEq(keccak256(bytes(v.template())), keccak256(bytes("rwa")));

        (address rwaAsset, uint24 poolFee, uint256 minH) = v.config();
        assertEq(rwaAsset, NVDA);
        assertEq(poolFee, NVDA_POOL_FEE);
        assertEq(minH, 1);
        assertEq(v.quoteWethPoolFee(), 500, "AAPL/WETH deepest live tier");
        assertTrue(v.rwaPool() != address(0));
    }

    function test_sameAssetLaunchSkipsSwapRoute() public {
        (, address vault,) = _launchRwa(keccak256("v2-rwa-same"), NVDA, NVDA, NVDA_POOL_FEE);
        PonsV2RwaVault v = PonsV2RwaVault(vault);
        assertEq(v.quoteAsset(), NVDA);
        assertEq(v.quoteWethPoolFee(), 0);
        assertEq(v.rwaPool(), address(0));
    }

    function test_rejectsEmptyRwaPool() public {
        // SPCX at fee 100 — pool may not exist or is empty; use a nonsense fee.
        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(PonsV2RwaVault.RwaPoolNotFound.selector, NVDA, uint24(99))
        );
        launcher.launchWithVault{value: launchFee}(
            _params(keccak256("v2-rwa-badfee")),
            0,
            address(AAPL),
            PonsTemplates.RWA,
            abi.encode(_rwaConfig(NVDA, 99, 1))
        );
    }

    function test_permissionlessRunBuysNvdaViaWeth() public {
        (address token, address vaultAddr, address curve) =
            _launchRwa(keccak256("v2-rwa-run"), address(AAPL), NVDA, NVDA_POOL_FEE);
        PonsV2RwaVault vault = PonsV2RwaVault(vaultAddr);

        vm.roll(block.number + 5_000);
        vm.warp(block.timestamp + 10_000);
        _accrueAndSweep(token, curve, AAPL);

        uint256 pending = vault.pendingEscrowQuote();
        (uint256 idle,) = vault.idleBalances();
        console.log("pending escrow quote", pending);
        console.log("idle quote          ", idle);
        assertGt(pending + idle, 0, "vault must be owed quote after sweep");

        uint256 nvdaBefore = IERC20(NVDA).balanceOf(vaultAddr);

        vm.prank(keeper);
        (uint256 roundId, uint256 amount) = vault.run(0);

        console.log("roundId", roundId);
        console.log("rwa amount", amount);

        assertEq(roundId, 0);
        assertGt(amount, 0, "must buy some NVDA");
        assertEq(IERC20(NVDA).balanceOf(vaultAddr) - nvdaBefore, amount);
        assertEq(vault.rwaReserved(), amount);
        assertEq(vault.runCount(), 1);
        assertGt(vault.totalQuoteConverted(), 0);
        assertEq(vault.roundCount(), 1);

        (bool ready,) = vault.canRun();
        assertFalse(ready, "fees spent - next run waits for more");
    }

    function test_sameAssetRunAllocatesQuoteDirectly() public {
        (address token, address vaultAddr, address curve) =
            _launchRwa(keccak256("v2-rwa-same-run"), NVDA, NVDA, NVDA_POOL_FEE);
        PonsV2RwaVault vault = PonsV2RwaVault(vaultAddr);

        vm.roll(block.number + 5_000);
        vm.warp(block.timestamp + 10_000);
        _accrueAndSweep(token, curve, IERC20(NVDA));

        vm.prank(keeper);
        (uint256 roundId, uint256 amount) = vault.run(0);

        assertEq(roundId, 0);
        assertGt(amount, 0);
        assertEq(vault.rwaReserved(), amount);
        // No external RWA purchase — reserved balance is still the quote asset.
        assertEq(IERC20(NVDA).balanceOf(vaultAddr), amount);
    }

    function test_postRootAndClaim() public {
        (address token, address vaultAddr, address curve) =
            _launchRwa(keccak256("v2-rwa-claim"), address(AAPL), NVDA, NVDA_POOL_FEE);
        PonsV2RwaVault vault = PonsV2RwaVault(vaultAddr);

        vm.roll(block.number + 5_000);
        vm.warp(block.timestamp + 10_000);
        _accrueAndSweep(token, curve, AAPL);

        vm.prank(keeper);
        (uint256 roundId, uint256 amount) = vault.run(0);

        // Single-leaf tree: root = leaf, empty proof.
        bytes32 leaf = vault.leafFor(holder, amount);
        vm.prank(keeper);
        vault.postRoot(roundId, leaf);

        uint256 holderBefore = IERC20(NVDA).balanceOf(holder);
        vault.claim(roundId, holder, amount, new bytes32[](0));

        assertEq(IERC20(NVDA).balanceOf(holder) - holderBefore, amount);
        assertTrue(vault.hasClaimed(roundId, holder));
        assertEq(vault.rwaReserved(), 0);
        assertEq(vault.totalRwaClaimed(), amount);
    }

    function test_runRevertsWithoutFees() public {
        (, address vaultAddr,) = _launchRwa(keccak256("v2-rwa-empty"), address(AAPL), NVDA, NVDA_POOL_FEE);
        vm.prank(keeper);
        vm.expectRevert(PonsV2VaultBase.NothingToHarvest.selector);
        PonsV2RwaVault(vaultAddr).run(0);
    }

    function test_onlyDistributorPostsRoot() public {
        (address token, address vaultAddr, address curve) =
            _launchRwa(keccak256("v2-rwa-dist"), address(AAPL), NVDA, NVDA_POOL_FEE);
        PonsV2RwaVault vault = PonsV2RwaVault(vaultAddr);

        vm.roll(block.number + 5_000);
        vm.warp(block.timestamp + 10_000);
        _accrueAndSweep(token, curve, AAPL);

        vm.prank(keeper);
        (uint256 roundId, uint256 amount) = vault.run(0);

        bytes32 leaf = vault.leafFor(holder, amount);
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(PonsV2RwaVault.NotDistributor.selector, creator, keeper));
        vault.postRoot(roundId, leaf);
    }
}
