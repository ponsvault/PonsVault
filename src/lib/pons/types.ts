import type { VaultTemplateId } from './vault';

/**
 * A vault's headline number for list views.
 *
 * Templates measure themselves differently — one removes supply, another locks
 * it up — so the unit travels with the number rather than being assumed.
 */
export interface VaultStat {
  kind: 'burn' | 'stake' | 'dividend' | 'prize';
  /** Whole-token decimal string. */
  amount: string;
  /** Share of total supply, 0-100. Zero where the amount is not the launch's own token. */
  percent: number;
  /**
   * What `amount` is denominated in, when it is not the launch's own token.
   *
   * A dividend is paid in a stock, and a lottery prize in ETH, so neither the
   * launch's symbol nor a share of its supply describes it. Present only where
   * that applies.
   */
  unit?: string;
}

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
  vault?: string | null;
  vaultTemplate?: VaultTemplateId | null;
  /** What the vault has done so far, in whichever terms its template works in. */
  vaultStat?: VaultStat | null;
  pool: string;
  launchedAt: string;
  marketCapUsd: number | null;
  priceUsd: number | null;
  graduated: boolean;
  graduationProgressPct: number | null;
  transactionHash: string;
}

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
    factoryKind: 'active' | 'legacy' | 'v2';
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
  /**
   * Quote asset for a v2 launch (approved equity / USDG). Empty on legacy v1
   * launches that pair against WETH implicitly.
   */
  pairToken: string;
  /** Creator tax in bps for v2 launches (capped by factory.maxCreatorTaxBps). */
  creatorTaxBps: string;
  /** Which vault template to attach, or 'none' to keep fees in your wallet. */
  vaultTemplate: VaultTemplateId;
  /** Shared by every template, and the only thing pacing a vault. */
  vaultMinHarvestEth: string;
  /** Buyback & Burn only. */
  vaultBurnPercent: string;
  vaultTreasury: string;
  /** Staking only. Days a stake is locked, counted from the staker's deposit. */
  vaultStakingLockDays: string;
  /**
   * RWA Dividend only. Address of the tokenized stock fees are converted
   * into, which must be one of the curated assets and can never be changed.
   */
  vaultRwaAsset: string;
  /** Lottery only. Hours holders may enter after a pot opens. */
  vaultLotteryEntryHours: string;
  /** Lottery only. Minutes between the operator's commit and reveal. */
  vaultLotteryRevealMinutes: string;
}
