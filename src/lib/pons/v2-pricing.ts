import { formatUnits, parseAbi, zeroAddress, type Address } from 'viem';

import { robinhoodPublicClient } from './client';
import { PONS_QUOTER_V2, PONS_WETH } from './contracts';
import { fetchEquityTokenUsd } from './equity-usd';
import { fetchEthUsd, type PoolMarketSnapshot } from './pricing';
import { findV2PairToken } from './v2-deployments';

const CURVE_ABI = parseAbi([
  'function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)',
  'function realQuoteReserve() view returns (uint256)',
  'function graduationThreshold() view returns (uint256)',
  'function graduated() view returns (bool)',
]);

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

const FEE_TIERS = [500, 3000, 10000, 100] as const;

export interface V2CurveMarketSnapshot extends PoolMarketSnapshot {
  progress: number;
  graduated: boolean;
  priceInQuote: number;
}

export function isV2CurveMarketSnapshot(
  market: object,
): market is V2CurveMarketSnapshot {
  return (
    'progress' in market &&
    'graduated' in market &&
    'priceInQuote' in market
  );
}

/**
 * Spot price + graduation progress for a pre-pool v2 bonding curve.
 *
 * Docs: marginal price = quoteReserve / tokenReserve (phantom included).
 * Progress = realQuoteReserve / graduationThreshold.
 */
export async function readV2CurveMarketSnapshot(params: {
  curve: Address;
  pairToken: Address;
  supplyWei: bigint;
}): Promise<V2CurveMarketSnapshot> {
  const [reserves, realQuote, threshold, graduated, ethUsd, quoteUsd] =
    await Promise.all([
      robinhoodPublicClient.readContract({
        address: params.curve,
        abi: CURVE_ABI,
        functionName: 'getReserves',
      }),
      robinhoodPublicClient.readContract({
        address: params.curve,
        abi: CURVE_ABI,
        functionName: 'realQuoteReserve',
      }),
      robinhoodPublicClient.readContract({
        address: params.curve,
        abi: CURVE_ABI,
        functionName: 'graduationThreshold',
      }),
      robinhoodPublicClient
        .readContract({
          address: params.curve,
          abi: CURVE_ABI,
          functionName: 'graduated',
        })
        .catch(() => false),
      fetchEthUsd(),
      quoteTokenUsd(params.pairToken),
    ]);

  const [quoteReserve, tokenReserve] = reserves;
  const decimals = findV2PairToken(params.pairToken)?.decimals ?? 18;

  const priceInQuote =
    tokenReserve > 0n
      ? Number(formatUnits(quoteReserve, decimals)) /
        Number(formatUnits(tokenReserve, 18))
      : 0;

  const priceUsd = priceInQuote * quoteUsd;
  const supplyTokens = Number(formatUnits(params.supplyWei, 18));
  const marketCapUsd = priceUsd * supplyTokens;

  const progress =
    threshold > 0n ? Number((realQuote * 10_000n) / threshold) / 10_000 : 0;

  // Spot in WETH terms when we know quote→ETH (display helpers expect it).
  const priceInWeth = ethUsd > 0 ? priceUsd / ethUsd : 0;

  return {
    priceInWeth,
    priceUsd,
    marketCapUsd,
    fdvUsd: marketCapUsd,
    ethUsd,
    sqrtPriceX96: '0',
    progress: Math.min(Math.max(progress, 0), 1),
    graduated: Boolean(graduated) || (threshold > 0n && realQuote >= threshold),
    priceInQuote,
  };
}

/** USD per 1 whole unit of a v2 pair token. */
async function quoteTokenUsd(pairToken: Address): Promise<number> {
  // A curve on the factory's native path reports the zero address as its pair, and quotes in ETH
  // itself. Without this it falls through to the quoter, which has no pool for 0x0 and returns
  // nothing, leaving every ETH-paired launch priced at zero.
  if (pairToken === zeroAddress || pairToken.toLowerCase() === PONS_WETH.toLowerCase()) {
    return fetchEthUsd();
  }

  const pair = findV2PairToken(pairToken);
  if (pair?.symbol === 'USDG') return 1;

  // Chainlink first (works on Vercel); Robinhood REST is often blocked there.
  const equityUsd = await fetchEquityTokenUsd(pairToken);
  if (equityUsd > 0) return equityUsd;

  return quoteViaWeth(pairToken, pair?.decimals ?? 18);
}

async function quoteViaWeth(pairToken: Address, decimals: number): Promise<number> {
  const amountIn = 10n ** BigInt(decimals);
  const ethUsd = await fetchEthUsd();
  if (ethUsd <= 0) return 0;

  for (const fee of FEE_TIERS) {
    try {
      const { result } = await robinhoodPublicClient.simulateContract({
        address: PONS_QUOTER_V2,
        abi: QUOTER_ABI,
        functionName: 'quoteExactInputSingle',
        args: [
          {
            tokenIn: pairToken,
            tokenOut: PONS_WETH,
            amountIn,
            fee,
            sqrtPriceLimitX96: 0n,
          },
        ],
      });
      const wethOut = Number(formatUnits(result[0], 18));
      if (wethOut > 0) return wethOut * ethUsd;
    } catch {
      // try next fee tier
    }
  }

  return 0;
}
