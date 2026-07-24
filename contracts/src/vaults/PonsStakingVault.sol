// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/token/ERC20/utils/SafeERC20.sol";
import {Strings} from "@openzeppelin/utils/Strings.sol";

import {PonsAddresses} from "../PonsAddresses.sol";
import {PonsVaultBase} from "./PonsVaultBase.sol";

/// @title PonsStakingVault
/// @notice PonsVault template that pays a pons token's creator LP fees out to whoever stakes the
///         token, pro rata, as real WETH yield rather than newly minted supply.
///
/// @dev Why staking rather than holder dividends: paying every holder automatically would require
///      the token to notify this contract on each balance change, and pons tokens are plain ERC-20s
///      whose fees come from the Uniswap pool rather than a transfer tax. There is no hook to
///      attach to. Requiring an explicit deposit sidesteps that — the vault knows its own stakers.
///
///      Distribution is permissionless, like every template here: anyone may call {run}, and the
///      split is fixed by the maths rather than by an operator, so nobody can time or shape it.
///
///      Rewards come in two currencies because that is how the fees arrive. A Uniswap position
///      accrues both sides, so stakers earn WETH *and* the token itself. That makes the staked
///      asset also a reward asset, which is the one real hazard in this contract: `balanceOf` is
///      never a safe measure of anything here, since it mixes staked principal with undistributed
///      and unclaimed rewards. Every quantity below is tracked explicitly for that reason.
contract PonsStakingVault is PonsVaultBase {
    using SafeERC20 for IERC20;

    error InvalidLockPeriod();
    error ZeroAmount();
    error StakeTooSmall(uint256 amount, uint256 minimum);
    error InsufficientStake(uint256 staked, uint256 requested);
    error StakeLocked(uint256 unlockAt);
    error NoStakers();

    event Staked(address indexed account, uint256 amount, uint256 unlockAt);
    event Unstaked(address indexed account, uint256 amount);
    event RewardsClaimed(address indexed account, uint256 wethAmount, uint256 tokenAmount);
    event RewardsDistributed(uint256 wethAmount, uint256 tokenAmount, uint256 totalStaked);
    event Configured(uint32 lockPeriod, uint256 minHarvestWei, uint32 cooldown);

    /// @dev Fixed-point scale for the per-share accumulators. Deliberately far above the usual
    ///      1e12/1e18: a meme token's staked supply runs to ~1e26, and each of the two divisions
    ///      between a distribution and a staker's balance truncates by up to `totalStaked/PRECISION`
    ///      wei. At 1e18 that stranded ~1e8 wei per run; at 1e27 it rounds to nothing.
    uint256 private constant PRECISION = 1e27;

    /// @dev Floor on a non-zero position. Bounds how large the accumulators can grow in one step
    ///      (the increment scales with 1/totalStaked), which keeps the fixed-point maths clear of
    ///      overflow even in adversarial sequences, and stops dust positions accumulating.
    ///      Negligible against any realistic supply: 0.001 of an 18-decimal token.
    uint256 private constant MIN_STAKE = 1e15;

    /// @dev A year. Long enough for any plausible lock, short enough that a typo cannot
    ///      strand someone's stake for a human lifetime.
    uint32 private constant MAX_LOCK_PERIOD = 365 days;

    /// @param lockPeriod Seconds a stake is locked, measured from the staker's most recent deposit.
    /// @param minHarvestWei Minimum WETH a harvest must yield before {run} will act.
    /// @param cooldown Minimum seconds between successful runs.
    struct Config {
        uint32 lockPeriod;
        uint256 minHarvestWei;
        uint32 cooldown;
    }

    /// @param amount Tokens currently staked.
    /// @param wethDebt Bookkeeping baseline; not a debt owed by anyone.
    /// @param tokenDebt As above, for the token side.
    /// @param wethOwed Settled but unclaimed WETH.
    /// @param tokenOwed Settled but unclaimed tokens.
    /// @param unlockAt Timestamp from which {unstake} is permitted.
    struct Position {
        uint256 amount;
        uint256 wethDebt;
        uint256 tokenDebt;
        uint256 wethOwed;
        uint256 tokenOwed;
        uint256 unlockAt;
    }

    Config public config;

    mapping(address account => Position position) public positions;

    /// @notice Tokens staked across every account.
    /// @dev The only trustworthy measure of principal. See the note on `balanceOf` above.
    uint256 public totalStaked;

    uint256 public accWethPerShare;
    uint256 public accTokenPerShare;

    /// @notice Lifetime WETH distributed to stakers.
    uint256 public totalWethDistributed;

    /// @notice Lifetime tokens distributed to stakers.
    uint256 public totalTokenDistributed;

    /// @notice WETH credited to stakers but not yet claimed.
    /// @dev Held here on stakers' behalf, so it is not this vault's to spend. Tracked because
    ///      `idleBalances()` cannot tell the difference between unclaimed rewards and fresh fees.
    uint256 public wethReserved;

    /// @notice Tokens credited to stakers but not yet claimed. Separate from {totalStaked}.
    uint256 public tokenReserved;

    constructor() {
        _disableInitializers();
    }

    function initialize(address _token, address _locker, address _collector, Config calldata _config)
        external
        initializer
    {
        __PonsVaultBase_init(_token, _locker, _collector);
        if (_config.lockPeriod > MAX_LOCK_PERIOD) revert InvalidLockPeriod();
        config = _config;
        emit Configured(_config.lockPeriod, _config.minHarvestWei, _config.cooldown);
    }

    /* ---------------------------------------------------------------------- */
    /* staking                                                                */
    /* ---------------------------------------------------------------------- */

    /// @notice Stake `amount` tokens to start earning a share of the fees.
    /// @dev Restarts the lock for the whole position, not just the new tokens. Tracking each
    ///      deposit separately would let a staker unstake in slices to dodge a lock they opted
    ///      into, and would grow unboundedly with deposits.
    function stake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        Position storage position = positions[msg.sender];
        _settle(position);

        // Measured rather than assumed: a token that takes a cut on transfer would otherwise
        // credit more than actually arrived, and the shortfall would come out of other stakers.
        uint256 before = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - before;
        if (received == 0) revert ZeroAmount();

        position.amount += received;
        if (position.amount < MIN_STAKE) revert StakeTooSmall(position.amount, MIN_STAKE);

        totalStaked += received;
        _resetDebt(position);

        position.unlockAt = block.timestamp + config.lockPeriod;
        emit Staked(msg.sender, received, position.unlockAt);
    }

    /// @notice Withdraw `amount` of staked tokens once the lock has expired.
    /// @dev Rewards are never locked, only principal. {claim} stays open throughout.
    function unstake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        Position storage position = positions[msg.sender];
        if (position.amount < amount) revert InsufficientStake(position.amount, amount);
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < position.unlockAt) revert StakeLocked(position.unlockAt);

        _settle(position);

        position.amount -= amount;
        // Leave either nothing or a real position, never dust — see {MIN_STAKE}. Exiting fully is
        // always available, so this constrains how you leave rather than whether you can.
        if (position.amount != 0 && position.amount < MIN_STAKE) revert StakeTooSmall(position.amount, MIN_STAKE);

        totalStaked -= amount;
        _resetDebt(position);

        IERC20(token).safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    /// @notice Collect everything owed to the caller, in both currencies.
    function claim() external nonReentrant returns (uint256 wethOut, uint256 tokenOut) {
        Position storage position = positions[msg.sender];
        _settle(position);

        wethOut = position.wethOwed;
        tokenOut = position.tokenOwed;
        position.wethOwed = 0;
        position.tokenOwed = 0;

        wethReserved -= wethOut;
        tokenReserved -= tokenOut;

        if (wethOut != 0) IERC20(PonsAddresses.WETH).safeTransfer(msg.sender, wethOut);
        if (tokenOut != 0) IERC20(token).safeTransfer(msg.sender, tokenOut);

        emit RewardsClaimed(msg.sender, wethOut, tokenOut);
    }

    /* ---------------------------------------------------------------------- */
    /* distribution                                                           */
    /* ---------------------------------------------------------------------- */

    /// @notice Harvest creator fees and credit them across current stakers.
    /// @dev Permissionless. Reverts when nobody is staked, which deliberately leaves the fees
    ///      unclaimed in the locker rather than stranding them here: the whole call rolls back,
    ///      so the first run after someone stakes collects the entire backlog for them.
    /// @return wethDistributed WETH credited to stakers.
    /// @return tokenDistributed Tokens credited to stakers.
    function run() external nonReentrant returns (uint256 wethDistributed, uint256 tokenDistributed) {
        Config memory cfg = config;

        uint256 readyAt = lastRunAt + cfg.cooldown;
        // forge-lint: disable-next-line(block-timestamp)
        if (lastRunAt != 0 && block.timestamp < readyAt) revert CooldownActive(readyAt);

        (wethDistributed, tokenDistributed) = _harvest();
        if (wethDistributed < cfg.minHarvestWei || wethDistributed == 0) revert NothingToHarvest();

        uint256 staked = totalStaked;
        if (staked == 0) revert NoStakers();

        lastRunAt = block.timestamp;
        runCount += 1;

        accWethPerShare += (wethDistributed * PRECISION) / staked;
        accTokenPerShare += (tokenDistributed * PRECISION) / staked;
        totalWethDistributed += wethDistributed;
        totalTokenDistributed += tokenDistributed;
        wethReserved += wethDistributed;
        tokenReserved += tokenDistributed;

        emit RewardsDistributed(wethDistributed, tokenDistributed, staked);
    }

    /* ---------------------------------------------------------------------- */
    /* views                                                                  */
    /* ---------------------------------------------------------------------- */

    /// @notice Whether {run} would currently succeed, and why not if it would not.
    /// @dev Only reports the blockers this contract can see. Almost all pending value sits in the
    ///      locker rather than here, and only {run} can measure it, so a `true` here means
    ///      "nothing structural is in the way" rather than "there are fees to distribute".
    ///      Callers needing a definitive answer should simulate {run}.
    function canRun() external view returns (bool ready, string memory reason) {
        Config memory cfg = config;

        // forge-lint: disable-next-line(block-timestamp)
        if (lastRunAt != 0 && block.timestamp < lastRunAt + cfg.cooldown) {
            return (false, "Cooldown active");
        }
        if (totalStaked == 0) {
            return (false, "Nobody is staked yet");
        }
        return (true, "");
    }

    /// @notice Fees sitting here that no staker has a claim on yet.
    /// @dev What a UI should show as "queued for the next distribution". The plain
    ///      {idleBalances} cannot be used for this: its WETH figure includes rewards already
    ///      credited but unclaimed, and its token figure also includes staked principal.
    function unencumberedBalances() public view returns (uint256 weth, uint256 tokenAmount) {
        (uint256 wethBalance, uint256 tokenBalance) = idleBalances();
        uint256 tokenSpokenFor = totalStaked + tokenReserved;

        weth = wethBalance > wethReserved ? wethBalance - wethReserved : 0;
        tokenAmount = tokenBalance > tokenSpokenFor ? tokenBalance - tokenSpokenFor : 0;
    }

    /// @notice Rewards `account` could claim right now, in both currencies.
    function pendingRewards(address account) public view returns (uint256 weth, uint256 tokenAmount) {
        Position memory position = positions[account];
        weth = position.wethOwed;
        tokenAmount = position.tokenOwed;

        if (position.amount != 0) {
            weth += (position.amount * accWethPerShare) / PRECISION - position.wethDebt;
            tokenAmount += (position.amount * accTokenPerShare) / PRECISION - position.tokenDebt;
        }
    }

    /// @notice Everything a UI needs about one staker, in a single call.
    function positionOf(address account)
        external
        view
        returns (uint256 staked, uint256 pendingWeth, uint256 pendingToken, uint256 unlockAt, uint256 sharePpm)
    {
        Position memory position = positions[account];
        staked = position.amount;
        unlockAt = position.unlockAt;
        (pendingWeth, pendingToken) = pendingRewards(account);
        sharePpm = totalStaked == 0 ? 0 : (position.amount * 1_000_000) / totalStaked;
    }

    /// @inheritdoc PonsVaultBase
    function template() external pure override returns (string memory) {
        return "staking";
    }

    /// @inheritdoc PonsVaultBase
    function description() external view override returns (string memory) {
        return string.concat(
            "PonsStakingVault: creator fees are paid to stakers pro rata. Staked: ",
            Strings.toString(totalStaked / 1e18),
            " tokens. Distributed: ",
            Strings.toString(totalWethDistributed),
            " wei WETH across ",
            Strings.toString(runCount),
            " runs. Lock: ",
            Strings.toString(config.lockPeriod),
            "s."
        );
    }

    /* ---------------------------------------------------------------------- */
    /* internals                                                              */
    /* ---------------------------------------------------------------------- */

    /// @dev Moves whatever the position has accrued into its owed balances and advances its
    ///      baseline, so the same rewards cannot be credited twice. Must run before any change to
    ///      `amount`, otherwise the new amount would be applied retroactively to rewards earned
    ///      under the old one.
    function _settle(Position storage position) private {
        if (position.amount == 0) return;
        position.wethOwed += (position.amount * accWethPerShare) / PRECISION - position.wethDebt;
        position.tokenOwed += (position.amount * accTokenPerShare) / PRECISION - position.tokenDebt;
        _resetDebt(position);
    }

    /// @dev Rebases the position onto the current accumulators. Must run after `amount` changes.
    function _resetDebt(Position storage position) private {
        position.wethDebt = (position.amount * accWethPerShare) / PRECISION;
        position.tokenDebt = (position.amount * accTokenPerShare) / PRECISION;
    }
}
