// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";

import {PonsAddresses} from "../src/PonsAddresses.sol";
import {PonsVaultLauncher} from "../src/PonsVaultLauncher.sol";
import {PonsVaultRegistry} from "../src/PonsVaultRegistry.sol";
import {IPonsLaunchpad} from "../src/interfaces/IPonsLaunchpad.sol";

/// @notice Replaces only the launcher, keeping the existing registry and factories.
///
/// REGISTRY=0x… forge script script/RedeployLauncher.s.sol --rpc-url robinhood --broadcast
///
/// @dev The launcher is immutable and becomes the on-chain deployer of every token it creates, so a
///      bug in it cannot be patched — only superseded, and only before anything has launched through
///      it. Templates live in the registry, so replacing the launcher leaves them untouched: vaults
///      already created keep working, and their fees keep sweeping through whichever launcher
///      launched them.
///
///      Tokens launched by the previous launcher stay bound to it forever. It remains the only
///      contract that can sweep their fees, which is why this must not be run casually.
contract RedeployLauncher is Script {
    address constant PONS_LAUNCHPAD = 0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB;

    function run() external {
        PonsVaultRegistry registry = PonsVaultRegistry(vm.envAddress("REGISTRY"));

        vm.startBroadcast();
        PonsVaultLauncher launcher =
            new PonsVaultLauncher(IPonsLaunchpad(PONS_LAUNCHPAD), PonsAddresses.PONS_ACTIVE_LOCKER, registry);
        vm.stopBroadcast();

        console.log("PonsVaultLauncher :", address(launcher));
        console.log("registry (reused) :", address(registry));
        console.log("deployed at block :", block.number);
    }
}
