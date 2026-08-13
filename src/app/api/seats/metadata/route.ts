import { NextResponse } from 'next/server';

import { uploadSeatMetadataPack } from '@/lib/seats/metadata-upload';

export const runtime = 'nodejs';
/** Large packs (up to 10k metadata files) can take a few minutes to pin. */
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const image = form.get('image');
    const name = String(form.get('name') ?? '').trim();
    const symbol = String(form.get('symbol') ?? '').trim().toUpperCase();
    const description = String(form.get('description') ?? '').trim();
    const maxSupply = Number(form.get('maxSupply') ?? '0');

    if (!(image instanceof File) || image.size === 0) {
      return NextResponse.json({ error: 'Seat artwork image is required.' }, { status: 400 });
    }
    if (!name || !symbol) {
      return NextResponse.json({ error: 'Name and symbol are required.' }, { status: 400 });
    }

    const result = await uploadSeatMetadataPack({
      image,
      imageFilename: image.name || 'seat.png',
      name,
      symbol,
      description,
      maxSupply,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Metadata upload failed' },
      { status: 500 },
    );
  }
}
