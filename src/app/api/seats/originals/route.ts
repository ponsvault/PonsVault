import { NextResponse } from 'next/server';

import { buildOriginalsPack } from '@/lib/seats/originals-pack';

export const runtime = 'nodejs';
/** Pinning the shared art folder on a cold cache plus 1111 metadata files can take a few minutes. */
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      name?: string;
      symbol?: string;
      description?: string;
    };

    const name = String(body.name ?? '').trim();
    const symbol = String(body.symbol ?? '')
      .trim()
      .toUpperCase();

    if (!name || !symbol) {
      return NextResponse.json({ error: 'Name and ticker are required.' }, { status: 400 });
    }

    const result = await buildOriginalsPack({
      name,
      symbol,
      description: String(body.description ?? ''),
    });

    // The salt stays on this side: with it, the name and the ticker, anyone could rebuild the pack
    // and see which seat holds the 1-of-1 while the sale is still running.
    return NextResponse.json({
      placeholderUri: result.placeholderUri,
      provenanceHash: result.provenanceHash,
      imageUri: result.imageUri,
      artCid: result.artCid,
      metadataCount: result.metadataCount,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Originals pack build failed' },
      { status: 500 },
    );
  }
}
