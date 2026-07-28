import { parseEther, type Address } from 'viem';

import { robinhoodPublicClient } from '@/lib/pons/client';
import { PONS_QUOTER_V2, PONS_WETH } from '@/lib/pons/contracts';
import { RpcUnavailableError, isRevert } from '@/lib/pons/rpc-errors';

import { CURATED_RWA_ASSETS, type RwaAsset } from './assets';

/**
 * Live tradeability checks for the curated assets.
 *
 * Split from the list itself so the launch form can import the three names
 * without dragging an RPC client into the browser bundle: the list is a
 * constant, while everything here needs the chain.
 */

/** The keeper's floor, and so the smallest round a vault will ever buy. */
export const ROUND_SIZE_WETH = parseEther('0.025');

/**
 * A round ten times the floor.
 *
 * Comparing the price of this against the floor is what exposes a pool that
 * looks fine on a small quote but has nothing behind it. Depth is only
 * meaningful relative to the trade being made.
 */
const STRESS_SIZE_WETH = parseEther('0.25');

/** Above this, a round loses more to price impact than the dividend is worth. */
const MAX_IMPACT_BPS = 500n;

const QUOTER_ABI = [
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    stateMutability: 'nonpayable',
    inputs: [
      {
        type: 'tuple',
        name: 'params',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'fee', type: 'uint24' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
] as const;

/**
 * What `amountIn` of WETH would actually buy.
 *
 * Null means the pool cannot fill it: an empty pool reverts, and nothing else
 * here does. An {@link RpcUnavailableError} means we do not know, which is a
 * different thing and must not be shown to a creator as a verdict.
 */
export async function quoteRound(asset: RwaAsset, amountIn: bigint): Promise<bigint | null> {
  try {
    const { result } = await robinhoodPublicClient.simulateContract({
      address: PONS_QUOTER_V2,
      abi: QUOTER_ABI,
      functionName: 'quoteExactInputSingle',
      args: [
        {
          tokenIn: PONS_WETH,
          tokenOut: asset.address,
          amountIn,
          fee: asset.poolFee,
          sqrtPriceLimitX96: 0n,
        },
      ],
    });
    return result[0];
  } catch (error) {
    // A pool with nothing in it reverts rather than quoting zero.
    if (isRevert(error)) return null;
    throw new RpcUnavailableError(`quote a round of ${asset.symbol}`, error);
  }
}

/**
 * What `amountIn` of an asset would fetch back in WETH right now.
 *
 * The mirror of {@link quoteRound}, for valuing RWA a vault already holds. It
 * reads slightly low against what was paid, because it crosses the spread and
 * the pool fee a second time — which is the right direction for a keeper
 * deciding whether a round is worth its gas.
 */
export async function quoteToWeth(
  asset: Address,
  poolFee: number,
  amountIn: bigint,
): Promise<bigint | null> {
  if (amountIn <= 0n) return 0n;

  try {
    const { result } = await robinhoodPublicClient.simulateContract({
      address: PONS_QUOTER_V2,
      abi: QUOTER_ABI,
      functionName: 'quoteExactInputSingle',
      args: [
        {
          tokenIn: asset,
          tokenOut: PONS_WETH,
          amountIn,
          fee: poolFee,
          sqrtPriceLimitX96: 0n,
        },
      ],
    });
    return result[0];
  } catch (error) {
    if (isRevert(error)) return null;
    throw new RpcUnavailableError('value a round in WETH', error);
  }
}

export interface RwaAssetHealth {
  asset: RwaAsset;
  /** What one floor-sized round buys right now. */
  perRound: bigint;
  /** How much worse the price gets at ten times the size, in basis points. */
  impactBps: bigint;
  tradeable: boolean;
  /**
   * True when the check could not be run at all.
   *
   * Distinct from `tradeable: false`, which is a measurement. Callers must not
   * describe this as a property of the pool, and should not cache it.
   */
  unknown?: boolean;
  reason?: string;
}

/**
 * Measures an asset against the chain as it is right now.
 *
 * The curated list is a record of what was true when it was written, and a pool
 * can be drained after that. Since a vault's asset is fixed forever at launch,
 * this is what should gate the choice at the moment it is made.
 */
export async function assessAsset(asset: RwaAsset): Promise<RwaAssetHealth> {
  let floor: bigint | null;
  let stress: bigint | null;
  try {
    [floor, stress] = await Promise.all([
      quoteRound(asset, ROUND_SIZE_WETH),
      quoteRound(asset, STRESS_SIZE_WETH),
    ]);
  } catch (error) {
    if (!(error instanceof RpcUnavailableError)) throw error;
    return {
      asset,
      perRound: 0n,
      impactBps: 0n,
      tradeable: false,
      unknown: true,
      reason: 'Could not check liquidity just now. This says nothing about the stock — retrying.',
    };
  }

  if (floor === null || floor === 0n) {
    return {
      asset,
      perRound: 0n,
      impactBps: 0n,
      tradeable: false,
      reason: 'No liquidity: a round of fees cannot be converted into this asset at all.',
    };
  }

  if (stress === null || stress === 0n) {
    return {
      asset,
      perRound: floor,
      impactBps: MAX_IMPACT_BPS + 1n,
      tradeable: false,
      reason: 'The pool cannot absorb a larger round, so payouts would shrink as fees grow.',
    };
  }

  // Price per WETH at each size. A deep pool gives nearly the same rate for
  // both; a thin one pays far worse for the larger trade.
  const scale = STRESS_SIZE_WETH / ROUND_SIZE_WETH;
  const expected = floor * scale;
  const impactBps = expected > stress ? ((expected - stress) * 10_000n) / expected : 0n;

  const tradeable = impactBps <= MAX_IMPACT_BPS;

  return {
    asset,
    perRound: floor,
    impactBps,
    tradeable,
    reason: tradeable
      ? undefined
      : `Liquidity is too thin: a larger round would lose ${Number(impactBps) / 100}% to price impact.`,
  };
}

export async function assessAllAssets(): Promise<RwaAssetHealth[]> {
  return Promise.all(CURATED_RWA_ASSETS.map(assessAsset));
}
