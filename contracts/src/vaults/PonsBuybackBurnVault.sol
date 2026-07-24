// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/token/ERC20/utils/SafeERC20.sol";
import {Strings} from "@openzeppelin/utils/Strings.sol";

import {PonsAddresses} from "../PonsAddresses.sol";
import {PonsVaultBase} from "./PonsVaultBase.sol";

/// @title PonsBuybackBurnVault
/// @notice PonsVault template that turns a pons token's creator LP fees into automated
///         buyback-and-burn pressure, optionally splitting a share to a treasury.
///
/// @dev Distribution is permissionless: anyone may call {run}, and the vault itself is the
///      authorised fee claimant on the locker. That keeps the incentive-sensitive parameters
///      (split, cooldown, slippage bounds) fixed at configuration time rather than under an
///      operator's control, so no privileged party can time or shape the buyback.
contract PonsBuybackBurnVault is PonsVaultBase {
    using SafeERC20 for IERC20;

    error InvalidBurnBps(uint16 burnBps);
    error InvalidTwapWindow();
    error InvalidTickDeviation();
    error TreasuryRequired();

    /// @dev Floor on `maxTickDeviation`. A value of one tick is ~0.01% and will reject almost
    ///      every run on a thin pool, stranding fees forever with no way to recover them.
    ///      Fifty ticks is ~0.5% — still tight, but not self-defeating.
    int24 private constant MIN_MAX_TICK_DEVIATION = 50;

    event TreasuryPaid(address indexed treasury, uint256 amount);
    event Configured(uint16 burnBps, address treasury, uint256 minHarvestWei, uint32 cooldown);

    /// @param burnBps Share of harvested WETH spent on buyback-and-burn, in basis points.
    /// @param treasury Recipient of the remaining WETH. Required unless `burnBps` is 10000.
    /// @param minHarvestWei Minimum idle WETH required before {run} will act.
    /// @param cooldown Minimum seconds between successful runs.
    /// @param twapWindow TWAP window, in seconds, used for the price-manipulation guard.
    /// @param maxTickDeviation Maximum absolute tick gap tolerated between spot and TWAP.
    struct Config {
        uint16 burnBps;
        address treasury;
        uint256 minHarvestWei;
        uint32 cooldown;
        uint32 twapWindow;
        int24 maxTickDeviation;
    }

    Config public config;

    /// @notice Total WETH forwarded to the treasury over the vault's lifetime.
    uint256 public totalTreasuryPaid;

    constructor() {
        _disableInitializers();
    }

    function initialize(address _token, address _locker, address _collector, Config calldata _config)
        external
        initializer
    {
        __PonsVaultBase_init(_token, _locker, _collector);
        _validate(_config);
        config = _config;
        emit Configured(_config.burnBps, _config.treasury, _config.minHarvestWei, _config.cooldown);
    }

    /// @notice Harvest creator fees, buy back and burn the configured share, and forward the rest.
    /// @dev Permissionless. `amountOutMinimum` is the caller's own slippage floor; it may be zero
    ///      when the pool oracle has enough history for the TWAP guard to protect the swap, and is
    ///      mandatory otherwise.
    /// @param amountOutMinimum Minimum tokens the buyback swap must return.
    /// @return wethSpent WETH spent on the buyback.
    /// @return tokensBurned Tokens sent to the burn address, including harvested token-side fees.
    function run(uint256 amountOutMinimum) external nonReentrant returns (uint256 wethSpent, uint256 tokensBurned) {
        Config memory cfg = config;

        uint256 readyAt = lastRunAt + cfg.cooldown;
        // forge-lint: disable-next-line(block-timestamp)
        if (lastRunAt != 0 && block.timestamp < readyAt) revert CooldownActive(readyAt);

        _harvest();

        (uint256 wethBalance,) = idleBalances();
        if (wethBalance < cfg.minHarvestWei || wethBalance == 0) revert NothingToHarvest();

        lastRunAt = block.timestamp;
        runCount += 1;

        wethSpent = (wethBalance * cfg.burnBps) / PonsAddresses.BPS_DENOMINATOR;
        uint256 treasuryAmount = wethBalance - wethSpent;

        if (wethSpent != 0) {
            _requireFairPrice(cfg.twapWindow, cfg.maxTickDeviation, amountOutMinimum);
            _buyback(wethSpent, amountOutMinimum);
        }

        tokensBurned = _burnAllTokens();

        if (treasuryAmount != 0) {
            totalTreasuryPaid += treasuryAmount;
            IERC20(PonsAddresses.WETH).safeTransfer(cfg.treasury, treasuryAmount);
            emit TreasuryPaid(cfg.treasury, treasuryAmount);
        }
    }

    /// @notice Whether {run} would currently succeed, and why not if it would not.
    function canRun() external view returns (bool ready, string memory reason) {
        Config memory cfg = config;

        // forge-lint: disable-next-line(block-timestamp)
        if (lastRunAt != 0 && block.timestamp < lastRunAt + cfg.cooldown) {
            return (false, "Cooldown active");
        }
        (uint256 wethBalance,) = idleBalances();
        if (wethBalance < cfg.minHarvestWei || wethBalance == 0) {
            return (false, "Insufficient accrued fees (harvest may still be pending in the locker)");
        }
        if (pool() == address(0)) {
            return (false, "Pool not deployed yet");
        }
        return (true, "");
    }

    /// @inheritdoc PonsVaultBase
    function template() external pure override returns (string memory) {
        return "buyback-burn";
    }

    /// @inheritdoc PonsVaultBase
    function description() external view override returns (string memory) {
        Config memory cfg = config;
        (uint256 wethBalance,) = idleBalances();

        return string.concat(
            "PonsBuybackBurnVault: ",
            Strings.toString(cfg.burnBps / 100),
            "% of creator fees buy back and burn the token",
            cfg.burnBps == PonsAddresses.BPS_DENOMINATOR
                ? ""
                : string.concat(
                    ", ", Strings.toString((PonsAddresses.BPS_DENOMINATOR - cfg.burnBps) / 100), "% to treasury"
                ),
            ". Burned so far: ",
            Strings.toString(totalTokensBurned / 1e18),
            " tokens across ",
            Strings.toString(runCount),
            " runs. Pending: ",
            Strings.toString(wethBalance),
            " wei WETH."
        );
    }

    function _validate(Config calldata cfg) private pure {
        if (cfg.burnBps == 0 || cfg.burnBps > PonsAddresses.BPS_DENOMINATOR) revert InvalidBurnBps(cfg.burnBps);
        if (cfg.burnBps != PonsAddresses.BPS_DENOMINATOR && cfg.treasury == address(0)) revert TreasuryRequired();
        if (cfg.twapWindow < 60) revert InvalidTwapWindow();
        if (cfg.maxTickDeviation < MIN_MAX_TICK_DEVIATION || cfg.maxTickDeviation > 5000) {
            revert InvalidTickDeviation();
        }
    }
}
