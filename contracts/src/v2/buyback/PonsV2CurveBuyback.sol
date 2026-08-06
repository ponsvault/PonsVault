// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/token/ERC20/utils/SafeERC20.sol";

import {IPonsCurve} from "../interfaces/IPonsCurve.sol";
import {IPonsV2Factory} from "../interfaces/IPonsV2Factory.sol";
import {IQuoteBuyback} from "../interfaces/IQuoteBuyback.sol";
import {PonsV2Addresses} from "../PonsV2Addresses.sol";

/// @title PonsV2CurveBuyback
/// @notice `IQuoteBuyback` that spends quote on the launch's bonding curve.
///
/// @dev Pre-graduation this is the correct venue: the curve is the only market.
///      After graduation (`phase != 0`) the curve reverts with `CurveGraduated`
///      and this helper refuses the call — a Uniswap v4 helper must take over
///      for graduated launches. Most vault buybacks happen while the curve is
///      still live, which is what this covers.
contract PonsV2CurveBuyback is IQuoteBuyback {
    using SafeERC20 for IERC20;

    error UnknownLaunch(address token);
    error WrongQuoteAsset(address expected, address provided);
    error LaunchGraduated(address token, uint8 phase);
    error ZeroAmount();

    /// @dev Matches pons factory: 0 NotGraduated, 1 Swept, 2 PoolCreated, 3 Rescued.
    uint8 private constant PHASE_NOT_GRADUATED = 0;

    IPonsV2Factory public immutable factory;

    constructor(address _factory) {
        factory = IPonsV2Factory(_factory == address(0) ? PonsV2Addresses.FACTORY : _factory);
    }

    /// @inheritdoc IQuoteBuyback
    function buyback(address quoteAsset, address token, uint256 quoteAmount, uint256 minTokensOut)
        external
        returns (uint256 tokensBought)
    {
        if (quoteAmount == 0) revert ZeroAmount();

        IPonsV2Factory.LaunchedToken memory launch = factory.getLaunchedToken(token);
        if (!launch.exists || launch.curve == address(0)) revert UnknownLaunch(token);
        if (launch.pairToken != quoteAsset) revert WrongQuoteAsset(launch.pairToken, quoteAsset);
        if (launch.phase != PHASE_NOT_GRADUATED) revert LaunchGraduated(token, launch.phase);

        IERC20 quote = IERC20(quoteAsset);
        quote.safeTransferFrom(msg.sender, address(this), quoteAmount);
        quote.forceApprove(launch.curve, quoteAmount);

        tokensBought = IPonsCurve(launch.curve).buy(quoteAmount, minTokensOut, msg.sender);

        // Curve may partial-fill near graduation and leave unspent quote here.
        quote.forceApprove(launch.curve, 0);
        uint256 leftover = quote.balanceOf(address(this));
        if (leftover != 0) {
            quote.safeTransfer(msg.sender, leftover);
        }
    }
}
