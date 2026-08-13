// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Clones} from "@openzeppelin/proxy/Clones.sol";

import {PonsSeatAccount} from "./PonsSeatAccount.sol";

/// @notice Custom TBA registry (Robinhood Chain has no canonical ERC-6551 registry).
contract PonsSeatTbaRegistry {
    using Clones for address;

    error ZeroAddress();
    error AlreadyCreated();

    event AccountCreated(
        address indexed account,
        address indexed implementation,
        uint256 chainId,
        address indexed tokenContract,
        uint256 tokenId
    );

    address public immutable accountImplementation;

    mapping(address tokenContract => mapping(uint256 tokenId => address account)) public accounts;

    constructor(address accountImplementation_) {
        if (accountImplementation_ == address(0)) revert ZeroAddress();
        accountImplementation = accountImplementation_;
    }

    function account(address tokenContract, uint256 tokenId) public view returns (address) {
        address existing = accounts[tokenContract][tokenId];
        if (existing != address(0)) return existing;
        return accountImplementation.predictDeterministicAddress(_salt(tokenContract, tokenId), address(this));
    }

    function createAccount(address tokenContract, uint256 tokenId) external returns (address created) {
        if (tokenContract == address(0)) revert ZeroAddress();
        if (accounts[tokenContract][tokenId] != address(0)) revert AlreadyCreated();

        created = accountImplementation.cloneDeterministic(_salt(tokenContract, tokenId));
        accounts[tokenContract][tokenId] = created;
        PonsSeatAccount(payable(created)).initialize(block.chainid, tokenContract, tokenId);

        emit AccountCreated(created, accountImplementation, block.chainid, tokenContract, tokenId);
    }

    function _salt(address tokenContract, uint256 tokenId) internal pure returns (bytes32) {
        return keccak256(abi.encode(tokenContract, tokenId));
    }
}
