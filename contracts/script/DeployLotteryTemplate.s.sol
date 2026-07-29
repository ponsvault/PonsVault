// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";

import {PonsTemplates} from "../src/PonsTemplates.sol";
import {PonsVaultRegistry} from "../src/PonsVaultRegistry.sol";
import {PonsLotteryVaultFactory} from "../src/factories/PonsLotteryVaultFactory.sol";

/// @notice Ships the Lottery template onto the live stack.
///
///   REGISTRY=0x… OPERATOR=0x… \
///     forge script script/DeployLotteryTemplate.s.sol --rpc-url robinhood --broadcast
///
/// @dev OPERATOR is the keeper key that commits and reveals each draw. Creators cannot choose it.
contract DeployLotteryTemplate is Script {
    function run() external {
        PonsVaultRegistry registry = PonsVaultRegistry(vm.envAddress("REGISTRY"));
        address operator_ = vm.envAddress("OPERATOR");
        require(operator_ != address(0), "operator required");

        vm.startBroadcast();

        PonsLotteryVaultFactory factory = new PonsLotteryVaultFactory(operator_);

        require(
            keccak256(bytes(factory.template())) == keccak256(bytes("lottery")),
            "factory reports a different template id"
        );

        registry.register(PonsTemplates.LOTTERY, address(factory));

        vm.stopBroadcast();

        console.log("PonsLotteryVaultFactory:", address(factory));
        console.log("  beacon               :", factory.beacon());
        console.log("  vault implementation :", factory.implementation());
        console.log("  operator             :", operator_);
        console.log("registered as          : lottery");
    }
}
