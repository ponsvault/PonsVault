// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin-contracts-upgradeable/proxy/utils/Initializable.sol";
import {ReentrancyGuardUpgradeable} from
    "@openzeppelin-contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

import {PonsV2Addresses} from "../PonsV2Addresses.sol";
import {IPonsCurve} from "../interfaces/IPonsCurve.sol";
import {IPonsFeeEscrow} from "../interfaces/IPonsFeeEscrow.sol";
import {IPonsV2Factory} from "../interfaces/IPonsV2Factory.sol";

/// @title PonsV2VaultBase
/// @notice Shared plumbing for PonsVault templates on pons v2.
///
/// @dev How a v2 vault earns: the vault is set as `creatorFeeRecipient` on the launch. Trade
///      fees first sit on the bonding curve (`quoteFeeBalance` / `creatorTaxBalance`). The vault
///      (as fee recipient) must `sweepFees` them into the fee escrow, then {_harvest} claims
///      that escrow balance. Anyone may call a template's {run}, which does sweep → claim →
///      distribute.
///
///      Unlike v1 there is no locker sweep and no collector. The vault is its own claimant.
///      The payout asset is the launch's quote asset (today AAPL; later possibly native ETH
///      or other approved pairs), not hardcoded WETH.
abstract contract PonsV2VaultBase is Initializable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    error ZeroAddress();
    error NothingToHarvest();
    error NativeQuoteUnsupported();

    event FeesHarvested(uint256 quoteAmount, uint256 tokenAmount);
    event TokensBurned(uint256 amount);
    event CurveFeesSwept(uint256 quoteFeeBalance, uint256 creatorTaxBalance);

    /// @notice The pons v2 launch token this vault is bound to.
    address public token;

    /// @notice Quote asset fees arrive in. `address(0)` means native ETH (not yet supported here).
    address public quoteAsset;

    /// @notice Total quote asset harvested from the escrow over the vault's lifetime.
    uint256 public totalQuoteHarvested;

    /// @notice Total launch tokens sent to the burn address over the vault's lifetime.
    uint256 public totalTokensBurned;

    /// @notice Timestamp of the last successful distribution.
    uint256 public lastRunAt;

    /// @notice Number of successful distributions.
    uint256 public runCount;

    function __PonsV2VaultBase_init(address _token, address _quoteAsset) internal onlyInitializing {
        if (_token == address(0)) revert ZeroAddress();
        // Native ETH launches credit the escrow's native ledger. Supporting them needs a
        // `receive()` path and careful gas accounting on payouts — defer until ETH is approved.
        if (_quoteAsset == address(0)) revert NativeQuoteUnsupported();
        __ReentrancyGuard_init();
        token = _token;
        quoteAsset = _quoteAsset;
    }

    /// @notice Balances currently sitting in the vault, awaiting distribution.
    function idleBalances() public view returns (uint256 quoteBalance, uint256 tokenBalance) {
        quoteBalance = IERC20(quoteAsset).balanceOf(address(this));
        tokenBalance = IERC20(token).balanceOf(address(this));
    }

    /// @notice Quote still claimable from the escrow but not yet pulled into the vault.
    function pendingEscrowQuote() public view returns (uint256) {
        return IPonsFeeEscrow(PonsV2Addresses.FEE_ESCROW).balanceOfToken(address(this), quoteAsset);
    }

    /// @notice Launch-token balance still claimable (e.g. released buyback vest credits).
    function pendingEscrowToken() public view returns (uint256) {
        return IPonsFeeEscrow(PonsV2Addresses.FEE_ESCROW).balanceOfToken(address(this), token);
    }

    /// @notice Creator's unswept share still sitting on the bonding curve.
    /// @dev Escrow reads alone understate fees — pons only credits the escrow after a sweep.
    function pendingCurveQuote() public view returns (uint256) {
        address curve = _curve();
        if (curve == address(0)) return 0;

        uint256 tax = IPonsCurve(curve).creatorTaxBalance();
        uint256 fees = IPonsCurve(curve).quoteFeeBalance();
        if (fees == 0) return tax;

        IPonsV2Factory.FeePolicy memory policy =
            IPonsV2Factory(PonsV2Addresses.FACTORY).getLaunchFeePolicy(token);
        IPonsV2Factory.LaunchedToken memory launch =
            IPonsV2Factory(PonsV2Addresses.FACTORY).getLaunchedToken(token);

        uint256 afterProtocol =
            fees - (fees * uint256(policy.protocolFeeShareBps)) / PonsV2Addresses.BPS_DENOMINATOR;
        if (launch.buybackEnabled && policy.buybackBurnBps != 0) {
            afterProtocol = afterProtocol
                - (afterProtocol * uint256(policy.buybackBurnBps)) / PonsV2Addresses.BPS_DENOMINATOR;
        }
        return tax + afterProtocol;
    }

    /// @notice Idle vault quote + escrow + unswept curve creator share.
    function pendingQuote() public view returns (uint256) {
        (uint256 idle,) = idleBalances();
        return idle + pendingEscrowQuote() + pendingCurveQuote();
    }

    function description() external view virtual returns (string memory);

    function template() external pure virtual returns (string memory);

    function _curve() internal view returns (address) {
        IPonsV2Factory.LaunchedToken memory launch =
            IPonsV2Factory(PonsV2Addresses.FACTORY).getLaunchedToken(token);
        return launch.exists ? launch.curve : address(0);
    }

    /// @dev Moves curve fee balances into the escrow. Only the vault (fee recipient) or the
    ///      protocol fee-sweep operator may call `sweepFees`; we are the vault.
    function _sweepCurveFees() internal {
        address curve = _curve();
        if (curve == address(0)) return;

        uint256 fees = IPonsCurve(curve).quoteFeeBalance();
        uint256 tax = IPonsCurve(curve).creatorTaxBalance();
        if (fees == 0 && tax == 0) return;

        try IPonsCurve(curve).sweepFees(0) {
            emit CurveFeesSwept(fees, tax);
        } catch {
            // Operator-gated paths or empty dust — run() still tries escrow/idle.
        }
    }

    /// @dev Sweep curve → escrow, then pull claimable balances into this vault.
    function _harvest() internal returns (uint256 quoteGained, uint256 tokenGained) {
        _sweepCurveFees();

        (uint256 quoteBefore, uint256 tokenBefore) = idleBalances();

        uint256 quoteOwed = pendingEscrowQuote();
        if (quoteOwed != 0) {
            IPonsFeeEscrow(PonsV2Addresses.FEE_ESCROW).claimToken(quoteAsset);
        }

        uint256 tokenOwed = pendingEscrowToken();
        if (tokenOwed != 0) {
            IPonsFeeEscrow(PonsV2Addresses.FEE_ESCROW).claimToken(token);
        }

        (uint256 quoteAfter, uint256 tokenAfter) = idleBalances();
        quoteGained = quoteAfter - quoteBefore;
        tokenGained = tokenAfter - tokenBefore;

        if (quoteGained != 0) totalQuoteHarvested += quoteGained;
        emit FeesHarvested(quoteGained, tokenGained);
    }

    /// @dev Burns the vault's entire launch-token balance.
    function _burnAllTokens() internal returns (uint256 burned) {
        burned = IERC20(token).balanceOf(address(this));
        if (burned == 0) return 0;

        IERC20(token).safeTransfer(PonsV2Addresses.BURN_ADDRESS, burned);
        totalTokensBurned += burned;
        emit TokensBurned(burned);
    }

    uint256[45] private __gap;
}
