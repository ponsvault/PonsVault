// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC721} from "@openzeppelin/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/token/common/ERC2981.sol";
import {Strings} from "@openzeppelin/utils/Strings.sol";

import {PonsSeatTbaRegistry} from "./PonsSeatTbaRegistry.sol";

interface IPonsSeatActivationClear {
    function clearActivation(uint256 tokenId) external;
}

/// @notice Fixed-supply seat NFT: minted on purchase, one bound wallet each, art sealed until reveal.
contract PonsSeatCollection is ERC721, ERC2981 {
    using Strings for uint256;

    error SoldOut();
    error NotMinter();
    error NotShop();
    error ShopAlreadySet();
    error AlreadyMinted();
    error BadTokenId();
    error ZeroAddress();
    error AlreadyRevealed();
    error NotRevealable();
    error WrongPack();

    /// @notice Marketplaces refresh a range of tokens when they see this (ERC-4906).
    event BatchMetadataUpdate(uint256 fromTokenId, uint256 toTokenId);
    event Revealed(string baseTokenURI);

    /// @dev A series that never sells out still owes its holders their art.
    uint64 public constant REVEAL_WINDOW = 7 days;

    address public immutable minter;
    address public immutable registry;
    address public activationManager;
    /// @notice The AMM, the only contract allowed to mint. Seats are minted as they are bought.
    address public shop;
    uint256 public immutable maxSupply;
    string private _baseTokenURI;
    /**
     * Committed at creation as keccak256 of the real base URI, and checked when it is revealed.
     *
     * The art is pinned before the sale opens, so without a commitment a creator could sell the
     * series blind and then point it at whichever pack suited whoever ended up holding which seat.
     * With one, the pack is fixed before the first sale and the reveal can only produce that pack.
     */
    bytes32 public provenanceHash;
    /// @notice Until then, every seat shows the same placeholder and nobody knows which one is rare.
    bool public revealed;
    uint64 public immutable revealAfter;
    /// @dev Cursor for sequential mints. Skips ids already taken by a snipe.
    uint256 private _nextId = 1;
    uint256 private _minted;

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 maxSupply_,
        string memory baseTokenURI_,
        bytes32 provenanceHash_,
        address minter_,
        address registry_,
        address royaltyReceiver_,
        uint96 royaltyBps_
    ) ERC721(name_, symbol_) {
        if (minter_ == address(0) || registry_ == address(0) || royaltyReceiver_ == address(0)) {
            revert ZeroAddress();
        }
        minter = minter_;
        registry = registry_;
        maxSupply = maxSupply_;
        // No commitment means the series is not selling blind: what it was given is the real pack.
        revealed = provenanceHash_ == bytes32(0);
        provenanceHash = provenanceHash_;
        _baseTokenURI = baseTokenURI_;
        revealAfter = uint64(block.timestamp) + REVEAL_WINDOW;
        _setDefaultRoyalty(royaltyReceiver_, royaltyBps_);
    }

    /**
     * @notice Swaps the placeholder for the real pack. Permissionless, because the hash is the gate.
     *
     * Only the pack committed at creation can pass, so there is nothing to gain by front-running it
     * and nothing lost if the creator disappears: anyone holding the URI can finish the reveal.
     */
    function reveal(string calldata baseTokenURI_) external {
        if (revealed) revert AlreadyRevealed();
        if (_minted < maxSupply && block.timestamp < revealAfter) revert NotRevealable();
        if (keccak256(bytes(baseTokenURI_)) != provenanceHash) revert WrongPack();

        _baseTokenURI = baseTokenURI_;
        revealed = true;

        emit Revealed(baseTokenURI_);
        emit BatchMetadataUpdate(1, maxSupply);
    }

    /// @notice Whether `reveal` would go through right now, sellout or window having done it.
    function revealable() external view returns (bool) {
        return !revealed && (_minted == maxSupply || block.timestamp >= revealAfter);
    }

    function setActivationManager(address manager) external {
        require(msg.sender == minter, "minter");
        activationManager = manager;
    }

    function setShop(address shop_) external {
        if (msg.sender != minter) revert NotMinter();
        if (shop_ == address(0)) revert ZeroAddress();
        if (shop != address(0)) revert ShopAlreadySet();
        shop = shop_;
    }

    /**
     * Mints the lowest seat nobody has taken yet.
     *
     * Seats are minted on purchase rather than at series creation. Minting all of them upfront cost
     * the creator ~230k gas per seat, which put a 1111-seat series past what any node will simulate
     * and made the series impossible to launch. This way creation is a flat cost whatever the supply,
     * and each buyer pays for their own seat.
     */
    function mintNext(address to) external returns (uint256 tokenId) {
        if (msg.sender != shop) revert NotShop();

        uint256 id = _nextId;
        while (id <= maxSupply && _exists(id)) id++;
        if (id > maxSupply) revert SoldOut();

        _nextId = id + 1;
        tokenId = id;
        _minted++;
        _safeMint(to, tokenId);
    }

    /// @notice Mints one specific unsold seat, so a buyer can still pick the seat they want.
    function mintSpecific(address to, uint256 tokenId) external {
        if (msg.sender != shop) revert NotShop();
        if (tokenId == 0 || tokenId > maxSupply) revert BadTokenId();
        if (_exists(tokenId)) revert AlreadyMinted();

        _minted++;
        _safeMint(to, tokenId);
    }

    function totalMinted() external view returns (uint256) {
        return _minted;
    }

    /// @notice Seats never minted yet, which the shop can still sell.
    function unmintedSupply() external view returns (uint256) {
        return maxSupply - _minted;
    }

    function isMinted(uint256 tokenId) external view returns (bool) {
        return _exists(tokenId);
    }

    /**
     * The seat's wallet address, whether or not it has been deployed.
     *
     * The registry derives this with CREATE2, so the address is fixed from the moment the series
     * exists and can receive rewards before anything is deployed to it. Deploying every one of them
     * at mint time was most of the old per-seat gas cost, so it now happens on first use.
     */
    function accountOf(uint256 tokenId) external view returns (address) {
        return PonsSeatTbaRegistry(registry).account(address(this), tokenId);
    }

    /// @notice Deploys the seat's wallet so it can execute calls. Anyone may call this, once.
    function createAccount(uint256 tokenId) external returns (address) {
        if (!_exists(tokenId)) revert BadTokenId();
        return PonsSeatTbaRegistry(registry).createAccount(address(this), tokenId);
    }

    function accountImplementation() external view returns (address) {
        return PonsSeatTbaRegistry(registry).accountImplementation();
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_exists(tokenId), "token");
        // One placeholder for the whole series while it is blind: a per-seat URI before the reveal
        // would leak exactly what the reveal is meant to hide.
        if (!revealed) return _baseTokenURI;
        return string(abi.encodePacked(_baseTokenURI, tokenId.toString()));
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC2981) returns (bool) {
        // 0x49064906 is ERC-4906, which is how a marketplace knows to re-read metadata on reveal.
        return interfaceId == 0x49064906 || super.supportsInterface(interfaceId);
    }

    function _beforeTokenTransfer(address from, address to, uint256 tokenId, uint256 batchSize) internal override {
        super._beforeTokenTransfer(from, to, tokenId, batchSize);
        if (from != address(0) && to != address(0) && activationManager != address(0)) {
            IPonsSeatActivationClear(activationManager).clearActivation(tokenId);
        }
    }
}
