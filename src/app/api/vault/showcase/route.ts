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

/**
 * Live stats for the landing-page $VAULT mock.
 *
 * Lifetime totals come from the vault; the "recent runs" strip is rebuilt from
 * the latest BuybackExecuted / TokensBurned logs so the hero never shows
 * invented PONSV numbers.
 */
export async function GET() {
  const { token, vault, symbol, pairSymbol } = SHOWCASE_VAULT_TOKEN;

  try {
    const state = await fetchVaultState(robinhoodPublicClient, token);
    if (!state || state.template !== 'buyback-burn') {
      return NextResponse.json({ error: 'Showcase vault is not a buyback vault.' }, { status: 503 });
    }

    const latestBlock = await robinhoodPublicClient.getBlockNumber();
    const fromBlock = latestBlock > 2_000_000n ? latestBlock - 2_000_000n : 0n;

    const [burnLogs, buybackLogs] = await Promise.all([
      robinhoodPublicClient.getLogs({
        address: vault,
        event: {
          type: 'event',
          name: 'TokensBurned',
          inputs: [{ name: 'amount', type: 'uint256', indexed: false }],
        },
        fromBlock,
        toBlock: latestBlock,
      }),
      robinhoodPublicClient.getLogs({
        address: vault,
        event: {
          type: 'event',
          name: 'BuybackExecuted',
          inputs: [
            { name: 'wethSpent', type: 'uint256', indexed: false },
            { name: 'tokensBought', type: 'uint256', indexed: false },
          ],
        },
        fromBlock,
        toBlock: latestBlock,
      }),
    ]);

    const lastBurns = burnLogs.slice(-2).reverse();
    const lastBuy = buybackLogs.at(-1);

    const recentBlocks = [
      ...lastBurns.map((l) => l.blockNumber),
      ...(lastBuy ? [lastBuy.blockNumber] : []),
    ];
    const uniqueBlocks = [...new Set(recentBlocks.filter((b): b is bigint => b != null))];
    const blockTimes = new Map<string, number>();
    await Promise.all(
      uniqueBlocks.map(async (bn) => {
        const block = await robinhoodPublicClient.getBlock({ blockNumber: bn });
        blockTimes.set(bn.toString(), Number(block.timestamp));
      }),
    );

    const now = Math.floor(Date.now() / 1000);
    const runs: {
      time: string;
      label: string;
      value: string;
      unit: string;
      burn: boolean;
    }[] = [];

    for (const log of lastBurns) {
      const amount = log.args.amount ?? 0n;
      const ts = blockTimes.get((log.blockNumber ?? 0n).toString()) ?? now;
      runs.push({
        time: relativeClock(now - ts),
        label: 'Burned',
        value: compactTokenAmount(amount),
        unit: symbol,
        burn: true,
      });
    }

    if (lastBuy) {
      const spent = lastBuy.args.wethSpent ?? 0n;
      const ts = blockTimes.get((lastBuy.blockNumber ?? 0n).toString()) ?? now;
      runs.push({
        time: relativeClock(now - ts),
        label: 'Bought',
        value: formatEthAmount(spent),
        unit: pairSymbol,
        burn: false,
      });
    }

    const lastBurnAmount = lastBurns[0]?.args.amount ?? 0n;
    const lastBuySpent = lastBuy?.args.wethSpent ?? 0n;

    return NextResponse.json(
      {
        token,
        vault,
        symbol,
        pairSymbol,
        burnBps: state.burnBps,
        treasuryBps: 10_000 - state.burnBps,
        minHarvest: formatEthAmount(state.minHarvestWei),
        pending: formatEthAmount(state.pendingWeth),
        runCount: state.runCount.toString(),
        totalBurned: compactTokenAmount(state.totalTokensBurned),
        totalBurnedRaw: state.totalTokensBurned.toString(),
        totalHarvested: formatEthAmount(state.totalWethHarvested),
        totalTreasuryPaid: formatEthAmount(state.totalTreasuryPaid),
        canRun: state.canRun,
        lastRunAt: Number(state.lastRunAt),
        runs: runs.slice(0, 3),
        float: {
          title: state.runCount > 0n ? 'Keeper ran vault' : 'Vault waiting',
          body:
            state.runCount > 0n && lastBurnAmount > 0n
              ? `Burned ${compactTokenAmount(lastBurnAmount)} ${symbol} from ${formatEthAmount(lastBuySpent)} ${pairSymbol}`
              : `${compactTokenAmount(state.totalTokensBurned)} ${symbol} burned across ${state.runCount.toString()} runs`,
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

/** Compact clock label for the recent-runs strip (matches the mock's HH:MM feel). */
function relativeClock(ageSeconds: number): string {
  if (ageSeconds < 0) ageSeconds = 0;
  if (ageSeconds < 3600) {
    const m = Math.max(1, Math.floor(ageSeconds / 60));
    return `${String(m).padStart(2, '0')}:00`;
  }
  if (ageSeconds < 86_400) {
    const h = Math.floor(ageSeconds / 3600);
    return `${String(h).padStart(2, '0')}:00`;
  }
  const d = Math.floor(ageSeconds / 86_400);
  return `${d}d`;
}