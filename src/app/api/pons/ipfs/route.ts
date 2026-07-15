import { NextResponse } from 'next/server';

import { fetchPonsApi, readResponseJson } from '@/lib/pons/pons-http';

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const image = form.get('image');

    if (!(image instanceof File)) {
      return NextResponse.json({ error: 'Image file is required.' }, { status: 400 });
    }

    const upstream = new FormData();
    upstream.append('image', image);

    let res: Response;
    try {
      res = await fetchPonsApi('/api/ipfs/image', {
        method: 'POST',
        body: upstream,
      });
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? `Could not reach pons image upload (${error.message}). Paste an ipfs:// URI instead.`
              : 'Could not reach pons image upload. Paste an ipfs:// URI instead.',
        },
        { status: 502 },
      );
    }

    const data = await readResponseJson<{ uri?: string; error?: string }>(res);
    if (!res.ok || !data.uri) {
      return NextResponse.json(
        { error: data.error ?? 'pons image upload failed' },
        { status: res.status || 502 },
      );
    }

    return NextResponse.json({ uri: data.uri, source: 'pons' });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Image upload failed. Paste an ipfs:// URI instead.',
      },
      { status: 502 },
    );
  }
}
