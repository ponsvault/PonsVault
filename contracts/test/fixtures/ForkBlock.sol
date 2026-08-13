// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @dev Pinning the fork block lets Foundry serve state from its local RPC cache instead of
///      re-fetching every run, which is what keeps the public endpoint from rate-limiting the suite.
///      Bump this when a test needs state newer than this block.
///
///      The public endpoint prunes state after a few thousand blocks, so a fresh checkout can only
///      re-fetch this block from an archive provider. Point ROBINHOOD_RPC_URL at one (see .env.example).
uint256 constant ROBINHOOD_FORK_BLOCK = 34_412_700;
