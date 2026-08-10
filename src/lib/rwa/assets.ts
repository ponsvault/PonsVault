import type { Address } from 'viem';

import { PONS_V2_PAIR_TOKENS } from '@/lib/pons/v2-deployments';

/**
 * The tokenized assets an RWA vault may be pointed at.
 *
 * Two ways an asset can pay out:
 * 1. **Cross-asset** — fees arrive in the pair quote, then the vault buys this
 *    stock via WETH on Uniswap. Only deep WETH pools survive the live check.
 * 2. **Same-asset** — pair quote == dividend asset. The vault allocates fees as
 *    dividends with no swap (works even when the WETH pool is empty).
 *
 * Every equity that is also an approved v2 pair belongs here so creators can
 * always take the same-asset path. USDG is a stable, not a stock dividend, so
 * it stays pairing-only.
 *
 * DEX depth is measured at request time by {@link assessAsset}; this list is
 * not a liquidity guarantee.
 */
export interface RwaAsset {
  symbol: string;
  /** Issuer's name, as the token itself reports it. */
  name: string;
  address: Address;
  /** Preferred WETH fee tier when a swap route is required. */
  poolFee: number;
  decimals: number;
}

/** Pairing assets that are stocks (not USDG / stables). */
const EQUITY_PAIR_TOKENS = PONS_V2_PAIR_TOKENS.filter((p) => p.symbol !== 'USDG');

/**
 * Curated dividend targets = every equity pairing token, plus any stock we
 * want to offer via WETH buy that is not (yet) a pair.
 *
 * Built from the pair list so adding a new equity pair automatically unlocks
 * same-asset RWA dividends for it.
 */
export const CURATED_RWA_ASSETS: readonly RwaAsset[] = EQUITY_PAIR_TOKENS.map((pair) => ({
  symbol: pair.symbol,
  name: pair.name.replace(/\s*•\s*Robinhood Token\s*$/i, '').trim() || pair.name,
  address: pair.address as Address,
  poolFee: 500,
  decimals: pair.decimals,
}));

export function findRwaAsset(address: string): RwaAsset | undefined {
  return CURATED_RWA_ASSETS.find((a) => a.address.toLowerCase() === address.toLowerCase());
}

/**
 * When the launch quote asset is the same stock the vault pays out, the vault
 * allocates fees as-is — no Uniswap buy.
 */
export function isSameAssetRwaDividend(pairToken: string, rwaAsset: string): boolean {
  const pair = pairToken.trim().toLowerCase();
  const asset = rwaAsset.trim().toLowerCase();
  return pair.length === 42 && asset.length === 42 && pair === asset;
}
