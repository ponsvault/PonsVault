import { NextResponse } from 'next/server';

import { enrichLaunchRecords } from '@/lib/pons/explore-enrichment';
import { listPonsShareLaunches } from '@/lib/launch-registry/store';
import { listClaimedFeeShareWalletKeys } from '@/lib/fee-share/registry';
import { feeShareWalletKey } from '@/lib/fee-share/social';

export async function GET(request: Request) {
  try {
    const limit = Number(new URL(request.url).searchParams.get('limit') ?? '48');
    const [launches, claimedWalletKeys] = await Promise.all([
      listPonsShareLaunches(Number.isFinite(limit) ? limit : 48),
      listClaimedFeeShareWalletKeys().catch(() => new Set<string>()),
    ]);
    const base = launches.map((launch) => ({
      token: launch.token,
      name: launch.name,
      symbol: launch.symbol,
      description: launch.description,
      logo: launch.logo,
      deployer: launch.deployer,
      feeWallet: launch.feeWallet,
      feeSharePlatform:
        launch.feeSharePlatform === 'twitter' || launch.feeSharePlatform === 'github'
          ? launch.feeSharePlatform
          : null,
      feeShareHandle: launch.feeShareHandle ?? null,
      feeWalletClaimed:
        launch.feeSharePlatform && launch.feeShareHandle
          ? claimedWalletKeys.has(
              feeShareWalletKey(launch.feeSharePlatform, launch.feeShareHandle),
            )
          : false,
      launchedAt: launch.launchedAt,
      transactionHash: launch.transactionHash,
    }));
    const enriched = await enrichLaunchRecords(base);
    return NextResponse.json(enriched);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load launches' },
      { status: 500 },
    );
  }
}
