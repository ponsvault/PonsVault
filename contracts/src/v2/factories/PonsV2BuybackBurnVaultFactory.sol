// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BeaconProxy} from "@openzeppelin/proxy/beacon/BeaconProxy.sol";
import {UpgradeableBeacon} from "@openzeppelin/proxy/beacon/UpgradeableBeacon.sol";
import {Ownable2Step} from "@openzeppelin/access/Ownable2Step.sol";

import {IPonsV2VaultFactory} from "../interfaces/IPonsV2VaultFactory.sol";
import {PonsV2BuybackBurnVault} from "../vaults/PonsV2BuybackBurnVault.sol";

/// @title PonsV2BuybackBurnVaultFactory
contract PonsV2BuybackBurnVaultFactory is Ownable2Step, IPonsV2VaultFactory {
    error VaultAlreadyExists(address token, address vault);
    error NotTokenDeployer(address caller, address deployer);

    event VaultCreated(address indexed token, address indexed vault, address indexed creator);
    event DefaultBuybackChanged(address indexed buyback);
    event UpgradesLocked();

    address public immutable beacon;

    /// @notice Optional default IQuoteBuyback used when the launch config does not override it.
    address public defaultBuyback;

    mapping(address token => address vault) public vaultOf;
    address[] public vaults;

    constructor(address _defaultBuyback) Ownable2Step() {
        PonsV2BuybackBurnVault impl = new PonsV2BuybackBurnVault();
        beacon = address(new UpgradeableBeacon(address(impl)));
        defaultBuyback = _defaultBuyback;
        emit DefaultBuybackChanged(_defaultBuyback);
    }

    /// @inheritdoc IPonsV2VaultFactory
    /// @dev `config` is ABI-encoded {PonsV2BuybackBurnVault.Config}.
    function createVault(address token, address quoteAsset, bytes calldata config)
        external
        returns (address vault)
    {
        address existing = vaultOf[token];
        if (existing != address(0)) revert VaultAlreadyExists(token, existing);

        address deployer = _tokenDeployer(token);
        if (msg.sender != deployer) revert NotTokenDeployer(msg.sender, deployer);

        PonsV2BuybackBurnVault.Config memory decoded = abi.decode(config, (PonsV2BuybackBurnVault.Config));

        vault = address(
            new BeaconProxy(
                beacon,
                abi.encodeCall(
                    PonsV2BuybackBurnVault.initialize, (token, quoteAsset, defaultBuyback, decoded)
                )
            )
        );

        vaultOf[token] = vault;
        vaults.push(vault);
        emit VaultCreated(token, vault, msg.sender);
    }

    function template() external pure returns (string memory) {
        return "buyback-burn";
    }

    function vaultCount() external view returns (uint256) {
        return vaults.length;
    }

    function setDefaultBuyback(address _buyback) external onlyOwner {
        defaultBuyback = _buyback;
        emit DefaultBuybackChanged(_buyback);
    }

    function upgradeVaultImplementation(address newImplementation) external onlyOwner {
        UpgradeableBeacon(beacon).upgradeTo(newImplementation);
    }

    function lockUpgrades() external onlyOwner {
        UpgradeableBeacon(beacon).renounceOwnership();
        emit UpgradesLocked();
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
