import { formatEther, formatUnits, type Address } from 'viem';

import { PONS_RWA_VAULT_ABI } from '@/lib/rwa/abi';
import { findRwaAsset } from '@/lib/rwa/assets';

import { robinhoodPublicClient } from './client';
import { PONS_TOTAL_SUPPLY } from './constants';
import { resolveLaunchedToken } from './factory';
import { readPoolMarketSnapshot } from './pricing';
import { resolveStickyGraduation } from './graduation-sticky';
import { readGraduationStatus, readTokenOnchainMetadata } from './token-state';
import { isToken0Ordering } from './trades';
import type { PonsLaunchRecord, VaultStat } from './types';
import { PONS_LOTTERY_VAULT_ABI } from '@/lib/lottery/abi';

import { PONS_STAKING_VAULT_ABI, PONS_VAULT_ABI } from './vault-state';

/**
 * The headline number for a launch's vault, or null when it has none.
 *
 * Read here rather than on the client so an explore card can show what a vault
 * has actually done without every card opening its own RPC connection.
 */
async function readVaultStat(vault: string | null | undefined): Promise<{ vaultStat: VaultStat | null }> {
  if (!vault) return { vaultStat: null };
  const address = vault as Address;

  try {
    const template = await robinhoodPublicClient
      .readContract({ address, abi: PONS_VAULT_ABI, functionName: 'template' })
      .catch(() => 'buyback-burn');

    // An RWA vault pays out a stock rather than the launch's own token, so it is
    // measured in that stock's units and a share of the token supply says
    // nothing about it. Reading `totalTokensBurned` here would simply revert.
    if (template === 'rwa') {
      const [config, distributed] = await Promise.all([
        robinhoodPublicClient.readContract({
          address,
          abi: PONS_RWA_VAULT_ABI,
          functionName: 'config',
        }),
        robinhoodPublicClient.readContract({
          address,
          abi: PONS_RWA_VAULT_ABI,
          functionName: 'totalRwaDistributed',
        }),
      ]);

      const asset = findRwaAsset(config[0]);

      return {
        vaultStat: {
          kind: 'dividend',
          amount: formatUnits(distributed, asset?.decimals ?? 18),
          percent: 0,
          unit: asset?.symbol ?? 'stock',
        },
      };
    }

    if (template === 'lottery') {
      const paid = await robinhoodPublicClient.readContract({
        address,
        abi: PONS_LOTTERY_VAULT_ABI,
        functionName: 'totalPrizePaid',
      });
      return {
        vaultStat: {
          kind: 'prize',
          amount: formatEther(paid),
          percent: 0,
          unit: 'ETH',
        },
      };
    }

    const amountWei =
      template === 'staking'
        ? await robinhoodPublicClient.readContract({
            address,
            abi: PONS_STAKING_VAULT_ABI,
            functionName: 'totalStaked',
          })
        : await robinhoodPublicClient.readContract({
            address,
            abi: PONS_VAULT_ABI,
            functionName: 'totalTokensBurned',
          });

    return {
      vaultStat: {
        kind: template === 'staking' ? 'stake' : 'burn',
        amount: formatEther(amountWei),
        // Both sides are wei. PONS_TOTAL_SUPPLY is the fixed 1e9 × 1e18 supply.
        percent: (Number(amountWei) / Number(PONS_TOTAL_SUPPLY)) * 100,
      },
    };
  } catch {
    return { vaultStat: null };
  }
}

export async function enrichLaunchRecord(
  launch: Pick<
    PonsLaunchRecord,
    | 'token'
    | 'name'
    | 'symbol'
    | 'description'
    | 'logo'
    | 'deployer'
    | 'launchedAt'
    | 'transactionHash'
    | 'feeWallet'
    | 'vault'
    | 'vaultTemplate'
  > & { everGraduated?: boolean },
): Promise<PonsLaunchRecord> {
  const token = launch.token as Address;

  try {
    const [metadata, resolved] = await Promise.all([
      readTokenOnchainMetadata(token),
      resolveLaunchedToken(token),
    ]);

    const isToken0 = resolved?.launched.isToken0 ?? isToken0Ordering(token);
    const supplyWei = resolved?.launched.supply ?? BigInt(PONS_TOTAL_SUPPLY);
    const factory = resolved?.factory;

    const isV2 = resolved?.kind === 'v2';

    const [market, rawGraduation, vaultStats] = await Promise.all([
      // v2 curves are not Uniswap v3 pools — skip the v3 snapshot until graduated.
      !isV2 && metadata.pool
        ? readPoolMarketSnapshot({
            pool: metadata.pool,
            isToken0,
            supplyWei,
          }).catch(() => ({
            priceInWeth: 0,
            priceUsd: 0,
            marketCapUsd: 0,
            fdvUsd: 0,
            ethUsd: 0,
          }))
        : Promise.resolve({
            priceInWeth: 0,
            priceUsd: 0,
            marketCapUsd: 0,
            fdvUsd: 0,
            ethUsd: 0,
          }),
      !isV2 && factory
        ? readGraduationStatus(token, factory).catch(() => ({
            pairedPrincipal: 0n,
            threshold: 0n,
            graduated: false,
            progress: 0,
          }))
        : Promise.resolve({
            pairedPrincipal: 0n,
            threshold: 0n,
            graduated: false,
            progress: 0,
          }),
      readVaultStat(launch.vault),
    ]);

    const graduation = !isV2
      ? await resolveStickyGraduation({
          token,
          status: rawGraduation,
          pool: metadata.pool,
          everGraduated: launch.everGraduated,
          // Explore lists many tokens — seed/DB sticky only (peak scan on detail).
          checkPeak: false,
        })
      : rawGraduation;

    return {
      ...launch,
      ...vaultStats,
      pool: metadata.pool,
      marketCapUsd: market.marketCapUsd,
      priceUsd: market.priceUsd,
      graduated: graduation.graduated,
      // Graduated tokens always report 100% — current pool WETH can be lower.
      graduationProgressPct: graduation.graduated
        ? 100
        : Math.min(graduation.progress * 100, 100),
    };
  } catch {
    return {
      ...launch,
      pool: '',
      marketCapUsd: null,
      priceUsd: null,
      graduated: false,
      graduationProgressPct: null,
    };
  }
}

export async function enrichLaunchRecords(
  launches: Array<
    Pick<
      PonsLaunchRecord,
      | 'token'
      | 'name'
      | 'symbol'
      | 'description'
      | 'logo'
      | 'deployer'
      | 'launchedAt'
      | 'transactionHash'
      | 'feeWallet'
      | 'vault'
      | 'vaultTemplate'
    > & { everGraduated?: boolean }
  >,
): Promise<PonsLaunchRecord[]> {
  return Promise.all(launches.map((launch) => enrichLaunchRecord(launch)));
}
