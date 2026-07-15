import { NextResponse } from 'next/server';

import { listPonsShareLaunches } from '@/lib/launch-registry/store';
import type { PonsLaunchRecord } from '@/lib/pons/types';

function toExploreRecord(launch: Awaited<ReturnType<typeof listPonsShareLaunches>>[number]): PonsLaunchRecord {
  return {
    token: launch.token,
    name: launch.name,
    symbol: launch.symbol,
    description: launch.description,
    logo: launch.logo,
    deployer: launch.deployer,
    pool: '',
    launchedAt: launch.launchedAt,
    marketCapUsd: null,
    priceUsd: null,
    graduated: false,
    graduationProgressPct: null,
    transactionHash: launch.transactionHash,
  };
}

export async function GET(request: Request) {
  try {
    const limit = Number(new URL(request.url).searchParams.get('limit') ?? '48');
    const launches = await listPonsShareLaunches(Number.isFinite(limit) ? limit : 48);
    return NextResponse.json(launches.map(toExploreRecord));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load launches' },
      { status: 500 },
    );
  }
}
