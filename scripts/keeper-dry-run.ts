/**
 * What the keeper would do right now, without doing any of it.
 *
 * Runs the real decision path — same discovery, same simulation, same
 * thresholds — and stops immediately before the write. Nothing is signed and
 * nothing is broadcast, so this is safe to run against production at any time.
 *
 *   npx tsx --env-file=.env.local scripts/keeper-dry-run.ts
 */
import { runDueVaults } from '@/lib/keeper/run-vaults';

const label: Record<string, string> = {
  'would-run': 'WOULD RUN',
  throttled: 'throttled',
  'not-ready': 'waiting  ',
  uneconomic: 'skipped  ',
  failed: 'FAILED   ',
  ran: 'ran      ',
};

async function main() {
  const result = await runDueVaults({ dryRun: true });

  console.log(
    `keeper ${result.keeper} · ${Number(result.balance).toFixed(6)} ETH · checked ${result.checked}\n`,
  );

  for (const outcome of result.outcomes) {
    const head = `  ${label[outcome.status] ?? outcome.status} ${(outcome.symbol || '???').padEnd(11)}`;

    switch (outcome.status) {
      case 'would-run':
        console.log(`${head} ${outcome.weth} WETH harvested, ${outcome.tokens} tokens moved`);
        break;
      case 'throttled':
        console.log(`${head} next run allowed in ${outcome.nextRunIn}s`);
        break;
      case 'uneconomic':
        console.log(`${head} ${outcome.weth} WETH does not clear ${outcome.gasCost} ETH of gas`);
        break;
      default:
        console.log(`${head} ${'reason' in outcome ? outcome.reason : ''}`);
    }
  }

  const ready = result.outcomes.filter((o) => o.status === 'would-run').length;
  console.log(`\n${ready} vault(s) would run on the next real tick.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
