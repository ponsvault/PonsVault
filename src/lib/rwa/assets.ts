import type { Address } from 'viem';

/**
 * The tokenized assets an RWA vault may be pointed at.
 *
 * Curated rather than open, because the vault contract only refuses a pool that
 * is completely empty and that is a much lower bar than being tradeable. Most
 * of the equities on this chain sit just above it: AAPL has 28,000 holders and
 * a WETH pool holding a few wei, TSLA's holds 0.007 WETH and cannot even be
 * quoted. A vault pointed at either would pass every check at launch, then
 * spend each round shoving the price up against itself and hand holders close
 * to nothing — and the parameters are immutable, so the creator could never fix
 * it. Offering only assets that have been measured is the difference between a
 * dividend and a slow leak.
 *
 * These tokens are traded mainly through Robinhood itself rather than on-chain,
 * so DEX depth here reflects what someone bothered to seed a pool with, not the
 * real market. It follows that this list is a snapshot: run
 * `scripts/rwa-equities.ts` to re-measure, and treat {assessAsset} as the
 * authority at launch time rather than this array.
 */
export interface RwaAsset {
  symbol: string;
  /** Issuer's name, as the token itself reports it. */
  name: string;
  address: Address;
  /** Deepest WETH tier at the time of measuring. */
  poolFee: number;
  decimals: number;
}

export const CURATED_RWA_ASSETS: readonly RwaAsset[] = [
  {
    symbol: 'GME',
    name: 'GameStop',
    address: '0x1b0E319c6A659F002271B69dB8A7df2F911c153E',
    poolFee: 500,
    decimals: 18,
  },
  {
    symbol: 'NVDA',
    name: 'NVIDIA',
    address: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC',
    poolFee: 500,
    decimals: 18,
  },
  {
    symbol: 'SPCX',
    name: 'SpaceX Class A',
    address: '0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa',
    poolFee: 500,
    decimals: 18,
  },
] as const;

export function findRwaAsset(address: string): RwaAsset | undefined {
  return CURATED_RWA_ASSETS.find((a) => a.address.toLowerCase() === address.toLowerCase());
}
