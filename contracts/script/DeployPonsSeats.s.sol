// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";

import {PonsV2Addresses} from "../src/v2/PonsV2Addresses.sol";
import {PonsSeatAccount} from "../src/seats/PonsSeatAccount.sol";
import {PonsSeatLauncher} from "../src/seats/PonsSeatLauncher.sol";
import {PonsSeatSeriesCoreDeployer} from "../src/seats/PonsSeatSeriesCoreDeployer.sol";
import {PonsSeatSeriesFactory} from "../src/seats/PonsSeatSeriesFactory.sol";
import {PonsSeatSeriesMarketDeployer} from "../src/seats/PonsSeatSeriesMarketDeployer.sol";
import {PonsSeatSeriesRegistry} from "../src/seats/PonsSeatSeriesRegistry.sol";
import {PonsSeatTbaRegistry} from "../src/seats/PonsSeatTbaRegistry.sol";

/// @notice Deploys shared Seat infrastructure (TBA + series registry + factory).
contract DeployPonsSeats is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address ponsFactory = vm.envOr("PONS_V2_FACTORY", PonsV2Addresses.FACTORY);
        vm.startBroadcast(pk);

        PonsSeatAccount accountImpl = new PonsSeatAccount();
        PonsSeatTbaRegistry tbaRegistry = new PonsSeatTbaRegistry(address(accountImpl));
        PonsSeatSeriesRegistry seriesRegistry = new PonsSeatSeriesRegistry();
        PonsSeatSeriesCoreDeployer coreDeployer = new PonsSeatSeriesCoreDeployer();
        PonsSeatSeriesMarketDeployer marketDeployer = new PonsSeatSeriesMarketDeployer();

        // The launcher needs the factory and the factory has to trust exactly one launcher, so one of
        // the two addresses is computed before it exists. Predicting the launcher keeps the factory's
        // trusted address immutable rather than something a stranger could claim after deployment.
        address predictedLauncher = vm.computeCreateAddress(vm.addr(pk), vm.getNonce(vm.addr(pk)) + 1);
        PonsSeatSeriesFactory factory = new PonsSeatSeriesFactory(
            address(seriesRegistry),
            address(tbaRegistry),
            address(coreDeployer),
            address(marketDeployer),
            predictedLauncher
        );
        PonsSeatLauncher launcher = new PonsSeatLauncher(ponsFactory, address(factory));
        require(address(launcher) == predictedLauncher, "launcher address");
        seriesRegistry.setFactory(address(factory));

        vm.stopBroadcast();

        console2.log("PonsSeatLauncher", address(launcher));

        console2.log("PonsSeatAccount", address(accountImpl));
        console2.log("PonsSeatTbaRegistry", address(tbaRegistry));
        console2.log("PonsSeatSeriesRegistry", address(seriesRegistry));
        console2.log("PonsSeatSeriesCoreDeployer", address(coreDeployer));
        console2.log("PonsSeatSeriesMarketDeployer", address(marketDeployer));
        console2.log("PonsSeatSeriesFactory", address(factory));
        console2.log("protocolTreasury", vm.addr(pk));
    }
}
