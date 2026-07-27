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
        return PonsBuybackBurnVault.Config({burnBps: 8_000, treasury: treasury, minHarvestWei: 1});
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

        // Zero floor, which is what the site and the keeper send.
        (uint256 wethSpent, uint256 tokensBurned) = vault.run(0);

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
        (uint256 wethSpent,) = vault.run(0);
        assertGt(wethSpent, 0, "any caller may trigger distribution");
    }

    /// @dev Half of why no timer is needed: a run leaves nothing behind, so the next one starts
    ///      from zero and has to wait for trading to refill the vault.
    function test_runSpendsEverythingItHolds() public {
        _sweepIntoVault();
        vault.run(0);

        (uint256 leftoverWeth,) = vault.idleBalances();
        assertEq(leftoverWeth, 0, "run leaves no WETH behind");

        (bool ready,) = vault.canRun();
        assertFalse(ready, "a drained vault is not runnable");
    }

    /// @dev The other half: a balance that exists but is not yet worth spending stays put. Note
    ///      that a run's own swap pays pool fees, so a vault with a negligible floor really can
    ///      run back to back — the floor, not a timer, is what makes the pacing meaningful.
    function test_balanceBelowFloorCannotRun() public {
        PonsBuybackBurnVaultFactory fresh = new PonsBuybackBurnVaultFactory();
        PonsBuybackBurnVault.Config memory cfg = _config();
        cfg.minHarvestWei = 1_000 ether;

        vm.startPrank(TOKEN_DEPLOYER);
        PonsBuybackBurnVault strict = PonsBuybackBurnVault(fresh.createVault(TOKEN, LOCKER, abi.encode(cfg)));
        IPonsLocker(LOCKER).setFeeRedirect(TOKEN, address(strict));
        vm.stopPrank();

        _sweepIntoVault();
        (uint256 idleWeth,) = strict.idleBalances();
        assertGt(idleWeth, 0, "fees did arrive");

        (bool ready,) = strict.canRun();
        assertFalse(ready, "a balance under the floor is not runnable");

        vm.expectRevert(PonsVaultBase.NothingToHarvest.selector);
        strict.run(0);
    }

    function test_revertsWhenNothingAccrued() public {
        vm.expectRevert(PonsVaultBase.NothingToHarvest.selector);
        vault.run(0);
    }

    /// @dev The vault checks no price of its own, so `amountOutMinimum` is all a caller who wants a
    ///      guarantee has. A floor the pool cannot fill aborts the whole run rather than buying.
    function test_callerSuppliedFloorStillApplies() public {
        _sweepIntoVault();
        vm.expectRevert();
        vault.run(type(uint256).max);
    }

    function test_descriptionReflectsState() public {
        console.log(vault.description());
        _sweepIntoVault();
        vault.run(0);
        console.log(vault.description());
    }
}
