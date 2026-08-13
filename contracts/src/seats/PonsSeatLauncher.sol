// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/token/ERC20/utils/SafeERC20.sol";

import {IPonsCurve} from "../v2/interfaces/IPonsCurve.sol";
import {IPonsV2Factory} from "../v2/interfaces/IPonsV2Factory.sol";
import {PonsSeatSeriesFactory} from "./PonsSeatSeriesFactory.sol";

/**
 * @title PonsSeatLauncher
 * @notice Launches a series' fuel token and the series itself in one transaction.
 *
 * @dev A series has to point at fuel that already exists, so creating one is naturally two calls,
 *      and only a wallet implementing EIP-5792 can sign two calls as a single confirmation. Wallets
 *      that cannot, or chains a wallet has not enabled batching on, leave the creator confirming
 *      twice with a launched token and no series in between. One contract call is one confirmation
 *      on every wallet, and it either all happens or none of it does.
 *
 *      Nothing is attributed to this contract. The fuel token's creator fees are pointed at the
 *      caller, the first buy is delivered to them, and the series is registered in their name
 *      through {PonsSeatSeriesFactory-createSeriesFor}, which trusts this contract and no other.
 */
contract PonsSeatLauncher {
    using SafeERC20 for IERC20;

    error ZeroAddress();
    error NotWhitelisted();
    error PairTokenNotApproved(address pairToken);
    error WrongValue(uint256 required, uint256 provided);
    error RefundFailed();

    IPonsV2Factory public immutable pons;
    PonsSeatSeriesFactory public immutable seats;

    event SeriesLaunched(
        uint256 indexed seriesId, address indexed creator, address indexed fuelToken, address curve, uint256 firstBuy
    );

    constructor(address pons_, address seats_) {
        if (pons_ == address(0) || seats_ == address(0)) revert ZeroAddress();
        pons = IPonsV2Factory(pons_);
        seats = PonsSeatSeriesFactory(seats_);
    }

    /**
     * @notice Launch the fuel, optionally buy some, and create the series that runs on it.
     * @param params Fuel token metadata. `creatorFeeRecipient`, `expectedEconomics` and an empty
     *        `salt` are filled in here; everything else is the caller's.
     * @param pairToken Asset the curve prices fuel in. The zero address is native ETH, which the
     *        factory treats as its own path rather than an approved ERC-20.
     * @param firstBuy Pair-asset amount to spend on fuel for the caller, or zero to skip the buy.
     * @param minFuelOut Slippage floor for that buy. The launch and the buy share a transaction so
     *        nothing can trade in between, but the curve's own maths still applies.
     * @param series Series parameters. `fuelToken` is overwritten with the token just launched.
     */
    function launchSeries(
        IPonsV2Factory.TokenParams memory params,
        uint256 launchConfigId,
        address pairToken,
        uint256 firstBuy,
        uint256 minFuelOut,
        PonsSeatSeriesFactory.CreateParams memory series
    ) external payable returns (uint256 seriesId, address fuelToken, address curve) {
        if (!pons.canLaunch(address(this))) revert NotWhitelisted();

        bool nativePair = pairToken == address(0);
        if (!nativePair && !pons.approvedPairTokens(pairToken)) revert PairTokenNotApproved(pairToken);

        // An ETH-paired curve is bought with transaction value, so the fee and the buy arrive
        // together. Any other pair is an ERC-20 this contract pulls from the caller instead.
        uint256 launchFee = pons.launchFee();
        uint256 required = launchFee + (nativePair ? firstBuy : 0);
        if (msg.value != required) revert WrongValue(required, msg.value);

        // Pin the economics so a change between quote and broadcast cannot alter the terms.
        params.expectedEconomics = pons.previewLaunchEconomics(launchConfigId, pairToken);
        params.creatorFeeRecipient = msg.sender;
        // The factory namespaces salts by the calling account, which is this contract for every
        // series, so a caller-chosen salt would collide across creators.
        params.salt = keccak256(abi.encode(msg.sender, params.salt, block.number, series.symbol));

        (fuelToken, curve) = pons.launchToken{value: launchFee}(params, launchConfigId, pairToken);

        if (firstBuy > 0) {
            if (nativePair) {
                IPonsCurve(curve).buy{value: firstBuy}(firstBuy, minFuelOut, msg.sender);
            } else {
                IERC20(pairToken).safeTransferFrom(msg.sender, address(this), firstBuy);
                IERC20(pairToken).forceApprove(curve, firstBuy);
                IPonsCurve(curve).buy(firstBuy, minFuelOut, msg.sender);

                // A launch caps how much of the supply one buyer can take, so the curve spends only
                // part of a large first buy. Hand the rest back rather than stranding it here.
                IERC20(pairToken).forceApprove(curve, 0);
                uint256 unspent = IERC20(pairToken).balanceOf(address(this));
                if (unspent > 0) IERC20(pairToken).safeTransfer(msg.sender, unspent);
            }
        }

        series.fuelToken = fuelToken;
        // The loan book can only be seeded with fuel the creator already holds, which nobody does on
        // a token that did not exist a moment ago. The vault lends from its balance, so it can be
        // topped up with a plain transfer whenever they want to.
        series.loanSeed = 0;

        seriesId = seats.createSeriesFor(msg.sender, series);

        emit SeriesLaunched(seriesId, msg.sender, fuelToken, curve, firstBuy);

        uint256 dust = address(this).balance;
        if (dust > 0) {
            (bool ok,) = msg.sender.call{value: dust}("");
            if (!ok) revert RefundFailed();
        }
    }

    /// @dev Only ever holds value inside {launchSeries}, which sweeps itself before returning.
    receive() external payable {}
}
