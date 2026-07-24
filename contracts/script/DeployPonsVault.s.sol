// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";

import {PonsAddresses} from "../src/PonsAddresses.sol";
import {PonsTemplates} from "../src/PonsTemplates.sol";
import {PonsVaultLauncher} from "../src/PonsVaultLauncher.sol";
import {PonsVaultRegistry} from "../src/PonsVaultRegistry.sol";
import {IPonsLaunchpad} from "../src/interfaces/IPonsLaunchpad.sol";
import {PonsBuybackBurnVaultFactory} from "../src/factories/PonsBuybackBurnVaultFactory.sol";
import {PonsStakingVaultFactory} from "../src/factories/PonsStakingVaultFactory.sol";

/// @notice Deploys the PonsVault stack to Robinhood Chain.
///
/// forge script script/DeployPonsVault.s.sol --rpc-url robinhood --broadcast --verify
///
/// @dev This should be the last time the launcher moves. Templates are registered rather than
///      compiled in, so shipping a new one afterwards is {DeployVaultTemplate}, not this.
contract DeployPonsVault is Script {
    address constant PONS_LAUNCHPAD = 0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB;

    function run() external {
        vm.startBroadcast();

        PonsVaultRegistry registry = new PonsVaultRegistry();
        PonsBuybackBurnVaultFactory buybackFactory = new PonsBuybackBurnVaultFactory();
        PonsStakingVaultFactory stakingFactory = new PonsStakingVaultFactory();

        registry.register(PonsTemplates.BUYBACK_BURN, address(buybackFactory));
        registry.register(PonsTemplates.STAKING, address(stakingFactory));

        PonsVaultLauncher launcher =
            new PonsVaultLauncher(IPonsLaunchpad(PONS_LAUNCHPAD), PonsAddresses.PONS_ACTIVE_LOCKER, registry);

        vm.stopBroadcast();

        console.log("PonsVaultRegistry          :", address(registry));
        console.log("PonsVaultLauncher          :", address(launcher));
        console.log("PonsBuybackBurnVaultFactory:", address(buybackFactory));
        console.log("  beacon                   :", buybackFactory.beacon());
        console.log("  vault implementation     :", buybackFactory.implementation());
        console.log("PonsStakingVaultFactory    :", address(stakingFactory));
        console.log("  beacon                   :", stakingFactory.beacon());
        console.log("  vault implementation     :", stakingFactory.implementation());
    }
}
