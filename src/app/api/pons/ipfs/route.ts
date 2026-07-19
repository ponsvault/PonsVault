import { NextResponse } from 'next/server';

import { uploadTokenImageFile } from '@/lib/pons/ipfs-upload';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const image = form.get('image');

    if (!(image instanceof Blob) || image.size === 0) {
      return NextResponse.json({ error: 'Missing image file' }, { status: 400 });
    }

    const filename =
      image instanceof File && image.name ? image.name : 'token-image.png';

    const result = await uploadTokenImageFile(image, filename);

    return NextResponse.json({ uri: result.uri, source: result.source });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Image upload failed' },
      { status: 502 },
    );
  }
}
