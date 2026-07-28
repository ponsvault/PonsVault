// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BeaconProxy} from "@openzeppelin/proxy/beacon/BeaconProxy.sol";
import {UpgradeableBeacon} from "@openzeppelin/proxy/beacon/UpgradeableBeacon.sol";
import {Ownable2Step} from "@openzeppelin/access/Ownable2Step.sol";

import {IPonsVaultFactory} from "../interfaces/IPonsVaultFactory.sol";
import {PonsRwaVault} from "../vaults/PonsRwaVault.sol";

/// @title PonsRwaVaultFactory
/// @notice Deploys one {PonsRwaVault} per pons token, behind a shared upgradeable beacon.
///
/// @dev Mirrors the other factories, including the beacon rationale: vaults can ship before an
///      audit completes and be patched afterwards without asking any creator to migrate, and
///      {lockUpgrades} lets that ability be renounced permanently once the design has settled.
///
///      Which RWA a vault buys is chosen per launch and validated by the vault's own initializer,
///      not curated here. Keeping the factory out of that decision means adding a newly liquid
///      stock token costs nothing on-chain — no allowlist to update, no owner call, no redeploy.
///
///      The distributor is the opposite: it comes from here rather than from the launch config, so
///      a creator cannot name themselves. A creator who could shape their own token's payout split
///      could pay the entire dividend to their own address, which would make the vault a promise
///      instead of a guarantee. See {PonsRwaVault-distributor}.
contract PonsRwaVaultFactory is Ownable2Step, IPonsVaultFactory {
    error VaultAlreadyExists(address token, address vault);
    error NotTokenDeployer(address caller, address deployer);
    error ZeroAddress();

    event VaultCreated(address indexed token, address indexed vault, address indexed creator);
    event DefaultDistributorChanged(address indexed from, address indexed to);
    event UpgradesLocked();

    /// @notice Beacon all deployed vaults delegate to.
    address public immutable beacon;

    /// @notice Distributor stamped into vaults created from now on.
    /// @dev Changing this does not touch vaults already deployed: each one rotates its own key
    ///      through {PonsRwaVault-setDistributor}, so this address gains no authority over any
    ///      vault it did not create.
    address public defaultDistributor;

    /// @notice Vault deployed for a given pons token, if any.
    mapping(address token => address vault) public vaultOf;

    /// @notice Every vault this factory has deployed, in creation order.
    address[] public vaults;

    constructor(address distributor) Ownable2Step() {
        if (distributor == address(0)) revert ZeroAddress();
        defaultDistributor = distributor;

        PonsRwaVault impl = new PonsRwaVault();
        beacon = address(new UpgradeableBeacon(address(impl)));
    }

    /// @notice Change the distributor future vaults are created with.
    function setDefaultDistributor(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit DefaultDistributorChanged(defaultDistributor, next);
        defaultDistributor = next;
    }

    /// @inheritdoc IPonsVaultFactory
    /// @dev `config` is an ABI-encoded {PonsRwaVault.Config}. See the note on the buyback factory
    ///      for why it arrives as bytes.
    function createVault(address token, address locker, bytes calldata config) external returns (address vault) {
        address existing = vaultOf[token];
        if (existing != address(0)) revert VaultAlreadyExists(token, existing);

        address deployer = _tokenDeployer(token);
        if (msg.sender != deployer) revert NotTokenDeployer(msg.sender, deployer);

        PonsRwaVault.Config memory decoded = abi.decode(config, (PonsRwaVault.Config));

        vault = address(
            new BeaconProxy(
                beacon,
                abi.encodeCall(
                    PonsRwaVault.initialize, (token, locker, msg.sender, defaultDistributor, decoded)
                )
            )
        );

        vaultOf[token] = vault;
        vaults.push(vault);

        emit VaultCreated(token, vault, msg.sender);
    }

    /// @inheritdoc IPonsVaultFactory
    function template() external pure returns (string memory) {
        return "rwa";
    }

    /// @notice Number of vaults deployed by this factory.
    function vaultCount() external view returns (uint256) {
        return vaults.length;
    }

    /// @notice Point every deployed vault at a new implementation.
    function upgradeVaultImplementation(address newImplementation) external onlyOwner {
        UpgradeableBeacon(beacon).upgradeTo(newImplementation);
    }

    /// @notice Permanently give up the ability to upgrade deployed vaults. Irreversible.
    function lockUpgrades() external onlyOwner {
        UpgradeableBeacon(beacon).renounceOwnership();
        emit UpgradesLocked();
    }

    /// @notice Whether {lockUpgrades} has been called.
    function isUpgradesLocked() external view returns (bool) {
        return UpgradeableBeacon(beacon).owner() == address(0);
    }

    /// @notice Current vault implementation behind the beacon.
    function implementation() external view returns (address) {
        return UpgradeableBeacon(beacon).implementation();
    }

    function _tokenDeployer(address token) private view returns (address deployer) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSignature("deployer()"));
        if (!ok || data.length < 32) return address(0);
        deployer = abi.decode(data, (address));
    }
}
