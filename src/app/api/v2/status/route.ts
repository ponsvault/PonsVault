import { NextResponse } from 'next/server';

import { fetchPonsV2Status } from '@/lib/pons/v2-status';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const status = await fetchPonsV2Status();
    return NextResponse.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to read v2 status';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
