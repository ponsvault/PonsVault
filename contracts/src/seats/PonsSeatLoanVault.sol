// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/token/ERC721/IERC721Receiver.sol";

/// @notice Borrow companion-token principal against a seat NFT. ETH fee splits to booster / protocol.
contract PonsSeatLoanVault is IERC721Receiver {
    using SafeERC20 for IERC20;

    error NotOwner();
    error ActiveLoan();
    error NoLoan();
    error FeeRequired();
    error NotLiquidatable();
    error ZeroAddress();

    event Borrowed(address indexed borrower, uint256 indexed tokenId, uint256 principal, uint256 ethFee, uint64 due);
    event Repaid(address indexed borrower, uint256 indexed tokenId, uint256 principal);
    event Liquidated(address indexed liquidator, uint256 indexed tokenId, address indexed borrower);

    struct Loan {
        address borrower;
        uint256 principal;
        uint64 start;
        uint64 due;
    }

    IERC20 public immutable token;
    IERC721 public immutable nft;
    address payable public immutable booster;
    address public immutable protocolTreasury;
    uint256 public immutable principalAmount;
    uint64 public immutable termSeconds;
    uint16 public immutable boosterFeeBps; // of ETH fee
    uint256 public immutable minEthFee;

    mapping(uint256 tokenId => Loan) public loans;

    constructor(
        address token_,
        address nft_,
        address payable booster_,
        address protocolTreasury_,
        uint256 principalAmount_,
        uint64 termSeconds_,
        uint16 boosterFeeBps_,
        uint256 minEthFee_
    ) {
        if (
            token_ == address(0) || nft_ == address(0) || booster_ == address(0) || protocolTreasury_ == address(0)
        ) {
            revert ZeroAddress();
        }
        require(boosterFeeBps_ <= 10_000, "bps");
        token = IERC20(token_);
        nft = IERC721(nft_);
        booster = booster_;
        protocolTreasury = protocolTreasury_;
        principalAmount = principalAmount_;
        termSeconds = termSeconds_;
        boosterFeeBps = boosterFeeBps_;
        minEthFee = minEthFee_;
    }

    function borrow(uint256 tokenId) external payable {
        if (nft.ownerOf(tokenId) != msg.sender) revert NotOwner();
        if (loans[tokenId].borrower != address(0)) revert ActiveLoan();
        if (msg.value < minEthFee) revert FeeRequired();

        uint256 toBooster = (msg.value * boosterFeeBps) / 10_000;
        uint256 toProtocol = msg.value - toBooster;
        if (toBooster > 0) {
            (bool ok,) = booster.call{value: toBooster}("");
            require(ok, "booster");
        }
        if (toProtocol > 0) {
            (bool ok,) = payable(protocolTreasury).call{value: toProtocol}("");
            require(ok, "treasury");
        }

        nft.safeTransferFrom(msg.sender, address(this), tokenId);
        uint64 due = uint64(block.timestamp) + termSeconds;
        loans[tokenId] = Loan({borrower: msg.sender, principal: principalAmount, start: uint64(block.timestamp), due: due});
        token.safeTransfer(msg.sender, principalAmount);

        emit Borrowed(msg.sender, tokenId, principalAmount, msg.value, due);
    }

    function repay(uint256 tokenId) external {
        Loan memory loan = loans[tokenId];
        if (loan.borrower == address(0)) revert NoLoan();
        require(msg.sender == loan.borrower, "borrower");

        token.safeTransferFrom(msg.sender, address(this), loan.principal);
        delete loans[tokenId];
        nft.safeTransferFrom(address(this), msg.sender, tokenId);

        emit Repaid(msg.sender, tokenId, loan.principal);
    }

    /// @notice Seize an overdue seat by paying its principal back into the vault.
    /// @dev The principal is below the seat's shop price, so the liquidator buys the seat at a discount
    ///      while the vault is made whole. Seizing for free would let a borrower drain the loan book.
    function liquidate(uint256 tokenId) external {
        Loan memory loan = loans[tokenId];
        if (loan.borrower == address(0)) revert NoLoan();
        if (block.timestamp <= loan.due) revert NotLiquidatable();

        delete loans[tokenId];
        token.safeTransferFrom(msg.sender, address(this), loan.principal);
        nft.safeTransferFrom(address(this), msg.sender, tokenId);

        emit Liquidated(msg.sender, tokenId, loan.borrower);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external view returns (bytes4) {
        require(msg.sender == address(nft), "nft");
        return IERC721Receiver.onERC721Received.selector;
    }
}
