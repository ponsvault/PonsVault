import type { FeeShareWalletRecord } from './types';

/** Privy-linked wallet only — ignores linked_at alone (blocks DB larp rows). */
export function isFeeShareWalletClaimed(
  wallet: Pick<
    FeeShareWalletRecord,
    'linkedAt' | 'privyUserId' | 'privyWalletId'
  > | null | undefined,
): boolean {
  if (!wallet?.linkedAt || !wallet.privyUserId || !wallet.privyWalletId) {
    return false;
  }

  return wallet.privyUserId.startsWith('did:privy:') && wallet.privyWalletId.length >= 8;
}

export function isFeeShareWalletClaimedRow(row: {
  linked_at: string | null;
  privy_user_id: string | null;
  privy_wallet_id: string | null;
}): boolean {
  return isFeeShareWalletClaimed({
    linkedAt: row.linked_at,
    privyUserId: row.privy_user_id,
    privyWalletId: row.privy_wallet_id,
  });
}
