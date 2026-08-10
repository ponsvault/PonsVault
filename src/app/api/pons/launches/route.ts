import { NextResponse } from 'next/server';

import { listPonsVaultLaunches } from '@/lib/launch-registry/store';
import { discoverLaunchesOnChain } from '@/lib/pons/discover-launches';
import { enrichLaunchRecords } from '@/lib/pons/explore-enrichment';
import type { VaultTemplateId } from '@/lib/pons/vault';

type ExploreLaunchBase = {
  token: string;
  name: string;
  symbol: string;
  description: string;
  logo: string;
  deployer: string;
  feeWallet: string;
  vault: string | null;
  vaultTemplate: VaultTemplateId | null;
  launchedAt: string;
  transactionHash: string;
  everGraduated?: boolean;
};

export async function GET(request: Request) {
  try {
    const limit = Number(new URL(request.url).searchParams.get('limit') ?? '48');
    const capped = Number.isFinite(limit) ? limit : 48;

    const [recorded, discovered] = await Promise.all([
      listPonsVaultLaunches(capped),
      discoverLaunchesOnChain(),
    ]);

    // Recorded rows win: they have the logo, description and fee wallet the
    // creator typed. On-chain discovery only fills gaps the insert missed.
    const byToken = new Map<string, ExploreLaunchBase>();

    for (const launch of discovered) {
      byToken.set(launch.token.toLowerCase(), {
        token: launch.token,
        name: launch.name,
        symbol: launch.symbol,
        description: '',
        logo: '',
        deployer: launch.deployer,
        // Creator fees are redirected to the vault at launch.
        feeWallet: launch.vault,
        vault: launch.vault,
        vaultTemplate: launch.vaultTemplate,
        launchedAt: launch.launchedAt,
        transactionHash: launch.transactionHash,
        everGraduated: false,
      });
    }

    for (const launch of recorded) {
      byToken.set(launch.token.toLowerCase(), {
        token: launch.token,
        name: launch.name,
        symbol: launch.symbol,
        description: launch.description,
        logo: launch.logo,
        deployer: launch.deployer,
        feeWallet: launch.feeWallet,
        vault: launch.vault ?? null,
        vaultTemplate: launch.vaultTemplate ?? null,
        launchedAt: launch.launchedAt,
        transactionHash: launch.transactionHash,
        everGraduated: launch.everGraduated ?? false,
      });
    }

    const base = [...byToken.values()]
      .sort((a, b) => Date.parse(b.launchedAt) - Date.parse(a.launchedAt))
      .slice(0, capped);

    const enriched = await enrichLaunchRecords(base);
    return NextResponse.json(enriched);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load launches' },
      { status: 500 },
    );
  }
}
