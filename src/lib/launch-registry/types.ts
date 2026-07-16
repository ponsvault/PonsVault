import type { SocialPlatform } from '@/lib/fee-share/types';

export interface PonsShareLaunchRecord {
  token: string;
  name: string;
  symbol: string;
  description: string;
  logo: string;
  deployer: string;
  feeWallet: string;
  feeSharePlatform?: SocialPlatform;
  feeShareHandle?: string;
  transactionHash: string;
  launchedAt: string;
}

export interface PonsShareLaunchRegistryFile {
  launches: PonsShareLaunchRecord[];
}
