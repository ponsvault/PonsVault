// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/token/ERC20/utils/SafeERC20.sol";
import {Strings} from "@openzeppelin/utils/Strings.sol";

import {PonsV2Addresses} from "../PonsV2Addresses.sol";
import {IQuoteBuyback} from "../interfaces/IQuoteBuyback.sol";
import {PonsV2VaultBase} from "./PonsV2VaultBase.sol";

/// @title PonsV2BuybackBurnVault
/// @notice v2 Buyback & Burn: harvest creator fees from the escrow, spend a share buying the
///         launch token via an injectable swapper, burn it, and forward the rest to a treasury.
///
/// @dev The swapper is pluggable because v2 pools are Uniswap v4 and the routing surface is
///      still settling. A zero swapper with `burnBps == 10000` is rejected — there would be no
///      way to spend the burn share. With a treasury split, a missing swapper just holds the
///      burn share in the vault until one is set (beacon-upgrade or {setBuyback}).
contract PonsV2BuybackBurnVault is PonsV2VaultBase {
    using SafeERC20 for IERC20;

    error InvalidBurnBps(uint16 burnBps);
    error TreasuryRequired();
    error BuybackRequired();

    event TreasuryPaid(address indexed treasury, uint256 amount);
    event BuybackExecuted(uint256 quoteSpent, uint256 tokensBought);
    event BuybackChanged(address indexed buyback);
    event Configured(uint16 burnBps, address treasury, uint256 minHarvest);

    struct Config {
        uint16 burnBps;
        address treasury;
        /// @dev Minimum idle quote (already in the vault + pending in escrow) before {run} acts.
        uint256 minHarvest;
    }

    Config public config;

    /// @notice Optional helper that swaps quote → launch token into this vault.
    address public buyback;

    uint256 public totalTreasuryPaid;
    uint256 public totalQuoteBoughtBack;

    constructor() {
        _disableInitializers();
    }

    function initialize(address _token, address _quoteAsset, address _buyback, Config calldata _config)
        external
        initializer
    {
        __PonsV2VaultBase_init(_token, _quoteAsset);
        _validate(_config);
        if (_config.burnBps == PonsV2Addresses.BPS_DENOMINATOR && _buyback == address(0)) {
            revert BuybackRequired();
        }
        config = _config;
        buyback = _buyback;
        emit Configured(_config.burnBps, _config.treasury, _config.minHarvest);
        emit BuybackChanged(_buyback);
    }

    /// @notice Harvest fees, buy back and burn the configured share, forward the rest.
    /// @param amountOutMinimum Slippage floor for the buyback swap. Ignored when burn share is 0.
    function run(uint256 amountOutMinimum)
        external
        nonReentrant
        returns (uint256 quoteSpent, uint256 tokensBurned)
    {
        Config memory cfg = config;

        _harvest();

        (uint256 quoteBalance,) = idleBalances();
        if (quoteBalance < cfg.minHarvest || quoteBalance == 0) revert NothingToHarvest();

        lastRunAt = block.timestamp;
        runCount += 1;

        quoteSpent = (quoteBalance * cfg.burnBps) / PonsV2Addresses.BPS_DENOMINATOR;
        uint256 treasuryAmount = quoteBalance - quoteSpent;

        if (quoteSpent != 0) {
            address swapper = buyback;
            if (swapper == address(0)) revert BuybackRequired();
            IERC20(quoteAsset).forceApprove(swapper, quoteSpent);
            uint256 bought = IQuoteBuyback(swapper).buyback(quoteAsset, token, quoteSpent, amountOutMinimum);
            IERC20(quoteAsset).forceApprove(swapper, 0);
            totalQuoteBoughtBack += quoteSpent;
            emit BuybackExecuted(quoteSpent, bought);
        }

        tokensBurned = _burnAllTokens();

        if (treasuryAmount != 0) {
            totalTreasuryPaid += treasuryAmount;
            IERC20(quoteAsset).safeTransfer(cfg.treasury, treasuryAmount);
            emit TreasuryPaid(cfg.treasury, treasuryAmount);
        }
    }

    function canRun() external view returns (bool ready, string memory reason) {
        Config memory cfg = config;
        (uint256 quoteBalance,) = idleBalances();
        uint256 available = quoteBalance + pendingEscrowQuote();
        if (available < cfg.minHarvest || available == 0) {
            return (false, "Insufficient accrued fees (may still be pending in the escrow)");
        }
        if (cfg.burnBps != 0 && buyback == address(0)) {
            return (false, "Buyback swapper not set");
        }
        return (true, "");
    }

    function template() external pure override returns (string memory) {
        return "buyback-burn";
    }

    function description() external view override returns (string memory) {
        Config memory cfg = config;
        (uint256 quoteBalance,) = idleBalances();
        return string.concat(
            "PonsV2BuybackBurnVault: ",
            Strings.toString(cfg.burnBps / 100),
            "% of creator fees buy back and burn",
            cfg.burnBps == PonsV2Addresses.BPS_DENOMINATOR
                ? ""
                : string.concat(
                    ", ",
                    Strings.toString((PonsV2Addresses.BPS_DENOMINATOR - cfg.burnBps) / 100),
                    "% to treasury"
                ),
            ". Burned: ",
            Strings.toString(totalTokensBurned),
            " across ",
            Strings.toString(runCount),
            " runs. Idle quote: ",
            Strings.toString(quoteBalance),
            "."
        );
    }

    function _validate(Config calldata cfg) private pure {
        if (cfg.burnBps == 0 || cfg.burnBps > PonsV2Addresses.BPS_DENOMINATOR) {
            revert InvalidBurnBps(cfg.burnBps);
        }
        if (cfg.burnBps != PonsV2Addresses.BPS_DENOMINATOR && cfg.treasury == address(0)) {
            revert TreasuryRequired();
        }
    }
}
