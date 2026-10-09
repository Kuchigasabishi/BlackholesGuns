/**
 * Injectable randomness. The engine itself is deterministic; the only random
 * rule in the GDD is the Sudden Death timeout attack (§10), which takes an Rng.
 */

/** Returns a float in [0, 1). */
export type Rng = () => number;

const hashSeed = (seed: number | string): number => {
  if (typeof seed === 'number') return seed >>> 0;
  // FNV-1a
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

/** mulberry32: small, fast, and reproducible across platforms. */
export function createSeededRng(seed: number | string): Rng {
  let a = hashSeed(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickRandom<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new RangeError('pickRandom on empty list');
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))] as T;
}
