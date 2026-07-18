import { parseAbiItem, type Address } from 'viem';

import { robinhoodPublicClient } from './client';

const SLOT0_ABI = [
  parseAbiItem(
    'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  ),
];

export async function fetchEthUsd(): Promise<number> {
  try {
    const res = await fetch('https://coins.llama.fi/prices/current/coingecko:ethereum', {
      next: { revalidate: 60 },
    });
    if (!res.ok) return 0;
    const data = (await res.json()) as {
      coins?: Record<string, { price?: number }>;
    };
    return data.coins?.['coingecko:ethereum']?.price ?? 0;
  } catch {
    return 0;
  }
}

export function priceInWethFromSqrtPriceX96(sqrtPriceX96: bigint, isToken0: boolean): number {
  const ratio = Number(sqrtPriceX96) / 2 ** 96;
  const token1PerToken0 = ratio * ratio;
  return isToken0 ? token1PerToken0 : 1 / token1PerToken0;
}

export interface PoolMarketSnapshot {
  priceInWeth: number;
  priceUsd: number;
  marketCapUsd: number;
  fdvUsd: number;
  ethUsd: number;
  sqrtPriceX96: string;
}

export async function readPoolMarketSnapshot(params: {
  pool: Address;
  isToken0: boolean;
  supplyWei: bigint;
}): Promise<PoolMarketSnapshot> {
  const [slot0, ethUsd] = await Promise.all([
    robinhoodPublicClient.readContract({
      address: params.pool,
      abi: SLOT0_ABI,
      functionName: 'slot0',
    }),
    fetchEthUsd(),
  ]);

  const sqrtPriceX96 = slot0[0];
  const priceInWeth = priceInWethFromSqrtPriceX96(sqrtPriceX96, params.isToken0);
  const priceUsd = priceInWeth * ethUsd;
  const supplyTokens = Number(params.supplyWei) / 1e18;
  const marketCapUsd = priceUsd * supplyTokens;

  return {
    priceInWeth,
    priceUsd,
    marketCapUsd,
    fdvUsd: marketCapUsd,
    ethUsd,
    sqrtPriceX96: sqrtPriceX96.toString(),
  };
}
