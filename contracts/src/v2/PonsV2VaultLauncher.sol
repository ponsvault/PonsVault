// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PonsV2Addresses} from "./PonsV2Addresses.sol";
import {IPonsV2Factory} from "./interfaces/IPonsV2Factory.sol";
import {IPonsV2VaultFactory} from "./interfaces/IPonsV2VaultFactory.sol";
import {PonsV2VaultRegistry} from "./PonsV2VaultRegistry.sol";

/// @title PonsV2VaultLauncher
/// @notice Launches a pons v2 token with a PonsVault attached, in one transaction.
///
/// @dev Flow:
///      1. Resolve the template factory from the registry.
///      2. Call the v2 launch factory with `creatorFeeRecipient = this` so the launcher is the
///         fee recipient long enough to re-point it.
///      3. Deploy the vault (msg.sender = launcher = token.deployer()).
///      4. `transferCreatorFeeRecipient(token, vault)` so future fees credit the vault's escrow
///         balance.
///
///      Protocol-native buybacks are forced off for vault launches: they take a slice of the
///      creator share before escrow credit, which would starve a Buyback & Burn / staking vault.
///      Creator tax is passed through from the caller.
///
///      This launcher must be whitelisted on the v2 factory (or `launchEnabled` must be true)
///      before anyone can use it.
contract PonsV2VaultLauncher {
    error LaunchDisabled();
    error NotWhitelisted();
    error InsufficientLaunchFee(uint256 required, uint256 provided);
    error PairTokenNotApproved(address pairToken);
    error VaultNotCreated();
    error CreatorTaxTooHigh(uint16 tax, uint256 maxTax);

    event Launched(
        address indexed token,
        address indexed vault,
        address indexed creator,
        address curve,
        address pairToken,
        bytes32 templateId
    );

    IPonsV2Factory public immutable factory;
    PonsV2VaultRegistry public immutable registry;

    mapping(address token => address vault) private _vaultOf;
    mapping(address token => bytes32 templateId) public templateOf;
    mapping(address token => address creator) public creatorOf;

    constructor(PonsV2VaultRegistry _registry) {
        factory = IPonsV2Factory(PonsV2Addresses.FACTORY);
        registry = _registry;
    }

    /// @notice Launch a v2 token and attach a vault of `templateId` to its creator fees.
    /// @param params Token metadata. `creatorFeeRecipient` and `buybackEnabled` are overwritten.
    /// @param launchConfigId Factory launch config id.
    /// @param pairToken Quote asset (must be approved; today AAPL).
    /// @param templateId Registered vault template.
    /// @param vaultConfig ABI-encoded template config.
    function launchWithVault(
        IPonsV2Factory.TokenParams memory params,
        uint256 launchConfigId,
        address pairToken,
        bytes32 templateId,
        bytes calldata vaultConfig
    ) external payable returns (address token, address vault) {
        IPonsV2VaultFactory vaultFactory = registry.factoryFor(templateId);

        if (!factory.approvedPairTokens(pairToken)) revert PairTokenNotApproved(pairToken);

        if (!factory.canLaunch(address(this))) revert NotWhitelisted();

        uint256 fee = factory.launchFee();
        if (msg.value != fee) revert InsufficientLaunchFee(fee, msg.value);

        uint256 maxTax = factory.maxCreatorTaxBps();
        if (params.creatorTaxBps > maxTax) revert CreatorTaxTooHigh(params.creatorTaxBps, maxTax);

        // Pin economics so an owner re-peg between quote and broadcast cannot change terms.
        params.expectedEconomics = factory.previewLaunchEconomics(launchConfigId, pairToken);
        params.creatorFeeRecipient = address(this);
        params.buybackEnabled = false;
        // Salt is namespaced to this launcher (the factory-authenticated initiator).
        if (params.salt == bytes32(0)) {
            params.salt = keccak256(abi.encode(msg.sender, block.timestamp, templateId, pairToken));
        }

        address curve;
        (token, curve) = factory.launchToken{value: msg.value}(params, launchConfigId, pairToken);

        vault = vaultFactory.createVault(token, pairToken, vaultConfig);
        if (vault == address(0)) revert VaultNotCreated();

        factory.transferCreatorFeeRecipient(token, vault);

        _vaultOf[token] = vault;
        templateOf[token] = templateId;
        creatorOf[token] = msg.sender;

        emit Launched(token, vault, msg.sender, curve, pairToken, templateId);
    }

    /// @notice Whether this launcher can currently call the v2 factory.
    function canLaunch() external view returns (bool ready, string memory reason) {
        if (!factory.canLaunch(address(this))) {
            return (false, "Launcher cannot launch on the current v2 factory");
        }
        return (true, "");
    }

    function vaultOf(address token) external view returns (address) {
        address vault = _vaultOf[token];
        if (vault != address(0)) return vault;
        return registry.findVault(token);
    }
}
