import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import type { SocialPlatform } from './types';
import { normalizeHandle, toCustomUserId } from './social';
import type { FeeShareWalletRecord } from './types';

export function createPlatformFeeWallet(
  platform: SocialPlatform,
  handle: string,
): Omit<FeeShareWalletRecord, 'launches'> {
  const normalized = normalizeHandle(handle);
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);

  return {
    platform,
    handle: normalized,
    customUserId: toCustomUserId(platform, normalized),
    walletAddress: account.address,
    privateKey,
    privyUserId: null,
    privyWalletId: null,
    linkedAt: null,
    createdAt: new Date().toISOString(),
  };
}
