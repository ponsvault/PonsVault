// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PonsSeatAccount} from "../src/seats/PonsSeatAccount.sol";
import {PonsSeatSeriesCoreDeployer} from "../src/seats/PonsSeatSeriesCoreDeployer.sol";
import {PonsSeatSeriesFactory} from "../src/seats/PonsSeatSeriesFactory.sol";
import {PonsSeatSeriesMarketDeployer} from "../src/seats/PonsSeatSeriesMarketDeployer.sol";
import {PonsSeatSeriesRegistry} from "../src/seats/PonsSeatSeriesRegistry.sol";
import {PonsSeatTbaRegistry} from "../src/seats/PonsSeatTbaRegistry.sol";

/// @dev Diagnostic: the exact CreateParams the create form sends, against freshly built contracts.
contract SeatsUiParamsTest is Test {
    PonsSeatSeriesFactory internal factory;
    address internal creator = address(0xC0FFEE);

    function setUp() public {
        PonsSeatAccount accountImpl = new PonsSeatAccount();
        PonsSeatTbaRegistry tbaRegistry = new PonsSeatTbaRegistry(address(accountImpl));
        PonsSeatSeriesRegistry seriesRegistry = new PonsSeatSeriesRegistry();
        PonsSeatSeriesCoreDeployer coreDeployer = new PonsSeatSeriesCoreDeployer();
        PonsSeatSeriesMarketDeployer marketDeployer = new PonsSeatSeriesMarketDeployer();
        factory = new PonsSeatSeriesFactory(
            address(seriesRegistry),
            address(tbaRegistry),
            address(coreDeployer),
            address(marketDeployer),
            makeAddr("launcher")
        );
        seriesRegistry.setFactory(address(factory));
    }

    function _uiParams() internal pure returns (PonsSeatSeriesFactory.CreateParams memory p) {
        uint256[] memory fees = new uint256[](3);
        fees[0] = 66_666 ether;
        fees[1] = 166_666 ether;
        fees[2] = 666_666 ether;

        uint256[] memory weights = new uint256[](3);
        weights[0] = 10_000;
        weights[1] = 12_500;
        weights[2] = 20_000;

        p = PonsSeatSeriesFactory.CreateParams({
            name: "Simulation Only",
            symbol: "SIMONLY",
            tokenName: "Simulation Only Fuel",
            tokenSymbol: "SIMONLYF",
            baseTokenURI: "ipfs://QmV3sgvhE6viMW5rebR8TZbgnuTArYrfRs8PzbNME6Zz8B/",
            provenanceHash: bytes32(0),
            maxSupply: 1111,
            tokenSupply: 0.001 ether * 1111 * 3,
            seatPrice: 0.001 ether,
            swapFeeBps: 1000,
            snipeFeeBps: 1500,
            royaltyBps: 333,
            distributeThreshold: 0.05 ether,
            protocolTreasury: address(0xBEEF),
            activationFees: fees,
            activationWeights: weights,
            loanTermSeconds: 7 days,
            loanMinEthFee: 0.01 ether,
            fuelToken: address(0),
            loanSeed: 0
        });
    }

    /// The create form's own defaults must produce a series, or the desk is unusable as shipped.
    function testCreateFormDefaultsProduceASeries() public {
        vm.prank(creator);
        uint256 seriesId = factory.createSeries(_uiParams());
        assertEq(seriesId, 0, "first series should be id 0");
    }
}
