export interface PonsLaunchpadStatus {
  chainId: number;
  factory: string;
  locker: string;
  launchFeeEth: string;
  launchFeeWei: string;
  graduationEth: number;
  launchEnabled: boolean;
  totalSupply: string;
  weth: string;
  pairToken: string;
  maxTxBps: number;
  maxWalletBps: number;
  initialTick?: number;
  restrictionBlocks?: number;
}

export interface PonsLaunchMetadata {
  name: string;
  symbol: string;
  logo: string;
  description: string;
  socials: {
    twitter: string;
    telegram: string;
    discord: string;
    website: string;
    farcaster: string;
  };
  feeWallet: `0x${string}`;
}

export interface PonsLaunchRecord {
  token: string;
  name: string;
  symbol: string;
  description: string;
  logo: string;
  deployer: string;
  feeWallet?: string;
  feeSharePlatform?: 'twitter' | 'github' | null;
  feeShareHandle?: string | null;
  feeWalletClaimed?: boolean;
  pool: string;
  launchedAt: string;
  marketCapUsd: number | null;
  priceUsd: number | null;
  graduated: boolean;
  graduationProgressPct: number | null;
  transactionHash: string;
}

import type { SocialPlatform } from '@/lib/fee-share/types';

export interface TokenDetailTrade {
  transactionHash: string;
  blockNumber: string;
  timestamp: number;
  side: 'buy' | 'sell';
  ethAmount: number;
  tokenAmount: number;
  priceUsd: number | null;
  trader: string;
}

export interface TokenDetailResponse {
  token: string;
  metadata: {
    name: string;
    symbol: string;
    decimals: number;
    logo: string;
    description: string;
    pool: string;
    socials: {
      twitter: string;
      telegram: string;
      discord: string;
      website: string;
      farcaster: string;
    };
  };
  launch: {
    factory: string;
    factoryKind: 'active' | 'legacy';
    deployer: string;
    pairedToken: string;
    isToken0: boolean;
    poolFee: number;
    supply: string;
    restrictionsEndBlock: string;
    initialBuyAmount: string;
    initialBuyEth: string;
  } | null;
  market: {
    priceInWeth: number;
    priceUsd: number;
    marketCapUsd: number;
    fdvUsd: number;
    ethUsd: number;
  };
  graduation: {
    pairedPrincipal: string;
    pairedPrincipalEth: string;
    threshold: string;
    thresholdEth: string;
    graduated: boolean;
    progress: number;
  };
  fees: {
    protocolSharePercent: number;
    creatorSharePercent: number;
    feeRedirect: string | null;
    creatorPayout: string;
    locker: string | null;
    creatorRewards: {
      grossToken: string;
      grossWeth: string;
      creatorToken: string;
      creatorWeth: string;
      payoutAddress: string;
      claimable: boolean;
      source: 'pons' | 'unavailable';
    } | null;
  };
  feeShare: {
    feeWallet: string;
    deployer: string;
    feeSharePlatform: 'twitter' | 'github' | null;
    feeShareHandle: string | null;
    walletClaimed: boolean;
  } | null;
  trades: TokenDetailTrade[];
}

export interface SwapQuoteResponse {
  side: 'buy' | 'sell';
  amountIn: string;
  amountOut: string;
  amountInFormatted: string;
  amountOutFormatted: string;
  priceImpactPct: number | null;
}

export interface LaunchFormInput {
  name: string;
  symbol: string;
  description: string;
  imageUri: string;
  twitter: string;
  telegram: string;
  website: string;
  devBuyEth: string;
  useFeeShare: boolean;
  feeShareMode: 'social' | 'wallet';
  feeSharePlatform: SocialPlatform;
  feeShareHandle: string;
  feeShareWallet: string;
}
