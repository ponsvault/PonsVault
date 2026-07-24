// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IUniswapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IUniswapV3Pool {
    function token0() external view returns (address);

    function token1() external view returns (address);

    function liquidity() external view returns (uint128);

    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );

    /// @notice Cumulative tick and liquidity values at each `secondsAgos` offset.
    /// @dev Reverts with `OLD` when the requested window predates the oldest stored observation.
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);

    /// @notice Grow the oracle ring buffer so a TWAP window becomes available. Permissionless.
    function increaseObservationCardinalityNext(uint16 observationCardinalityNext) external;
}

/// @dev The Robinhood Chain router at 0xCaf681a6... is SwapRouter02, so `ExactInputSingleParams`
///      has no `deadline` field. Verified by selector: it exposes 0x04e45aaf, not 0x414bf389.
interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut);
}
