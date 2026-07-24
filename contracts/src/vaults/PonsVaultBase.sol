// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin-contracts-upgradeable/proxy/utils/Initializable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin-contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

import {PonsAddresses} from "../PonsAddresses.sol";
import {IPonsFeeCollector} from "../interfaces/IPonsLaunchpad.sol";
import {ISwapRouter02, IUniswapV3Factory, IUniswapV3Pool} from "../interfaces/IUniswapV3.sol";

/// @title PonsVaultBase
/// @notice Shared plumbing for PonsVault templates: claiming pons creator fees, price-manipulation
///         guards, and buyback/burn primitives.
///
/// @dev How a PonsVault earns: pons routes a launch's creator LP fees to `feeRedirects(token)` on
///      the locker, so pointing that at a vault makes the vault the payout recipient.
///
///      Sweeping and receiving are separate permissions, which shapes this design. The locker only
///      accepts `collectFees` from the token's `deployer` or pons's `protocolFeeRecipient` — a fee
///      redirect target is *not* authorised, even though it is where the funds land. The vault
///      therefore delegates the sweep to a `collector` (the {PonsVaultLauncher} that performed the
///      launch and is thus the on-chain deployer), while distribution stays permissionless here.
///
///      Fees arrive as ERC-20 WETH plus, when the pool has accrued token-side fees, the token
///      itself. No native ETH is ever received, so there is no fallback-gas constraint here.
abstract contract PonsVaultBase is Initializable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    error ZeroAddress();
    error PoolNotFound();
    error NothingToHarvest();
    error CooldownActive(uint256 readyAt);
    error PriceOutOfRange(int24 spotTick, int24 twapTick, int24 maxDeviation);
    error OracleNotReady();

    event FeesHarvested(uint256 wethAmount, uint256 tokenAmount);
    event BuybackExecuted(uint256 wethSpent, uint256 tokensBought);
    event TokensBurned(uint256 amount);

    /// @notice The pons token this vault is bound to.
    address public token;

    /// @notice The pons locker custodying the token's LP position.
    address public locker;

    /// @notice Contract authorised to sweep this token's fees out of the locker.
    /// @dev The launcher that deployed the token, and therefore its on-chain `deployer`.
    address public collector;

    /// @notice Total WETH harvested from the locker over the vault's lifetime.
    uint256 public totalWethHarvested;

    /// @notice Total tokens sent to the burn address over the vault's lifetime.
    uint256 public totalTokensBurned;

    /// @notice Timestamp of the last successful distribution.
    uint256 public lastRunAt;

    /// @notice Number of successful distributions.
    uint256 public runCount;

    function __PonsVaultBase_init(address _token, address _locker, address _collector) internal onlyInitializing {
        if (_token == address(0) || _locker == address(0) || _collector == address(0)) revert ZeroAddress();
        __ReentrancyGuard_init();
        token = _token;
        locker = _locker;
        collector = _collector;
    }

    /// @notice The WETH/token Uniswap V3 pool backing this token.
    function pool() public view returns (address poolAddress) {
        poolAddress =
            IUniswapV3Factory(PonsAddresses.V3_FACTORY).getPool(PonsAddresses.WETH, token, PonsAddresses.POOL_FEE);
    }

    /// @notice Grow the pool's oracle ring buffer so TWAP checks become available.
    /// @dev Permissionless and idempotent. pons pools start at cardinality 1, which is not enough
    ///      history for a TWAP, so this needs calling once per pool. The buffer then fills as
    ///      trades land in distinct blocks.
    function primeOracle(uint16 observationCardinalityNext) external {
        address poolAddress = pool();
        if (poolAddress == address(0)) revert PoolNotFound();
        IUniswapV3Pool(poolAddress).increaseObservationCardinalityNext(observationCardinalityNext);
    }

    /// @notice Whether a TWAP over `window` seconds can currently be read from the pool.
    function isOracleReady(uint32 window) public view returns (bool ready) {
        address poolAddress = pool();
        if (poolAddress == address(0)) return false;
        (, ready) = _twapTick(poolAddress, window);
    }

    /// @notice Balances currently sitting in the vault, awaiting distribution.
    function idleBalances() public view returns (uint256 wethBalance, uint256 tokenBalance) {
        wethBalance = IERC20(PonsAddresses.WETH).balanceOf(address(this));
        tokenBalance = IERC20(token).balanceOf(address(this));
    }

    /// @notice Human-readable status for UIs. Implementations should reflect live state.
    function description() external view virtual returns (string memory);

    /// @notice Stable identifier for which template this vault is.
    /// @dev Templates expose different configs and a different {run} signature, so anything
    ///      reading a vault by address alone needs to know which it is holding before it can
    ///      decode anything else. Matches the ids the frontend uses.
    function template() external pure virtual returns (string memory);

    /// @dev Sweeps pending creator fees out of the locker into this vault, via the collector.
    ///      Deliberately a low-level call with the result ignored: the locker reverts when there is
    ///      nothing to collect, and a retrofitted vault may have an EOA as its collector, in which
    ///      case the call succeeds but returns no decodable data. Balances measured either side are
    ///      the source of truth, so a failed sweep simply contributes nothing.
    function _harvest() internal returns (uint256 wethGained, uint256 tokenGained) {
        (uint256 wethBefore, uint256 tokenBefore) = idleBalances();

        // solhint-disable-next-line avoid-low-level-calls
        (bool swept,) = collector.call(abi.encodeCall(IPonsFeeCollector.collect, (token)));
        swept;

        (uint256 wethAfter, uint256 tokenAfter) = idleBalances();
        wethGained = wethAfter - wethBefore;
        tokenGained = tokenAfter - tokenBefore;

        if (wethGained != 0) totalWethHarvested += wethGained;
        emit FeesHarvested(wethGained, tokenGained);
    }

    /// @dev Reverts unless the pool's spot price sits within `maxTickDeviation` of its TWAP.
    ///      This is the sandwich guard: because distribution is permissionless, an attacker could
    ///      otherwise move the pool, trigger a buyback into the skewed price, and unwind. Bounding
    ///      the deviation bounds the extractable value.
    ///
    ///      When the oracle has insufficient history the caller must supply an explicit
    ///      `amountOutMinimum` instead, so the swap is still protected.
    function _requireFairPrice(uint32 window, int24 maxTickDeviation, uint256 amountOutMinimum) internal view {
        address poolAddress = pool();
        if (poolAddress == address(0)) revert PoolNotFound();

        (int24 twapTick, bool ok) = _twapTick(poolAddress, window);
        if (!ok) {
            if (amountOutMinimum == 0) revert OracleNotReady();
            return;
        }

        (, int24 spotTick,,,,,) = IUniswapV3Pool(poolAddress).slot0();
        int256 deviation = int256(spotTick) - int256(twapTick);
        if (deviation < 0) deviation = -deviation;
        if (deviation > int256(maxTickDeviation)) {
            revert PriceOutOfRange(spotTick, twapTick, maxTickDeviation);
        }
    }

    /// @dev Spends `wethAmount` buying the token into this vault.
    ///      The swap must deliver to the vault rather than straight to the burn address: pons tokens
    ///      reject a pool transfer whose recipient is the burn address (Uniswap surfaces this as
    ///      `TF`), even though an ordinary ERC-20 transfer to that same address succeeds. Burning is
    ///      therefore a separate step, see {_burnAllTokens}.
    function _buyback(uint256 wethAmount, uint256 amountOutMinimum) internal returns (uint256 bought) {
        IERC20(PonsAddresses.WETH).forceApprove(PonsAddresses.SWAP_ROUTER_02, wethAmount);

        bought = ISwapRouter02(PonsAddresses.SWAP_ROUTER_02)
            .exactInputSingle(
                ISwapRouter02.ExactInputSingleParams({
                tokenIn: PonsAddresses.WETH,
                tokenOut: token,
                fee: PonsAddresses.POOL_FEE,
                recipient: address(this),
                amountIn: wethAmount,
                amountOutMinimum: amountOutMinimum,
                sqrtPriceLimitX96: 0
            })
            );

        IERC20(PonsAddresses.WETH).forceApprove(PonsAddresses.SWAP_ROUTER_02, 0);
        emit BuybackExecuted(wethAmount, bought);
    }

    /// @dev Burns the vault's entire token balance, covering both bought tokens and token-side LP fees.
    function _burnAllTokens() internal returns (uint256 burned) {
        burned = IERC20(token).balanceOf(address(this));
        if (burned == 0) return 0;

        IERC20(token).safeTransfer(PonsAddresses.BURN_ADDRESS, burned);
        totalTokensBurned += burned;
        emit TokensBurned(burned);
    }

    function _twapTick(address poolAddress, uint32 window) private view returns (int24 tick, bool ok) {
        if (window == 0) return (0, false);

        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = window;
        secondsAgos[1] = 0;

        try IUniswapV3Pool(poolAddress).observe(secondsAgos) returns (
            int56[] memory tickCumulatives, uint160[] memory
        ) {
            int56 delta = tickCumulatives[1] - tickCumulatives[0];
            int56 windowInt = int56(uint56(window));
            int56 averaged = delta / windowInt;
            if (delta < 0 && delta % windowInt != 0) averaged--;
            // An average of observed ticks stays within Uniswap's [MIN_TICK, MAX_TICK] range,
            // which fits in int24 by construction.
            // forge-lint: disable-next-line(unsafe-typecast)
            tick = int24(averaged);
            ok = true;
        } catch {
            ok = false;
        }
    }

    uint256[45] private __gap;
}
