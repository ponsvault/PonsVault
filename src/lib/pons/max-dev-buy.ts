import { formatEther } from 'viem';

import { getSqrtRatioAtTick } from './tick-math';
import type { PonsLaunchpadStatus } from './types';

const Q192 = 2n ** 192n;

/** Max developer buy in wei — matches pons launch wallet cap math. */
export function computeMaxDevBuyWei(status: PonsLaunchpadStatus): bigint {
  if (!status.totalSupply || status.initialTick == null) return 0n;

  try {
    const totalSupply = BigInt(status.totalSupply);
    const maxWalletBps = status.maxWalletBps;

    if (totalSupply <= 0n || maxWalletBps <= 0 || status.initialTick === 0) return 0n;

    const walletCap = (totalSupply * BigInt(maxWalletBps)) / 10_000n;
    const sqrtRatio = getSqrtRatioAtTick(status.initialTick);
    return (walletCap * sqrtRatio * sqrtRatio) / Q192;
  } catch {
    return 0n;
  }
}

export function formatMaxDevBuyEth(status: PonsLaunchpadStatus): string {
  const wei = computeMaxDevBuyWei(status);
  if (wei === 0n) return '0';
  const eth = Number(formatEther(wei));
  if (!Number.isFinite(eth)) return '0';
  return eth.toFixed(4).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
}
