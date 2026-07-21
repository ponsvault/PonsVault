import { NextResponse } from 'next/server';

import { recordPonsShareLaunch } from '@/lib/launch-registry/store';
import type { PonsShareLaunchRecord } from '@/lib/launch-registry/types';
import { verifyLaunchRecord } from '@/lib/launch-registry/verify-launch-record';
import { normalizeHandle } from '@/lib/fee-share/social';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<PonsShareLaunchRecord>;

    if (!body.token || !body.transactionHash || !body.deployer || !body.feeWallet) {
      return NextResponse.json({ error: 'Missing launch record fields.' }, { status: 400 });
    }

    await verifyLaunchRecord({
      token: body.token,
      transactionHash: body.transactionHash,
      deployer: body.deployer,
      feeWallet: body.feeWallet,
      feeSharePlatform: body.feeSharePlatform,
      feeShareHandle: body.feeShareHandle,
    });

    const launch = await recordPonsShareLaunch({
      token: body.token,
      name: body.name ?? '',
      symbol: body.symbol ?? '',
      description: body.description ?? '',
      logo: body.logo ?? '',
      deployer: body.deployer,
      feeWallet: body.feeWallet,
      feeSharePlatform: body.feeSharePlatform,
      feeShareHandle: body.feeShareHandle
        ? normalizeHandle(body.feeShareHandle)
        : undefined,
      transactionHash: body.transactionHash,
      launchedAt: body.launchedAt ?? new Date().toISOString(),
    });

    return NextResponse.json(launch);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to record launch' },
      { status: 500 },
    );
  }
}
