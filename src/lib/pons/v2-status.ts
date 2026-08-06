import { createPublicClient, formatEther, http, parseAbi } from 'viem';

import { robinhoodChain } from './chain';
import { ROBINHOOD_RPC_URL } from './constants';
import {
  findV2PairToken,
  isV2VaultLauncherDeployed,
  PONS_V2,
  PONS_V2_PAIR_TOKENS,
  PONSVAULT_V2_DEPLOYMENT,
  type V2PairToken,
} from './v2-deployments';

const factoryAbi = parseAbi([
  'function launchEnabled() view returns (bool)',
  'function canLaunch(address) view returns (bool)',
  'function whitelistedLaunchers(address) view returns (bool)',
  'function approvedPairTokens(address) view returns (bool)',
  'function pairTokenEconomics(address) view returns (uint256 phantomQuote, uint256 graduationThreshold, uint8 decimals)',
  'function launchFee() view returns (uint256)',
  'function maxCreatorTaxBps() view returns (uint256)',
]);

const launcherAbi = parseAbi([
  'function canLaunch() view returns (bool ready, string reason)',
]);

const buybackFactoryAbi = parseAbi([
  'function defaultBuyback() view returns (address)',
]);

export type ApprovedPairToken = V2PairToken & {
  approved: boolean;
  graduationThreshold: string;
  phantomQuote: string;
};

export type PonsV2Status = {
  factory: string;
  launchEnabled: boolean;
  launchFeeWei: string;
  launchFeeEth: string;
  maxCreatorTaxBps: number;
  /** All curated pairs, with live approval + economics. */
  pairTokens: ApprovedPairToken[];
  nativeApproved: boolean;
  wethApproved: boolean;
  vaultLauncher: string | null;
  vaultLauncherWhitelisted: boolean | null;
  vaultCanLaunch: boolean;
  vaultCanLaunchReason: string;
  publicReady: boolean;
  /** Live `defaultBuyback` on the buyback factory — required for burn runs. */
  defaultBuyback: string | null;
  buybackHelperReady: boolean;
};

export async function fetchPonsV2Status(): Promise<PonsV2Status> {
  const client = createPublicClient({
    chain: robinhoodChain,
    transport: http(ROBINHOOD_RPC_URL),
  });

  const factory = PONS_V2.factory as `0x${string}`;
  const zero = '0x0000000000000000000000000000000000000000' as const;
  const weth = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73' as const;

  const [launchEnabled, publicCanLaunch, launchFee, maxTax, nativeApproved, wethApproved] =
    await Promise.all([
      client.readContract({ address: factory, abi: factoryAbi, functionName: 'launchEnabled' }),
      client.readContract({
        address: factory,
        abi: factoryAbi,
        functionName: 'canLaunch',
        args: ['0x1111111111111111111111111111111111111111'],
      }),
      client.readContract({ address: factory, abi: factoryAbi, functionName: 'launchFee' }),
      client.readContract({ address: factory, abi: factoryAbi, functionName: 'maxCreatorTaxBps' }),
      client.readContract({
        address: factory,
        abi: factoryAbi,
        functionName: 'approvedPairTokens',
        args: [zero],
      }),
      client.readContract({
        address: factory,
        abi: factoryAbi,
        functionName: 'approvedPairTokens',
        args: [weth],
      }),
    ]);

  const pairTokens: ApprovedPairToken[] = await Promise.all(
    PONS_V2_PAIR_TOKENS.map(async (pair) => {
      const address = pair.address as `0x${string}`;
      const [approved, economics] = await Promise.all([
        client.readContract({
          address: factory,
          abi: factoryAbi,
          functionName: 'approvedPairTokens',
          args: [address],
        }),
        client.readContract({
          address: factory,
          abi: factoryAbi,
          functionName: 'pairTokenEconomics',
          args: [address],
        }),
      ]);
      const [phantomQuote, graduationThreshold] = economics;
      return {
        ...pair,
        approved: approved && phantomQuote > 0n && graduationThreshold > 0n,
        phantomQuote: phantomQuote.toString(),
        graduationThreshold: graduationThreshold.toString(),
      };
    }),
  );

  const launcherDeployed = isV2VaultLauncherDeployed();
  const launcher = launcherDeployed
    ? (PONSVAULT_V2_DEPLOYMENT.launcher as `0x${string}`)
    : null;

  let vaultLauncherWhitelisted: boolean | null = null;
  let vaultCanLaunch = false;
  let vaultCanLaunchReason = launcherDeployed
    ? 'Launcher deployed — checking permissions'
    : 'V2 vault launcher not deployed yet';

  if (launcher) {
    vaultLauncherWhitelisted = await client.readContract({
      address: factory,
      abi: factoryAbi,
      functionName: 'whitelistedLaunchers',
      args: [launcher],
    });

    try {
      const [ready, reason] = await client.readContract({
        address: launcher,
        abi: launcherAbi,
        functionName: 'canLaunch',
      });
      vaultCanLaunch = ready;
      vaultCanLaunchReason = reason || (ready ? 'Ready' : 'Not ready');
    } catch {
      const factoryAllows = await client.readContract({
        address: factory,
        abi: factoryAbi,
        functionName: 'canLaunch',
        args: [launcher],
      });
      vaultCanLaunch = factoryAllows;
      vaultCanLaunchReason = factoryAllows ? 'Ready' : 'Factory canLaunch(launcher) is false';
    }
  }

  let defaultBuyback: string | null = null;
  try {
    const buyback = await client.readContract({
      address: PONSVAULT_V2_DEPLOYMENT.buybackFactory as `0x${string}`,
      abi: buybackFactoryAbi,
      functionName: 'defaultBuyback',
    });
    defaultBuyback = buyback;
  } catch {
    defaultBuyback = null;
  }

  const buybackHelperReady =
    !!defaultBuyback && defaultBuyback !== '0x0000000000000000000000000000000000000000';

  return {
    factory,
    launchEnabled,
    launchFeeWei: launchFee.toString(),
    launchFeeEth: formatEther(launchFee),
    maxCreatorTaxBps: Number(maxTax),
    pairTokens,
    nativeApproved,
    wethApproved,
    vaultLauncher: launcher,
    vaultLauncherWhitelisted,
    vaultCanLaunch,
    vaultCanLaunchReason,
    publicReady: launchEnabled && publicCanLaunch,
    defaultBuyback,
    buybackHelperReady,
  };
}

export function defaultV2PairAddress(status?: PonsV2Status | null): string {
  const live = status?.pairTokens.find((p) => p.approved);
  if (live) return live.address;
  return findV2PairToken(PONS_V2_PAIR_TOKENS[0].address)?.address ?? PONS_V2_PAIR_TOKENS[0].address;
}
