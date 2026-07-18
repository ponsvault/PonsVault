import {
  encodeFunctionData,
  formatEther,
  parseAbi,
  parseEther,
  type Address,
  type Hex,
} from 'viem';

import { robinhoodPublicClient } from './client';
import { PONS_POOL_FEE, PONS_QUOTER_V2, PONS_SWAP_ROUTER, PONS_WETH } from './contracts';
import type { SwapQuoteResponse } from './types';

const QUOTER_ABI = parseAbi([
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) view returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
]);

const SWAP_ROUTER_ABI = parseAbi([
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)',
]);

const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
]);

function applySlippage(amountOut: bigint, bps = 100n): bigint {
  return (amountOut * (10_000n - bps)) / 10_000n;
}

export async function quoteSwap(params: {
  token: Address;
  side: 'buy' | 'sell';
  amount: string;
}): Promise<SwapQuoteResponse> {
  const amountIn = parseEther(params.amount);
  if (amountIn <= 0n) {
    throw new Error('Enter an amount greater than zero.');
  }

  const tokenIn = params.side === 'buy' ? PONS_WETH : params.token;
  const tokenOut = params.side === 'buy' ? params.token : PONS_WETH;

  const quote = await robinhoodPublicClient.readContract({
    address: PONS_QUOTER_V2,
    abi: QUOTER_ABI,
    functionName: 'quoteExactInputSingle',
    args: [
      {
        tokenIn,
        tokenOut,
        amountIn,
        fee: PONS_POOL_FEE,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });

  return {
    side: params.side,
    amountIn: amountIn.toString(),
    amountOut: quote[0].toString(),
    amountInFormatted: formatEther(amountIn),
    amountOutFormatted: formatEther(quote[0]),
    priceImpactPct: null,
  };
}

export function encodeExactInputSingle(params: {
  token: Address;
  side: 'buy' | 'sell';
  amountIn: bigint;
  amountOutMinimum: bigint;
  recipient: Address;
}): { to: Address; data: Hex; value: bigint } {
  const tokenIn = params.side === 'buy' ? PONS_WETH : params.token;
  const tokenOut = params.side === 'buy' ? params.token : PONS_WETH;

  return {
    to: PONS_SWAP_ROUTER,
    value: params.side === 'buy' ? params.amountIn : 0n,
    data: encodeFunctionData({
      abi: SWAP_ROUTER_ABI,
      functionName: 'exactInputSingle',
      args: [
        {
          tokenIn,
          tokenOut,
          fee: PONS_POOL_FEE,
          recipient: params.recipient,
          amountIn: params.amountIn,
          amountOutMinimum: params.amountOutMinimum,
          sqrtPriceLimitX96: 0n,
        },
      ],
    }),
  };
}

export function encodeTokenApproval(token: Address, amount: bigint): Hex {
  return encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [PONS_SWAP_ROUTER, amount],
  });
}

export async function readTokenAllowance(owner: Address, token: Address): Promise<bigint> {
  return robinhoodPublicClient.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [owner, PONS_SWAP_ROUTER],
  });
}

export { applySlippage };
