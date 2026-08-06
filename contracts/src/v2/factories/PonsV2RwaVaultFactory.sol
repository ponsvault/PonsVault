// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BeaconProxy} from "@openzeppelin/proxy/beacon/BeaconProxy.sol";
import {UpgradeableBeacon} from "@openzeppelin/proxy/beacon/UpgradeableBeacon.sol";
import {Ownable2Step} from "@openzeppelin/access/Ownable2Step.sol";

import {IPonsV2VaultFactory} from "../interfaces/IPonsV2VaultFactory.sol";
import {PonsV2RwaVault} from "../vaults/PonsV2RwaVault.sol";

/// @title PonsV2RwaVaultFactory
/// @notice Deploys one {PonsV2RwaVault} per pons v2 token, behind a shared upgradeable beacon.
///
/// @dev The distributor is stamped from here — not from launch config — so a creator cannot
///      appoint themselves and redirect every dividend round.
contract PonsV2RwaVaultFactory is Ownable2Step, IPonsV2VaultFactory {
    error VaultAlreadyExists(address token, address vault);
    error NotTokenDeployer(address caller, address deployer);
    error ZeroAddress();

    event VaultCreated(address indexed token, address indexed vault, address indexed creator);
    event DefaultDistributorChanged(address indexed from, address indexed to);
    event UpgradesLocked();

    address public immutable beacon;
    address public defaultDistributor;

    mapping(address token => address vault) public vaultOf;
    address[] public vaults;

    constructor(address distributor) Ownable2Step() {
        if (distributor == address(0)) revert ZeroAddress();
        defaultDistributor = distributor;

        PonsV2RwaVault impl = new PonsV2RwaVault();
        beacon = address(new UpgradeableBeacon(address(impl)));
    }

    function setDefaultDistributor(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit DefaultDistributorChanged(defaultDistributor, next);
        defaultDistributor = next;
    }

    /// @inheritdoc IPonsV2VaultFactory
    function createVault(address token, address quoteAsset, bytes calldata config)
        external
        returns (address vault)
    {
        address existing = vaultOf[token];
        if (existing != address(0)) revert VaultAlreadyExists(token, existing);

        address deployer = _tokenDeployer(token);
        if (msg.sender != deployer) revert NotTokenDeployer(msg.sender, deployer);

        PonsV2RwaVault.Config memory decoded = abi.decode(config, (PonsV2RwaVault.Config));

        vault = address(
            new BeaconProxy(
                beacon,
                abi.encodeCall(
                    PonsV2RwaVault.initialize, (token, quoteAsset, defaultDistributor, decoded)
                )
            )
        );

        vaultOf[token] = vault;
        vaults.push(vault);
        emit VaultCreated(token, vault, msg.sender);
    }

    function template() external pure returns (string memory) {
        return "rwa";
    }

    function vaultCount() external view returns (uint256) {
        return vaults.length;
    }

    function upgradeVaultImplementation(address newImplementation) external onlyOwner {
        UpgradeableBeacon(beacon).upgradeTo(newImplementation);
    }

    function lockUpgrades() external onlyOwner {
        UpgradeableBeacon(beacon).renounceOwnership();
        emit UpgradesLocked();
    }

    function isUpgradesLocked() external view returns (bool) {
        return UpgradeableBeacon(beacon).owner() == address(0);
    }

    function implementation() external view returns (address) {
        return UpgradeableBeacon(beacon).implementation();
    }

    function _tokenDeployer(address token) private view returns (address deployer) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSignature("deployer()"));
        if (!ok || data.length < 32) return address(0);
        deployer = abi.decode(data, (address));
    }
}
