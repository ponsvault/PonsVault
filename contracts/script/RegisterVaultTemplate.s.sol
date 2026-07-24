// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";

import {PonsVaultRegistry} from "../src/PonsVaultRegistry.sol";
import {IPonsVaultFactory} from "../src/interfaces/IPonsVaultFactory.sol";

/// @notice Adds a vault template to a live stack.
///
/// This is the whole cost of shipping a new template: deploy its factory, point an id at it. The
/// launcher does not move, existing tokens are untouched, and no frontend address changes.
///
///   REGISTRY=0x… FACTORY=0x… TEMPLATE_ID=lottery \
///     forge script script/RegisterVaultTemplate.s.sol --rpc-url robinhood --broadcast
contract RegisterVaultTemplate is Script {
    function run() external {
        PonsVaultRegistry registry = PonsVaultRegistry(vm.envAddress("REGISTRY"));
        address factory = vm.envAddress("FACTORY");
        bytes32 templateId = bytes32(bytes(vm.envString("TEMPLATE_ID")));

        // Catches the easy mistake of pointing an id at something that is not a factory, before
        // the registration makes it selectable at launch.
        string memory reported = IPonsVaultFactory(factory).template();
        require(
            keccak256(bytes(reported)) == keccak256(bytes(vm.envString("TEMPLATE_ID"))),
            "factory reports a different template id"
        );

        vm.startBroadcast();
        registry.register(templateId, factory);
        vm.stopBroadcast();

        console.log("registered template:", reported);
        console.log("  id     :", vm.toString(templateId));
        console.log("  factory:", factory);
    }
}
