// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/token/ERC721/IERC721.sol";

import {PonsSeatAccount} from "../src/seats/PonsSeatAccount.sol";
import {PonsSeatActivationManager} from "../src/seats/PonsSeatActivationManager.sol";
import {PonsSeatAmmVault} from "../src/seats/PonsSeatAmmVault.sol";
import {PonsSeatCollection} from "../src/seats/PonsSeatCollection.sol";
import {PonsSeatDirectedBooster} from "../src/seats/PonsSeatDirectedBooster.sol";
import {PonsSeatLoanVault} from "../src/seats/PonsSeatLoanVault.sol";
import {PonsSeatSeriesCoreDeployer} from "../src/seats/PonsSeatSeriesCoreDeployer.sol";
import {PonsSeatSeriesFactory} from "../src/seats/PonsSeatSeriesFactory.sol";
import {PonsSeatSeriesMarketDeployer} from "../src/seats/PonsSeatSeriesMarketDeployer.sol";
import {PonsSeatSeriesRegistry} from "../src/seats/PonsSeatSeriesRegistry.sol";
import {PonsSeatTbaRegistry} from "../src/seats/PonsSeatTbaRegistry.sol";

contract PonsSeatSeriesTest is Test {
    PonsSeatSeriesFactory factory;
    PonsSeatSeriesRegistry seriesRegistry;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address treasury = makeAddr("treasury");
    address launcher = makeAddr("launcher");

    uint256 constant SEAT_PRICE = 1_000 ether;

    function setUp() public {
        PonsSeatAccount accountImpl = new PonsSeatAccount();
        PonsSeatTbaRegistry tba = new PonsSeatTbaRegistry(address(accountImpl));
        seriesRegistry = new PonsSeatSeriesRegistry();
        PonsSeatSeriesCoreDeployer core = new PonsSeatSeriesCoreDeployer();
        PonsSeatSeriesMarketDeployer market = new PonsSeatSeriesMarketDeployer();
        factory = new PonsSeatSeriesFactory(
            address(seriesRegistry), address(tba), address(core), address(market), launcher
        );
        seriesRegistry.setFactory(address(factory));

        deal(alice, 100 ether);
        deal(bob, 100 ether);
    }

    function _params(uint256 maxSupply) internal view returns (PonsSeatSeriesFactory.CreateParams memory p) {
        uint256[] memory fees = new uint256[](2);
        fees[0] = 100 ether;
        fees[1] = 500 ether;
        uint256[] memory weights = new uint256[](2);
        weights[0] = 10_000;
        weights[1] = 20_000;

        p = PonsSeatSeriesFactory.CreateParams({
            name: "Vault Seats",
            symbol: "SEAT",
            tokenName: "Seat Fuel",
            tokenSymbol: "FUEL",
            baseTokenURI: "ipfs://seat/",
            provenanceHash: bytes32(0),
            maxSupply: maxSupply,
            tokenSupply: SEAT_PRICE * maxSupply * 3,
            seatPrice: SEAT_PRICE,
            swapFeeBps: 1000,
            snipeFeeBps: 1500,
            royaltyBps: 333,
            distributeThreshold: 0.05 ether,
            protocolTreasury: treasury,
            activationFees: fees,
            activationWeights: weights,
            loanTermSeconds: 1 days,
            loanMinEthFee: 0.01 ether,
            fuelToken: address(0),
            loanSeed: 0
        });
    }

    function _create(uint256 maxSupply)
        internal
        returns (
            address token,
            address collection,
            address amm,
            address activation,
            address booster,
            address loan
        )
    {
        vm.prank(alice);
        uint256 seriesId = factory.createSeries(_params(maxSupply));
        (
            ,
            token,
            collection,
            amm,
            activation,
            booster,
            loan,
            ,
            ,
            ,
        ) = seriesRegistry.series(seriesId);
    }

    function testFullLifecycleBuyActivateCrankDeliver() public {
        (address token, address collection, address amm, address activation, address booster,) = _create(10);

        // Nothing is minted until someone buys, but all 10 seats are for sale.
        assertEq(PonsSeatCollection(collection).totalMinted(), 0);
        assertEq(PonsSeatAmmVault(amm).inventorySize(), 0);
        assertEq(PonsSeatAmmVault(amm).availableSupply(), 10);

        vm.startPrank(alice);
        IERC20(token).approve(amm, type(uint256).max);
        IERC20(token).approve(activation, type(uint256).max);

        uint256 tokenId = PonsSeatAmmVault(amm).buy{value: 0.01 ether}();
        assertEq(PonsSeatCollection(collection).ownerOf(tokenId), alice);

        address[] memory electTokens = new address[](1);
        electTokens[0] = address(0);
        uint256[] memory electWeights = new uint256[](1);
        electWeights[0] = 10_000;
        PonsSeatDirectedBooster(payable(booster)).elect(tokenId, electTokens, electWeights);

        PonsSeatActivationManager(activation).activate(tokenId, 0);
        assertTrue(PonsSeatActivationManager(activation).isActivated(tokenId));

        PonsSeatAmmVault(amm).buy{value: 0.1 ether}();
        vm.stopPrank();

        uint256 roundId = _crank(booster);
        address tba = PonsSeatCollection(collection).accountOf(tokenId);
        uint256 beforeBal = tba.balance;
        PonsSeatDirectedBooster(payable(booster)).deliver(roundId, tokenId);
        assertGt(tba.balance, beforeBal);
    }

    function testSnipeAndSellRoundTrip() public {
        (address token, address collection, address amm,,,) = _create(5);

        vm.startPrank(alice);
        IERC20(token).approve(amm, type(uint256).max);

        // Sniping picks one explicit seat. Nothing is minted yet, so this mints that exact id.
        uint256 target = 3;
        assertFalse(PonsSeatCollection(collection).isMinted(target));
        PonsSeatAmmVault(amm).snipe{value: 0.02 ether}(target);
        assertEq(PonsSeatCollection(collection).ownerOf(target), alice);

        IERC721(collection).approve(amm, target);
        uint256 balBefore = IERC20(token).balanceOf(alice);
        PonsSeatAmmVault(amm).sell{value: 0.01 ether}(target);
        assertEq(PonsSeatCollection(collection).ownerOf(target), amm);
        assertEq(IERC20(token).balanceOf(alice), balBefore + SEAT_PRICE);
        vm.stopPrank();
    }

    function testTransferClearsActivation() public {
        (address token, address collection, address amm, address activation,,) = _create(5);

        vm.startPrank(alice);
        IERC20(token).approve(amm, type(uint256).max);
        IERC20(token).approve(activation, type(uint256).max);
        uint256 tokenId = PonsSeatAmmVault(amm).buy{value: 0.01 ether}();
        PonsSeatActivationManager(activation).activate(tokenId, 0);
        assertTrue(PonsSeatActivationManager(activation).isActivated(tokenId));
        assertEq(PonsSeatActivationManager(activation).totalWeight(), 10_000);

        IERC721(collection).transferFrom(alice, bob, tokenId);
        vm.stopPrank();

        assertFalse(PonsSeatActivationManager(activation).isActivated(tokenId));
        assertEq(PonsSeatActivationManager(activation).totalWeight(), 0);
    }

    function testUpgradeTier() public {
        (address token, , address amm, address activation,,) = _create(5);

        vm.startPrank(alice);
        IERC20(token).approve(amm, type(uint256).max);
        IERC20(token).approve(activation, type(uint256).max);
        uint256 tokenId = PonsSeatAmmVault(amm).buy{value: 0.01 ether}();
        PonsSeatActivationManager(activation).activate(tokenId, 0);
        PonsSeatActivationManager(activation).upgrade(tokenId, 1);
        assertEq(PonsSeatActivationManager(activation).tierOf(tokenId), 1);
        assertEq(PonsSeatActivationManager(activation).totalWeight(), 20_000);
        vm.stopPrank();
    }

    function testBorrowRepay() public {
        (address token, address collection, address amm,, , address loan) = _create(5);

        vm.startPrank(alice);
        IERC20(token).approve(amm, type(uint256).max);
        IERC20(token).approve(loan, type(uint256).max);
        uint256 tokenId = PonsSeatAmmVault(amm).buy{value: 0.01 ether}();

        IERC721(collection).approve(loan, tokenId);
        uint256 balBefore = IERC20(token).balanceOf(alice);
        PonsSeatLoanVault(loan).borrow{value: 0.01 ether}(tokenId);
        assertEq(PonsSeatCollection(collection).ownerOf(tokenId), loan);
        assertEq(IERC20(token).balanceOf(alice), balBefore + PonsSeatLoanVault(loan).principalAmount());

        PonsSeatLoanVault(loan).repay(tokenId);
        assertEq(PonsSeatCollection(collection).ownerOf(tokenId), alice);
        vm.stopPrank();
    }

    function testBorrowLiquidateAfterDue() public {
        (address token, address collection, address amm,, , address loan) = _create(5);
        uint256 principal = PonsSeatLoanVault(loan).principalAmount();

        vm.startPrank(alice);
        IERC20(token).approve(amm, type(uint256).max);
        uint256 tokenId = PonsSeatAmmVault(amm).buy{value: 0.01 ether}();
        IERC721(collection).approve(loan, tokenId);
        PonsSeatLoanVault(loan).borrow{value: 0.01 ether}(tokenId);
        vm.stopPrank();

        vm.warp(block.timestamp + 2 days);

        deal(token, bob, principal);
        vm.startPrank(bob);
        IERC20(token).approve(loan, principal);
        PonsSeatLoanVault(loan).liquidate(tokenId);
        vm.stopPrank();

        assertEq(PonsSeatCollection(collection).ownerOf(tokenId), bob);
    }

    function testTbaOwnerCanExecute() public {
        (address token, address collection, address amm,, ,) = _create(3);

        vm.startPrank(alice);
        IERC20(token).approve(amm, type(uint256).max);
        uint256 tokenId = PonsSeatAmmVault(amm).buy{value: 0.01 ether}();
        address tba = PonsSeatCollection(collection).accountOf(tokenId);
        PonsSeatCollection(collection).createAccount(tokenId);
        deal(tba, 1 ether);

        PonsSeatAccount(payable(tba)).execute(bob, 0.25 ether, "");
        assertEq(bob.balance, 100 ether + 0.25 ether);
        vm.stopPrank();
    }

    function testDeliverRangeTwoActivatedSeats() public {
        (address token, address collection, address amm, address activation, address booster,) = _create(8);

        // Fund bob with companion tokens from alice.
        vm.prank(alice);
        IERC20(token).transfer(bob, SEAT_PRICE * 2);

        vm.startPrank(alice);
        IERC20(token).approve(amm, type(uint256).max);
        IERC20(token).approve(activation, type(uint256).max);
        uint256 a = PonsSeatAmmVault(amm).buy{value: 0.01 ether}();
        PonsSeatActivationManager(activation).activate(a, 0);
        vm.stopPrank();

        vm.startPrank(bob);
        IERC20(token).approve(amm, type(uint256).max);
        IERC20(token).approve(activation, type(uint256).max);
        uint256 b = PonsSeatAmmVault(amm).buy{value: 0.01 ether}();
        PonsSeatActivationManager(activation).activate(b, 0);
        // Fill pot
        vm.stopPrank();

        vm.prank(alice);
        // alice still has tokens and inventory
        IERC20(token).approve(amm, type(uint256).max);
        vm.prank(alice);
        PonsSeatAmmVault(amm).buy{value: 0.2 ether}();

        uint256 roundId = _crank(booster);
        PonsSeatDirectedBooster(payable(booster)).deliverRange(roundId, 1, 8);

        assertGt(PonsSeatCollection(collection).accountOf(a).balance, 0);
        assertGt(PonsSeatCollection(collection).accountOf(b).balance, 0);
    }

    /* ------------------------------------------------------------------ */
    /* Factory wiring                                                      */
    /* ------------------------------------------------------------------ */

    function testFactorySplitsSupplyBetweenLoanBookAndCreator() public {
        (address token,, address amm,,, address loan) = _create(10);
        uint256 principal = PonsSeatLoanVault(loan).principalAmount();

        assertEq(IERC20(token).balanceOf(loan), principal * 10, "loan book funded");
        assertEq(IERC20(token).balanceOf(alice), SEAT_PRICE * 10 * 3 - principal * 10, "creator remainder");
        assertEq(IERC20(token).balanceOf(amm), 0, "amm starts with no tokens");
    }

    function testCollectionMetadataAndRoyalty() public {
        (address token, address collection, address amm,,,) = _create(4);

        // tokenURI only exists once the seat does, so buy seat 3 before reading it.
        vm.startPrank(alice);
        IERC20(token).approve(amm, type(uint256).max);
        PonsSeatAmmVault(amm).snipe{value: 0.02 ether}(3);
        vm.stopPrank();

        assertEq(PonsSeatCollection(collection).tokenURI(3), "ipfs://seat/3");
        (address receiver, uint256 amount) = PonsSeatCollection(collection).royaltyInfo(1, 1 ether);
        assertEq(receiver, treasury);
        assertEq(amount, 0.0333 ether);
    }

    /* ------------------------------------------------------------------ */
    /* Shop (AMM)                                                          */
    /* ------------------------------------------------------------------ */

    function testBuyRevertsWhenInventoryIsEmpty() public {
        (address token,, address amm,,,) = _create(2);

        vm.startPrank(alice);
        IERC20(token).approve(amm, type(uint256).max);
        PonsSeatAmmVault(amm).buy{value: 0.01 ether}();
        PonsSeatAmmVault(amm).buy{value: 0.01 ether}();

        vm.expectRevert(PonsSeatAmmVault.EmptyInventory.selector);
        PonsSeatAmmVault(amm).buy{value: 0.01 ether}();
        vm.stopPrank();
    }

    function testSnipeRevertsForSeatNotInTheShop() public {
        (address token,, address amm,,,) = _create(5);

        vm.startPrank(alice);
        IERC20(token).approve(amm, type(uint256).max);
        PonsSeatAmmVault(amm).snipe{value: 0.02 ether}(2);

        // Already bought, so it is no longer listed.
        vm.expectRevert(PonsSeatAmmVault.NotListed.selector);
        PonsSeatAmmVault(amm).snipe{value: 0.02 ether}(2);
        vm.stopPrank();
    }

    function testTradeRevertsBelowMinimumEthFee() public {
        (address token,, address amm,,,) = _create(5);

        vm.startPrank(alice);
        IERC20(token).approve(amm, type(uint256).max);

        // swapFeeBps 1000 -> 0.001 ETH, snipeFeeBps 1500 -> 0.0015 ETH.
        vm.expectRevert(PonsSeatAmmVault.FeeRequired.selector);
        PonsSeatAmmVault(amm).buy{value: 0.0009 ether}();

        vm.expectRevert(PonsSeatAmmVault.FeeRequired.selector);
        PonsSeatAmmVault(amm).snipe{value: 0.0014 ether}(1);
        vm.stopPrank();
    }

    function testTradeFeesLandInTheRewardPot() public {
        (address token,, address amm,, address booster,) = _create(5);

        vm.startPrank(alice);
        IERC20(token).approve(amm, type(uint256).max);
        PonsSeatAmmVault(amm).buy{value: 0.01 ether}();
        PonsSeatAmmVault(amm).buy{value: 0.02 ether}();
        vm.stopPrank();

        assertEq(PonsSeatDirectedBooster(payable(booster)).accruedEth(), 0.03 ether);
        assertEq(booster.balance, 0.03 ether);
    }

    function testFuzzBuySellRoundTripIsBalanceNeutral(uint8 seatCount) public {
        seatCount = uint8(bound(seatCount, 1, 20));
        (address token, address collection, address amm,,,) = _create(seatCount);

        vm.startPrank(alice);
        IERC20(token).approve(amm, type(uint256).max);
        uint256 tokensBefore = IERC20(token).balanceOf(alice);

        uint256 tokenId = PonsSeatAmmVault(amm).buy{value: 0.01 ether}();
        assertEq(IERC20(token).balanceOf(alice), tokensBefore - SEAT_PRICE);

        IERC721(collection).approve(amm, tokenId);
        PonsSeatAmmVault(amm).sell{value: 0.01 ether}(tokenId);
        vm.stopPrank();

        assertEq(IERC20(token).balanceOf(alice), tokensBefore, "tokens restored");
        assertEq(PonsSeatAmmVault(amm).inventorySize(), 1, "the sold seat is the shop's only stock");
        assertEq(PonsSeatAmmVault(amm).availableSupply(), seatCount, "every seat is for sale again");
        assertEq(IERC20(token).balanceOf(amm), 0, "shop holds no leftover tokens");
    }

    /// @dev Re-listing a seat must not leave a duplicate inventory entry, which would make a later
    ///      buy() pop a seat the shop no longer holds and brick the shop for everyone.
    function testShopSurvivesRepeatedBuySellCycles() public {
        uint256 supply = 4;
        (address token, address collection, address amm,,,) = _create(supply);

        vm.startPrank(alice);
        IERC20(token).approve(amm, type(uint256).max);

        for (uint256 cycle = 0; cycle < 3; cycle++) {
            uint256[] memory held = new uint256[](supply);
            for (uint256 i = 0; i < supply; i++) {
                held[i] = PonsSeatAmmVault(amm).buy{value: 0.01 ether}();
            }
            assertEq(PonsSeatAmmVault(amm).inventorySize(), 0, "shop drained");

            for (uint256 i = 0; i < supply; i++) {
                IERC721(collection).approve(amm, held[i]);
                PonsSeatAmmVault(amm).sell{value: 0.01 ether}(held[i]);
            }
            assertEq(PonsSeatAmmVault(amm).inventorySize(), supply, "shop restocked exactly once");
        }
        vm.stopPrank();
    }

    /* ------------------------------------------------------------------ */
    /* Activation                                                          */
    /* ------------------------------------------------------------------ */

    function testActivationBurnsHalfAndPaysTreasury() public {
        (address token,, address amm, address activation,,) = _create(5);

        vm.startPrank(alice);
        IERC20(token).approve(amm, type(uint256).max);
        IERC20(token).approve(activation, type(uint256).max);
        uint256 tokenId = PonsSeatAmmVault(amm).buy{value: 0.01 ether}();
        PonsSeatActivationManager(activation).activate(tokenId, 0);
        vm.stopPrank();

        assertEq(IERC20(token).balanceOf(address(0xdead)), 50 ether, "half burned");
        assertEq(IERC20(token).balanceOf(treasury), 50 ether, "half to treasury");
        assertEq(IERC20(token).balanceOf(activation), 0, "manager keeps nothing");
    }

    function testActivateRejectsNonOwnerAndBadTier() public {
        (address token,, address amm, address activation,,) = _create(5);

        vm.startPrank(alice);
        IERC20(token).approve(amm, type(uint256).max);
        IERC20(token).approve(activation, type(uint256).max);
        uint256 tokenId = PonsSeatAmmVault(amm).buy{value: 0.01 ether}();

        vm.expectRevert(PonsSeatActivationManager.BadTier.selector);
        PonsSeatActivationManager(activation).activate(tokenId, 9);
        vm.stopPrank();

        vm.prank(bob);
        vm.expectRevert(PonsSeatActivationManager.NotOwner.selector);
        PonsSeatActivationManager(activation).activate(tokenId, 0);
    }

    function testCannotReactivateAtSameOrLowerTier() public {
        (address token,, address amm, address activation,,) = _create(5);

        vm.startPrank(alice);
        IERC20(token).approve(amm, type(uint256).max);
        IERC20(token).approve(activation, type(uint256).max);
        uint256 tokenId = PonsSeatAmmVault(amm).buy{value: 0.01 ether}();
        PonsSeatActivationManager(activation).activate(tokenId, 1);

        vm.expectRevert(PonsSeatActivationManager.AlreadyAtTier.selector);
        PonsSeatActivationManager(activation).activate(tokenId, 0);

        vm.expectRevert(PonsSeatActivationManager.AlreadyAtTier.selector);
        PonsSeatActivationManager(activation).activate(tokenId, 1);
        vm.stopPrank();
    }

    function testSellingClearsActivationAndPayrollWeight() public {
        (address token, address collection, address amm, address activation,,) = _create(5);

        vm.startPrank(alice);
        IERC20(token).approve(amm, type(uint256).max);
        IERC20(token).approve(activation, type(uint256).max);
        uint256 tokenId = PonsSeatAmmVault(amm).buy{value: 0.01 ether}();
        PonsSeatActivationManager(activation).activate(tokenId, 0);

        IERC721(collection).approve(amm, tokenId);
        PonsSeatAmmVault(amm).sell{value: 0.01 ether}(tokenId);
        vm.stopPrank();

        assertFalse(PonsSeatActivationManager(activation).isActivated(tokenId));
        assertEq(PonsSeatActivationManager(activation).totalWeight(), 0);
        assertEq(PonsSeatActivationManager(activation).activatedAt(tokenId), 0);
    }

    /* ------------------------------------------------------------------ */
    /* Reward pot                                                          */
    /* ------------------------------------------------------------------ */

    function testCrankRejectsEmptyPotAndEmptyPayroll() public {
        (address token,, address amm,, address booster,) = _create(5);

        vm.expectRevert(PonsSeatDirectedBooster.BelowThreshold.selector);
        PonsSeatDirectedBooster(payable(booster)).crank();

        // Pot is full but nobody is on the payroll.
        vm.startPrank(alice);
        IERC20(token).approve(amm, type(uint256).max);
        PonsSeatAmmVault(amm).buy{value: 0.1 ether}();
        vm.stopPrank();

        vm.expectRevert(bytes("no weight"));
        PonsSeatDirectedBooster(payable(booster)).crank();
    }

    function testDeliverIsOncePerRound() public {
        (address token, address collection, address amm, address activation, address booster,) = _create(5);
        uint256 tokenId = _buyAndActivate(alice, token, amm, activation, 0);

        vm.prank(alice);
        PonsSeatAmmVault(amm).buy{value: 0.1 ether}();

        uint256 roundId = _crank(booster);
        PonsSeatDirectedBooster(payable(booster)).deliver(roundId, tokenId);

        vm.expectRevert(PonsSeatDirectedBooster.NothingToDeliver.selector);
        PonsSeatDirectedBooster(payable(booster)).deliver(roundId, tokenId);

        assertGt(PonsSeatCollection(collection).accountOf(tokenId).balance, 0);
    }

    /// @dev A round's share is fixed at crank time, so joining the payroll afterwards must not dilute it.
    function testSeatActivatedAfterCrankCannotClaimThatRound() public {
        (address token,, address amm, address activation, address booster,) = _create(8);

        vm.prank(alice);
        IERC20(token).transfer(bob, SEAT_PRICE * 3);

        uint256 early = _buyAndActivate(alice, token, amm, activation, 0);

        vm.prank(alice);
        PonsSeatAmmVault(amm).buy{value: 0.1 ether}();

        uint256 roundId = _crank(booster);
        (uint256 pot,,,) = PonsSeatDirectedBooster(payable(booster)).rounds(roundId);

        vm.warp(block.timestamp + 1);
        uint256 late = _buyAndActivate(bob, token, amm, activation, 0);

        vm.expectRevert(PonsSeatDirectedBooster.NothingToDeliver.selector);
        PonsSeatDirectedBooster(payable(booster)).deliver(roundId, late);

        PonsSeatDirectedBooster(payable(booster)).deliver(roundId, early);
        (, , uint256 distributed,) = PonsSeatDirectedBooster(payable(booster)).rounds(roundId);
        assertEq(distributed, pot, "early seat takes the whole round");
    }

    /// @dev Blocks can share a second, so "after the crank" has to include the crank's own second:
    ///      that seat is not in the round's weight, and paying it would come out of the seats that are.
    function testSeatActivatedInTheCrankSecondCannotClaimThatRound() public {
        (address token,, address amm, address activation, address booster,) = _create(8);

        vm.prank(alice);
        IERC20(token).transfer(bob, SEAT_PRICE * 3);

        uint256 early = _buyAndActivate(alice, token, amm, activation, 0);

        vm.prank(alice);
        PonsSeatAmmVault(amm).buy{value: 0.1 ether}();

        vm.warp(block.timestamp + 1);
        uint256 roundId = PonsSeatDirectedBooster(payable(booster)).crank();
        (uint256 pot,,,) = PonsSeatDirectedBooster(payable(booster)).rounds(roundId);

        // No warp: same timestamp as the crank.
        uint256 sameSecond = _buyAndActivate(bob, token, amm, activation, 0);

        vm.expectRevert(PonsSeatDirectedBooster.NothingToDeliver.selector);
        PonsSeatDirectedBooster(payable(booster)).deliver(roundId, sameSecond);

        PonsSeatDirectedBooster(payable(booster)).deliver(roundId, early);
        (,, uint256 distributed,) = PonsSeatDirectedBooster(payable(booster)).rounds(roundId);
        assertEq(distributed, pot, "the seat that was on the payroll takes the round");
    }

    function testRoundNeverPaysOutMoreThanItsPot() public {
        (address token,, address amm, address activation, address booster,) = _create(8);

        vm.prank(alice);
        IERC20(token).transfer(bob, SEAT_PRICE * 6);

        uint256 a = _buyAndActivate(alice, token, amm, activation, 0);
        uint256 b = _buyAndActivate(alice, token, amm, activation, 1);
        uint256 c = _buyAndActivate(bob, token, amm, activation, 0);

        vm.prank(alice);
        PonsSeatAmmVault(amm).buy{value: 0.1 ether}();

        vm.warp(block.timestamp + 1);
        uint256 roundId = PonsSeatDirectedBooster(payable(booster)).crank();
        (uint256 pot,,,) = PonsSeatDirectedBooster(payable(booster)).rounds(roundId);

        uint256 boosterBefore = booster.balance;
        PonsSeatDirectedBooster(payable(booster)).deliver(roundId, a);
        PonsSeatDirectedBooster(payable(booster)).deliver(roundId, b);
        PonsSeatDirectedBooster(payable(booster)).deliver(roundId, c);

        assertLe(boosterBefore - booster.balance, pot, "pot is the hard ceiling");
        (,, uint256 distributed,) = PonsSeatDirectedBooster(payable(booster)).rounds(roundId);
        assertLe(distributed, pot, "a round cannot distribute more than it holds");
        assertGe(distributed, pot - 3, "and it pays out the pot bar rounding dust");
    }

    function testStaleRoundRemainderRollsIntoTheNextPot() public {
        (address token,, address amm, address activation, address booster,) = _create(8);

        vm.prank(alice);
        IERC20(token).transfer(bob, SEAT_PRICE * 3);

        uint256 a = _buyAndActivate(alice, token, amm, activation, 0);
        uint256 b = _buyAndActivate(bob, token, amm, activation, 0);

        vm.prank(alice);
        PonsSeatAmmVault(amm).buy{value: 0.2 ether}();

        uint256 roundId = _crank(booster);
        (uint256 pot,,,) = PonsSeatDirectedBooster(payable(booster)).rounds(roundId);
        PonsSeatDirectedBooster(payable(booster)).deliver(roundId, a);

        vm.expectRevert(PonsSeatDirectedBooster.TooEarly.selector);
        PonsSeatDirectedBooster(payable(booster)).reclaim(roundId);

        vm.warp(block.timestamp + 8 days);
        uint256 reclaimed = PonsSeatDirectedBooster(payable(booster)).reclaim(roundId);

        assertEq(reclaimed, pot / 2, "b never claimed its half");
        assertEq(PonsSeatDirectedBooster(payable(booster)).accruedEth(), reclaimed);

        // And the rolled-over ETH is claimable in the next round.
        uint256 next = _crank(booster);
        PonsSeatDirectedBooster(payable(booster)).deliverRange(next, 1, 8);
        assertGt(PonsSeatCollection(_collectionOf(booster)).accountOf(b).balance, 0);
    }

    function testElectionRequiresOwnerAndFullWeights() public {
        (address token,, address amm,, address booster,) = _create(5);

        vm.startPrank(alice);
        IERC20(token).approve(amm, type(uint256).max);
        uint256 tokenId = PonsSeatAmmVault(amm).buy{value: 0.01 ether}();

        address[] memory tokens = new address[](1);
        uint256[] memory weights = new uint256[](1);
        weights[0] = 9_000;

        vm.expectRevert(PonsSeatDirectedBooster.BadElection.selector);
        PonsSeatDirectedBooster(payable(booster)).elect(tokenId, tokens, weights);
        vm.stopPrank();

        weights[0] = 10_000;
        vm.prank(bob);
        vm.expectRevert(bytes("owner"));
        PonsSeatDirectedBooster(payable(booster)).elect(tokenId, tokens, weights);
    }

    /* ------------------------------------------------------------------ */
    /* Loans                                                               */
    /* ------------------------------------------------------------------ */

    function testLoanPrincipalSitsBelowTheSeatPrice() public {
        (,,,,, address loan) = _create(5);
        assertEq(PonsSeatLoanVault(loan).principalAmount(), (SEAT_PRICE * 7000) / 10_000);
    }

    function testLiquidatorMustPayThePrincipal() public {
        (address token, address collection, address amm,,, address loan) = _create(5);

        vm.startPrank(alice);
        IERC20(token).approve(amm, type(uint256).max);
        uint256 tokenId = PonsSeatAmmVault(amm).buy{value: 0.01 ether}();
        IERC721(collection).approve(loan, tokenId);
        PonsSeatLoanVault(loan).borrow{value: 0.01 ether}(tokenId);
        vm.stopPrank();

        vm.warp(block.timestamp + 2 days);

        // Bob holds no companion tokens, so he cannot seize the seat for free.
        vm.prank(bob);
        vm.expectRevert();
        PonsSeatLoanVault(loan).liquidate(tokenId);

        assertEq(PonsSeatCollection(collection).ownerOf(tokenId), loan);
    }

    /// @dev Borrow, default, then self-liquidate from a second wallet. Must not mint free tokens.
    function testSelfLiquidationCannotDrainTheLoanBook() public {
        (address token, address collection, address amm,,, address loan) = _create(5);
        uint256 bookBefore = IERC20(token).balanceOf(loan);
        uint256 principal = PonsSeatLoanVault(loan).principalAmount();

        vm.startPrank(alice);
        IERC20(token).approve(amm, type(uint256).max);
        uint256 tokenId = PonsSeatAmmVault(amm).buy{value: 0.01 ether}();
        IERC721(collection).approve(loan, tokenId);
        PonsSeatLoanVault(loan).borrow{value: 0.01 ether}(tokenId);

        // Alice funds her alt with exactly the borrowed principal.
        assertTrue(IERC20(token).transfer(bob, principal));
        vm.stopPrank();

        vm.warp(block.timestamp + 2 days);

        vm.startPrank(bob);
        IERC20(token).approve(loan, principal);
        PonsSeatLoanVault(loan).liquidate(tokenId);
        vm.stopPrank();

        assertEq(IERC20(token).balanceOf(loan), bookBefore, "loan book made whole");
        assertEq(PonsSeatCollection(collection).ownerOf(tokenId), bob);
    }

    function testRepayIsBorrowerOnly() public {
        (address token, address collection, address amm,,, address loan) = _create(5);

        vm.startPrank(alice);
        IERC20(token).approve(amm, type(uint256).max);
        IERC20(token).approve(loan, type(uint256).max);
        uint256 tokenId = PonsSeatAmmVault(amm).buy{value: 0.01 ether}();
        IERC721(collection).approve(loan, tokenId);
        PonsSeatLoanVault(loan).borrow{value: 0.01 ether}(tokenId);
        vm.stopPrank();

        vm.prank(bob);
        vm.expectRevert(bytes("borrower"));
        PonsSeatLoanVault(loan).repay(tokenId);
    }

    function testCannotLiquidateBeforeDue() public {
        (address token, address collection, address amm,,, address loan) = _create(5);

        vm.startPrank(alice);
        IERC20(token).approve(amm, type(uint256).max);
        uint256 tokenId = PonsSeatAmmVault(amm).buy{value: 0.01 ether}();
        IERC721(collection).approve(loan, tokenId);
        PonsSeatLoanVault(loan).borrow{value: 0.01 ether}(tokenId);
        vm.stopPrank();

        vm.prank(bob);
        vm.expectRevert(PonsSeatLoanVault.NotLiquidatable.selector);
        PonsSeatLoanVault(loan).liquidate(tokenId);
    }

    function testBorrowRequiresOwnershipAndFee() public {
        (address token, address collection, address amm,,, address loan) = _create(5);

        vm.startPrank(alice);
        IERC20(token).approve(amm, type(uint256).max);
        uint256 tokenId = PonsSeatAmmVault(amm).buy{value: 0.01 ether}();
        IERC721(collection).approve(loan, tokenId);

        vm.expectRevert(PonsSeatLoanVault.FeeRequired.selector);
        PonsSeatLoanVault(loan).borrow{value: 0.001 ether}(tokenId);
        vm.stopPrank();

        vm.prank(bob);
        vm.expectRevert(PonsSeatLoanVault.NotOwner.selector);
        PonsSeatLoanVault(loan).borrow{value: 0.01 ether}(tokenId);
    }

    /* ------------------------------------------------------------------ */
    /* Seat wallets (TBA)                                                  */
    /* ------------------------------------------------------------------ */

    function testTbaRejectsNonOwner() public {
        (address token, address collection, address amm,,,) = _create(3);

        vm.startPrank(alice);
        IERC20(token).approve(amm, type(uint256).max);
        uint256 tokenId = PonsSeatAmmVault(amm).buy{value: 0.01 ether}();
        PonsSeatCollection(collection).createAccount(tokenId);
        vm.stopPrank();

        address tba = PonsSeatCollection(collection).accountOf(tokenId);
        deal(tba, 1 ether);

        vm.prank(bob);
        vm.expectRevert();
        PonsSeatAccount(payable(tba)).execute(bob, 0.25 ether, "");
    }

    function testSeatWalletFollowsTheNftOnTransfer() public {
        (address token, address collection, address amm,,,) = _create(3);

        vm.startPrank(alice);
        IERC20(token).approve(amm, type(uint256).max);
        uint256 tokenId = PonsSeatAmmVault(amm).buy{value: 0.01 ether}();
        address tba = PonsSeatCollection(collection).accountOf(tokenId);
        PonsSeatCollection(collection).createAccount(tokenId);
        deal(tba, 1 ether);
        IERC721(collection).transferFrom(alice, bob, tokenId);
        vm.stopPrank();

        // Same wallet address, new controller.
        assertEq(PonsSeatCollection(collection).accountOf(tokenId), tba);
        assertEq(tba.balance, 1 ether);

        vm.prank(alice);
        vm.expectRevert();
        PonsSeatAccount(payable(tba)).execute(alice, 0.1 ether, "");

        vm.prank(bob);
        PonsSeatAccount(payable(tba)).execute(bob, 0.1 ether, "");
        assertEq(tba.balance, 0.9 ether);
    }

    /* ------------------------------------------------------------------ */
    /* Lazy minting                                                        */
    /* ------------------------------------------------------------------ */

    /// Creation must not mint anything, or the creator pays for every seat and large series cannot launch.
    function testCreationMintsNothingButOffersEverySeat() public {
        (, address collection, address amm,,,) = _create(4444);

        assertEq(PonsSeatCollection(collection).totalMinted(), 0, "no seat exists yet");
        assertEq(PonsSeatCollection(collection).unmintedSupply(), 4444);
        assertEq(PonsSeatAmmVault(amm).inventorySize(), 0, "shop holds no seats");
        assertEq(PonsSeatAmmVault(amm).availableSupply(), 4444, "yet all of them are for sale");
        assertEq(PonsSeatCollection(collection).balanceOf(alice), 0, "creator gets no seats");
        assertEq(PonsSeatCollection(collection).balanceOf(amm), 0);
    }

    function testBuyingMintsSeatsInOrder() public {
        (address token, address collection, address amm,,,) = _create(3);

        vm.startPrank(alice);
        IERC20(token).approve(amm, type(uint256).max);
        assertEq(PonsSeatAmmVault(amm).buy{value: 0.01 ether}(), 1);
        assertEq(PonsSeatAmmVault(amm).buy{value: 0.01 ether}(), 2);
        assertEq(PonsSeatAmmVault(amm).buy{value: 0.01 ether}(), 3);
        vm.stopPrank();

        assertEq(PonsSeatCollection(collection).totalMinted(), 3);
        assertEq(PonsSeatCollection(collection).ownerOf(2), alice);
    }

    /// A sniped id is taken out of the sequence, so the next plain buy must skip over it.
    function testBuyingSkipsASnipedSeat() public {
        (address token, address collection, address amm,,,) = _create(3);

        vm.startPrank(alice);
        IERC20(token).approve(amm, type(uint256).max);
        PonsSeatAmmVault(amm).snipe{value: 0.02 ether}(1);
        assertEq(PonsSeatAmmVault(amm).buy{value: 0.01 ether}(), 2, "1 was taken, so 2 is next");

        PonsSeatAmmVault(amm).snipe{value: 0.02 ether}(3);
        vm.stopPrank();

        assertEq(PonsSeatCollection(collection).totalMinted(), 3);
        assertEq(PonsSeatAmmVault(amm).availableSupply(), 0, "series is sold out");
    }

    /// Resold seats must clear before the shop mints new ones, or returned stock would sit forever.
    function testShopSellsReturnedStockBeforeMintingMore() public {
        (address token, address collection, address amm,,,) = _create(5);

        vm.startPrank(alice);
        IERC20(token).approve(amm, type(uint256).max);
        uint256 first = PonsSeatAmmVault(amm).buy{value: 0.01 ether}();
        IERC721(collection).approve(amm, first);
        PonsSeatAmmVault(amm).sell{value: 0.01 ether}(first);

        assertEq(PonsSeatAmmVault(amm).inventorySize(), 1);
        uint256 second = PonsSeatAmmVault(amm).buy{value: 0.01 ether}();
        vm.stopPrank();

        assertEq(second, first, "the returned seat is sold again");
        assertEq(PonsSeatCollection(collection).totalMinted(), 1, "nothing new was minted");
    }

    function testSeriesSellsOutExactlyAtMaxSupply() public {
        (address token, address collection, address amm,,,) = _create(2);

        vm.startPrank(alice);
        IERC20(token).approve(amm, type(uint256).max);
        PonsSeatAmmVault(amm).buy{value: 0.01 ether}();
        PonsSeatAmmVault(amm).buy{value: 0.01 ether}();

        vm.expectRevert(PonsSeatAmmVault.EmptyInventory.selector);
        PonsSeatAmmVault(amm).buy{value: 0.01 ether}();

        vm.expectRevert(PonsSeatAmmVault.NotListed.selector);
        PonsSeatAmmVault(amm).snipe{value: 0.02 ether}(3);
        vm.stopPrank();

        assertEq(PonsSeatCollection(collection).totalMinted(), 2, "never mints past the cap");
    }

    function testSnipeRejectsSeatsThatAreNotForSale() public {
        (address token,, address amm,,,) = _create(3);

        vm.startPrank(alice);
        IERC20(token).approve(amm, type(uint256).max);
        PonsSeatAmmVault(amm).snipe{value: 0.02 ether}(2);

        // Already owned by someone, so not the shop's to sell.
        vm.expectRevert(PonsSeatAmmVault.NotListed.selector);
        PonsSeatAmmVault(amm).snipe{value: 0.02 ether}(2);

        vm.expectRevert(PonsSeatAmmVault.NotListed.selector);
        PonsSeatAmmVault(amm).snipe{value: 0.02 ether}(4);

        vm.expectRevert(PonsSeatAmmVault.NotListed.selector);
        PonsSeatAmmVault(amm).snipe{value: 0.02 ether}(0);
        vm.stopPrank();
    }

    /// Minting is the shop's alone. Anyone else could otherwise take seats without paying for them.
    function testOnlyTheShopCanMint() public {
        (, address collection,,,,) = _create(5);

        vm.startPrank(alice);
        vm.expectRevert(PonsSeatCollection.NotShop.selector);
        PonsSeatCollection(collection).mintNext(alice);

        vm.expectRevert(PonsSeatCollection.NotShop.selector);
        PonsSeatCollection(collection).mintSpecific(alice, 1);
        vm.stopPrank();
    }

    function testShopCannotBeRepointed() public {
        (, address collection,,,,) = _create(5);

        vm.prank(alice);
        vm.expectRevert(PonsSeatCollection.NotMinter.selector);
        PonsSeatCollection(collection).setShop(alice);
    }

    /**
     * Creation gas must not scale with supply.
     *
     * The RPC refuses to simulate calls past roughly 50M gas and wallets estimate before sending, so
     * a supply-dependent creation cost silently caps how large a series can be. It used to cost ~230k
     * per seat, which put 1111 seats out of reach entirely.
     */
    function testCreationGasDoesNotGrowWithSupply() public {
        uint256 smallGas = _measureCreateGas(10);
        uint256 largeGas = _measureCreateGas(4444);

        emit log_named_uint("createSeries gas at supply 10  ", smallGas);
        emit log_named_uint("createSeries gas at supply 4444", largeGas);

        assertLt(largeGas, 20_000_000, "creation must fit comfortably inside the RPC gas cap");
        assertLt(largeGas, smallGas + 1_000_000, "cost per extra seat at creation must be ~zero");
    }

    /* ------------------------------------------------------------------ */
    /* Fuel from an existing market, e.g. a Pons V2 bonding-curve launch   */
    /* ------------------------------------------------------------------ */

    /// @dev Creates a series whose currency is a token the factory did not mint.
    function _createWithFuel(uint256 maxSupply, address fuel, uint256 loanSeed)
        internal
        returns (address token, address collection, address amm, address activation, address loan)
    {
        PonsSeatSeriesFactory.CreateParams memory p = _params(maxSupply);
        p.fuelToken = fuel;
        p.loanSeed = loanSeed;

        vm.prank(alice);
        uint256 seriesId = factory.createSeries(p);
        (, token, collection, amm, activation,, loan,,,,) = seriesRegistry.series(seriesId);
    }

    function testSeriesCanRunOnAnExistingToken() public {
        ExternalFuel fuel = new ExternalFuel();
        (address token, address collection, address amm, address activation,) =
            _createWithFuel(10, address(fuel), 0);

        // The series adopted the token rather than minting one of its own.
        assertEq(token, address(fuel), "series currency must be the token we passed in");
        assertEq(PonsSeatAmmVault(amm).availableSupply(), 10);

        // Every module that moves money must point at that same token.
        assertEq(address(PonsSeatAmmVault(amm).token()), address(fuel));
        assertEq(address(PonsSeatActivationManager(activation).token()), address(fuel));

        // A buyer who acquired fuel on its market can buy a seat with no help from the creator.
        fuel.mint(bob, SEAT_PRICE * 2);
        vm.startPrank(bob);
        IERC20(address(fuel)).approve(amm, type(uint256).max);
        uint256 tokenId = PonsSeatAmmVault(amm).buy{value: 0.01 ether}();
        vm.stopPrank();

        assertEq(PonsSeatCollection(collection).ownerOf(tokenId), bob);
        assertEq(IERC20(address(fuel)).balanceOf(amm), SEAT_PRICE);
    }

    function testExistingTokenSeriesMintsNoFuelOfItsOwn() public {
        ExternalFuel fuel = new ExternalFuel();
        uint256 supplyBefore = fuel.totalSupply();

        (address token,,,,) = _createWithFuel(10, address(fuel), 0);

        assertEq(token, address(fuel));
        assertEq(fuel.totalSupply(), supplyBefore, "creation must not mint any fuel");
        assertEq(fuel.balanceOf(alice), 0, "creator must not be handed a free supply");
    }

    function testCreatorCanSeedTheLoanBookWithBoughtFuel() public {
        ExternalFuel fuel = new ExternalFuel();
        uint256 seed = 5_000 ether;

        // The creator bought fuel on its market first, then lends it to their own series.
        fuel.mint(alice, seed);
        vm.prank(alice);
        IERC20(address(fuel)).approve(address(factory), seed);

        (,,,, address loan) = _createWithFuel(10, address(fuel), seed);

        assertEq(IERC20(address(fuel)).balanceOf(loan), seed, "loan book must hold the seed");
        assertEq(IERC20(address(fuel)).balanceOf(alice), 0);
    }

    function testUnseededLoanBookCanBeToppedUpLater() public {
        ExternalFuel fuel = new ExternalFuel();
        (address token, address collection, address amm,, address loan) =
            _createWithFuel(10, address(fuel), 0);

        assertEq(IERC20(token).balanceOf(loan), 0, "an unseeded loan book starts empty");

        // The vault lends from its own balance, so anyone can stock it with a plain transfer.
        uint256 principal = PonsSeatLoanVault(loan).principalAmount();
        fuel.mint(address(loan), principal);

        fuel.mint(bob, SEAT_PRICE);
        vm.startPrank(bob);
        IERC20(token).approve(amm, type(uint256).max);
        uint256 tokenId = PonsSeatAmmVault(amm).buy{value: 0.01 ether}();
        IERC721(collection).approve(loan, tokenId);
        PonsSeatLoanVault(loan).borrow{value: 0.01 ether}(tokenId);
        vm.stopPrank();

        assertEq(IERC20(token).balanceOf(bob), principal, "borrower receives the principal");
        assertEq(IERC721(collection).ownerOf(tokenId), loan, "seat is held as collateral");
    }

    function testSeedingTheLoanBookNeedsTheCreatorsApproval() public {
        ExternalFuel fuel = new ExternalFuel();
        fuel.mint(alice, 5_000 ether);

        PonsSeatSeriesFactory.CreateParams memory p = _params(10);
        p.fuelToken = address(fuel);
        p.loanSeed = 5_000 ether;

        // No approve() call, so the pull must fail rather than silently create an empty loan book.
        vm.prank(alice);
        vm.expectRevert();
        factory.createSeries(p);
    }

    function testMintedFuelPathStillFundsItsOwnLoanBook() public {
        // The default path is unchanged: the factory mints fuel and stocks the loan book itself.
        (address token,,,,, address loan) = _create(10);

        uint256 principal = PonsSeatLoanVault(loan).principalAmount();
        assertEq(IERC20(token).balanceOf(loan), principal * 10);
        assertGt(IERC20(token).balanceOf(alice), 0, "creator keeps the rest of a minted supply");
    }

    function _measureCreateGas(uint256 maxSupply) internal returns (uint256) {
        vm.prank(alice);
        uint256 before = gasleft();
        factory.createSeries(_params(maxSupply));
        return before - gasleft();
    }

    /* ------------------------------------------------------------------ */
    /* Blind sale and reveal                                               */
    /* ------------------------------------------------------------------ */

    string constant REAL_PACK = "ipfs://QmRealPackCidGoesHere/";
    string constant PLACEHOLDER = "ipfs://QmPlaceholder/box.json";

    function testBlindSeriesHidesTheLayoutUntilItSellsOut() public {
        (address token, address collection, address amm) = _createBlind(2);

        // Every seat looks the same while the sale runs, so there is no rare seat to aim at.
        vm.startPrank(alice);
        IERC20(token).approve(amm, type(uint256).max);
        uint256 first = PonsSeatAmmVault(amm).buy{value: 0.01 ether}();
        assertEq(PonsSeatCollection(collection).tokenURI(first), PLACEHOLDER);
        assertFalse(PonsSeatCollection(collection).revealed());
        assertFalse(PonsSeatCollection(collection).revealable());

        vm.expectRevert(PonsSeatCollection.NotRevealable.selector);
        PonsSeatCollection(collection).reveal(REAL_PACK);

        uint256 second = PonsSeatAmmVault(amm).buy{value: 0.01 ether}();
        vm.stopPrank();

        assertTrue(PonsSeatCollection(collection).revealable());

        // Only the pack committed at creation can land, whoever sends it.
        vm.prank(bob);
        vm.expectRevert(PonsSeatCollection.WrongPack.selector);
        PonsSeatCollection(collection).reveal("ipfs://QmSomeOtherPack/");

        vm.prank(bob);
        PonsSeatCollection(collection).reveal(REAL_PACK);

        assertTrue(PonsSeatCollection(collection).revealed());
        assertEq(PonsSeatCollection(collection).tokenURI(first), string.concat(REAL_PACK, vm.toString(first)));
        assertEq(PonsSeatCollection(collection).tokenURI(second), string.concat(REAL_PACK, vm.toString(second)));

        vm.expectRevert(PonsSeatCollection.AlreadyRevealed.selector);
        PonsSeatCollection(collection).reveal(REAL_PACK);
    }

    function testBlindSeriesStillRevealsWhenItNeverSellsOut() public {
        (address token, address collection, address amm) = _createBlind(10);

        vm.startPrank(alice);
        IERC20(token).approve(amm, type(uint256).max);
        uint256 tokenId = PonsSeatAmmVault(amm).buy{value: 0.01 ether}();
        vm.stopPrank();

        vm.warp(block.timestamp + PonsSeatCollection(collection).REVEAL_WINDOW());
        assertTrue(PonsSeatCollection(collection).revealable());

        PonsSeatCollection(collection).reveal(REAL_PACK);
        assertEq(PonsSeatCollection(collection).tokenURI(tokenId), string.concat(REAL_PACK, vm.toString(tokenId)));
    }

    function testSeriesWithoutACommitmentIsRevealedFromTheStart() public {
        (address token, address collection, address amm,,,) = _create(4);
        assertTrue(PonsSeatCollection(collection).revealed());

        vm.startPrank(alice);
        IERC20(token).approve(amm, type(uint256).max);
        uint256 tokenId = PonsSeatAmmVault(amm).buy{value: 0.01 ether}();
        vm.stopPrank();
        assertEq(PonsSeatCollection(collection).tokenURI(tokenId), string.concat("ipfs://seat/", vm.toString(tokenId)));
    }

    /* ------------------------------------------------------------------ */
    /* Helpers                                                             */
    /* ------------------------------------------------------------------ */

    function _createBlind(uint256 maxSupply) internal returns (address token, address collection, address amm) {
        PonsSeatSeriesFactory.CreateParams memory p = _params(maxSupply);
        p.baseTokenURI = PLACEHOLDER;
        p.provenanceHash = keccak256(bytes(REAL_PACK));

        vm.prank(alice);
        uint256 seriesId = factory.createSeries(p);
        (, token, collection, amm,,,,,,,) = seriesRegistry.series(seriesId);
    }

    /// @dev Cranks the way a round opens in practice: after the seats joined, not in the same second.
    function _crank(address booster) internal returns (uint256) {
        vm.warp(block.timestamp + 1);
        return PonsSeatDirectedBooster(payable(booster)).crank();
    }

    function _buyAndActivate(address who, address token, address amm, address activation, uint8 tier)
        internal
        returns (uint256 tokenId)
    {
        vm.startPrank(who);
        IERC20(token).approve(amm, type(uint256).max);
        IERC20(token).approve(activation, type(uint256).max);
        tokenId = PonsSeatAmmVault(amm).buy{value: 0.01 ether}();
        PonsSeatActivationManager(activation).activate(tokenId, tier);
        vm.stopPrank();
    }

    function _collectionOf(address booster) internal view returns (address) {
        return address(PonsSeatDirectedBooster(payable(booster)).nft());
    }
}

/**
 * Stands in for a token launched somewhere else — a Pons V2 bonding-curve launch, say.
 *
 * The point is that the seat factory has no special relationship with it: it cannot mint it, and
 * whatever the series needs has to come from someone who bought it on its own market.
 */
contract ExternalFuel is ERC20 {
    constructor() ERC20("External Fuel", "XFUEL") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
