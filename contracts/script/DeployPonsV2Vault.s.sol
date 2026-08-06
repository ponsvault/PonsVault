// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";

import {PonsTemplates} from "../src/PonsTemplates.sol";
import {PonsV2Addresses} from "../src/v2/PonsV2Addresses.sol";
import {PonsV2CurveBuyback} from "../src/v2/buyback/PonsV2CurveBuyback.sol";
import {PonsV2VaultLauncher} from "../src/v2/PonsV2VaultLauncher.sol";
import {PonsV2VaultRegistry} from "../src/v2/PonsV2VaultRegistry.sol";
import {PonsV2BuybackBurnVaultFactory} from "../src/v2/factories/PonsV2BuybackBurnVaultFactory.sol";
import {PonsV2StakingVaultFactory} from "../src/v2/factories/PonsV2StakingVaultFactory.sol";

/// @notice Deploys the PonsVault v2 stack beside the existing v1 deployment.
///
/// forge script script/DeployPonsV2Vault.s.sol --rpc-url robinhood --broadcast
///
/// @dev After deploy, paste addresses into `src/lib/pons/v2-deployments.ts`.
contract DeployPonsV2Vault is Script {
    function run() external {
        vm.startBroadcast();

        PonsV2VaultRegistry registry = new PonsV2VaultRegistry();

        PonsV2CurveBuyback buyback = new PonsV2CurveBuyback(PonsV2Addresses.FACTORY);
        PonsV2BuybackBurnVaultFactory buybackFactory = new PonsV2BuybackBurnVaultFactory(address(buyback));
        PonsV2StakingVaultFactory stakingFactory = new PonsV2StakingVaultFactory();

        registry.register(PonsTemplates.BUYBACK_BURN, address(buybackFactory));
        registry.register(PonsTemplates.STAKING, address(stakingFactory));

        PonsV2VaultLauncher launcher = new PonsV2VaultLauncher(registry);

        vm.stopBroadcast();

        console.log("PonsV2VaultRegistry             :", address(registry));
        console.log("PonsV2VaultLauncher             :", address(launcher));
        console.log("PonsV2CurveBuyback              :", address(buyback));
        console.log("PonsV2BuybackBurnVaultFactory   :", address(buybackFactory));
        console.log("  defaultBuyback                :", buybackFactory.defaultBuyback());
        console.log("  beacon                        :", buybackFactory.beacon());
        console.log("PonsV2StakingVaultFactory       :", address(stakingFactory));
        console.log("  beacon                        :", stakingFactory.beacon());
    }
}
