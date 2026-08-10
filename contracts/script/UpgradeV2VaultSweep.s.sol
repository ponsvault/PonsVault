// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";

import {PonsV2BuybackBurnVault} from "../src/v2/vaults/PonsV2BuybackBurnVault.sol";
import {PonsV2BuybackBurnVaultFactory} from "../src/v2/factories/PonsV2BuybackBurnVaultFactory.sol";
import {PonsV2StakingVault} from "../src/v2/vaults/PonsV2StakingVault.sol";
import {PonsV2StakingVaultFactory} from "../src/v2/factories/PonsV2StakingVaultFactory.sol";
import {PonsV2RwaVault} from "../src/v2/vaults/PonsV2RwaVault.sol";
import {PonsV2RwaVaultFactory} from "../src/v2/factories/PonsV2RwaVaultFactory.sol";

/// @notice Upgrade all three v2 vault beacons so {run} sweeps curve fees into escrow.
///
/// Must be broadcast by each factory's owner.
///
///   cd contracts && forge script script/UpgradeV2VaultSweep.s.sol --rpc-url robinhood --broadcast
contract UpgradeV2VaultSweep is Script {
    address constant BUYBACK_FACTORY = 0xdE4670A2Be85Baa3f6a2C1F6443101EA041362aB;
    address constant STAKING_FACTORY = 0x1488473464F2C6E6c5C412f05d805c619322E7EB;
    address constant RWA_FACTORY = 0xE3Dd55a527D7408d21f6Cc2aA66A488a0177C164;

    function run() external {
        vm.startBroadcast();

        PonsV2BuybackBurnVault bb = new PonsV2BuybackBurnVault();
        PonsV2BuybackBurnVaultFactory(BUYBACK_FACTORY).upgradeVaultImplementation(address(bb));

        PonsV2StakingVault st = new PonsV2StakingVault();
        PonsV2StakingVaultFactory(STAKING_FACTORY).upgradeVaultImplementation(address(st));

        PonsV2RwaVault rwa = new PonsV2RwaVault();
        PonsV2RwaVaultFactory(RWA_FACTORY).upgradeVaultImplementation(address(rwa));

        vm.stopBroadcast();

        console.log("buyback impl:", address(bb));
        console.log("staking impl:", address(st));
        console.log("rwa impl    :", address(rwa));
    }
}
