// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {ROBINHOOD_FORK_BLOCK} from "./fixtures/ForkBlock.sol";
import {IERC20} from "@openzeppelin/token/ERC20/IERC20.sol";

import {PonsAddresses} from "../src/PonsAddresses.sol";
import {PonsVaultLauncher} from "../src/PonsVaultLauncher.sol";
import {IPonsLaunchpad, IPonsToken} from "../src/interfaces/IPonsLaunchpad.sol";
import {IPonsLocker} from "../src/interfaces/IPonsLocker.sol";
import {PonsBuybackBurnVault} from "../src/vaults/PonsBuybackBurnVault.sol";
import {PonsStakingVault} from "../src/vaults/PonsStakingVault.sol";
import {GENERATED_FOR_LAUNCHER, LaunchCalldata} from "./fixtures/LaunchCalldata.sol";

/// @dev Replays the browser's own calldata against the launcher that is actually deployed.
///
///      Every other test builds its arguments in Solidity, which proves the contract works but says
///      nothing about whether the site is calling it correctly — a wrong selector, a mis-encoded
///      tuple or a stale address all look identical from in here. This closes that gap by executing
///      the exact bytes a wallet would sign, against live state, and it is the check that would have
///      caught the launcher being redeployed without the frontend following.
contract WebsiteLaunchForkTest is Test {
    IPonsLaunchpad constant LAUNCHPAD = IPonsLaunchpad(0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB);

    /// Must match the creator baked into the fixture, since the calldata is signed by them.
    address constant CREATOR = 0x45e9E2A1BB0798dd3722c24f6bb31112dAf6DcD5;
    address constant TREASURY = 0x1111111111111111111111111111111111111111;

    PonsVaultLauncher launcher = PonsVaultLauncher(GENERATED_FOR_LAUNCHER);

    function setUp() public {
        vm.createSelectFork("robinhood", ROBINHOOD_FORK_BLOCK);
        vm.deal(CREATOR, 10 ether);
    }

    /// @dev Sends the fixture exactly as a wallet would, and fails loudly with the revert data if the
    ///      chain rejects it.
    function _send(bytes memory calldata_, uint256 devBuyWei) internal returns (address token, address vault) {
        uint256 value = LAUNCHPAD.launchFee() + devBuyWei;

        vm.prank(CREATOR);
        (bool ok, bytes memory ret) = address(launcher).call{value: value}(calldata_);

        if (!ok) {
            console.log("launch reverted, raw return data:");
            console.logBytes(ret);
            revert("website calldata reverted against the deployed launcher");
        }

        (token, vault) = abi.decode(ret, (address, address));
    }

    /// @dev The fixture is only meaningful against the launcher it was generated for.
    function test_fixtureTargetsTheDeployedLauncher() public view {
        assertGt(GENERATED_FOR_LAUNCHER.code.length, 0, "no launcher deployed at the generated address");
        assertEq(address(launcher.launchpad()), address(LAUNCHPAD), "launcher points at the pons launchpad");
        assertEq(launcher.locker(), PonsAddresses.PONS_ACTIVE_LOCKER, "launcher points at the active locker");
    }

    function test_websiteBuybackLaunchWithDevBuy() public {
        (address token, address vault) = _send(LaunchCalldata.BUYBACK_WITH_DEV_BUY, 0.05 ether);

        console.log("token :", token);
        console.log("vault :", vault);

        assertEq(IPonsToken(token).deployer(), address(launcher), "launcher must be the deployer");
        assertEq(
            IPonsLocker(PonsAddresses.PONS_ACTIVE_LOCKER).feeRedirects(token), vault, "fees must route to the vault"
        );
        assertEq(launcher.vaultOf(token), vault, "launcher indexes the vault");
        assertEq(launcher.creatorOf(token), CREATOR, "creator recorded");

        // The bug this suite exists to prevent regressing.
        assertGt(IERC20(token).balanceOf(CREATOR), 0, "creator must receive the dev buy");
        assertEq(IERC20(token).balanceOf(address(launcher)), 0, "launcher must hold nothing");

        // And the config the form sent must be what the vault ended up with.
        PonsBuybackBurnVault v = PonsBuybackBurnVault(vault);
        (uint16 burnBps, address treasury, uint256 minHarvestWei) = v.config();
        assertEq(burnBps, 8_000, "80% burn share as entered");
        assertEq(treasury, TREASURY, "treasury as entered");
        assertEq(minHarvestWei, 0.025 ether, "minimum harvest as entered");
        assertEq(v.template(), "buyback-burn", "template matches");
    }

    function test_websiteBuybackFullBurnLaunch() public {
        (, address vault) = _send(LaunchCalldata.BUYBACK_FULL_BURN, 0.05 ether);

        (uint16 burnBps, address treasury,) = PonsBuybackBurnVault(vault).config();
        assertEq(burnBps, 10_000, "100% burn");
        assertEq(treasury, address(0), "no treasury needed at 100% burn");
    }

    function test_websiteStakingLaunch() public {
        (address token, address vault) = _send(LaunchCalldata.STAKING_THIRTY_DAY_LOCK, 0.05 ether);

        PonsStakingVault v = PonsStakingVault(vault);
        (uint32 lockPeriod, uint256 minHarvestWei) = v.config();
        assertEq(lockPeriod, 30 days, "30 day lock as entered");
        assertEq(minHarvestWei, 0.025 ether, "minimum harvest as entered");
        assertEq(v.template(), "staking", "template matches");

        assertEq(
            IPonsLocker(PonsAddresses.PONS_ACTIVE_LOCKER).feeRedirects(token), vault, "fees must route to the vault"
        );
        assertGt(IERC20(token).balanceOf(CREATOR), 0, "creator must receive the dev buy");
    }

    function test_websiteLaunchWithoutDevBuy() public {
        (address token, address vault) = _send(LaunchCalldata.BUYBACK_NO_DEV_BUY, 0);

        assertEq(IERC20(token).balanceOf(CREATOR), 0, "no dev buy means no tokens");
        assertEq(IERC20(token).balanceOf(address(launcher)), 0, "and nothing stranded");
        assertEq(
            IPonsLocker(PonsAddresses.PONS_ACTIVE_LOCKER).feeRedirects(token), vault, "fees must route to the vault"
        );
    }
}
