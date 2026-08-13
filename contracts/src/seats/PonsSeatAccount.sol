// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC721} from "@openzeppelin/token/ERC721/IERC721.sol";
import {IERC165} from "@openzeppelin/utils/introspection/IERC165.sol";

/// @notice Minimal token-bound account for a Pons Seat NFT.
contract PonsSeatAccount is IERC165 {
    error NotOwner();
    error CallFailed();

    uint256 public state;
    uint256 public chainId;
    address public tokenContract;
    uint256 public tokenId;
    bool public initialized;

    receive() external payable {}

    function initialize(uint256 chainId_, address tokenContract_, uint256 tokenId_) external {
        require(!initialized, "initialized");
        initialized = true;
        chainId = chainId_;
        tokenContract = tokenContract_;
        tokenId = tokenId_;
    }

    function owner() public view returns (address) {
        return IERC721(tokenContract).ownerOf(tokenId);
    }

    function execute(address to, uint256 value, bytes calldata data) external payable returns (bytes memory) {
        if (msg.sender != owner()) revert NotOwner();
        state++;
        (bool ok, bytes memory ret) = to.call{value: value}(data);
        if (!ok) revert CallFailed();
        return ret;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC165).interfaceId;
    }
}
