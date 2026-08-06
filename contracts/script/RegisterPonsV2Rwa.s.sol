// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";

import {PonsTemplates} from "../src/PonsTemplates.sol";
import {PonsV2VaultRegistry} from "../src/v2/PonsV2VaultRegistry.sol";
import {PonsV2RwaVaultFactory} from "../src/v2/factories/PonsV2RwaVaultFactory.sol";

/// @notice Deploy {PonsV2RwaVaultFactory} and register it on the live v2 registry.
///
/// Must be broadcast by the registry owner.
///
///   DISTRIBUTOR=0x… \
///     forge script script/RegisterPonsV2Rwa.s.sol --rpc-url robinhood --broadcast
///
/// @dev DISTRIBUTOR posts each round's merkle root. Use the keeper address.
contract RegisterPonsV2Rwa is Script {
    address constant LIVE_REGISTRY = 0xaA9C86049A258D4A076d3eF367F69C231C9746D5;

    function run() external {
        address distributor = vm.envAddress("DISTRIBUTOR");
        require(distributor != address(0), "distributor required");

        PonsV2VaultRegistry registry = PonsV2VaultRegistry(LIVE_REGISTRY);

        vm.startBroadcast();

        PonsV2RwaVaultFactory factory = new PonsV2RwaVaultFactory(distributor);

        require(
            keccak256(bytes(factory.template())) == keccak256(bytes("rwa")),
            "factory reports a different template id"
        );

        registry.register(PonsTemplates.RWA, address(factory));

        vm.stopBroadcast();

        console.log("PonsV2RwaVaultFactory :", address(factory));
        console.log("  beacon              :", factory.beacon());
        console.log("  implementation      :", factory.implementation());
        console.log("  distributor         :", distributor);
        console.log("registered on         :", LIVE_REGISTRY);
    }
}
