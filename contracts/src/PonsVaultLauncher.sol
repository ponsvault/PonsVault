// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPonsFeeCollector, IPonsLaunchpad} from "./interfaces/IPonsLaunchpad.sol";
import {IPonsLocker} from "./interfaces/IPonsLocker.sol";
import {IPonsVaultFactory} from "./interfaces/IPonsVaultFactory.sol";
import {PonsVaultRegistry} from "./PonsVaultRegistry.sol";

/// @title PonsVaultLauncher
/// @notice Launches a pons token with a PonsVault attached, in a single transaction.
///
/// @dev This contract exists because of how the pons locker gates fee collection. `collectFees` is
///      only callable by a token's on-chain `deployer` (or pons's own protocol fee recipient), and
///      `setFeeRedirect` is deployer-only — while the payout itself follows the fee redirect. A
///      vault can therefore *receive* fees but can never *sweep* them.
///
///      By performing the launch itself, this launcher becomes the deployer of every token it
///      creates. That lets it wire the fee redirect to the vault at launch and expose {collect} as
///      a permissionless sweep, which is what makes the downstream vault fully automatable with no
///      privileged operator in the loop.
///
///      Being the deployer also means this contract can never move: every token it has launched
///      depends on it to sweep their fees forever. It therefore knows nothing about any particular
///      template — the template set lives in a {PonsVaultRegistry}, and configs pass through as
///      opaque bytes, so a new template is a registry transaction rather than a new launcher.
contract PonsVaultLauncher is IPonsFeeCollector {
    error LaunchDisabled();
    error InsufficientLaunchFee(uint256 required, uint256 provided);
    error VaultNotCreated();

    event Launched(
        address indexed token, address indexed vault, address indexed creator, bytes32 templateId
    );

    /// @notice The pons launchpad factory this launcher deploys through.
    IPonsLaunchpad public immutable launchpad;

    /// @notice The locker paired with `launchpad`, custodying every launch's LP position.
    /// @dev Supplied at construction because tokens from the current pons factory do not expose a
    ///      `locker()` getter.
    address public immutable locker;

    /// @notice The set of vault templates a launch may choose from.
    PonsVaultRegistry public immutable registry;

    /// @notice Vault attached to each token this launcher has launched.
    mapping(address token => address vault) private _vaultOf;

    /// @notice Template each token's vault was built from.
    mapping(address token => bytes32 templateId) public templateOf;

    /// @notice Original caller who requested each launch, for attribution.
    mapping(address token => address creator) public creatorOf;

    constructor(IPonsLaunchpad _launchpad, address _locker, PonsVaultRegistry _registry) {
        launchpad = _launchpad;
        locker = _locker;
        registry = _registry;
    }

    /// @notice Launch a pons token and attach a vault of `templateId` to its creator fees.
    /// @dev Any msg.value above the launch fee is forwarded to pons as the initial dev buy.
    ///      pons sets the locker's fee redirect to `metadata.feeWallet` during the launch itself, so
    ///      this passes the launcher and then re-points the redirect at the vault. The vault address
    ///      cannot be supplied up front because it is keyed on a token that does not exist yet.
    ///
    ///      A token gets exactly one vault and the choice is permanent, since nothing here can
    ///      re-point the redirect afterwards.
    /// @param metadata pons token metadata. `feeWallet` is ignored and overwritten.
    /// @param launchConfigId pons launch config id.
    /// @param dexId pons dex id.
    /// @param salt CREATE2 salt for the token address.
    /// @param templateId Which registered template to build the vault from.
    /// @param vaultConfig ABI-encoded parameters for that template, fixed for the vault's lifetime.
    /// @return token The launched token.
    /// @return vault The vault now receiving the token's creator fees.
    function launchWithVault(
        IPonsLaunchpad.TokenMetadata memory metadata,
        uint256 launchConfigId,
        uint256 dexId,
        bytes32 salt,
        bytes32 templateId,
        bytes calldata vaultConfig
    ) external payable returns (address token, address vault) {
        // Resolved before the launch so an unknown or retired template costs nothing but gas,
        // rather than leaving a launched token with no vault attached.
        IPonsVaultFactory factory = registry.factoryFor(templateId);

        if (!launchpad.launchEnabled()) revert LaunchDisabled();
        uint256 fee = launchpad.launchFee();
        if (msg.value < fee) revert InsufficientLaunchFee(fee, msg.value);

        metadata.feeWallet = address(this);
        token = launchpad.launchToken{value: msg.value}(metadata, launchConfigId, dexId, salt);

        vault = factory.createVault(token, locker, vaultConfig);
        // A factory is registered by the owner, so this guards against a mistake rather than an
        // attack: redirecting fees to address zero would burn them irrecoverably.
        if (vault == address(0)) revert VaultNotCreated();

        IPonsLocker(locker).setFeeRedirect(token, vault);

        _vaultOf[token] = vault;
        templateOf[token] = templateId;
        creatorOf[token] = msg.sender;

        emit Launched(token, vault, msg.sender, templateId);
    }

    /// @inheritdoc IPonsFeeCollector
    /// @dev Permissionless, and the reason a vault can be swept by anyone: the locker accepts
    ///      `collectFees` only from the token's deployer, which is this launcher. Funds never touch
    ///      this contract — the locker pays the token's fee redirect, which {launchWithVault}
    ///      already pointed at the vault.
    function collect(address token) external returns (uint256 amount0, uint256 amount1) {
        (amount0, amount1) = IPonsLocker(locker).collectFees(token);
    }

    /// @notice Vault attached to `token`, or the zero address if none.
    /// @dev Falls back to the registry for vaults this launcher did not create itself, which covers
    ///      a vault made by calling a factory directly and one from an earlier launcher whose
    ///      factory is still registered.
    function vaultOf(address token) external view returns (address) {
        address vault = _vaultOf[token];
        if (vault != address(0)) return vault;
        return registry.findVault(token);
    }
}
