// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable2Step} from "@openzeppelin/access/Ownable2Step.sol";

import {IPonsV2VaultFactory} from "./interfaces/IPonsV2VaultFactory.sol";

/// @title PonsV2VaultRegistry
/// @notice Template set for the v2 launcher. Same shape as the v1 registry.
contract PonsV2VaultRegistry is Ownable2Step {
    error RegistryLocked();
    error UnknownTemplate(bytes32 templateId);
    error TemplateNotAvailable(bytes32 templateId);
    error ZeroAddress();

    event TemplateRegistered(bytes32 indexed templateId, address indexed factory);
    event TemplateRetired(bytes32 indexed templateId, address indexed factory);
    event RegistryLockedForever();

    struct Template {
        address factory;
        bool retired;
    }

    mapping(bytes32 templateId => Template template) public templates;
    bytes32[] public templateIds;
    bool public locked;

    constructor() Ownable2Step() {}

    function register(bytes32 templateId, address factory) external onlyOwner {
        if (locked) revert RegistryLocked();
        if (factory == address(0)) revert ZeroAddress();
        if (templates[templateId].factory == address(0)) templateIds.push(templateId);
        templates[templateId] = Template({factory: factory, retired: false});
        emit TemplateRegistered(templateId, factory);
    }

    function retire(bytes32 templateId) external onlyOwner {
        if (locked) revert RegistryLocked();
        address factory = templates[templateId].factory;
        if (factory == address(0)) revert UnknownTemplate(templateId);
        templates[templateId].retired = true;
        emit TemplateRetired(templateId, factory);
    }

    function lockRegistry() external onlyOwner {
        locked = true;
        emit RegistryLockedForever();
    }

    function factoryFor(bytes32 templateId) external view returns (IPonsV2VaultFactory) {
        Template memory template = templates[templateId];
        if (template.factory == address(0)) revert UnknownTemplate(templateId);
        if (template.retired) revert TemplateNotAvailable(templateId);
        return IPonsV2VaultFactory(template.factory);
    }

    function templateCount() external view returns (uint256) {
        return templateIds.length;
    }

    function allTemplateIds() external view returns (bytes32[] memory) {
        return templateIds;
    }

    function findVault(address token) external view returns (address vault) {
        uint256 count = templateIds.length;
        for (uint256 i = 0; i < count; i++) {
            address factory = templates[templateIds[i]].factory;
            if (factory == address(0)) continue;
            try IPonsV2VaultFactory(factory).vaultOf(token) returns (address found) {
                if (found != address(0)) return found;
            } catch {
                continue;
            }
        }
        return address(0);
    }
}
