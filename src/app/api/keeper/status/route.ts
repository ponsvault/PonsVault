import { NextResponse } from 'next/server';

import { readKeeperStatus } from '@/lib/keeper/status';

export const dynamic = 'force-dynamic';

/**
 * Whether the keeper is alive, and what it last did.
 *
 * Open, unlike the tick route: this reads history rather than spending gas, and
 * everything it returns is already on-chain and public. Being open is the point —
 * an uptime monitor can watch it, and so can anyone who wants to check that the
 * vaults are actually being serviced rather than taking our word for it.
 *
 * Returns 503 when the keeper looks stale so a monitor can alert on the status
 * code alone, without parsing the body.
 */
export async function GET() {
  try {
    const status = await readKeeperStatus();
    return NextResponse.json(status, { status: status.healthy ? 200 : 503 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not read keeper status.';
    return NextResponse.json({ observed: false, healthy: false, reason: message }, { status: 500 });
  }
}
