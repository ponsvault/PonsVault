import { formatEther, zeroAddress, type Address } from 'viem';

import { tryFetchPonsJson } from './pons-http';

export interface CreatorFeesSnapshot {
  grossToken: string;
  grossWeth: string;
  creatorToken: string;
  creatorWeth: string;
  protocolSharePercent: number;
  creatorSharePercent: number;
  payoutAddress: Address;
  claimable: boolean;
  source: 'pons' | 'unavailable';
}

interface PonsCreatorFeesResponse {
  grossToken: string;
  grossWeth: string;
  creatorToken: string;
  creatorWeth: string;
  protocolSharePercent: number;
  creatorSharePercent: number;
  payoutAddress: Address;
  claimable?: boolean;
  error?: string;
}

/** Same endpoint pons.family uses: `/api/pons-market/:token/creator-fees`. */
export async function fetchCreatorFees(token: Address): Promise<CreatorFeesSnapshot | null> {
  const data = await tryFetchPonsJson<PonsCreatorFeesResponse>(
    `/api/pons-market/${encodeURIComponent(token)}/creator-fees`,
  );

  if (!data || !('grossToken' in data)) {
    return null;
  }

  return {
    grossToken: data.grossToken,
    grossWeth: data.grossWeth,
    creatorToken: data.creatorToken,
    creatorWeth: data.creatorWeth,
    protocolSharePercent: data.protocolSharePercent,
    creatorSharePercent: data.creatorSharePercent,
    payoutAddress: data.payoutAddress,
    claimable: data.claimable ?? true,
    source: 'pons',
  };
}

export function formatAccruedTokenAmount(raw: string, symbol: string): string {
  const amount = Number(formatEther(BigInt(raw)));
  if (!Number.isFinite(amount) || amount <= 0) return `0 ${symbol}`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}M ${symbol}`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(2)}K ${symbol}`;
  if (amount >= 1) return `${amount.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${symbol}`;
  return `${amount.toFixed(6)} ${symbol}`;
}

export function formatAccruedWethAmount(raw: string): string {
  const amount = Number(formatEther(BigInt(raw)));
  if (!Number.isFinite(amount) || amount <= 0) return '0 WETH';
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: 8 })} WETH`;
}

export function hasClaimableCreatorFees(
  fees: Pick<CreatorFeesSnapshot, 'claimable' | 'creatorToken' | 'creatorWeth'> | null | undefined,
): boolean {
  if (!fees?.claimable) return false;
  return BigInt(fees.creatorToken) > 0n || BigInt(fees.creatorWeth) > 0n;
}

export function isCreatorFeeClaimant(
  wallet: string | undefined,
  deployer: Address,
  payoutAddress: Address,
  feeRedirect: Address | null,
): boolean {
  if (!wallet) return false;
  const normalized = wallet.toLowerCase();
  if (normalized === deployer.toLowerCase()) return true;
  const redirect = feeRedirect ?? payoutAddress;
  return redirect !== zeroAddress && normalized === redirect.toLowerCase();
}
