// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IPonsCurve
/// @notice Minimal bonding-curve surface used by {PonsV2CurveBuyback}.
interface IPonsCurve {
    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient)
        external
        payable
        returns (uint256 tokensOut);

    function sweepFees(uint256 minBuybackTokensOut) external;

    function quoteFeeBalance() external view returns (uint256);

    function creatorTaxBalance() external view returns (uint256);

    function graduated() external view returns (bool);

    function pairToken() external view returns (address);
}
