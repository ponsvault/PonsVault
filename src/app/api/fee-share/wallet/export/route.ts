import { PrivyClient as PrivyAuthClient } from '@privy-io/server-auth';
import { NextResponse } from 'next/server';

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

type LinkedAccount = { type: string; username?: string | null };

function handleFromUser(
  user: {
    linkedAccounts?: LinkedAccount[];
    twitter?: { username?: string | null };
    github?: { username?: string | null };
  },
  platform: SocialPlatform,
): string | null {
  if (platform === 'twitter') {
    if (user.twitter?.username) return user.twitter.username.toLowerCase();
    for (const account of user.linkedAccounts ?? []) {
      if (account.type === 'twitter_oauth' && account.username) {
        return account.username.toLowerCase();
      }
    }
    return null;
  }

  if (user.github?.username) return user.github.username.toLowerCase();
  for (const account of user.linkedAccounts ?? []) {
    if (account.type === 'github_oauth' && account.username) {
      return account.username.toLowerCase();
    }
  }

  return null;
}

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return NextResponse.json({ error: 'Missing Privy access token.' }, { status: 401 });
    }

    const authClient = getAuthClient();
    const authClaims = await authClient.verifyAuthToken(token);
    const user = await authClient.getUser(authClaims.userId);

    const twitterHandle = handleFromUser(user, 'twitter');
    const githubHandle = handleFromUser(user, 'github');

    const twitterWallet = twitterHandle
      ? await getFeeShareWallet('twitter', twitterHandle)
      : null;
    const githubWallet = githubHandle
      ? await getFeeShareWallet('github', githubHandle)
      : null;

    const wallet = twitterWallet ?? githubWallet;

    if (!wallet?.privateKey) {
      return NextResponse.json(
        { error: 'No exportable fee wallet found for this account.' },
        { status: 404 },
      );
    }

    if (wallet.privyUserId && wallet.privyUserId !== user.id) {
      return NextResponse.json(
        { error: 'This fee wallet belongs to a different Privy account.' },
        { status: 403 },
      );
    }

    return NextResponse.json({
      platform: wallet.platform,
      handle: wallet.handle,
      walletAddress: wallet.walletAddress,
      privateKey: wallet.privateKey,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to export wallet' },
      { status: 500 },
    );
  }
}
