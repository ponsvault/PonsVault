import { isAddress, type Address } from 'viem';
import { NextResponse } from 'next/server';

import { fetchTokenDetail } from '@/lib/pons/token-detail';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address: raw } = await params;
  const address = raw.trim();

  if (!isAddress(address)) {
    return NextResponse.json({ error: 'Invalid token address' }, { status: 400 });
  }

  try {
    const detail = await fetchTokenDetail(address as Address);
    return NextResponse.json(detail);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to read token on-chain' },
      { status: 500 },
    );
  }
}
