/** Small, fast, seeded random number generator (mulberry32). Same seed, same sequence. */
export type Rng = () => number;

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const range = (rng: Rng, min: number, max: number) => min + rng() * (max - min);
export const pick = <T,>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)];

/** Stable seed from tile coordinates, so a tile looks the same every time it is built. */
export const seedFor = (x: number, z: number, salt = 0) =>
  ((x * 73856093) ^ (z * 19349663) ^ (salt * 83492791)) >>> 0;
