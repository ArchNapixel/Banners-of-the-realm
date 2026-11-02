export type Rng = () => number;

/** FNV-1a over the joined parts, e.g. hashSeed(gameSeed, turn). */
export function hashSeed(...parts: (string | number)[]): number {
  const s = parts.join('|');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const between = (rng: Rng, lo: number, hi: number): number => lo + rng() * (hi - lo);

/** Rounds up with probability equal to the fraction, so small losses never vanish. */
export function stochRound(rng: Rng, x: number): number {
  const f = Math.floor(x);
  return f + (rng() < x - f ? 1 : 0);
}

export const pickOne = <T>(rng: Rng, xs: T[]): T => xs[Math.floor(rng() * xs.length)];
