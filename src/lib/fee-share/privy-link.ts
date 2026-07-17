import { getPrivyServerClient } from '@/lib/fee-share/privy-server';
import { upsertFeeShareWallet } from '@/lib/fee-share/registry';
import type { FeeShareWalletRecord } from '@/lib/fee-share/types';

function externalIdFromCustomUserId(customUserId: string): string {
  return customUserId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

export async function linkFeeWalletToPrivyUser(
  record: FeeShareWalletRecord,
  privyUserId: string,
): Promise<FeeShareWalletRecord> {
  if (record.privyUserId === privyUserId && record.privyWalletId) {
    return record;
  }

  if (!record.privateKey) {
    throw new Error('Fee wallet is missing private key.');
  }

  const privateKey = record.privateKey as `0x${string}`;
  const privy = getPrivyServerClient();

  const wallet = await privy.wallets().import({
    wallet: {
      private_key: privateKey,
      chain_type: 'ethereum',
      entropy_type: 'private-key',
      address: record.walletAddress,
    },
    owner: { user_id: privyUserId },
    external_id: externalIdFromCustomUserId(record.customUserId),
  });

  return upsertFeeShareWallet({
    ...record,
    privyUserId,
    privyWalletId: wallet.id,
    linkedAt: new Date().toISOString(),
  });
}
