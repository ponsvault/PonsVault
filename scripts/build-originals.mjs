/**
 * Renders the PonsVault Originals art pack: every base animal in every light grade.
 *
 * Run once after changing the base art or the grade table:
 *   node scripts/build-originals.mjs
 *
 * Output goes to public/originals/variants and is pinned to IPFS by scripts/pin-originals.mjs.
 */
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const SOURCE_DIR = path.join(ROOT, 'public', 'originals');
const OUT_DIR = path.join(SOURCE_DIR, 'variants');
const LIGHTS_FILE = path.join(ROOT, 'src', 'lib', 'seats', 'originals-lights.json');

const ANIMALS = [
  { id: 'cat', source: '01-cat.jpg' },
  { id: 'shiba', source: '02-shiba.jpg' },
  { id: 'fox', source: '03-fox.jpg' },
  { id: 'rabbit', source: '04-rabbit.jpg' },
  { id: 'frog', source: '05-frog.jpg' },
  { id: 'owl', source: '06-owl.jpg' },
  { id: 'bear', source: '07-bear.jpg' },
  { id: 'wolf', source: '08-wolf.jpg' },
  { id: 'raccoon', source: '09-raccoon.jpg' },
  { id: 'otter', source: '10-otter.jpg' },
  { id: 'deer', source: '11-deer.jpg' },
  { id: 'penguin', source: '12-penguin.jpg' },
];

async function main() {
  // Same table the app reads, so rendered files and published rarity can never drift apart.
  const LIGHTS = JSON.parse(await readFile(LIGHTS_FILE, 'utf8'));

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  let written = 0;
  for (const animal of ANIMALS) {
    const source = path.join(SOURCE_DIR, animal.source);
    await stat(source).catch(() => {
      throw new Error(`Missing base art: ${animal.source}`);
    });

    for (const light of LIGHTS) {
      let pipeline = sharp(source).resize(1024, 1024, { fit: 'cover' });
      if (light.modulate) pipeline = pipeline.modulate(light.modulate);
      if (light.grayscale) pipeline = pipeline.grayscale();

      await pipeline
        .jpeg({ quality: 82, mozjpeg: true })
        .toFile(path.join(OUT_DIR, `${animal.id}-${light.id}.jpg`));
      written++;
    }
  }

  // The 1-of-1 is copied through ungraded — there is one of it, so there are no near-misses.
  const oneOfOne = path.join(SOURCE_DIR, 'one-of-one.png');
  await stat(oneOfOne).catch(() => {
    throw new Error('Missing 1-of-1 art: public/originals/one-of-one.png');
  });
  await sharp(oneOfOne)
    .resize(1024, 1024, { fit: 'cover' })
    .jpeg({ quality: 90, mozjpeg: true })
    .toFile(path.join(OUT_DIR, 'one-of-one.jpg'));

  const files = await readdir(OUT_DIR);
  console.log(
    `Rendered ${written} variants + 1 of 1 (${files.length} files) into ${path.relative(ROOT, OUT_DIR)}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
