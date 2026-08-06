import { formatEther, formatUnits } from 'viem';
import { NextResponse } from 'next/server';

import { robinhoodPublicClient } from '@/lib/pons/client';
import { SHOWCASE_VAULT_TOKEN } from '@/lib/pons/showcase-vault';
import { fetchVaultState } from '@/lib/pons/vault-state';

export const dynamic = 'force-dynamic';

function compactTokenAmount(value: bigint, decimals = 18): string {
  const n = Number(formatUnits(value, decimals));
  if (!Number.isFinite(n)) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  if (n >= 1) return n.toFixed(2);
  return n.toPrecision(3);
}

function formatEthAmount(value: bigint): string {
  const n = Number(formatEther(value));
  if (!Number.isFinite(n) || n === 0) return '0';
  if (n >= 1) return n.toFixed(3);
  if (n >= 0.01) return n.toFixed(3);
  return n.toFixed(4);
}

function ageLabel(ageSeconds: number): string {
  if (ageSeconds < 0) ageSeconds = 0;
  if (ageSeconds < 60) return 'just now';
  if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)}m ago`;
  if (ageSeconds < 86_400) return `${Math.floor(ageSeconds / 3600)}h ago`;
  const days = Math.floor(ageSeconds / 86_400);
  return `${days}d ago`;
}

/**
 * Live stats for the landing-page $VAULT panel.
 *
 * Lifetime totals from the vault contract — not inventing "recent runs" from
 * those same totals when event logs are out of range.
 */
export async function GET() {
  const { token, symbol, pairSymbol } = SHOWCASE_VAULT_TOKEN;

  try {
    const state = await fetchVaultState(robinhoodPublicClient, token);
    if (!state || state.template !== 'buyback-burn') {
      return NextResponse.json({ error: 'Showcase vault is not a buyback vault.' }, { status: 503 });
    }

    const now = Math.floor(Date.now() / 1000);
    const lastRunAt = Number(state.lastRunAt);
    const lastRunLabel = lastRunAt > 0 ? ageLabel(now - lastRunAt) : 'never';

    const rows = [
      {
        label: 'Burned',
        value: compactTokenAmount(state.totalTokensBurned),
        unit: symbol,
        burn: true,
      },
      {
        label: 'Harvested',
        value: formatEthAmount(state.totalWethHarvested),
        unit: pairSymbol,
        burn: false,
      },
      {
        label: 'Treasury',
        value: formatEthAmount(state.totalTreasuryPaid),
        unit: pairSymbol,
        burn: false,
      },
    ];

    return NextResponse.json(
      {
        token,
        vault: state.vault,
        symbol,
        pairSymbol,
        burnBps: state.burnBps,
        treasuryBps: 10_000 - state.burnBps,
        minHarvest: formatEthAmount(state.minHarvestWei),
        pending: formatEthAmount(state.pendingWeth),
        runCount: state.runCount.toString(),
        totalBurned: compactTokenAmount(state.totalTokensBurned),
        totalHarvested: formatEthAmount(state.totalWethHarvested),
        totalTreasuryPaid: formatEthAmount(state.totalTreasuryPaid),
        canRun: state.canRun,
        lastRunAt,
        lastRunLabel,
        rows,
        float: {
          title: state.runCount > 0n ? 'Live vault' : 'Vault waiting',
          body: `${compactTokenAmount(state.totalTokensBurned)} ${symbol} burned · ${state.runCount.toString()} runs · last ${lastRunLabel}`,
        },
        href: `/launchpad/${token}`,
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Could not read showcase vault.',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
