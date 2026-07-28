/**
 * Re-measures the curated RWA list against the chain as it is now.
 *
 * The list in src/lib/rwa/assets.ts records what was true when it was written,
 * and these pools are shallow enough that one withdrawal changes the answer.
 * Run this before trusting the picker.
 *
 *   npx tsx --conditions=react-server scripts/rwa-assets-health.ts
 */
import { formatEther, formatUnits } from 'viem';

import { ROUND_SIZE_WETH, assessAllAssets } from '@/lib/rwa/asset-health';

async function main() {
  const results = await assessAllAssets();

  console.log(`One round is ${formatEther(ROUND_SIZE_WETH)} WETH.\n`);
  console.log('  symbol   buys per round        impact at 10x   verdict');
  console.log('  ' + '-'.repeat(70));

  for (const health of results) {
    const buys = formatUnits(health.perRound, health.asset.decimals).slice(0, 16);
    console.log(
      `  ${health.asset.symbol.padEnd(8)} ${buys.padEnd(21)} ` +
        `${(Number(health.impactBps) / 100).toFixed(2).padStart(7)}%      ` +
        `${health.tradeable ? 'tradeable' : `NOT TRADEABLE — ${health.reason}`}`,
    );
  }

  const bad = results.filter((r) => !r.tradeable);
  if (bad.length > 0) {
    console.log(`\n${bad.length} curated asset(s) are no longer tradeable and should be removed.`);
    process.exitCode = 1;
  } else {
    console.log('\nEvery curated asset still converts a round at a sane price.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
