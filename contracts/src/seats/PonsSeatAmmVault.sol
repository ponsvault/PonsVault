// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/token/ERC20/utils/SafeERC20.sol";
import {IERC721Receiver} from "@openzeppelin/token/ERC721/IERC721Receiver.sol";

import {PonsSeatCollection} from "./PonsSeatCollection.sol";

/// @notice Flat-price NFT ↔ companion-token AMM. ETH trade fees go to the rewards booster.
contract PonsSeatAmmVault is IERC721Receiver {
    using SafeERC20 for IERC20;

    error EmptyInventory();
    error BadTokenId();
    error FeeRequired();
    error NotListed();
    error ZeroAddress();

    event Bought(address indexed buyer, uint256 indexed tokenId, uint256 tokenPaid, uint256 ethFee);
    event Sold(address indexed seller, uint256 indexed tokenId, uint256 tokenPaid, uint256 ethFee);
    event Sniped(address indexed buyer, uint256 indexed tokenId, uint256 tokenPaid, uint256 ethFee);

    IERC20 public immutable token;
    PonsSeatCollection public immutable collection;
    address payable public immutable booster;
    uint256 public immutable seatPrice; // companion tokens per seat
    uint16 public immutable swapFeeBps; // of msg.value on buy/sell
    uint16 public immutable snipeFeeBps;

    uint256[] private _inventory;
    mapping(uint256 tokenId => uint256 indexPlusOne) private _index;

    constructor(
        address token_,
        address collection_,
        address payable booster_,
        uint256 seatPrice_,
        uint16 swapFeeBps_,
        uint16 snipeFeeBps_
    ) {
        if (token_ == address(0) || collection_ == address(0) || booster_ == address(0)) revert ZeroAddress();
        token = IERC20(token_);
        collection = PonsSeatCollection(collection_);
        booster = booster_;
        seatPrice = seatPrice_;
        swapFeeBps = swapFeeBps_;
        snipeFeeBps = snipeFeeBps_;
    }

    function inventorySize() external view returns (uint256) {
        return _inventory.length;
    }

    function inventoryAt(uint256 i) external view returns (uint256) {
        return _inventory[i];
    }

    /// @notice Seats the shop can sell right now: resold stock plus everything never minted.
    function availableSupply() external view returns (uint256) {
        return _inventory.length + collection.unmintedSupply();
    }

    /**
     * Buys a seat for `seatPrice` tokens.
     *
     * Seats resold into the shop are sold on first, so returned stock clears before the shop mints
     * anything new. Once the shop is empty it mints the next seat straight to the buyer, which is
     * what keeps series creation cheap no matter how large the supply.
     */
    function buy() external payable returns (uint256 tokenId) {
        uint256 len = _inventory.length;
        bool fromStock = len > 0;
        if (!fromStock && collection.unmintedSupply() == 0) revert EmptyInventory();

        _takeFee(swapFeeBps);
        token.safeTransferFrom(msg.sender, address(this), seatPrice);

        if (fromStock) {
            tokenId = _inventory[len - 1];
            _pop(tokenId);
            collection.safeTransferFrom(address(this), msg.sender, tokenId);
        } else {
            tokenId = collection.mintNext(msg.sender);
        }

        emit Bought(msg.sender, tokenId, seatPrice, msg.value);
    }

    /// @notice Buys one specific seat, whether it is resold stock or has never been minted.
    function snipe(uint256 tokenId) external payable {
        bool listed = _index[tokenId] != 0;
        if (!listed && !_isMintable(tokenId)) revert NotListed();

        _takeFee(snipeFeeBps);
        token.safeTransferFrom(msg.sender, address(this), seatPrice);

        if (listed) {
            _pop(tokenId);
            collection.safeTransferFrom(address(this), msg.sender, tokenId);
        } else {
            collection.mintSpecific(msg.sender, tokenId);
        }

        emit Sniped(msg.sender, tokenId, seatPrice, msg.value);
    }

    /// @dev A seat nobody has minted yet is still for sale, so sniping a rare id stays possible.
    function _isMintable(uint256 tokenId) internal view returns (bool) {
        if (tokenId == 0 || tokenId > collection.maxSupply()) return false;
        return !collection.isMinted(tokenId);
    }

    function sell(uint256 tokenId) external payable {
        _takeFee(swapFeeBps);
        // onERC721Received re-lists the seat; pushing again here would duplicate the inventory entry.
        collection.safeTransferFrom(msg.sender, address(this), tokenId);
        token.safeTransfer(msg.sender, seatPrice);
        emit Sold(msg.sender, tokenId, seatPrice, msg.value);
    }

    /// @notice Re-lists seats that arrived without triggering onERC721Received, e.g. a raw transfer.
    function syncInventory(uint256 fromId, uint256 toId) external {
        for (uint256 id = fromId; id <= toId; id++) {
            if (collection.ownerOf(id) != address(this)) continue;
            if (_index[id] != 0) continue;
            _push(id);
        }
    }

    function onERC721Received(address, address, uint256 tokenId, bytes calldata) external returns (bytes4) {
        require(msg.sender == address(collection), "nft");
        if (_index[tokenId] == 0) _push(tokenId);
        return IERC721Receiver.onERC721Received.selector;
    }

    function _takeFee(uint16 feeBps) internal {
        // Minimum ETH trade fee scales with bps against a 0.01 ETH notional.
        uint256 minFee = (uint256(feeBps) * 0.01 ether) / 10_000;
        if (msg.value < minFee) revert FeeRequired();
        if (msg.value > 0) {
            (bool ok,) = booster.call{value: msg.value}("");
            require(ok, "booster");
        }
    }

    function _push(uint256 tokenId) internal {
        _inventory.push(tokenId);
        _index[tokenId] = _inventory.length;
    }

    function _pop(uint256 tokenId) internal {
        uint256 idxPlus = _index[tokenId];
        if (idxPlus == 0) revert BadTokenId();
        uint256 idx = idxPlus - 1;
        uint256 last = _inventory[_inventory.length - 1];
        _inventory[idx] = last;
        _index[last] = idx + 1;
        _inventory.pop();
        delete _index[tokenId];
    }
}
