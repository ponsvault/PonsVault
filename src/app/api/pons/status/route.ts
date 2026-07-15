import { NextResponse } from 'next/server';

import { getDefaultLaunchpadStatus } from '@/lib/pons/constants';
import { fetchLaunchpadStatusFromChain } from '@/lib/pons/onchain';
import { tryFetchPonsJson } from '@/lib/pons/pons-http';
import type { PonsLaunchpadStatus } from '@/lib/pons/types';

export async function GET() {
  try {
    const indexed = await tryFetchPonsJson<PonsLaunchpadStatus>('/api/pons-launchpad-status');
    if (indexed) {
      return NextResponse.json(indexed);
    }

    try {
      const onchain = await fetchLaunchpadStatusFromChain();
      return NextResponse.json(onchain);
    } catch {
      return NextResponse.json(getDefaultLaunchpadStatus());
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load launchpad status' },
      { status: 500 },
    );
  }
}
