import { uploadTokenImageFile } from '@/lib/pons/ipfs-upload';

import { pinFolderToIpfs } from './pinata';
import { MAX_SEAT_SUPPLY } from './supply';

/** One metadata file per seat, so this is simply the series ceiling. */
export const MAX_SEAT_METADATA_FILES = MAX_SEAT_SUPPLY;

export interface SeatMetadataPackInput {
  image: File | Blob;
  imageFilename: string;
  name: string;
  symbol: string;
  description: string;
  maxSupply: number;
}

export interface SeatMetadataPackResult {
  imageUri: string;
  baseTokenURI: string;
  metadataCount: number;
}

/**
 * Uploads seat artwork, then pins a metadata folder where each file is named
 * by seat id (`1`, `2`, …) so `tokenURI(id) = baseTokenURI + id` resolves.
 *
 * Built-in upload supports the full series cap. Each metadata file is tiny JSON
 * pointing at the same image CID, so a full pack is only a few MB.
 */
export async function uploadSeatMetadataPack(
  input: SeatMetadataPackInput,
): Promise<SeatMetadataPackResult> {
  const maxSupply = Math.floor(input.maxSupply);
  if (!Number.isFinite(maxSupply) || maxSupply < 1 || maxSupply > MAX_SEAT_METADATA_FILES) {
    throw new Error(
      `Max seats for built-in metadata upload must be between 1 and ${MAX_SEAT_METADATA_FILES.toLocaleString()}.`,
    );
  }

  const imageUpload = await uploadTokenImageFile(input.image, input.imageFilename);
  const imageUri = imageUpload.uri;

  const form = new FormData();
  const description =
    input.description.trim() ||
    `${input.name} ($${input.symbol}) seat. Trade, activate, and earn from the series fee pot.`;

  for (let id = 1; id <= maxSupply; id++) {
    const meta = {
      name: `${input.name} #${id}`,
      description,
      image: imageUri,
      attributes: [
        { trait_type: 'Series', value: input.symbol },
        { trait_type: 'Seat', value: id },
      ],
    };
    form.append(
      'file',
      new Blob([JSON.stringify(meta)], { type: 'application/json' }),
      `seats/${id}`,
    );
  }

  form.append(
    'pinataMetadata',
    JSON.stringify({
      name: `${input.symbol}-seat-metadata`,
      keyvalues: {
        kind: 'pons-seat-metadata',
        symbol: input.symbol,
        supply: String(maxSupply),
      },
    }),
  );

  const metadataCid = await pinFolderToIpfs(form, {
    fileCount: maxSupply,
    label: 'seat metadata',
  });

  return {
    imageUri,
    baseTokenURI: `ipfs://${metadataCid}/`,
    metadataCount: maxSupply,
  };
}
