import { hexToString, trim, type Address, type Hex } from 'viem';

import { robinhoodPublicClient } from '@/lib/pons/client';
import { PONSVAULT_DEPLOYMENT } from '@/lib/pons/deployments';
import { PONS_TOKEN_ABI } from '@/lib/pons/token-state';
import { PONSVAULT_LAUNCHER_ABI, type VaultTemplateId } from '@/lib/pons/vault';

export interface DiscoveredLaunch {
  token: Address;
  vault: Address;
  creator: Address;
  vaultTemplate: VaultTemplateId;
  name: string;
  symbol: string;
  transactionHash: Hex;
  launchedAt: string;
}

function templateFromBytes32(id: Hex): VaultTemplateId {
  const raw = hexToString(trim(id, { dir: 'right' }));
  if (raw === 'staking' || raw === 'lottery' || raw === 'rwa-tax' || raw === 'buyback-burn') {
    return raw;
  }
  return 'buyback-burn';
}

/**
 * Launches the database never recorded, read from the launcher's own events.
 *
 * Explore used to trust `ponsvault_launches` alone. A failed insert — for example
 * the live check constraint rejecting `staking` — left a working vault invisible
 * on the site. The keeper already scans these events; Explore needs the same net.
 */
export async function discoverLaunchesOnChain(): Promise<DiscoveredLaunch[]> {
  try {
    const logs = await robinhoodPublicClient.getContractEvents({
      address: PONSVAULT_DEPLOYMENT.launcher as Address,
      abi: PONSVAULT_LAUNCHER_ABI,
      eventName: 'Launched',
      fromBlock: PONSVAULT_DEPLOYMENT.startBlock,
      toBlock: 'latest',
    });

    const launches: DiscoveredLaunch[] = [];
    for (const log of logs) {
      const { token, vault, creator, templateId } = log.args;
      if (!token || !vault || !creator || !templateId) continue;

      const [name, symbol, block] = await Promise.all([
        robinhoodPublicClient
          .readContract({ address: token, abi: PONS_TOKEN_ABI, functionName: 'name' })
          .catch(() => 'Unknown'),
        robinhoodPublicClient
          .readContract({ address: token, abi: PONS_TOKEN_ABI, functionName: 'symbol' })
          .catch(() => '???'),
        log.blockNumber != null
          ? robinhoodPublicClient.getBlock({ blockNumber: log.blockNumber })
          : Promise.resolve(null),
      ]);

      launches.push({
        token,
        vault,
        creator,
        vaultTemplate: templateFromBytes32(templateId),
        name,
        symbol,
        transactionHash: log.transactionHash!,
        launchedAt: block
          ? new Date(Number(block.timestamp) * 1000).toISOString()
          : new Date().toISOString(),
      });
    }
    return launches;
  } catch {
    return [];
  }
}
