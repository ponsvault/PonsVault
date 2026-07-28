// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/token/ERC20/IERC20.sol";

import {PonsAddresses} from "../src/PonsAddresses.sol";
import {ISwapRouter02} from "../src/interfaces/IUniswapV3.sol";

/// @dev Answers the questions that decide whether an RWA vault is buildable at all,
///      before any of it is written.
///
///      Stock tokens are tokenised debt securities, so the risk is not liquidity but
///      permission: if the token gates transfers to allowlisted holders, a vault can
///      neither receive nor distribute one and the whole template is dead. Nothing in
///      the docs says either way, so this buys the answer on a fork rather than
///      discovering it after the contracts are written.
contract RwaFeasibilityForkTest is Test {
    address constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address constant WETH = PonsAddresses.WETH;
    ISwapRouter02 constant ROUTER = ISwapRouter02(PonsAddresses.SWAP_ROUTER_02);

    /// The deepest NVDA/WETH pool at the time of writing.
    uint24 constant NVDA_FEE = 500;

    address contractHolder;
    address randomUser;

    function setUp() public {
        vm.createSelectFork("robinhood");
        contractHolder = address(this);
        randomUser = makeAddr("randomUser");
    }

    function _buyNvda(address recipient, uint256 wethIn) internal returns (uint256 out) {
        deal(WETH, address(this), wethIn);
        IERC20(WETH).approve(address(ROUTER), wethIn);

        out = ROUTER.exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: WETH,
                tokenOut: NVDA,
                fee: NVDA_FEE,
                recipient: recipient,
                amountIn: wethIn,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );
    }

    /// @dev The core question: can a plain contract buy a stock token and hold it?
    function test_contractCanBuyAndHoldNvda() public {
        uint256 out = _buyNvda(contractHolder, 0.025 ether);

        console.log("NVDA bought with 0.025 WETH:", out);
        assertGt(out, 0, "swap produced no NVDA");
        assertEq(IERC20(NVDA).balanceOf(contractHolder), out, "contract cannot hold NVDA");
    }

    /// @dev And can it pay one out, which is what any dividend template must do?
    function test_contractCanTransferNvdaToAnEoa() public {
        uint256 out = _buyNvda(contractHolder, 0.025 ether);

        assertTrue(IERC20(NVDA).transfer(randomUser, out), "transfer returned false");
        assertEq(IERC20(NVDA).balanceOf(randomUser), out, "NVDA transfer to a user failed");
        assertEq(IERC20(NVDA).balanceOf(contractHolder), 0, "sender balance not reduced");
    }

    /// @dev Price impact at the size a vault actually runs at. If a routine run moved the
    ///      price several percent, the template would be unshippable regardless of permissions.
    function test_priceImpactAtRealisticRunSize() public {
        uint256 small = _buyNvda(contractHolder, 0.025 ether);

        // Rate from a tiny trade, as a stand-in for the undisturbed price.
        uint256 baseline = _buyNvda(randomUser, 0.001 ether) * 25;

        console.log("0.025 WETH bought      :", small);
        console.log("25x of a 0.001 WETH buy:", baseline);

        // Allow a wide band: this records the shape of the market, it is not a promise.
        assertGt(small, (baseline * 90) / 100, "0.025 WETH run costs more than 10% to slippage");
    }

    /// @dev What a larger, overdue run would look like against this pool.
    function test_priceImpactAtTenTimesTheFloor() public {
        uint256 out = _buyNvda(contractHolder, 0.25 ether);
        console.log("0.25 WETH bought NVDA  :", out);
        assertGt(out, 0, "larger buy failed outright");
    }
}
