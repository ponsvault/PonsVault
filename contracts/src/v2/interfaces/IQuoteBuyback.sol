// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IQuoteBuyback
/// @notice Swaps quote asset into the launch token, delivering tokens to the caller (the vault).
interface IQuoteBuyback {
    /// @param quoteAsset Asset to spend.
    /// @param token Launch token to buy.
    /// @param quoteAmount Amount of quote to spend.
    /// @param minTokensOut Slippage floor.
    /// @return tokensBought Amount of launch token received by the caller.
    function buyback(address quoteAsset, address token, uint256 quoteAmount, uint256 minTokensOut)
        external
        returns (uint256 tokensBought);
}
