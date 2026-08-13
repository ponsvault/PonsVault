// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/token/ERC20/utils/SafeERC20.sol";

import {PonsSeatActivationManager} from "./PonsSeatActivationManager.sol";
import {PonsSeatCollection} from "./PonsSeatCollection.sol";

/// @notice Fee pot that permissionlessly distributes to activated seat TBAs.
/// @dev MVP pays ETH pro-rata by activation weight. Token elections are stored for a later swap router hook.
contract PonsSeatDirectedBooster {
    using SafeERC20 for IERC20;

    error BelowThreshold();
    error NothingToDeliver();
    error BadElection();
    error ZeroAddress();
    error TooEarly();

    event FeeReceived(address indexed from, uint256 amount);
    event Elected(uint256 indexed tokenId, address[] tokens, uint256[] weights);
    event Cranked(uint256 indexed roundId, uint256 pot, uint256 totalWeight);
    event Delivered(uint256 indexed roundId, uint256 indexed tokenId, address indexed tba, uint256 amount);
    event Reclaimed(uint256 indexed roundId, uint256 amount);

    struct Round {
        uint256 pot;
        uint256 totalWeight;
        uint256 distributed;
        uint64 startedAt;
    }

    /// @notice How long a round stays open before undelivered ETH rolls into the next pot.
    uint64 public constant RECLAIM_DELAY = 7 days;

    PonsSeatCollection public immutable nft;
    PonsSeatActivationManager public immutable activation;
    uint256 public immutable threshold;
    address public immutable defaultToken; // address(0) = native ETH

    uint256 public accruedEth;
    uint256 public roundCount;
    mapping(uint256 roundId => Round) public rounds;
    mapping(uint256 roundId => mapping(uint256 tokenId => bool claimed)) public claimed;
    mapping(uint256 tokenId => address[]) private _electTokens;
    mapping(uint256 tokenId => uint256[]) private _electWeights;

    constructor(address nft_, address activation_, uint256 threshold_, address defaultToken_) {
        if (nft_ == address(0) || activation_ == address(0)) revert ZeroAddress();
        nft = PonsSeatCollection(nft_);
        activation = PonsSeatActivationManager(activation_);
        threshold = threshold_;
        defaultToken = defaultToken_;
    }

    receive() external payable {
        accruedEth += msg.value;
        emit FeeReceived(msg.sender, msg.value);
    }

    function elect(uint256 tokenId, address[] calldata tokens, uint256[] calldata weights) external {
        require(nft.ownerOf(tokenId) == msg.sender, "owner");
        if (tokens.length == 0 || tokens.length > 3 || tokens.length != weights.length) revert BadElection();
        uint256 sum;
        for (uint256 i = 0; i < weights.length; i++) {
            sum += weights[i];
        }
        if (sum != 10_000) revert BadElection();
        _electTokens[tokenId] = tokens;
        _electWeights[tokenId] = weights;
        emit Elected(tokenId, tokens, weights);
    }

    function electionOf(uint256 tokenId) external view returns (address[] memory tokens, uint256[] memory weights) {
        return (_electTokens[tokenId], _electWeights[tokenId]);
    }

    /// @notice Open a distribution round when the ETH bar is full.
    function crank() external returns (uint256 roundId) {
        if (accruedEth < threshold) revert BelowThreshold();
        uint256 weight = activation.totalWeight();
        require(weight > 0, "no weight");

        roundId = ++roundCount;
        uint256 pot = accruedEth;
        accruedEth = 0;
        rounds[roundId] =
            Round({pot: pot, totalWeight: weight, distributed: 0, startedAt: uint64(block.timestamp)});
        emit Cranked(roundId, pot, weight);
    }

    /// @notice Pull one seat's share for a round into its TBA (permissionless).
    function deliver(uint256 roundId, uint256 tokenId) public {
        Round storage round = rounds[roundId];
        require(round.pot > 0, "round");
        if (claimed[roundId][tokenId]) revert NothingToDeliver();

        uint256 w = activation.weightOf(tokenId);
        if (w == 0) revert NothingToDeliver();
        // The round's weight was fixed at crank time, so only seats already on the payroll can claim it.
        // Timestamps are compared inclusively: blocks on this chain can share a second, and a seat
        // that joins in the crank's own second is not counted in the round's weight, so paying it
        // would come out of the seats that were.
        uint64 since = activation.activatedAt(tokenId);
        if (since == 0 || since >= round.startedAt) revert NothingToDeliver();

        claimed[roundId][tokenId] = true;
        uint256 amount = (round.pot * w) / round.totalWeight;
        uint256 remaining = round.pot - round.distributed;
        if (amount > remaining) amount = remaining;
        if (amount == 0) revert NothingToDeliver();
        round.distributed += amount;

        address tba = nft.accountOf(tokenId);
        (bool ok,) = payable(tba).call{value: amount}("");
        require(ok, "send");
        emit Delivered(roundId, tokenId, tba, amount);
    }

    /// @notice Roll a stale round's undelivered remainder into the next pot.
    function reclaim(uint256 roundId) external returns (uint256 amount) {
        Round storage round = rounds[roundId];
        require(round.pot > 0, "round");
        if (block.timestamp < round.startedAt + RECLAIM_DELAY) revert TooEarly();

        amount = round.pot - round.distributed;
        if (amount == 0) revert NothingToDeliver();
        round.distributed = round.pot;
        accruedEth += amount;
        emit Reclaimed(roundId, amount);
    }

    /// @notice Convenience: deliver a contiguous range of tokenIds for a round.
    function deliverRange(uint256 roundId, uint256 fromId, uint256 toId) external {
        Round storage round = rounds[roundId];
        for (uint256 id = fromId; id <= toId; id++) {
            if (activation.weightOf(id) == 0) continue;
            if (claimed[roundId][id]) continue;
            uint64 since = activation.activatedAt(id);
            if (since == 0 || since >= round.startedAt) continue;
            if (round.distributed >= round.pot) break;
            deliver(roundId, id);
        }
    }
}
