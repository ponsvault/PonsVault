// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IPonsFeeEscrow
/// @notice Pull-based fee escrow used by pons v2.
/// @dev Native-quote launches credit `balanceOf` / `claim`. Custom-pair launches credit
///      `balanceOfToken` / `claimToken` under the quote asset. Released buyback vests credit
///      the launch token's ledger.
interface IPonsFeeEscrow {
    function balanceOf(address recipient) external view returns (uint256);

    function balanceOfToken(address recipient, address token) external view returns (uint256);

    function claim() external returns (uint256);

    function claim(uint256 amount) external returns (uint256);

    function claimToken(address token) external returns (uint256);

    function claimToken(address token, uint256 amount) external returns (uint256);
}
