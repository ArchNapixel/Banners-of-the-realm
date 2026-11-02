import type { HexCoord } from './types';

/** Axial coordinates, pointy-top hexes. */
export const key = (h: HexCoord) => `${h.q},${h.r}`;
export const parseKey = (k: string): HexCoord => {
  const [q, r] = k.split(',').map(Number);
  return { q, r };
};

const DIRS: HexCoord[] = [{ q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 }, { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }];

export const neighbors = (h: HexCoord): HexCoord[] => DIRS.map((d) => ({ q: h.q + d.q, r: h.r + d.r }));

export const distance = (a: HexCoord, b: HexCoord) => {
  const dq = a.q - b.q, dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
};

/** All hexes within `radius` of the centre, centre included. */
export function withinRadius(c: HexCoord, radius: number): HexCoord[] {
  const out: HexCoord[] = [];
  for (let dq = -radius; dq <= radius; dq++) {
    for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++) out.push({ q: c.q + dq, r: c.r + dr });
  }
  return out;
}

/** Rectangular map of `width` x `height` hexes, as axial coordinates (odd-r layout). */
export const fromOffset = (col: number, row: number): HexCoord => ({ q: col - Math.floor(row / 2), r: row });
export const toOffset = (h: HexCoord) => ({ col: h.q + Math.floor(h.r / 2), row: h.r });

export const toPixel = (h: HexCoord, size: number) => ({
  x: size * Math.sqrt(3) * (h.q + h.r / 2),
  y: size * 1.5 * h.r,
});

export function fromPixel(x: number, y: number, size: number): HexCoord {
  const q = ((Math.sqrt(3) / 3) * x - (1 / 3) * y) / size;
  const r = ((2 / 3) * y) / size;
  // cube rounding
  let rq = Math.round(q), rr = Math.round(r);
  const rs = Math.round(-q - r);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs + q + r);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq + 0, r: rr + 0 }; // + 0 turns -0 into 0
}
