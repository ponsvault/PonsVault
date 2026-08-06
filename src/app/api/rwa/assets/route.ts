import { NextResponse } from 'next/server';

import { vaultTemplateId } from '@/lib/pons/vault';
import { isV2TemplateRegistered } from '@/lib/pons/registry';
import { assessAllAssets } from '@/lib/rwa/asset-health';

/**
 * What the RWA Dividend template can actually do right now.
 *
 * Both halves of the answer are facts about the chain rather than about this
 * deploy, and both can change without a release: a template is only launchable
 * once its factory is registered, and an asset is only worth choosing while its
 * pool is deep enough to convert a round at a sane price. Asking the chain at
 * request time is what stops the form offering a launch that would revert, or a
 * stock that would quietly waste every payout.
 *
 * Served from the server so a browser is not made to run four contract
 * simulations, and cached briefly because pool depth does not move per
 * keystroke.
 *
 * Only answers we actually got are cached. A failed check reads identically to
 * a dead pool in the response, so caching one would keep telling every visitor
 * for a minute that a healthy stock cannot be bought — and hide the template
 * while it did. Rendered per request for that reason, with the caching stated
 * in the header instead, where it can depend on the outcome.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [registered, assets] = await Promise.all([
      isV2TemplateRegistered(vaultTemplateId('rwa')),
      assessAllAssets(),
    ]);

    const complete = assets.every((health) => !health.unknown);

    return NextResponse.json(
      {
        registered,
        // So the client can distinguish "we checked" from "we could not", and
        // retry rather than presenting a gap as a finding.
        complete,
        assets: assets.map((health) => ({
          symbol: health.asset.symbol,
          name: health.asset.name,
          address: health.asset.address,
          poolFee: health.asset.poolFee,
          decimals: health.asset.decimals,
          // Strings because these are wei-scale and JSON has no bigint.
          perRound: health.perRound.toString(),
          impactBps: Number(health.impactBps),
          tradeable: health.tradeable,
          unknown: health.unknown ?? false,
          reason: health.reason ?? null,
        })),
      },
      {
        headers: {
          'Cache-Control': complete
            ? 'public, s-maxage=60, stale-while-revalidate=120'
            : 'no-store',
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        registered: false,
        complete: false,
        assets: [],
        error: error instanceof Error ? error.message : 'Could not read asset liquidity.',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
