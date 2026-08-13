/**
 * PonsVault Originals — the house art pack for Vault Seats.
 *
 * A creator who does not want to make their own art can launch on this pack instead. The art is the
 * same for every Originals series and is pinned to IPFS once, so a launch needs no upload and no wait.
 * What differs per series is the metadata folder: each series shuffles the pack with its own seed, so
 * two series never hand out the same animal to the same seat number.
 */

import lightTable from './originals-lights.json';

/** Fixed supply for an Originals series. Not configurable: the rarity table is built for this count. */
export const PONS_ORIGINALS_SUPPLY = 1111;

export interface OriginalAnimal {
  id: string;
  name: string;
  /** Base art filename in public/originals. */
  source: string;
}

export interface OriginalLight {
  id: string;
  name: string;
  /** Share of the supply, relative to the other grades. */
  weight: number;
  /** sharp modulate options applied to the base art. */
  modulate?: { hue?: number; saturation?: number; brightness?: number };
  grayscale?: boolean;
}

export const ORIGINAL_ANIMALS: OriginalAnimal[] = [
  { id: 'cat', name: 'Cat', source: '01-cat.jpg' },
  { id: 'shiba', name: 'Shiba', source: '02-shiba.jpg' },
  { id: 'fox', name: 'Fox', source: '03-fox.jpg' },
  { id: 'rabbit', name: 'Rabbit', source: '04-rabbit.jpg' },
  { id: 'frog', name: 'Frog', source: '05-frog.jpg' },
  { id: 'owl', name: 'Owl', source: '06-owl.jpg' },
  { id: 'bear', name: 'Bear', source: '07-bear.jpg' },
  { id: 'wolf', name: 'Wolf', source: '08-wolf.jpg' },
  { id: 'raccoon', name: 'Raccoon', source: '09-raccoon.jpg' },
  { id: 'otter', name: 'Otter', source: '10-otter.jpg' },
  { id: 'deer', name: 'Deer', source: '11-deer.jpg' },
  { id: 'penguin', name: 'Penguin', source: '12-penguin.jpg' },
];

/**
 * Common grades stay photographic so a plain seat still looks like a real photo; only the scarce
 * grades recolour hard, which is what makes pulling one feel like something.
 */
export const ORIGINAL_LIGHTS: OriginalLight[] = lightTable as OriginalLight[];

export interface OriginalVariant {
  animal: OriginalAnimal;
  light: OriginalLight;
  /** Filename inside the pinned art folder. */
  file: string;
}

export function originalVariantFile(animalId: string, lightId: string): string {
  return `${animalId}-${lightId}.jpg`;
}

/**
 * The single 1-of-1. Exactly one seat in every Originals run holds it.
 *
 * It sits outside the animal × light matrix on purpose: it is never colour graded, so there is one
 * of it and no near-misses. Which seat number holds it is decided by the series seed like everything
 * else, so it cannot be predicted before the series is created.
 */
export const ORIGINALS_ONE_OF_ONE: OriginalVariant = {
  animal: { id: 'ponsvault', name: 'PonsVault', source: 'one-of-one.png' },
  light: { id: 'oneofone', name: '1 of 1', weight: 0 },
  file: 'one-of-one.jpg',
};

/** Every graded combination plus the 1-of-1 — exactly what gets pinned as the shared art folder. */
export function allOriginalVariants(): OriginalVariant[] {
  const out: OriginalVariant[] = [];
  for (const animal of ORIGINAL_ANIMALS) {
    for (const light of ORIGINAL_LIGHTS) {
      out.push({ animal, light, file: originalVariantFile(animal.id, light.id) });
    }
  }
  out.push(ORIGINALS_ONE_OF_ONE);
  return out;
}

/** Small deterministic PRNG so a series seed always produces the same shuffle. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Builds the seat → variant assignment for one series.
 *
 * Rarity is allocated by exact count rather than per-seat dice rolls, so the published rarity table
 * is the truth: an Ash seat really is 1-in-1111-scale scarce, not scarce on average.
 */
export function buildOriginalsAssignment(seriesSeed: string): OriginalVariant[] {
  const totalLightWeight = ORIGINAL_LIGHTS.reduce((sum, light) => sum + light.weight, 0);
  const random = mulberry32(seedFrom(seriesSeed));

  // One seat is reserved for the 1-of-1, so the grades share what is left.
  const gradedSupply = PONS_ORIGINALS_SUPPLY - 1;

  const pool: OriginalVariant[] = [];
  for (const light of ORIGINAL_LIGHTS) {
    const lightCount = Math.round((gradedSupply * light.weight) / totalLightWeight);
    // A grade scarcer than the animal roster cannot cover every animal — Prism is 11 seats across 12
    // animals. Rotating where each grade starts decides that omission per series, because a fixed
    // start would cut the same trailing animals out of every series ever launched.
    const start = Math.floor(random() * ORIGINAL_ANIMALS.length);
    for (let i = 0; i < lightCount; i++) {
      const animal = ORIGINAL_ANIMALS[(start + i) % ORIGINAL_ANIMALS.length];
      pool.push({
        animal,
        light,
        file: originalVariantFile(animal.id, light.id),
      });
    }
  }

  // Rounding can leave the pool a few short or long; top up with the most common grade.
  const common = ORIGINAL_LIGHTS[0];
  let index = Math.floor(random() * ORIGINAL_ANIMALS.length);
  while (pool.length < gradedSupply) {
    const animal = ORIGINAL_ANIMALS[index++ % ORIGINAL_ANIMALS.length];
    pool.push({ animal, light: common, file: originalVariantFile(animal.id, common.id) });
  }
  pool.length = gradedSupply;

  pool.push(ORIGINALS_ONE_OF_ONE);

  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  return pool;
}

/** Rarity table shown in the UI, as a share of the fixed supply. Rarest last. */
export function originalsRarityTable(): Array<{ name: string; count: number; percent: number }> {
  const total = ORIGINAL_LIGHTS.reduce((sum, light) => sum + light.weight, 0);
  const gradedSupply = PONS_ORIGINALS_SUPPLY - 1;

  const percentOf = (count: number) => Math.round((count / PONS_ORIGINALS_SUPPLY) * 1000) / 10;

  const rows = ORIGINAL_LIGHTS.map((light) => {
    const count = Math.round((gradedSupply * light.weight) / total);
    return { name: light.name, count, percent: percentOf(count) };
  });

  rows.push({
    name: ORIGINALS_ONE_OF_ONE.light.name,
    count: 1,
    percent: percentOf(1),
  });

  return rows;
}
