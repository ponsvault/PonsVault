/**
 * Guards the PonsVault Originals pack.
 *
 *   node scripts/check-originals.mjs
 *
 * Catches the ways this pack silently breaks: a grade added to the table without re-rendering the
 * art, a rarity table that no longer adds up to the fixed supply, a minted set that does not match
 * the rarity the UI advertises, and art that no series can ever mint.
 *
 * Run through tsx so the checks exercise the real allocator rather than a copy of it.
 */
import { access, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  ORIGINAL_ANIMALS,
  ORIGINAL_LIGHTS,
  ORIGINALS_ONE_OF_ONE,
  PONS_ORIGINALS_SUPPLY,
  allOriginalVariants,
  buildOriginalsAssignment,
  originalsRarityTable,
} from '../src/lib/seats/originals.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const VARIANTS_DIR = path.join(ROOT, 'public', 'originals', 'variants');

const SUPPLY = 1111;

/** Arbitrary but fixed, so the check is reproducible. */
const SAMPLE_SERIES = [
  'TIERCHK:Tier Check',
  'PONS:Pons Series',
  'ABC:Alpha',
  'ZZZ:Omega',
  'MEOW:Cats',
  'FOO:Foo',
  'BAR:Bar',
  'QUX:Qux',
];

async function main() {
  const lights = ORIGINAL_LIGHTS;
  const animals = ORIGINAL_ANIMALS;

  if (PONS_ORIGINALS_SUPPLY !== SUPPLY) {
    throw new Error(
      `Supply drifted: originals.ts says ${PONS_ORIGINALS_SUPPLY}, this check expects ${SUPPLY}`,
    );
  }

  const problems = [];

  for (const animal of animals) {
    await access(path.join(ROOT, 'public', 'originals', animal.source)).catch(() =>
      problems.push(`Missing base art: ${animal.source}`),
    );
    for (const light of lights) {
      const file = `${animal.id}-${light.id}.jpg`;
      await access(path.join(VARIANTS_DIR, file)).catch(() =>
        problems.push(`Missing variant: ${file} (run scripts/build-originals.mjs)`),
      );
    }
  }

  await access(path.join(VARIANTS_DIR, ORIGINALS_ONE_OF_ONE.file)).catch(() =>
    problems.push(`Missing 1-of-1 art: ${ORIGINALS_ONE_OF_ONE.file} (run scripts/build-originals.mjs)`),
  );

  const rendered = (await readdir(VARIANTS_DIR)).filter((file) => file.endsWith('.jpg'));
  const expected = animals.length * lights.length + 1; // + the 1-of-1
  if (rendered.length !== expected) {
    problems.push(`Variant count is ${rendered.length}, expected ${expected}`);
  }

  const table = originalsRarityTable();
  const counts = table.map((row) => row.count);
  const allocated = counts.reduce((sum, count) => sum + count, 0);
  if (allocated !== SUPPLY) {
    problems.push(`Rarity table allocates ${allocated} seats, expected exactly ${SUPPLY}`);
  }

  // What the allocator actually mints, against what the UI promises.
  const reachable = new Set();
  for (const seed of SAMPLE_SERIES) {
    const assignment = buildOriginalsAssignment(seed);
    if (assignment.length !== SUPPLY) {
      problems.push(`${seed}: minted ${assignment.length} seats, expected ${SUPPLY}`);
    }

    const minted = new Map();
    for (const variant of assignment) {
      reachable.add(variant.file);
      minted.set(variant.light.name, (minted.get(variant.light.name) ?? 0) + 1);
    }
    for (const row of table) {
      const actual = minted.get(row.name) ?? 0;
      if (actual !== row.count) {
        problems.push(`${seed}: ${row.name} advertised ${row.count} seats but minted ${actual}`);
      }
    }

    const repeat = buildOriginalsAssignment(seed);
    if (assignment.some((variant, index) => variant.file !== repeat[index].file)) {
      problems.push(`${seed}: assignment is not deterministic for a fixed seed`);
    }
  }

  // A grade rarer than the animal roster has to omit some animals, but the omission must rotate with
  // the seed. When it does not, that art is unmintable in every series and may as well not exist.
  const unreachable = allOriginalVariants()
    .map((variant) => variant.file)
    .filter((file) => !reachable.has(file));
  if (unreachable.length > 0) {
    problems.push(
      `No series can mint ${unreachable.join(', ')} — the rarest grade always omits the same animals`,
    );
  }

  if (problems.length > 0) {
    console.error('Originals pack is inconsistent:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  console.log(
    `Originals pack OK: ${animals.length} animals x ${lights.length} grades + 1 of 1 = ${rendered.length} files, ${allocated} seats allocated.`,
  );
  for (const row of table) {
    console.log(`  ${row.name.padEnd(12)} ${String(row.count).padStart(4)} seats`);
  }
  console.log(
    `Checked ${SAMPLE_SERIES.length} sample series: rarity exact, deterministic, all ${reachable.size} variants mintable.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
