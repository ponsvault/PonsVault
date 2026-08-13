// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/token/ERC721/IERC721.sol";

/// @notice Tiered seat activation paid in the companion token (burn + protocol split).
contract PonsSeatActivationManager {
    using SafeERC20 for IERC20;

    error NotOwner();
    error BadTier();
    error AlreadyAtTier();
    error ZeroAddress();

    event Activated(uint256 indexed tokenId, uint8 tier, uint256 fee, uint256 weight);
    event ActivationCleared(uint256 indexed tokenId);

    struct Tier {
        uint256 fee;
        uint256 weight;
    }

    IERC20 public immutable token;
    IERC721 public immutable nft;
    address public immutable protocolTreasury;
    uint16 public immutable burnBps; // of fee
    uint16 public immutable protocolBps; // of fee (burnBps + protocolBps = 10000)

    Tier[] public tiers;
    mapping(uint256 tokenId => uint8 tierPlusOne) private _tierPlusOne;
    /// @notice When the seat's current tier was set. Rounds opened before this are not claimable.
    mapping(uint256 tokenId => uint64 timestamp) public activatedAt;
    uint256 public totalWeight;

    constructor(
        address token_,
        address nft_,
        address protocolTreasury_,
        uint16 burnBps_,
        uint16 protocolBps_,
        uint256[] memory fees,
        uint256[] memory weights
    ) {
        if (token_ == address(0) || nft_ == address(0) || protocolTreasury_ == address(0)) revert ZeroAddress();
        require(fees.length == weights.length && fees.length > 0, "tiers");
        require(uint256(burnBps_) + uint256(protocolBps_) == 10_000, "bps");
        token = IERC20(token_);
        nft = IERC721(nft_);
        protocolTreasury = protocolTreasury_;
        burnBps = burnBps_;
        protocolBps = protocolBps_;
        for (uint256 i = 0; i < fees.length; i++) {
            tiers.push(Tier({fee: fees[i], weight: weights[i]}));
        }
    }

    function tierCount() external view returns (uint256) {
        return tiers.length;
    }

    function isActivated(uint256 tokenId) public view returns (bool) {
        return _tierPlusOne[tokenId] != 0;
    }

    function tierOf(uint256 tokenId) public view returns (uint8) {
        uint8 t = _tierPlusOne[tokenId];
        require(t != 0, "inactive");
        return t - 1;
    }

    function weightOf(uint256 tokenId) public view returns (uint256) {
        uint8 t = _tierPlusOne[tokenId];
        if (t == 0) return 0;
        return tiers[t - 1].weight;
    }

    function activate(uint256 tokenId, uint8 tier) public {
        if (nft.ownerOf(tokenId) != msg.sender) revert NotOwner();
        if (tier >= tiers.length) revert BadTier();
        uint8 current = _tierPlusOne[tokenId];
        if (current != 0 && tier + 1 <= current) revert AlreadyAtTier();

        Tier memory next = tiers[tier];
        token.safeTransferFrom(msg.sender, address(this), next.fee);

        uint256 burnAmt = (next.fee * burnBps) / 10_000;
        uint256 protoAmt = next.fee - burnAmt;
        if (burnAmt > 0) {
            // Burn by sending to dead address (no burn hook on plain ERC20).
            token.safeTransfer(address(0xdead), burnAmt);
        }
        if (protoAmt > 0) token.safeTransfer(protocolTreasury, protoAmt);

        if (current != 0) {
            totalWeight -= tiers[current - 1].weight;
        }
        _tierPlusOne[tokenId] = tier + 1;
        activatedAt[tokenId] = uint64(block.timestamp);
        totalWeight += next.weight;

        emit Activated(tokenId, tier, next.fee, next.weight);
    }

    function upgrade(uint256 tokenId, uint8 tier) external {
        activate(tokenId, tier);
    }

    /// @notice Called by the collection on transfer to drop payroll status.
    function clearActivation(uint256 tokenId) external {
        require(msg.sender == address(nft), "nft");
        uint8 current = _tierPlusOne[tokenId];
        if (current == 0) return;
        totalWeight -= tiers[current - 1].weight;
        delete _tierPlusOne[tokenId];
        delete activatedAt[tokenId];
        emit ActivationCleared(tokenId);
    }
}
