import { NextResponse } from 'next/server';

import {
  getOrCreateFeeShareWallet,
  lookupFeeShareWallet,
} from '@/lib/fee-share/wallet-service';
import { isValidGithubHandle, isValidTwitterHandle, normalizeHandle } from '@/lib/fee-share/social';
import type { SocialPlatform } from '@/lib/fee-share/types';

function parsePlatform(value: string | null | undefined): SocialPlatform {
  return value === 'github' ? 'github' : 'twitter';
}

function validateHandle(platform: SocialPlatform, handle: string): string | null {
  if (!handle.trim()) {
    return 'Social handle is required.';
  }
  if (platform === 'twitter' && !isValidTwitterHandle(handle)) {
    return 'Invalid X/Twitter handle.';
  }
  if (platform === 'github' && !isValidGithubHandle(handle)) {
    return 'Invalid GitHub username.';
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      platform?: SocialPlatform;
      handle?: string;
    };

    const platform = parsePlatform(body.platform);
    const handle = body.handle?.trim() ?? '';
    const validationError = validateHandle(platform, handle);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const wallet = await getOrCreateFeeShareWallet(platform, handle);
    return NextResponse.json(wallet);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Wallet resolution failed' },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const platform = parsePlatform(params.get('platform'));
    const handle = params.get('handle')?.trim() ?? '';
    const validationError = validateHandle(platform, handle);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const wallet = await lookupFeeShareWallet(platform, handle);
    if (!wallet) {
      return NextResponse.json({
        exists: false,
        platform,
        handle: normalizeHandle(handle),
      });
    }

    return NextResponse.json({ exists: true, ...wallet });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Wallet lookup failed' },
      { status: 500 },
    );
  }
}
