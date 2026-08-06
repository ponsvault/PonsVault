// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";

import {PonsV2Addresses} from "../src/v2/PonsV2Addresses.sol";
import {PonsV2CurveBuyback} from "../src/v2/buyback/PonsV2CurveBuyback.sol";
import {PonsV2BuybackBurnVault} from "../src/v2/vaults/PonsV2BuybackBurnVault.sol";
import {PonsV2BuybackBurnVaultFactory} from "../src/v2/factories/PonsV2BuybackBurnVaultFactory.sol";

/// @notice Wire the curve buyback helper onto the already-deployed v2 buyback factory.
///
/// Must be broadcast by the factory owner (`factory.owner()`).
///
/// forge script script/WirePonsV2Buyback.s.sol --rpc-url robinhood --broadcast
contract WirePonsV2Buyback is Script {
    address constant LIVE_BUYBACK_FACTORY = 0xdE4670A2Be85Baa3f6a2C1F6443101EA041362aB;

    function run() external {
        PonsV2BuybackBurnVaultFactory factory = PonsV2BuybackBurnVaultFactory(LIVE_BUYBACK_FACTORY);

        vm.startBroadcast();

        // Upgrade vault impl so existing + new vaults get {setBuyback} / factory tracking.
        PonsV2BuybackBurnVault newImpl = new PonsV2BuybackBurnVault();
        factory.upgradeVaultImplementation(address(newImpl));

        PonsV2CurveBuyback buyback = new PonsV2CurveBuyback(PonsV2Addresses.FACTORY);
        factory.setDefaultBuyback(address(buyback));

        vm.stopBroadcast();

        console.log("upgraded impl :", address(newImpl));
        console.log("curve buyback :", address(buyback));
        console.log("defaultBuyback:", factory.defaultBuyback());
    }
}
