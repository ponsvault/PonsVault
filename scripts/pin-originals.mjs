/**
 * Pins the rendered PonsVault Originals art folder to IPFS and prints its CID.
 *
 *   PINATA_JWT=... node scripts/pin-originals.mjs
 *
 * Put the result in .env.local as PONS_ORIGINALS_ART_CID so launches skip the art upload entirely.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'public', 'originals', 'variants');

async function main() {
  const jwt = process.env.PINATA_JWT?.trim();
  if (!jwt) throw new Error('PINATA_JWT is required.');

  const files = (await readdir(DIR)).filter((file) => file.endsWith('.jpg')).sort();
  if (files.length === 0) throw new Error('No variants found. Run scripts/build-originals.mjs first.');

  const form = new FormData();
  for (const file of files) {
    const bytes = await readFile(path.join(DIR, file));
    form.append('file', new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }), `originals/${file}`);
  }
  form.append(
    'pinataMetadata',
    JSON.stringify({ name: 'ponsvault-originals-art', keyvalues: { kind: 'pons-originals-art' } }),
  );

  const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });
  const data = await res.json();
  if (!res.ok || !data.IpfsHash) throw new Error(`Pin failed: ${JSON.stringify(data)}`);

  console.log(`Pinned ${files.length} files`);
  console.log(`PONS_ORIGINALS_ART_CID=${data.IpfsHash}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
