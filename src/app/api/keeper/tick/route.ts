import { NextResponse } from 'next/server';

import { runDueVaults } from '@/lib/keeper/run-vaults';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * One keeper pass, for a scheduler to call on an interval.
 *
 * Spends real gas from the keeper wallet, so it is gated on a shared secret
 * rather than being open the way the on-chain `run()` is. Blocking the route
 * does not block the burns: anyone can still call the vault directly.
 */
export async function GET(request: Request) {
  // CRON_SECRET is what a Vercel cron sends; KEEPER_SECRET covers every other
  // scheduler, including the CLI in scripts/keeper-tick.mjs.
  const accepted = [process.env.CRON_SECRET, process.env.KEEPER_SECRET]
    .map((value) => (value ?? '').trim())
    .filter(Boolean);

  if (accepted.length === 0) {
    return NextResponse.json({ error: 'Keeper is not configured.' }, { status: 503 });
  }

  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!accepted.includes(provided)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  try {
    const result = await runDueVaults();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Keeper tick failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
