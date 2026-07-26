#!/usr/bin/env node
/**
 * One keeper pass, for `cron`, a systemd timer, or CI.
 *
 * Drives GET /api/keeper/tick rather than importing the keeper directly, so it
 * needs no TypeScript toolchain and works against whichever deployment the
 * schedule should act on.
 *
 *   KEEPER_URL=https://… KEEPER_SECRET=… node scripts/keeper-tick.mjs
 *
 * Node reads .env.local for you: `node --env-file=.env.local scripts/keeper-tick.mjs`.
 *
 * Exits non-zero when the pass fails or a vault errors, but not when a vault is
 * simply not worth running yet, so scheduler alerts stay meaningful.
 */
const base = (process.env.KEEPER_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const secret = (process.env.KEEPER_SECRET ?? '').trim();

if (!secret) {
  console.error('KEEPER_SECRET is not set.');
  process.exit(1);
}

const response = await fetch(`${base}/api/keeper/tick`, {
  headers: { authorization: `Bearer ${secret}` },
});

const body = await response.json().catch(() => null);

if (!response.ok) {
  console.error(`Keeper tick failed (${response.status}): ${body?.error ?? 'no response body'}`);
  process.exit(1);
}

const stamp = new Date().toISOString();
console.log(
  `[${stamp}] keeper ${body.keeper} · ${body.balance} ETH · checked ${body.checked} · ran ${body.ran}`,
);

for (const outcome of body.outcomes) {
  if (outcome.status === 'ran') {
    const verb = outcome.template === 'staking' ? 'paid   ' : 'burned ';
    console.log(
      `  ${verb} ${outcome.symbol}: ${outcome.tokens} tokens and ${outcome.weth} WETH — ${outcome.hash}`,
    );
  } else if (outcome.status === 'throttled') {
    console.log(`  holding ${outcome.symbol}: next run allowed in ${outcome.nextRunIn}s`);
  } else if (outcome.status === 'below-floor') {
    console.log(
      `  holding ${outcome.symbol}: ${outcome.weth} WETH is under the ${outcome.floor} WETH floor`,
    );
  } else if (outcome.status === 'uneconomic') {
    console.log(
      `  skipped ${outcome.symbol}: ${outcome.weth} WETH does not clear the ${outcome.gasCost} ETH gas cost`,
    );
  } else if (outcome.status === 'failed') {
    console.error(`  FAILED  ${outcome.symbol}: ${outcome.reason}`);
  } else {
    console.log(`  waiting ${outcome.symbol}: ${outcome.reason}`);
  }
}

if (body.outcomes.some((outcome) => outcome.status === 'failed')) process.exit(1);
