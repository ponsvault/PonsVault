import { NextResponse } from 'next/server';

import { recordPonsVaultLaunch } from '@/lib/launch-registry/store';
import type { PonsVaultLaunchRecord } from '@/lib/launch-registry/types';
import { verifyLaunchRecord } from '@/lib/launch-registry/verify-launch-record';
import { robinhoodPublicClient } from '@/lib/pons/client';
import { resolveVaultAddress, resolveVaultTemplate } from '@/lib/pons/vault-state';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<PonsVaultLaunchRecord>;

    if (!body.token || !body.transactionHash || !body.deployer || !body.feeWallet) {
      return NextResponse.json({ error: 'Missing launch record fields.' }, { status: 400 });
    }

    await verifyLaunchRecord({
      token: body.token,
      transactionHash: body.transactionHash,
      deployer: body.deployer,
      feeWallet: body.feeWallet,
    });

    // Read the vault off the launcher rather than taking the client's word for
    // it, so a record cannot claim a vault the token does not actually have.
    const vault = await resolveVaultAddress(
      robinhoodPublicClient,
      body.token as `0x${string}`,
    );
    const vaultTemplate = vault
      ? await resolveVaultTemplate(robinhoodPublicClient, vault)
      : undefined;

    const launch = await recordPonsVaultLaunch({
      token: body.token,
      name: body.name ?? '',
      symbol: body.symbol ?? '',
      description: body.description ?? '',
      logo: body.logo ?? '',
      deployer: body.deployer,
      feeWallet: body.feeWallet,
      vault: vault ?? undefined,
      vaultTemplate,
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
