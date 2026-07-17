import { PrivyClient as PrivyAuthClient } from '@privy-io/server-auth';
import { NextResponse } from 'next/server';

import { recordFeeClaim } from '@/lib/fee-share/claims';
import { getFeeShareWallet } from '@/lib/fee-share/registry';
import type { SocialPlatform } from '@/lib/fee-share/types';

function getAuthClient() {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error('Privy is not configured.');
  }
  return new PrivyAuthClient(appId, appSecret);
}

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return NextResponse.json({ error: 'Missing Privy access token.' }, { status: 401 });
    }

    const body = (await request.json()) as {
      token?: string;
      platform?: SocialPlatform;
      handle?: string;
      claimTransactionHash?: string;
    };

    if (!body.token || !body.platform || !body.handle) {
      return NextResponse.json({ error: 'Missing fee claim fields.' }, { status: 400 });
    }

    const authClient = getAuthClient();
    const claims = await authClient.verifyAuthToken(token);
    const user = await authClient.getUser(claims.userId);

    const wallet = await getFeeShareWallet(body.platform, body.handle);
    if (!wallet?.id) {
      return NextResponse.json({ error: 'Fee wallet not found for this handle.' }, { status: 404 });
    }

    if (wallet.privyUserId && wallet.privyUserId !== user.id) {
      return NextResponse.json(
        { error: 'This fee wallet is linked to a different Privy account.' },
        { status: 403 },
      );
    }

    const claim = await recordFeeClaim({
      token: body.token,
      feeWalletId: wallet.id,
      walletAddress: wallet.walletAddress,
      privyUserId: user.id,
      claimTransactionHash: body.claimTransactionHash,
    });

    return NextResponse.json(claim);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to record fee claim' },
      { status: 500 },
    );
  }
}
