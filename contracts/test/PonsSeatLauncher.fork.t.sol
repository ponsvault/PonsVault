// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/token/ERC20/IERC20.sol";


import {PonsV2Addresses} from "../src/v2/PonsV2Addresses.sol";
import {IPonsV2Factory} from "../src/v2/interfaces/IPonsV2Factory.sol";
import {PonsSeatAccount} from "../src/seats/PonsSeatAccount.sol";
import {PonsSeatAmmVault} from "../src/seats/PonsSeatAmmVault.sol";
import {PonsSeatCollection} from "../src/seats/PonsSeatCollection.sol";
import {PonsSeatLauncher} from "../src/seats/PonsSeatLauncher.sol";
import {PonsSeatSeriesCoreDeployer} from "../src/seats/PonsSeatSeriesCoreDeployer.sol";
import {PonsSeatSeriesFactory} from "../src/seats/PonsSeatSeriesFactory.sol";
import {PonsSeatSeriesMarketDeployer} from "../src/seats/PonsSeatSeriesMarketDeployer.sol";
import {PonsSeatSeriesRegistry} from "../src/seats/PonsSeatSeriesRegistry.sol";
import {PonsSeatTbaRegistry} from "../src/seats/PonsSeatTbaRegistry.sol";

/// @dev Proves a series can be launched in one call against the real pons v2 factory. Fork only —
///      nothing here is broadcast.
contract PonsSeatLauncherForkTest is Test {
    IPonsV2Factory constant PONS = IPonsV2Factory(PonsV2Addresses.FACTORY);
    IERC20 constant AAPL = IERC20(PonsV2Addresses.AAPL);
    uint256 constant SEAT_PRICE = 1_000 ether;

    PonsSeatSeriesFactory factory;
    PonsSeatSeriesRegistry registry;
    PonsSeatLauncher launcher;

    address creator = makeAddr("creator");
    address treasury = makeAddr("treasury");

    function setUp() public {
        // Deliberately unpinned, unlike the rest of the suite: this test writes AAPL balances, and
        // the public endpoint has pruned the state the pinned block would need for that.
        vm.createSelectFork("robinhood");

        PonsSeatAccount accountImpl = new PonsSeatAccount();
        PonsSeatTbaRegistry tba = new PonsSeatTbaRegistry(address(accountImpl));
        registry = new PonsSeatSeriesRegistry();
        PonsSeatSeriesCoreDeployer core = new PonsSeatSeriesCoreDeployer();
        PonsSeatSeriesMarketDeployer market = new PonsSeatSeriesMarketDeployer();

        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        factory = new PonsSeatSeriesFactory(
            address(registry), address(tba), address(core), address(market), predicted
        );
        launcher = new PonsSeatLauncher(address(PONS), address(factory));
        assertEq(address(launcher), predicted, "launcher prediction");
        registry.setFactory(address(factory));

        vm.deal(creator, 10 ether);
        deal(address(AAPL), creator, 1_000_000 ether);
    }

    function _tokenParams() internal pure returns (IPonsV2Factory.TokenParams memory p) {
        p.name = "Seat Fuel";
        p.symbol = "SEATF";
        p.logo = "ipfs://logo";
        p.description = "fork test fuel - not a production launch";
        p.socials = IPonsV2Factory.Socials({twitter: "", telegram: "", discord: "", website: "", farcaster: ""});
        p.creatorFeeRecipient = address(0); // overwritten with the caller
        p.creatorTaxBps = 0;
        p.buybackEnabled = false;
        p.expectedEconomics = bytes32(0); // pinned by the launcher
        p.salt = bytes32(0);
    }

    function _series() internal view returns (PonsSeatSeriesFactory.CreateParams memory p) {
        uint256[] memory fees = new uint256[](2);
        fees[0] = 66_666 ether;
        fees[1] = 166_666 ether;
        uint256[] memory weights = new uint256[](2);
        weights[0] = 10_000;
        weights[1] = 12_500;

        p = PonsSeatSeriesFactory.CreateParams({
            name: "Fork Seats",
            symbol: "FSEAT",
            tokenName: "Seat Fuel",
            tokenSymbol: "SEATF",
            baseTokenURI: "ipfs://seat/",
            provenanceHash: bytes32(0),
            maxSupply: 10,
            tokenSupply: 0, // unused: the fuel is the launched token
            seatPrice: SEAT_PRICE,
            swapFeeBps: 1000,
            snipeFeeBps: 1500,
            royaltyBps: 333,
            distributeThreshold: 0.05 ether,
            protocolTreasury: treasury,
            activationFees: fees,
            activationWeights: weights,
            loanTermSeconds: 7 days,
            loanMinEthFee: 0.001 ether,
            fuelToken: address(0), // overwritten with the launched token
            loanSeed: 0
        });
    }

    function testOneCallLaunchesTheFuelAndTheSeriesTogether() public {
        uint256 fee = PONS.launchFee();
        uint256 firstBuy = 0.05 ether;

        vm.prank(creator);
        (uint256 seriesId, address fuel, address curve) =
            launcher.launchSeries{value: fee + firstBuy}(_tokenParams(), 0, address(0), firstBuy, 0, _series());

        (address recordedCreator, address token, address collection, address amm,,,,,,,) = registry.series(seriesId);
        assertEq(recordedCreator, creator, "the series belongs to the caller, not the launcher");
        assertEq(token, fuel, "the series runs on the token that was just launched");
        assertGt(fuel.code.length, 0, "fuel token deployed");
        assertGt(curve.code.length, 0, "curve deployed");

        assertGt(IERC20(fuel).balanceOf(creator), 0, "the first buy went to the caller");
        assertEq(IERC20(fuel).balanceOf(address(launcher)), 0, "the launcher keeps no fuel");
        assertEq(address(launcher).balance, 0, "the launcher keeps no ETH");

        IPonsV2Factory.LaunchedToken memory launched = PONS.getLaunchedToken(fuel);
        assertEq(launched.creatorFeeRecipient, creator, "the caller keeps the fuel token's creator fees");

        // The series is usable straight away: the fuel from the same call buys a seat.
        vm.startPrank(creator);
        IERC20(fuel).approve(amm, type(uint256).max);
        PonsSeatAmmVault(payable(amm)).buy{value: 0.001 ether}();
        vm.stopPrank();
        assertEq(PonsSeatCollection(collection).ownerOf(1), creator, "seat 1 minted to the buyer");
    }

    function testLaunchWithoutAFirstBuyOnlyCostsTheLaunchFee() public {
        uint256 fee = PONS.launchFee();

        vm.prank(creator);
        (uint256 seriesId, address fuel,) =
            launcher.launchSeries{value: fee}(_tokenParams(), 0, address(0), 0, 0, _series());

        assertEq(IERC20(fuel).balanceOf(creator), 0, "no fuel without a first buy");
        (address recordedCreator,,,,,,,,,,) = registry.series(seriesId);
        assertEq(recordedCreator, creator, "still recorded under the caller");
    }

    function testAnErc20PairIsPulledFromTheCaller() public {
        uint256 fee = PONS.launchFee();
        uint256 firstBuy = 1_000 ether;

        vm.startPrank(creator);
        AAPL.approve(address(launcher), firstBuy);
        (, address fuel,) =
            launcher.launchSeries{value: fee}(_tokenParams(), 0, address(AAPL), firstBuy, 0, _series());
        vm.stopPrank();

        assertGt(IERC20(fuel).balanceOf(creator), 0, "fuel bought with the ERC-20 pair");
        assertEq(AAPL.balanceOf(address(launcher)), 0, "no pair token left behind");
    }

    function testTheValueHasToCoverTheFeeAndTheBuy() public {
        uint256 fee = PONS.launchFee();

        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(PonsSeatLauncher.WrongValue.selector, fee + 0.05 ether, fee)
        );
        launcher.launchSeries{value: fee}(_tokenParams(), 0, address(0), 0.05 ether, 0, _series());
    }

    function testOnlyTheLauncherCanNameSomeoneElseAsTheCreator() public {
        vm.prank(creator);
        vm.expectRevert(PonsSeatSeriesFactory.NotLauncher.selector);
        factory.createSeriesFor(creator, _series());
    }
}
