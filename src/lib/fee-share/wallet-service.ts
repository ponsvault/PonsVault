import { createPlatformFeeWallet } from '@/lib/fee-share/platform-wallet';
import { getFeeShareWallet, upsertFeeShareWallet } from './registry';
import type { FeeShareWalletRecord, ResolveFeeShareWalletResponse, SocialPlatform } from './types';
import { normalizeHandle } from './social';

function toResolveResponse(
  record: FeeShareWalletRecord,
  created: boolean,
): ResolveFeeShareWalletResponse {
  return {
    platform: record.platform,
    handle: record.handle,
    walletAddress: record.walletAddress,
    customUserId: record.customUserId,
    privyUserId: record.privyUserId,
    privyWalletId: record.privyWalletId,
    linkedAt: record.linkedAt,
    created,
  };
}

/** Read-only lookup — never creates a wallet. */
export async function lookupFeeShareWallet(
  platform: SocialPlatform,
  handle: string,
): Promise<ResolveFeeShareWalletResponse | null> {
  const normalized = normalizeHandle(handle);
  const cached = await getFeeShareWallet(platform, normalized);
  return cached ? toResolveResponse(cached, false) : null;
}

/**
 * Returns an existing social fee wallet or creates one and persists it.
 * Safe to call repeatedly for the same platform + handle.
 */
export async function getOrCreateFeeShareWallet(
  platform: SocialPlatform,
  handle: string,
): Promise<ResolveFeeShareWalletResponse> {
  const normalized = normalizeHandle(handle);

  const existing = await getFeeShareWallet(platform, normalized);
  if (existing) {
    return toResolveResponse(existing, false);
  }

  const wallet = createPlatformFeeWallet(platform, normalized);

  try {
    const saved = await upsertFeeShareWallet({
      ...wallet,
      launches: [],
    });
    return toResolveResponse(saved, true);
  } catch {
    // Another request may have created the wallet first — fetch the winner.
    const raced = await getFeeShareWallet(platform, normalized);
    if (raced) {
      return toResolveResponse(raced, false);
    }
    throw new Error('Failed to create or load the social fee wallet.');
  }
}

/** @deprecated Use getOrCreateFeeShareWallet */
export const resolveFeeShareWallet = getOrCreateFeeShareWallet;
