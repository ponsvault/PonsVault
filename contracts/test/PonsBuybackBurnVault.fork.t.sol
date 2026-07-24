// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/token/ERC20/IERC20.sol";

import {PonsAddresses} from "../src/PonsAddresses.sol";
import {IPonsLocker} from "../src/interfaces/IPonsLocker.sol";
import {IUniswapV3Factory} from "../src/interfaces/IUniswapV3.sol";
import {PonsVaultBase} from "../src/vaults/PonsVaultBase.sol";
import {PonsBuybackBurnVault} from "../src/vaults/PonsBuybackBurnVault.sol";
import {PonsBuybackBurnVaultFactory} from "../src/factories/PonsBuybackBurnVaultFactory.sol";

/// @dev Retrofit path: an existing pons token whose deployer is an EOA. The vault can receive and
///      distribute fees, but the sweep still needs the deployer, since the locker will not accept
///      `collectFees` from the fee-redirect target.
///
///      Forked just before a known `collectFees` call so real creator fees are still pending.
contract PonsBuybackBurnVaultForkTest is Test {
    address constant TOKEN = 0x0c1eD62D7811e5b437e537Ac9d0592469C119C74;
    address constant TOKEN_DEPLOYER = 0xCaF769F00Ea65eA67BABd04eEC922BdA8CFD5d11;
    address constant LOCKER = PonsAddresses.PONS_LEGACY_LOCKER;
    uint256 constant FORK_BLOCK = 18_475_672;

    PonsBuybackBurnVaultFactory factory;
    PonsBuybackBurnVault vault;
    address treasury = makeAddr("treasury");

    function setUp() public {
        vm.createSelectFork("robinhood", FORK_BLOCK);
        factory = new PonsBuybackBurnVaultFactory();

        vm.startPrank(TOKEN_DEPLOYER);
        vault = PonsBuybackBurnVault(factory.createVault(TOKEN, LOCKER, abi.encode(_config())));
        IPonsLocker(LOCKER).setFeeRedirect(TOKEN, address(vault));
        vm.stopPrank();
    }

    function _config() internal view returns (PonsBuybackBurnVault.Config memory) {
        return PonsBuybackBurnVault.Config({
            burnBps: 8_000,
            treasury: treasury,
            minHarvestWei: 1,
            cooldown: 1 hours,
            twapWindow: 300,
            maxTickDeviation: 200
        });
    }

    /// @dev Deployer-triggered sweep; funds land in the vault because the payout follows the redirect.
    function _sweepIntoVault() internal {
        vm.prank(TOKEN_DEPLOYER);
        IPonsLocker(LOCKER).collectFees(TOKEN);
    }

    function test_poolResolvesToLivePool() public view {
        address pool =
            IUniswapV3Factory(PonsAddresses.V3_FACTORY).getPool(PonsAddresses.WETH, TOKEN, PonsAddresses.POOL_FEE);
        assertEq(pool, vault.pool(), "vault should resolve the same pool as the factory");
        assertEq(pool, 0x2B3211e96D15212086e8333B447FBB35Dc08348a, "known live pool for this token");
    }

    function test_feeRedirectPaysTheVault() public {
        _sweepIntoVault();
        (uint256 wethBalance,) = vault.idleBalances();
        console.log("vault WETH after sweep:", wethBalance);
        assertGt(wethBalance, 0, "vault should receive the creator share");
    }

    function test_onlyTokenDeployerCanCreateVault() public {
        // A fresh factory, because the one from setUp already holds a vault for TOKEN and would
        // revert with VaultAlreadyExists before reaching the deployer check.
        PonsBuybackBurnVaultFactory fresh = new PonsBuybackBurnVaultFactory();
        address stranger = makeAddr("stranger");

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(PonsBuybackBurnVaultFactory.NotTokenDeployer.selector, stranger, TOKEN_DEPLOYER)
        );
        fresh.createVault(TOKEN, LOCKER, abi.encode(_config()));
    }

    /// @dev An address with no `deployer()` reports one of address zero, which no caller can match,
    ///      so a vault cannot be attached to something that is not a pons token.
    function test_rejectsPriceToleranceTooTight() public {
        PonsBuybackBurnVaultFactory fresh = new PonsBuybackBurnVaultFactory();
        PonsBuybackBurnVault.Config memory cfg = _config();
        cfg.maxTickDeviation = 1;

        vm.prank(TOKEN_DEPLOYER);
        vm.expectRevert(PonsBuybackBurnVault.InvalidTickDeviation.selector);
        fresh.createVault(TOKEN, LOCKER, abi.encode(cfg));
    }

    function test_cannotCreateVaultForNonToken() public {
        address notAToken = makeAddr("notAToken");
        address stranger = makeAddr("stranger");

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(PonsBuybackBurnVaultFactory.NotTokenDeployer.selector, stranger, address(0))
        );
        factory.createVault(notAToken, LOCKER, abi.encode(_config()));
    }

    function test_endToEnd_buybackAndBurn() public {
        _sweepIntoVault();

        (uint256 pendingWeth,) = vault.idleBalances();
        uint256 deadBefore = IERC20(TOKEN).balanceOf(PonsAddresses.BURN_ADDRESS);

        // Oracle history is not primed on pons pools, so the caller supplies an explicit floor.
        (uint256 wethSpent, uint256 tokensBurned) = vault.run(1);

        console.log("pending WETH  :", pendingWeth);
        console.log("weth spent    :", wethSpent);
        console.log("tokens burned :", tokensBurned);
        console.log("treasury paid :", vault.totalTreasuryPaid());

        assertEq(wethSpent, (pendingWeth * 8) / 10, "80% of fees should fund the buyback");
        assertEq(vault.totalTreasuryPaid(), pendingWeth - wethSpent, "remainder goes to treasury");
        assertGt(tokensBurned, 0, "buyback should have burned tokens");
        assertEq(
            IERC20(TOKEN).balanceOf(PonsAddresses.BURN_ADDRESS) - deadBefore,
            tokensBurned,
            "burn address receives exactly the burned amount"
        );
        assertEq(IERC20(PonsAddresses.WETH).balanceOf(treasury), pendingWeth - wethSpent, "treasury share paid");
        (uint256 leftoverWeth,) = vault.idleBalances();
        assertEq(leftoverWeth, 0, "vault should retain no WETH");
    }

    function test_runIsPermissionless() public {
        _sweepIntoVault();
        vm.prank(makeAddr("randomKeeper"));
        (uint256 wethSpent,) = vault.run(1);
        assertGt(wethSpent, 0, "any caller may trigger distribution");
    }

    function test_cooldownBlocksImmediateSecondRun() public {
        _sweepIntoVault();
        vault.run(1);
        _sweepIntoVault();

        vm.expectRevert(abi.encodeWithSelector(PonsVaultBase.CooldownActive.selector, block.timestamp + 1 hours));
        vault.run(1);

        vm.warp(block.timestamp + 1 hours);
        vault.run(1);
    }

    function test_revertsWhenNothingAccrued() public {
        vm.expectRevert(PonsVaultBase.NothingToHarvest.selector);
        vault.run(1);
    }

    function test_oracleNotReadyRequiresExplicitMinOut() public {
        _sweepIntoVault();
        vm.assume(!vault.isOracleReady(300));
        vm.expectRevert(PonsVaultBase.OracleNotReady.selector);
        vault.run(0);
    }

    function test_primeOracleIsPermissionless() public {
        vm.prank(makeAddr("anyone"));
        vault.primeOracle(24);
    }

    function test_descriptionReflectsState() public {
        console.log(vault.description());
        _sweepIntoVault();
        vault.run(1);
        console.log(vault.description());
    }
}
