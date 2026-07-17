import type {
  LookupFeeShareWalletResponse,
  ResolveFeeShareWalletResponse,
  SocialPlatform,
} from './types';

export async function resolveSocialFeeWallet(
  platform: SocialPlatform,
  handle: string,
): Promise<ResolveFeeShareWalletResponse> {
  const res = await fetch('/api/fee-share/wallet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform, handle }),
  });
  const data = (await res.json()) as ResolveFeeShareWalletResponse & { error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Failed to resolve social fee wallet');
  return data;
}

export async function lookupSocialFeeWallet(
  platform: SocialPlatform,
  handle: string,
): Promise<LookupFeeShareWalletResponse> {
  const query = new URLSearchParams({ platform, handle });
  const res = await fetch(`/api/fee-share/wallet?${query.toString()}`, { cache: 'no-store' });
  const data = (await res.json()) as LookupFeeShareWalletResponse & { error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Failed to look up social fee wallet');
  return data;
}

export interface AppLaunchRecord {
  token: string;
  name: string;
  symbol: string;
  logo: string;
  transactionHash: string;
  launchedAt: string;
  feeShareHandle: string | null;
  feeSharePlatform?: 'twitter' | 'github' | null;
  feeClaimed?: boolean;
  feeClaimedAt?: string | null;
  feeClaimTxHash?: string | null;
}

export interface ClaimProfileResponse {
  walletAddress: string;
  twitterHandle: string | null;
  githubHandle: string | null;
  socialPlatform: 'twitter' | 'github' | null;
  socialHandle: string | null;
  customUserId: string | null;
  launches: AppLaunchRecord[];
  registryMatch: boolean;
  privyLinked: boolean;
  linkedAt: string | null;
  privyWalletId: string | null;
  privyUserId: string;
}

export async function recordFeeClaim(
  privyAccessToken: string,
  input: {
    token: string;
    platform: 'twitter' | 'github';
    handle: string;
    claimTransactionHash?: string;
  },
): Promise<void> {
  const res = await fetch('/api/fee-share/claims/record', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${privyAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Failed to record fee claim');
}

export async function fetchClaimProfile(privyAccessToken: string): Promise<ClaimProfileResponse> {
  const res = await fetch('/api/fee-share/claim', {
    headers: { Authorization: `Bearer ${privyAccessToken}` },
    cache: 'no-store',
  });
  const data = (await res.json()) as ClaimProfileResponse & { error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Failed to load claim profile');
  return data;
}

export const isPrivyConfigured = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);
