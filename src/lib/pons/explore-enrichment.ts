import { formatEther, formatUnits, type Address } from 'viem';

import { PONS_RWA_VAULT_ABI } from '@/lib/rwa/abi';
import { findRwaAsset } from '@/lib/rwa/assets';

import { robinhoodPublicClient } from './client';
import { PONS_TOTAL_SUPPLY } from './constants';
import { prefetchEquityTokenUsd } from './equity-usd';
import { resolveLaunchedToken, type ResolvedLaunch } from './factory';
import { readPoolMarketSnapshot } from './pricing';
import { resolveStickyGraduation } from './graduation-sticky';
import {
  readGraduationStatus,
  readTokenOnchainMetadata,
  type TokenOnchainMetadata,
} from './token-state';
import { isToken0Ordering } from './trades';
import type { PonsLaunchRecord, VaultStat } from './types';
import { PONS_LOTTERY_VAULT_ABI } from '@/lib/lottery/abi';
import { findV2PairToken } from './v2-deployments';
import { readV2CurveMarketSnapshot } from './v2-pricing';

import { PONS_STAKING_VAULT_ABI, PONS_VAULT_ABI } from './vault-state';

const EMPTY_METADATA: TokenOnchainMetadata = {
  name: '',
  symbol: '',
  decimals: 18,
  logo: '',
  description: '',
  pool: '0x0000000000000000000000000000000000000000',
  socials: {
    twitter: '',
    telegram: '',
    discord: '',
    website: '',
    farcaster: '',
  },
};

/**
 * The headline number for a launch's vault, or null when it has none.
 *
 * Read here rather than on the client so an explore card can show what a vault
 * has actually done without every card opening its own RPC connection.
 */
async function readVaultStat(
  vault: string | null | undefined,
  knownTemplate?: string | null,
): Promise<{ vaultStat: VaultStat | null }> {
  if (!vault) return { vaultStat: null };
  const address = vault as Address;

  try {
    const template =
      knownTemplate === 'rwa' ||
      knownTemplate === 'staking' ||
      knownTemplate === 'lottery' ||
      knownTemplate === 'buyback-burn'
        ? knownTemplate
        : await robinhoodPublicClient
            .readContract({ address, abi: PONS_VAULT_ABI, functionName: 'template' })
            .catch(() => 'buyback-burn');

    // An RWA vault pays out a stock rather than the launch's own token, so it is
    // measured in that stock's units and a share of the token supply says
    // nothing about it. Reading `totalTokensBurned` here would simply revert.
    if (template === 'rwa') {
      const [config, distributed, pending] = await Promise.all([
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
        robinhoodPublicClient
          .readContract({
            address,
            abi: PONS_RWA_VAULT_ABI,
            functionName: 'pendingQuote',
          })
          .catch(async () => {
            // Pre-upgrade beacons: idle quote + escrow only.
            try {
              const [idle, escrow] = await Promise.all([
                robinhoodPublicClient.readContract({
                  address,
                  abi: PONS_RWA_VAULT_ABI,
                  functionName: 'idleBalances',
                }),
                robinhoodPublicClient.readContract({
                  address,
                  abi: PONS_RWA_VAULT_ABI,
                  functionName: 'pendingEscrowQuote',
                }),
              ]);
              return idle[0] + escrow;
            } catch {
              return 0n;
            }
          }),
      ]);

      const asset = findRwaAsset(config[0]);
      const decimals = asset?.decimals ?? 18;
      const unit = asset?.symbol ?? 'stock';

      // Prefer live fees waiting — Explore used to only show paid-out rounds,
      // which looked empty even when the curve had accrued creator fees.
      if (pending > 0n) {
        return {
          vaultStat: {
            kind: 'dividend',
            amount: formatUnits(pending, decimals),
            percent: 0,
            unit,
            verb: 'fees waiting',
          },
        };
      }

      return {
        vaultStat: {
          kind: 'dividend',
          amount: formatUnits(distributed, decimals),
          percent: 0,
          unit,
          verb: 'paid out',
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

    // When nothing has been burned/staked yet, surface accrued quote fees so
    // v2 cards are not stuck on "Nothing burned yet" while the curve has fees.
    if (amountWei === 0n) {
      const pending = await robinhoodPublicClient
        .readContract({
          address,
          abi: [
            {
              type: 'function',
              name: 'pendingQuote',
              stateMutability: 'view',
              inputs: [],
              outputs: [{ type: 'uint256' }],
            },
          ] as const,
          functionName: 'pendingQuote',
        })
        .catch(async () => {
          try {
            const idle = await robinhoodPublicClient.readContract({
              address,
              abi: PONS_VAULT_ABI,
              functionName: 'idleBalances',
            });
            return idle[0];
          } catch {
            return 0n;
          }
        });

      if (pending > 0n) {
        const quoteAsset = await robinhoodPublicClient
          .readContract({
            address,
            abi: [
              {
                type: 'function',
                name: 'quoteAsset',
                stateMutability: 'view',
                inputs: [],
                outputs: [{ type: 'address' }],
              },
            ] as const,
            functionName: 'quoteAsset',
          })
          .catch(() => null);
        const quoteSymbol = quoteAsset
          ? (findRwaAsset(quoteAsset)?.symbol ??
            findV2PairToken(quoteAsset)?.symbol)
          : null;

        return {
          vaultStat: {
            kind: template === 'staking' ? 'stake' : 'burn',
            amount: formatEther(pending),
            percent: 0,
            unit: quoteSymbol ?? 'fees',
            verb: 'fees waiting',
          },
        };
      }
    }

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
  preResolved?: ResolvedLaunch | null,
): Promise<PonsLaunchRecord> {
  const token = launch.token as Address;

  try {
    const resolved =
      preResolved !== undefined
        ? preResolved
        : await resolveLaunchedToken(token).catch(() => null);

    const isV2 = resolved?.kind === 'v2';
    // v2 cards only need the curve from the factory row — skip the heavy
    // token metadata multicall (name/logo/socials/pool) that Explore already
    // has from the registry.
    const metadata = isV2
      ? EMPTY_METADATA
      : await readTokenOnchainMetadata(token);

    const isToken0 = resolved?.launched.isToken0 ?? isToken0Ordering(token);
    // v2 factory does not return supply — treat 0 as unset.
    const supplyWei =
      resolved?.launched.supply && resolved.launched.supply > 0n
        ? resolved.launched.supply
        : BigInt(PONS_TOTAL_SUPPLY);
    const factory = resolved?.factory;

    const v2Curve =
      isV2 && resolved?.launched.curve ? resolved.launched.curve : null;

    const emptyMarket = {
      priceInWeth: 0,
      priceUsd: 0,
      marketCapUsd: 0,
      fdvUsd: 0,
      ethUsd: 0,
    };

    const [marketOrCurve, vaultStats] = await Promise.all([
      v2Curve
        ? readV2CurveMarketSnapshot({
            curve: v2Curve,
            pairToken: resolved!.launched.pairedToken,
            supplyWei,
          }).catch(() => ({
            ...emptyMarket,
            progress: 0,
            graduated: false,
            priceInQuote: 0,
          }))
        : !isV2 && metadata.pool
          ? readPoolMarketSnapshot({
              pool: metadata.pool,
              isToken0,
              supplyWei,
            }).catch(() => emptyMarket)
          : Promise.resolve(emptyMarket),
      readVaultStat(launch.vault, launch.vaultTemplate),
    ]);

    const market = marketOrCurve;
    const rawGraduation =
      v2Curve && 'progress' in marketOrCurve
        ? {
            pairedPrincipal: 0n,
            threshold: 0n,
            graduated: Boolean(marketOrCurve.graduated),
            progress: marketOrCurve.progress,
          }
        : !isV2 && factory
          ? await readGraduationStatus(token, factory).catch(() => ({
              pairedPrincipal: 0n,
              threshold: 0n,
              graduated: false,
              progress: 0,
            }))
          : {
              pairedPrincipal: 0n,
              threshold: 0n,
              graduated: false,
              progress: 0,
            };

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
      marketCapUsd: market.marketCapUsd > 0 ? market.marketCapUsd : null,
      priceUsd: market.priceUsd > 0 ? market.priceUsd : null,
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
  // Resolve each launch's factory row once — reuse for pricing + enrichment.
  const resolved = await Promise.all(
    launches.map((launch) =>
      resolveLaunchedToken(launch.token as Address).catch(() => null),
    ),
  );
  await prefetchEquityTokenUsd(
    resolved
      .filter((row) => row?.kind === 'v2')
      .map((row) => row!.launched.pairedToken),
  );

  return Promise.all(
    launches.map((launch, index) => enrichLaunchRecord(launch, resolved[index])),
  );
}
