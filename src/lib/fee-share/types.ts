export type SocialPlatform = 'twitter' | 'github' | 'tiktok' | 'twitch';

export interface FeeShareWalletRecord {
  id?: string;
  platform: SocialPlatform;
  handle: string;
  customUserId: string;
  walletAddress: `0x${string}`;
  privateKey?: string;
  privyUserId: string | null;
  privyWalletId: string | null;
  linkedAt: string | null;
  createdAt: string;
  launches: Array<{
    token: string;
    symbol: string;
    name: string;
    transactionHash: string;
    launchedAt: string;
  }>;
}

export interface FeeShareRegistryFile {
  wallets: FeeShareWalletRecord[];
}

export interface ResolveFeeShareWalletResponse {
  platform: SocialPlatform;
  handle: string;
  walletAddress: `0x${string}`;
  customUserId: string;
  privyUserId: string | null;
  privyWalletId: string | null;
  linkedAt: string | null;
  created: boolean;
}

export interface LookupFeeShareWalletResponse {
  exists: boolean;
  platform?: SocialPlatform;
  handle?: string;
  walletAddress?: `0x${string}`;
  customUserId?: string;
  privyUserId?: string | null;
  privyWalletId?: string | null;
  linkedAt?: string | null;
  created?: boolean;
}
