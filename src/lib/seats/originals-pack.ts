import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  ORIGINALS_ONE_OF_ONE,
  PONS_ORIGINALS_SUPPLY,
  allOriginalVariants,
  buildOriginalsAssignment,
} from './originals';
import { keccak256, toHex } from 'viem';

import { pinFolderToIpfs, pinJsonToIpfs, tagPin } from './pinata';

/**
 * The rendered art folder is identical for every Originals series, so it is pinned once and the CID
 * reused. Set PONS_ORIGINALS_ART_CID (see scripts/pin-originals.mjs) to skip the upload entirely.
 *
 * Without it every launch re-uploads ~12 MB of art. This cache only helps a warm process, which on
 * serverless means roughly one launch, so treat the env var as required in production.
 */
let cachedArtCid: string | null = null;

/** Mirrors PonsSeatCollection.REVEAL_WINDOW, only for the copy shown on a sealed seat. */
const REVEAL_WINDOW_DAYS = 7;

export async function resolveOriginalsArtCid(): Promise<string> {
  const configured = process.env.PONS_ORIGINALS_ART_CID?.trim();
  if (configured) return configured.replace(/^ipfs:\/\//, '').replace(/\/$/, '');
  if (cachedArtCid) return cachedArtCid;

  const dir = path.join(process.cwd(), 'public', 'originals', 'variants');
  const form = new FormData();
  const variants = allOriginalVariants();

  for (const variant of variants) {
    const bytes = await readFile(path.join(dir, variant.file));
    form.append(
      'file',
      new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }),
      `originals/${variant.file}`,
    );
  }

  form.append(
    'pinataMetadata',
    JSON.stringify({ name: 'ponsvault-originals-art', keyvalues: { kind: 'pons-originals-art' } }),
  );

  cachedArtCid = await pinFolderToIpfs(form, {
    fileCount: variants.length,
    label: 'the Originals art pack',
  });
  return cachedArtCid;
}

export interface OriginalsPackInput {
  name: string;
  symbol: string;
  description: string;
  /** Only for reproducing an existing pack; a fresh series should let this be generated. */
  salt?: string;
}

export interface OriginalsPackResult {
  /** What the collection sells against: one sealed card, identical for every seat. */
  placeholderUri: string;
  /** keccak256 of the real base URI, committed on-chain at creation. */
  provenanceHash: `0x${string}`;
  imageUri: string;
  artCid: string;
  metadataCount: number;
  /** The salt the shuffle used. Published with the reveal so anyone can recompute the layout. */
  salt: string;
}

export async function buildOriginalsPack(input: OriginalsPackInput): Promise<OriginalsPackResult> {
  const artCid = await resolveOriginalsArtCid();
  // Salted, because the shuffle is deterministic and this code is public: seeded on the name and
  // ticker alone, anyone could regenerate the pack before the sale and snipe the seat holding the
  // 1-of-1. The salt is random per series and only meaningful once the metadata is revealed.
  const salt = input.salt ?? randomBytes(16).toString('hex');
  const assignment = buildOriginalsAssignment(`${input.symbol}:${input.name}:${salt}`);

  const description =
    input.description.trim() ||
    `${input.name} ($${input.symbol}) — a PonsVault Originals seat. Trade it, activate it, and earn from the series fee pot.`;

  const form = new FormData();
  for (let id = 1; id <= PONS_ORIGINALS_SUPPLY; id++) {
    const variant = assignment[id - 1];
    const isOneOfOne = variant.file === ORIGINALS_ONE_OF_ONE.file;
    const meta = {
      name: isOneOfOne ? `${input.name} #${id} · 1 of 1` : `${input.name} #${id}`,
      description,
      image: `ipfs://${artCid}/${variant.file}`,
      attributes: [
        { trait_type: 'Animal', value: variant.animal.name },
        { trait_type: 'Light', value: variant.light.name },
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
      name: `${input.symbol}-originals-metadata`,
      keyvalues: {
        kind: 'pons-seat-metadata',
        pack: 'originals',
        symbol: input.symbol,
        supply: String(PONS_ORIGINALS_SUPPLY),
      },
    }),
  );

  const metadataCid = await pinFolderToIpfs(form, {
    fileCount: PONS_ORIGINALS_SUPPLY,
    label: 'seat metadata',
  });

  const baseTokenURI = `ipfs://${metadataCid}/`;
  const provenanceHash = keccak256(toHex(baseTokenURI));

  // The finished pack is now labelled with its own commitment, and nothing but that label ties it
  // to this series until the reveal endpoint hands it out.
  await tagPin(metadataCid, {
    kind: 'pons-seat-metadata',
    provenance: provenanceHash,
    salt,
  });

  // The series logo is the 1-of-1, not whatever landed on seat 1: the collection leads with its
  // rarest piece rather than a random common.
  const imageUri = `ipfs://${artCid}/${ORIGINALS_ONE_OF_ONE.file}`;

  const placeholderCid = await pinJsonToIpfs(
    {
      name: `${input.name} — sealed seat`,
      description:
        `${description} The art is sealed until the series sells out, or for ${REVEAL_WINDOW_DAYS} days, ` +
        `whichever comes first. Every seat looks the same until then, so nobody can see which one holds ` +
        `the 1-of-1 and buy it on purpose.`,
      image: imageUri,
      attributes: [
        { trait_type: 'Series', value: input.symbol },
        { trait_type: 'Status', value: 'Sealed' },
      ],
    },
    { name: `${input.symbol}-sealed-seat`, keyvalues: { kind: 'pons-seat-placeholder' } },
  );

  return {
    placeholderUri: `ipfs://${placeholderCid}`,
    provenanceHash,
    salt,
    imageUri,
    artCid,
    metadataCount: PONS_ORIGINALS_SUPPLY,
  };
}
