import { NextResponse } from 'next/server';

import { isTemplateRegistered } from '@/lib/pons/registry';
import { vaultTemplateId } from '@/lib/pons/vault';

export const dynamic = 'force-dynamic';

/** Whether the Lottery factory is registered and launchable. */
export async function GET() {
  try {
    const registered = await isTemplateRegistered(vaultTemplateId('lottery'));
    return NextResponse.json(
      { registered },
      { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        registered: false,
        error: error instanceof Error ? error.message : 'Could not read the registry.',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
