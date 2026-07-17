import { PrivyClient as PrivyAuthClient } from '@privy-io/server-auth';
import { NextResponse } from 'next/server';

import { listFeeClaimsForTokens } from '@/lib/fee-share/claims';
import { linkFeeWalletToPrivyUser } from '@/lib/fee-share/privy-link';
import { getFeeShareWallet } from '@/lib/fee-share/registry';
import {
  listPonsShareLaunchesForFeeHandle,
  listPonsShareLaunchesForWallet,
} from '@/lib/launch-registry/store';
import { toCustomUserId } from '@/lib/fee-share/social';
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

  if (platform === 'github') {
    if (user.github?.username) return user.github.username.toLowerCase();
    for (const account of user.linkedAccounts ?? []) {
      if (account.type === 'github_oauth' && account.username) {
        return account.username.toLowerCase();
      }
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

    let twitterRegistry = twitterHandle
      ? await getFeeShareWallet('twitter', twitterHandle)
      : null;
    let githubRegistry = githubHandle
      ? await getFeeShareWallet('github', githubHandle)
      : null;

    if (twitterRegistry && !twitterRegistry.linkedAt) {
      twitterRegistry = await linkFeeWalletToPrivyUser(twitterRegistry, user.id);
    }
    if (githubRegistry && !githubRegistry.linkedAt) {
      githubRegistry = await linkFeeWalletToPrivyUser(githubRegistry, user.id);
    }

    const registry = twitterRegistry ?? githubRegistry;

    const walletAddress =
      registry?.walletAddress ??
      user.wallet?.address ??
      user.linkedAccounts?.find((a) => a.type === 'wallet')?.address ??
      null;

    if (!walletAddress) {
      return NextResponse.json(
        { error: 'No fee wallet found for this account yet.' },
        { status: 404 },
      );
    }

    const handleLaunches = [
      ...(twitterHandle
        ? await listPonsShareLaunchesForFeeHandle(twitterHandle, 'twitter')
        : []),
      ...(githubHandle
        ? await listPonsShareLaunchesForFeeHandle(githubHandle, 'github')
        : []),
    ];
    const walletLaunches = await listPonsShareLaunchesForWallet(walletAddress);

    const merged = new Map<string, (typeof handleLaunches)[number]>();
    for (const launch of [...handleLaunches, ...walletLaunches]) {
      merged.set(launch.token.toLowerCase(), launch);
    }

    const launchList = [...merged.values()].sort(
      (a, b) => Date.parse(b.launchedAt) - Date.parse(a.launchedAt),
    );

    const feeClaims = await listFeeClaimsForTokens(launchList.map((launch) => launch.token));
    const claimsByToken = new Map(
      feeClaims.map((claim) => [claim.token.toLowerCase(), claim]),
    );

    const launches = launchList.map((launch) => {
      const claim = claimsByToken.get(launch.token.toLowerCase());
      return {
        token: launch.token,
        name: launch.name,
        symbol: launch.symbol,
        logo: launch.logo,
        transactionHash: launch.transactionHash,
        launchedAt: launch.launchedAt,
        feeShareHandle: launch.feeShareHandle ?? null,
        feeSharePlatform: launch.feeSharePlatform ?? null,
        feeClaimed: !!claim,
        feeClaimedAt: claim?.claimedAt ?? null,
        feeClaimTxHash: claim?.claimTransactionHash ?? null,
      };
    });

    const primaryPlatform = twitterRegistry
      ? 'twitter'
      : githubRegistry
        ? 'github'
        : twitterHandle
          ? 'twitter'
          : githubHandle
            ? 'github'
            : null;
    const primaryHandle =
      primaryPlatform === 'twitter'
        ? twitterHandle
        : primaryPlatform === 'github'
          ? githubHandle
          : null;

    return NextResponse.json({
      walletAddress,
      twitterHandle,
      githubHandle,
      socialPlatform: primaryPlatform,
      socialHandle: primaryHandle,
      customUserId: primaryPlatform && primaryHandle
        ? toCustomUserId(primaryPlatform, primaryHandle)
        : null,
      launches,
      registryMatch: !!registry,
      privyLinked: !!registry?.linkedAt,
      linkedAt: registry?.linkedAt ?? null,
      privyWalletId: registry?.privyWalletId ?? null,
      privyUserId: user.id,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Claim profile failed' },
      { status: 500 },
    );
  }
}
