// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BeaconProxy} from "@openzeppelin/proxy/beacon/BeaconProxy.sol";
import {UpgradeableBeacon} from "@openzeppelin/proxy/beacon/UpgradeableBeacon.sol";
import {Ownable2Step} from "@openzeppelin/access/Ownable2Step.sol";

import {IPonsVaultFactory} from "../interfaces/IPonsVaultFactory.sol";
import {PonsLotteryVault} from "../vaults/PonsLotteryVault.sol";

/// @title PonsLotteryVaultFactory
/// @notice Deploys one {PonsLotteryVault} per pons token, behind a shared upgradeable beacon.
///
/// @dev The operator (commit/reveal key) is stamped here rather than chosen at launch, for the same
///      reason the RWA factory stamps its distributor: a creator who could commit and reveal their
///      own draw could wait until they had entered and then pick a seed that pays themselves.
contract PonsLotteryVaultFactory is Ownable2Step, IPonsVaultFactory {
    error VaultAlreadyExists(address token, address vault);
    error NotTokenDeployer(address caller, address deployer);
    error ZeroAddress();

    event VaultCreated(address indexed token, address indexed vault, address indexed creator);
    event DefaultOperatorChanged(address indexed from, address indexed to);
    event UpgradesLocked();

    address public immutable beacon;
    address public defaultOperator;
    mapping(address token => address vault) public vaultOf;
    address[] public vaults;

    constructor(address operator_) Ownable2Step() {
        if (operator_ == address(0)) revert ZeroAddress();
        defaultOperator = operator_;

        PonsLotteryVault impl = new PonsLotteryVault();
        beacon = address(new UpgradeableBeacon(address(impl)));
    }

    function setDefaultOperator(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit DefaultOperatorChanged(defaultOperator, next);
        defaultOperator = next;
    }

    /// @inheritdoc IPonsVaultFactory
    /// @dev `config` is an ABI-encoded {PonsLotteryVault.Config}.
    function createVault(address token, address locker, bytes calldata config) external returns (address vault) {
        address existing = vaultOf[token];
        if (existing != address(0)) revert VaultAlreadyExists(token, existing);

        address deployer = _tokenDeployer(token);
        if (msg.sender != deployer) revert NotTokenDeployer(msg.sender, deployer);

        PonsLotteryVault.Config memory decoded = abi.decode(config, (PonsLotteryVault.Config));

        vault = address(
            new BeaconProxy(
                beacon,
                abi.encodeCall(
                    PonsLotteryVault.initialize, (token, locker, msg.sender, defaultOperator, decoded)
                )
            )
        );

        vaultOf[token] = vault;
        vaults.push(vault);
        emit VaultCreated(token, vault, msg.sender);
    }

    function template() external pure returns (string memory) {
        return "lottery";
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
