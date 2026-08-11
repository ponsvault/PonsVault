import { hexToString, trim, type Address, type Hex } from 'viem';

import { robinhoodPublicClient } from '@/lib/pons/client';
import { PONSVAULT_DEPLOYMENT } from '@/lib/pons/deployments';
import { PONS_TOKEN_ABI } from '@/lib/pons/token-state';
import { PONSVAULT_LAUNCHER_ABI, type VaultTemplateId } from '@/lib/pons/vault';
import {
  PONSVAULT_V2_DEPLOYMENT,
  isV2VaultLauncherDeployed,
} from '@/lib/pons/v2-deployments';
import {
  PONSVAULT_V2_LAUNCHER_ABI,
  PONS_V2_VAULT_FACTORY_ABI,
} from '@/lib/pons/v2-vault';

export interface DiscoveredLaunch {
  token: Address;
  vault: Address;
  creator: Address;
  /** On-chain token deployer when known; otherwise the emitting launcher. */
  deployer: Address;
  vaultTemplate: VaultTemplateId;
  name: string;
  symbol: string;
  transactionHash: Hex;
  launchedAt: string;
}

type HydrateInput = {
  token: Address;
  vault: Address;
  creator: Address;
  vaultTemplate: VaultTemplateId;
  deployer: Address;
  transactionHash: Hex;
  blockNumber: bigint | null;
};

const DISCOVERY_TTL_MS = 60_000;
let discoveryCache: { at: number; launches: DiscoveredLaunch[] } | null = null;

function templateFromBytes32(id: Hex): VaultTemplateId {
  const raw = hexToString(trim(id, { dir: 'right' }));
  if (raw === 'staking' || raw === 'lottery' || raw === 'rwa' || raw === 'buyback-burn') {
    return raw;
  }
  return 'buyback-burn';
}

async function hydrateLaunch(params: HydrateInput): Promise<DiscoveredLaunch> {
  const [name, symbol, block] = await Promise.all([
    robinhoodPublicClient
      .readContract({
        address: params.token,
        abi: PONS_TOKEN_ABI,
        functionName: 'name',
      })
      .catch(() => 'Unknown'),
    robinhoodPublicClient
      .readContract({
        address: params.token,
        abi: PONS_TOKEN_ABI,
        functionName: 'symbol',
      })
      .catch(() => '???'),
    params.blockNumber != null
      ? robinhoodPublicClient.getBlock({ blockNumber: params.blockNumber })
      : Promise.resolve(null),
  ]);

  return {
    token: params.token,
    vault: params.vault,
    creator: params.creator,
    deployer: params.deployer,
    vaultTemplate: params.vaultTemplate,
    name,
    symbol,
    transactionHash: params.transactionHash,
    launchedAt: block
      ? new Date(Number(block.timestamp) * 1000).toISOString()
      : new Date().toISOString(),
  };
}

async function collectHydrateInputs(): Promise<HydrateInput[]> {
  const inputs: HydrateInput[] = [];
  const seen = new Set<string>();

  const push = (input: HydrateInput) => {
    const key = input.token.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    inputs.push(input);
  };

  const scans: Array<Promise<void>> = [];

  scans.push(
    (async () => {
      try {
        const logs = await robinhoodPublicClient.getContractEvents({
          address: PONSVAULT_DEPLOYMENT.launcher as Address,
          abi: PONSVAULT_LAUNCHER_ABI,
          eventName: 'Launched',
          fromBlock: PONSVAULT_DEPLOYMENT.startBlock,
          toBlock: 'latest',
        });

        for (const log of logs) {
          const { token, vault, creator, templateId } = log.args;
          if (!token || !vault || !creator || !templateId) continue;
          push({
            token,
            vault,
            creator,
            vaultTemplate: templateFromBytes32(templateId),
            deployer: PONSVAULT_DEPLOYMENT.launcher as Address,
            transactionHash: log.transactionHash!,
            blockNumber: log.blockNumber ?? null,
          });
        }
      } catch {
        // Discovery is best-effort — recorded rows still load.
      }
    })(),
  );

  if (isV2VaultLauncherDeployed()) {
    scans.push(
      (async () => {
        try {
          const logs = await robinhoodPublicClient.getContractEvents({
            address: PONSVAULT_V2_DEPLOYMENT.launcher as Address,
            abi: PONSVAULT_V2_LAUNCHER_ABI,
            eventName: 'Launched',
            fromBlock: PONSVAULT_V2_DEPLOYMENT.startBlock,
            toBlock: 'latest',
          });

          for (const log of logs) {
            const { token, vault, creator, templateId } = log.args;
            if (!token || !vault || !creator || !templateId) continue;
            push({
              token,
              vault,
              creator,
              vaultTemplate: templateFromBytes32(templateId),
              deployer: PONSVAULT_V2_DEPLOYMENT.launcher as Address,
              transactionHash: log.transactionHash!,
              blockNumber: log.blockNumber ?? null,
            });
          }
        } catch {
          // Same: do not fail Explore because one RPC range timed out.
        }
      })(),
    );

    const factories: Array<{ address: string; template: VaultTemplateId }> = [
      { address: PONSVAULT_V2_DEPLOYMENT.buybackFactory, template: 'buyback-burn' },
      { address: PONSVAULT_V2_DEPLOYMENT.stakingFactory, template: 'staking' },
      { address: PONSVAULT_V2_DEPLOYMENT.rwaFactory, template: 'rwa' },
    ];

    for (const { address, template } of factories) {
      if (!address || address.length !== 42) continue;
      scans.push(
        (async () => {
          try {
            const logs = await robinhoodPublicClient.getContractEvents({
              address: address as Address,
              abi: PONS_V2_VAULT_FACTORY_ABI,
              eventName: 'VaultCreated',
              fromBlock: PONSVAULT_V2_DEPLOYMENT.startBlock,
              toBlock: 'latest',
            });

            for (const log of logs) {
              const { token, vault, creator } = log.args;
              if (!token || !vault || !creator) continue;
              // Creator called createVault and is therefore the on-chain token deployer.
              push({
                token,
                vault,
                creator,
                vaultTemplate: template,
                deployer: creator,
                transactionHash: log.transactionHash!,
                blockNumber: log.blockNumber ?? null,
              });
            }
          } catch {
            // Best-effort per factory.
          }
        })(),
      );
    }
  }

  await Promise.all(scans);
  return inputs;
}

/**
 * Launches the database never recorded, read from launcher / vault-factory events.
 *
 * Explore used to trust `ponsvault_launches` alone. A failed insert — for example
 * the live check constraint rejecting `staking` — left a working vault invisible
 * on the site. The keeper already scans these events; Explore needs the same net.
 *
 * Current launches go user → factory (user is deployer) → vault factory. Older
 * launches went through the shared launcher contracts.
 *
 * Results are cached briefly — Explore polls every ~20s and re-scanning the full
 * event history each time dominated TTFB.
 */
export async function discoverLaunchesOnChain(): Promise<DiscoveredLaunch[]> {
  if (discoveryCache && Date.now() - discoveryCache.at < DISCOVERY_TTL_MS) {
    return discoveryCache.launches;
  }

  const inputs = await collectHydrateInputs();
  const launches = await Promise.all(inputs.map((input) => hydrateLaunch(input)));

  discoveryCache = { at: Date.now(), launches };
  return launches;
}
