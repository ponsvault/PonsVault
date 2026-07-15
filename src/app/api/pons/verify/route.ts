import { NextResponse } from 'next/server';

import { fetchPonsApi, isHtmlResponse } from '@/lib/pons/pons-http';

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { token?: string };
    if (!payload.token) {
      return NextResponse.json({ error: 'Token address is required.' }, { status: 400 });
    }

    const res = await fetchPonsApi('/api/pons-verify-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: payload.token }),
    });

    const contentType = res.headers.get('content-type');
    const raw = await res.text();

    if (isHtmlResponse(raw, contentType)) {
      // Non-fatal: token still exists on-chain even if pons indexer is unreachable.
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: 'pons indexer unreachable from server (Cloudflare).',
      });
    }

    return new NextResponse(raw, {
      status: res.status,
      headers: { 'Content-Type': contentType ?? 'application/json' },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Verify request failed' },
      { status: 502 },
    );
  }
}
