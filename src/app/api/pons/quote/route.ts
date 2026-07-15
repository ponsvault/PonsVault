import { isAddress, parseEther } from 'viem';
import { NextResponse } from 'next/server';

import { quoteSwap } from '@/lib/pons/swap';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token')?.trim() ?? '';
  const side = url.searchParams.get('side') === 'sell' ? 'sell' : 'buy';
  const amount = url.searchParams.get('amount')?.trim() ?? '';

  if (!isAddress(token)) {
    return NextResponse.json({ error: 'Invalid token address' }, { status: 400 });
  }

  if (!amount || Number(amount) <= 0) {
    return NextResponse.json({ error: 'Enter a valid amount' }, { status: 400 });
  }

  try {
    parseEther(amount);
  } catch {
    return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
  }

  try {
    const quote = await quoteSwap({ token, side, amount });
    return NextResponse.json(quote);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Quote failed' },
      { status: 500 },
    );
  }
}
