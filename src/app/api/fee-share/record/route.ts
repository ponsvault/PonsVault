import { NextResponse } from 'next/server';

import { recordFeeShareLaunch } from '@/lib/fee-share/registry';
import type { SocialPlatform } from '@/lib/fee-share/types';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      platform?: SocialPlatform;
      handle?: string;
      token?: string;
      symbol?: string;
      name?: string;
      transactionHash?: string;
    };

    if (!body.handle || !body.token || !body.transactionHash) {
      return NextResponse.json({ error: 'Missing launch record fields.' }, { status: 400 });
    }

    await recordFeeShareLaunch({
      platform: body.platform ?? 'twitter',
      handle: body.handle,
      token: body.token,
      symbol: body.symbol ?? '',
      name: body.name ?? '',
      transactionHash: body.transactionHash,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to record launch' },
      { status: 500 },
    );
  }
}
