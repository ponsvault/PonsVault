import { formatEther } from 'viem';

import { PONS_TOTAL_SUPPLY } from './constants';
import { formatDuration } from './vault-state';

/** Wei strings arrive from the API; a malformed one should read as zero, not throw. */
export function toBigInt(value: string | null | undefined): bigint {
  if (!value) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

export function formatWeth(value: bigint): string {
  const amount = Number(formatEther(value));
  if (amount === 0) return '0';
  if (amount < 0.0001) return '<0.0001';
  return amount.toFixed(4);
}

export function formatTokens(value: bigint): string {
  const amount = Number(formatEther(value));
  if (amount === 0) return '0';
  if (amount < 1) return amount.toPrecision(3);
  return Math.round(amount).toLocaleString('en-US');
}

export function supplyPercent(value: bigint): number {
  return (Number(value) / Number(PONS_TOTAL_SUPPLY)) * 100;
}

/**
 * How often a vault can act, in the creator's own configured terms.
 *
 * Both limits exist so a vault cannot be spammed into spending its fees on gas,
 * so they are stated together rather than as two opaque parameters.
 */
export function describeCadence(state: { cooldown: number; minHarvestWei: bigint }): string {
  const parts: string[] = [];
  parts.push(
    state.cooldown > 0
      ? `at most once every ${formatDuration(state.cooldown)}`
      : 'no enforced wait between runs',
  );
  if (state.minHarvestWei > 0n) {
    parts.push(`once at least ${formatWeth(state.minHarvestWei)} WETH has accrued`);
  }
  return parts.join(', ');
}
