// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IPonsV2Factory
/// @notice Minimal surface of PonsV2LaunchFactory needed to launch with a vault attached.
interface IPonsV2Factory {
    struct Socials {
        string twitter;
        string telegram;
        string discord;
        string website;
        string farcaster;
    }

    struct TokenParams {
        string name;
        string symbol;
        string logo;
        string description;
        Socials socials;
        address creatorFeeRecipient;
        uint16 creatorTaxBps;
        bool buybackEnabled;
        bytes32 expectedEconomics;
        /// @dev CREATE2 salt for curve + token. Must be unique per initiating account.
        bytes32 salt;
    }

    struct LaunchedToken {
        address token;
        address curve;
        address deployer;
        address creatorFeeRecipient;
        address pairToken;
        uint256 graduationThreshold;
        uint24 poolFee;
        int24 tickSpacing;
        uint16 creatorTaxBps;
        bool buybackEnabled;
        uint8 phase;
        uint256 sweptQuote;
        uint256 sweptTokens;
        uint256 sweptAt;
        bool exists;
    }

    function launchToken(TokenParams calldata params, uint256 launchConfigId, address pairToken)
        external
        payable
        returns (address token, address curve);

    function previewLaunchEconomics(uint256 launchConfigId, address pairToken)
        external
        view
        returns (bytes32);

    function transferCreatorFeeRecipient(address token, address newRecipient) external;

    function getLaunchedToken(address token) external view returns (LaunchedToken memory);

    function launchFee() external view returns (uint256);

    function launchEnabled() external view returns (bool);

    /// @notice True while the public gate is open, or while `launcher` is whitelisted.
    function canLaunch(address launcher) external view returns (bool);

    function whitelistedLaunchers(address launcher) external view returns (bool);

    function approvedPairTokens(address pairToken) external view returns (bool);

    function maxCreatorTaxBps() external view returns (uint256);
}
