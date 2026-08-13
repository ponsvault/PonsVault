import { NextResponse } from 'next/server';
import { isAddress, keccak256, toHex, type Address } from 'viem';

import { robinhoodPublicClient } from '@/lib/pons/client';
import { PONS_SEAT_COLLECTION_ABI } from '@/lib/seats/abis';
import { findPinByKeyvalue } from '@/lib/seats/pinata';

export const runtime = 'nodejs';

/**
 * Hands out the real metadata folder for a sealed series, but only once the chain says the sale is
 * over. Anyone may ask, and anyone may then send the reveal transaction — the collection checks the
 * commitment, so a URI leaking early would be the only harm, and that is exactly what the gate here
 * prevents.
 */
export async function GET(request: Request) {
  const collection = new URL(request.url).searchParams.get('collection');
  if (!collection || !isAddress(collection)) {
    return NextResponse.json({ error: 'A collection address is required.' }, { status: 400 });
  }

  try {
    const [revealed, revealable, provenanceHash] = await Promise.all([
      robinhoodPublicClient.readContract({
        address: collection as Address,
        abi: PONS_SEAT_COLLECTION_ABI,
        functionName: 'revealed',
      }),
      robinhoodPublicClient.readContract({
        address: collection as Address,
        abi: PONS_SEAT_COLLECTION_ABI,
        functionName: 'revealable',
      }),
      robinhoodPublicClient.readContract({
        address: collection as Address,
        abi: PONS_SEAT_COLLECTION_ABI,
        functionName: 'provenanceHash',
      }),
    ]);

    if (revealed) {
      return NextResponse.json({ error: 'This series is already revealed.' }, { status: 409 });
    }
    if (!revealable) {
      return NextResponse.json(
        { error: 'This series is still sealed. It reveals once it sells out, or after its reveal window.' },
        { status: 409 },
      );
    }

    const cid = await findPinByKeyvalue('provenance', provenanceHash as string);
    if (!cid) {
      return NextResponse.json(
        { error: 'The pack for this series could not be found. Reveal it with the base URI you pinned.' },
        { status: 404 },
      );
    }

    const baseTokenURI = `ipfs://${cid}/`;
    if (keccak256(toHex(baseTokenURI)) !== provenanceHash) {
      return NextResponse.json(
        { error: 'The pack found for this series does not match what it committed to.' },
        { status: 409 },
      );
    }

    return NextResponse.json({ baseTokenURI });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Reveal lookup failed' },
      { status: 500 },
    );
  }
}
