// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";

import {PonsTemplates} from "../src/PonsTemplates.sol";
import {PonsVaultLauncher} from "../src/PonsVaultLauncher.sol";
import {IPonsLaunchpad} from "../src/interfaces/IPonsLaunchpad.sol";
import {PonsBuybackBurnVault} from "../src/vaults/PonsBuybackBurnVault.sol";

/// @notice Launches a throwaway token through a deployed launcher, to exercise the
///         vault end to end on a live chain.
///
/// The token metadata is deliberately generic. This runs against mainnet, so the
/// token it creates is permanent and public — it must not carry product branding.
///
/// The config is tuned for testing, not for production: no cooldown and no minimum
/// harvest so a run can be triggered immediately, the shortest legal TWAP window so
/// the oracle becomes usable quickly, and a wide price tolerance so a thin pool does
/// not revert the swap.
///
/// LAUNCHER=0x... forge script script/TestLaunch.s.sol --rpc-url ... --broadcast
contract TestLaunch is Script {
    function run() external {
        PonsVaultLauncher launcher = PonsVaultLauncher(vm.envAddress("LAUNCHER"));
        uint256 devBuyWei = vm.envOr("DEV_BUY_WEI", uint256(0));

        IPonsLaunchpad.TokenMetadata memory metadata = IPonsLaunchpad.TokenMetadata({
            name: "Sandbox",
            symbol: "SBX",
            logo: "",
            description: "Test launch. No value, no team, no promises.",
            socials: IPonsLaunchpad.Socials({twitter: "", telegram: "", discord: "", website: "", farcaster: ""}),
            feeWallet: address(0) // overwritten by the launcher
        });

        PonsBuybackBurnVault.Config memory cfg = PonsBuybackBurnVault.Config({
            burnBps: 10_000, // burn everything, so no treasury is required
            treasury: address(0),
            minHarvestWei: 0,
            cooldown: 0,
            twapWindow: 60,
            maxTickDeviation: 5000
        });

        uint256 fee = launcher.launchpad().launchFee();
        bytes32 salt = keccak256(abi.encodePacked(block.timestamp, msg.sender));

        vm.startBroadcast();
        (address token, address vault) = launcher.launchWithVault{value: fee + devBuyWei}(
            metadata, 0, 0, salt, PonsTemplates.BUYBACK_BURN, abi.encode(cfg)
        );
        vm.stopBroadcast();

        console.log("token :", token);
        console.log("vault :", vault);
    }
}
