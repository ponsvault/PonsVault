// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Canonical template ids used by the {PonsVaultRegistry}.
///
/// @dev Right-padded ASCII rather than a hash, so an id is readable in a block explorer and
///      matches the string the frontend and each factory's `template()` already use. New
///      templates add a constant here; nothing else in the launch path needs to change.
library PonsTemplates {
    // Every cast is of a compile-time string literal well under 32 bytes, so nothing can truncate.
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 internal constant BUYBACK_BURN = bytes32("buyback-burn");
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 internal constant STAKING = bytes32("staking");
    /// @dev Not "rwa-tax": the payout is funded by LP fees and claimed by stakers, with no
    ///      transfer tax anywhere in it. Naming it after one would describe a different product.
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 internal constant RWA = bytes32("rwa");
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 internal constant LOTTERY = bytes32("lottery");
}
