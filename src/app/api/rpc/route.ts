import { NextResponse } from 'next/server';

import { ROBINHOOD_RPC_URL } from '@/lib/pons/constants';

export async function POST(request: Request) {
  try {
    const body = await request.text();
    const res = await fetch(ROBINHOOD_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    const responseBody = await res.text();
    return new NextResponse(responseBody, {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'RPC request failed' },
      { status: 502 },
    );
  }
}
