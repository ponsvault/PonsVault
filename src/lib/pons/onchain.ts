import { formatEther, type Hex } from 'viem';

import { PONS_LAUNCHPAD_ABI } from './abi';
import { robinhoodPublicClient } from './client';
import {
  PONS_CHAIN_ID,
  PONS_FACTORY,
  PONS_FACTORY_START_BLOCK,
  PONS_GRADUATION_ETH,
  PONS_LAUNCH_LOG_LOOKBACK,
  PONS_LOCKER,
  PONS_INITIAL_TICK,
  PONS_MAX_TX_BPS,
  PONS_MAX_WALLET_BPS,
  PONS_TOTAL_SUPPLY,
  PONS_WETH,
} from './constants';
import { PONS_TOKEN_ABI } from './token-state';
import type { PonsLaunchpadStatus, PonsLaunchRecord } from './types';

export { robinhoodPublicClient } from './client';

export async function fetchLaunchpadStatusFromChain(): Promise<PonsLaunchpadStatus> {
  const [launchEnabled, launchFeeWei] = await Promise.all([
    robinhoodPublicClient.readContract({
      address: PONS_FACTORY,
      abi: PONS_LAUNCHPAD_ABI,
      functionName: 'launchEnabled',
    }),
    robinhoodPublicClient.readContract({
      address: PONS_FACTORY,
      abi: PONS_LAUNCHPAD_ABI,
      functionName: 'launchFee',
    }),
  ]);

  return {
    chainId: PONS_CHAIN_ID,
    factory: PONS_FACTORY,
    locker: PONS_LOCKER,
    launchFeeEth: formatEther(launchFeeWei),
    launchFeeWei: launchFeeWei.toString(),
    graduationEth: PONS_GRADUATION_ETH,
    launchEnabled,
    totalSupply: PONS_TOTAL_SUPPLY,
    weth: PONS_WETH,
    pairToken: PONS_WETH,
    maxTxBps: PONS_MAX_TX_BPS,
    maxWalletBps: PONS_MAX_WALLET_BPS,
    initialTick: PONS_INITIAL_TICK,
  };
}

export async function fetchRecentLaunchesFromChain(
  limit = 24,
): Promise<PonsLaunchRecord[]> {
  const latest = await robinhoodPublicClient.getBlockNumber();
  const fromBlock =
    latest > PONS_LAUNCH_LOG_LOOKBACK
      ? latest - PONS_LAUNCH_LOG_LOOKBACK
      : PONS_FACTORY_START_BLOCK;

  const logs = await robinhoodPublicClient.getContractEvents({
    address: PONS_FACTORY,
    abi: PONS_LAUNCHPAD_ABI,
    eventName: 'TokenLaunched',
    fromBlock,
    toBlock: 'latest',
  });

  const recent = logs.slice(-limit).reverse();

  const records = await Promise.all(
    recent.map(async (log) => {
      const token = log.args.token as `0x${string}`;
      const block = await robinhoodPublicClient.getBlock({ blockNumber: log.blockNumber });

      let name = 'Unknown Token';
      let symbol = '???';
      let logo = '';
      try {
        const [tokenName, tokenSymbol, tokenLogo] = await Promise.all([
          robinhoodPublicClient.readContract({
            address: token,
            abi: PONS_TOKEN_ABI,
            functionName: 'name',
          }),
          robinhoodPublicClient.readContract({
            address: token,
            abi: PONS_TOKEN_ABI,
            functionName: 'symbol',
          }),
          robinhoodPublicClient.readContract({
            address: token,
            abi: PONS_TOKEN_ABI,
            functionName: 'logo',
          }),
        ]);
        name = tokenName;
        symbol = tokenSymbol;
        logo = tokenLogo;
      } catch {
        // Metadata may not be on the token contract yet.
      }

      return {
        token,
        name,
        symbol,
        description: '',
        logo,
        deployer: (log.args.deployer as string) ?? '',
        pool: (log.args.pool as string) ?? '',
        launchedAt: new Date(Number(block.timestamp) * 1000).toISOString(),
        marketCapUsd: null,
        priceUsd: null,
        graduated: false,
        graduationProgressPct: null,
        transactionHash: log.transactionHash as Hex,
      } satisfies PonsLaunchRecord;
    }),
  );

  return records;
}
