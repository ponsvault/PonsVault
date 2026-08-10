// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/token/ERC20/utils/SafeERC20.sol";
import {Strings} from "@openzeppelin/utils/Strings.sol";

import {PonsV2VaultBase} from "./PonsV2VaultBase.sol";

/// @title PonsV2StakingVault
/// @notice Stake the launch token; earn pro-rata quote-asset yield from creator fees.
contract PonsV2StakingVault is PonsV2VaultBase {
    using SafeERC20 for IERC20;

    error ZeroAmount();
    error NothingToClaim();
    error NoStake();

    event Staked(address indexed account, uint256 amount);
    event Unstaked(address indexed account, uint256 amount);
    event RewardsClaimed(address indexed account, uint256 quoteAmount, uint256 tokenAmount);
    event RewardsDistributed(uint256 quoteAmount, uint256 tokenAmount, uint256 totalStaked);
    event Configured(uint256 minHarvest);

    uint256 private constant PRECISION = 1e18;

    struct Config {
        uint256 minHarvest;
    }

    struct Position {
        uint256 amount;
        uint256 quoteDebt;
        uint256 tokenDebt;
        uint256 quoteOwed;
        uint256 tokenOwed;
    }

    Config public config;

    uint256 public totalStaked;
    uint256 public accQuotePerShare;
    uint256 public accTokenPerShare;
    uint256 public totalQuoteDistributed;
    uint256 public quoteReserved;
    uint256 public tokenReserved;

    mapping(address => Position) private _positions;

    constructor() {
        _disableInitializers();
    }

    function initialize(address _token, address _quoteAsset, Config calldata _config) external initializer {
        __PonsV2VaultBase_init(_token, _quoteAsset);
        config = _config;
        emit Configured(_config.minHarvest);
    }

    function stake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _settle(msg.sender);
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        Position storage position = _positions[msg.sender];
        position.amount += amount;
        totalStaked += amount;
        _syncDebt(position);
        emit Staked(msg.sender, amount);
    }

    function unstake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Position storage position = _positions[msg.sender];
        if (position.amount < amount) revert NoStake();
        _settle(msg.sender);
        position.amount -= amount;
        totalStaked -= amount;
        _syncDebt(position);
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    function claim() external nonReentrant returns (uint256 quoteOut, uint256 tokenOut) {
        _settle(msg.sender);
        Position storage position = _positions[msg.sender];
        quoteOut = position.quoteOwed;
        tokenOut = position.tokenOwed;
        if (quoteOut == 0 && tokenOut == 0) revert NothingToClaim();
        position.quoteOwed = 0;
        position.tokenOwed = 0;
        quoteReserved -= quoteOut;
        tokenReserved -= tokenOut;
        if (quoteOut != 0) IERC20(quoteAsset).safeTransfer(msg.sender, quoteOut);
        if (tokenOut != 0) IERC20(token).safeTransfer(msg.sender, tokenOut);
        emit RewardsClaimed(msg.sender, quoteOut, tokenOut);
    }

    function run() external nonReentrant returns (uint256 quoteDistributed, uint256 tokenDistributed) {
        if (totalStaked == 0) revert NoStake();
        _harvest();

        (quoteDistributed, tokenDistributed) = unencumberedBalances();
        if (quoteDistributed < config.minHarvest || quoteDistributed == 0) revert NothingToHarvest();

        lastRunAt = block.timestamp;
        runCount += 1;

        accQuotePerShare += (quoteDistributed * PRECISION) / totalStaked;
        if (tokenDistributed != 0) {
            accTokenPerShare += (tokenDistributed * PRECISION) / totalStaked;
        }
        totalQuoteDistributed += quoteDistributed;
        quoteReserved += quoteDistributed;
        tokenReserved += tokenDistributed;

        emit RewardsDistributed(quoteDistributed, tokenDistributed, totalStaked);
    }

    function unencumberedBalances() public view returns (uint256 quoteAmt, uint256 tokenAmt) {
        (uint256 quoteBalance, uint256 tokenBalance) = idleBalances();
        // Staked launch tokens sit in the vault — exclude them from reward distribution.
        uint256 freeToken =
            tokenBalance > totalStaked + tokenReserved ? tokenBalance - totalStaked - tokenReserved : 0;
        quoteAmt = quoteBalance > quoteReserved ? quoteBalance - quoteReserved : 0;
        tokenAmt = freeToken;
    }

    function pendingRewards(address account) public view returns (uint256 quoteAmt, uint256 tokenAmt) {
        Position storage position = _positions[account];
        quoteAmt = position.quoteOwed;
        tokenAmt = position.tokenOwed;
        if (position.amount != 0) {
            quoteAmt += (position.amount * accQuotePerShare) / PRECISION - position.quoteDebt;
            tokenAmt += (position.amount * accTokenPerShare) / PRECISION - position.tokenDebt;
        }
    }

    function stakedOf(address account) external view returns (uint256) {
        return _positions[account].amount;
    }

    function canRun() external view returns (bool ready, string memory reason) {
        if (totalStaked == 0) return (false, "No stake");
        // Staking also locks quote into the reward pool — unencumbered idle plus
        // escrow/curve is what a new run can still distribute.
        (uint256 quoteAmt,) = unencumberedBalances();
        uint256 available = quoteAmt + pendingEscrowQuote() + pendingCurveQuote();
        if (available < config.minHarvest || available == 0) {
            return (false, "Insufficient accrued fees (may still be sitting on the curve)");
        }
        return (true, "");
    }

    function template() external pure override returns (string memory) {
        return "staking";
    }

    function description() external view override returns (string memory) {
        return string.concat(
            "PonsV2StakingVault: ",
            Strings.toString(totalQuoteDistributed),
            " quote distributed across ",
            Strings.toString(runCount),
            " runs. Staked: ",
            Strings.toString(totalStaked),
            "."
        );
    }

    function _settle(address account) private {
        Position storage position = _positions[account];
        if (position.amount == 0) return;
        position.quoteOwed += (position.amount * accQuotePerShare) / PRECISION - position.quoteDebt;
        position.tokenOwed += (position.amount * accTokenPerShare) / PRECISION - position.tokenDebt;
        _syncDebt(position);
    }

    function _syncDebt(Position storage position) private {
        position.quoteDebt = (position.amount * accQuotePerShare) / PRECISION;
        position.tokenDebt = (position.amount * accTokenPerShare) / PRECISION;
    }
}
