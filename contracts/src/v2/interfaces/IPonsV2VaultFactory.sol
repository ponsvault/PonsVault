// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IPonsV2VaultFactory
/// @notice Factory surface for v2 vault templates.
/// @dev Unlike v1 there is no locker. Fees are claimed from the fee escrow by the vault itself,
///      so `createVault` only needs the token, its quote asset, and opaque template config.
interface IPonsV2VaultFactory {
    /// @param token The v2 launch token.
    /// @param quoteAsset Pair token from the launch record (address(0) = native ETH).
    /// @param config ABI-encoded template parameters.
    function createVault(address token, address quoteAsset, bytes calldata config)
        external
        returns (address vault);

    function vaultOf(address token) external view returns (address);

    function template() external pure returns (string memory);
}
