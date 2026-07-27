import { formatEther } from 'viem';

import { PONS_TOTAL_SUPPLY } from './constants';

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
 * There is no clock in the answer because there is none in the contract: a run
 * spends the whole balance, so the floor alone decides how often one can
 * happen. Busy tokens act often, quiet ones rarely, and neither needs a timer.
 */
export function describeCadence(state: { minHarvestWei: bigint }): string {
  if (state.minHarvestWei === 0n) {
    return 'whenever any fees have accrued';
  }
  return `each time ${formatWeth(state.minHarvestWei)} WETH accrues`;
}
