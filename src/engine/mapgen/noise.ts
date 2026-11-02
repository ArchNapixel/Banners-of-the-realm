import { hashSeed } from '../core/rng';

const lattice = (seed: string, salt: string, x: number, y: number) => hashSeed(seed, salt, x, y) / 4294967296;
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Seeded value noise in [0,1). */
function valueNoise(seed: string, salt: string, x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const tx = smooth(x - x0), ty = smooth(y - y0);
  const a = lattice(seed, salt, x0, y0), b = lattice(seed, salt, x0 + 1, y0);
  const c = lattice(seed, salt, x0, y0 + 1), d = lattice(seed, salt, x0 + 1, y0 + 1);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/** Fractal noise normalised to [0,1]. */
export function fbm(seed: string, salt: string, x: number, y: number, octaves: number, persistence: number): number {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(seed, `${salt}${i}`, x * freq, y * freq);
    norm += amp;
    amp *= persistence;
    freq *= 2;
  }
  return sum / norm;
}
