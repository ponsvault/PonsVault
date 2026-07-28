// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";

import {PonsTemplates} from "../src/PonsTemplates.sol";
import {PonsVaultRegistry} from "../src/PonsVaultRegistry.sol";
import {PonsRwaVaultFactory} from "../src/factories/PonsRwaVaultFactory.sol";

/// @notice Ships the RWA Dividend template onto the live stack.
///
/// Deploys the factory — which brings its own vault implementation and beacon — and points the
/// `rwa` id at it. The launcher does not move and existing tokens are untouched; this is the whole
/// cost of adding a template, and the reason the registry exists.
///
///   REGISTRY=0x… DISTRIBUTOR=0x… \
///     forge script script/DeployRwaTemplate.s.sol --rpc-url robinhood --broadcast
///
/// @dev DISTRIBUTOR is the key allowed to post each round's allocation. It is set by the protocol
///      rather than the creator, so a creator cannot appoint themselves and hand the whole payout
///      to an address they control. In practice it is the keeper, which is the thing that computes
///      allocations in the first place.
contract DeployRwaTemplate is Script {
    function run() external {
        PonsVaultRegistry registry = PonsVaultRegistry(vm.envAddress("REGISTRY"));
        address distributor = vm.envAddress("DISTRIBUTOR");
        require(distributor != address(0), "distributor required");

        vm.startBroadcast();

        PonsRwaVaultFactory factory = new PonsRwaVaultFactory(distributor);

        // Guards the mistake that would otherwise only surface at someone's launch: an id pointed
        // at a factory that builds something else.
        require(
            keccak256(bytes(factory.template())) == keccak256(bytes("rwa")),
            "factory reports a different template id"
        );

        registry.register(PonsTemplates.RWA, address(factory));

        vm.stopBroadcast();

        console.log("PonsRwaVaultFactory  :", address(factory));
        console.log("  beacon             :", factory.beacon());
        console.log("  vault implementation:", factory.implementation());
        console.log("  distributor        :", distributor);
        console.log("registered as        : rwa");
    }
}
