import { distance, fromOffset, key, neighbors, parseKey, toPixel, withinRadius } from '../core/hex';
import { type Rng } from '../core/rng';
import type { HexCoord, MapData, MapSize, Region, TerrainId, Tile } from '../core/types';
import cfg from '../data/mapgen.json';
import { fbm } from './noise';
import type { createNamer } from './names';

type Namer = ReturnType<typeof createNamer>;

/** Picks up to `count` candidates at least `minDist` apart from each other and from `avoid`. */
export function scatter(rng: Rng, candidates: HexCoord[], count: number, minDist: number, avoid: HexCoord[] = []): HexCoord[] {
  const pool = [...candidates];
  const out: HexCoord[] = [];
  while (out.length < count && pool.length) {
    const i = Math.floor(rng() * pool.length);
    const [h] = pool.splice(i, 1);
    if ([...out, ...avoid].every((o) => distance(o, h) >= minDist)) out.push(h);
  }
  return out;
}

export function generateMap(seed: string, size: MapSize, rng: Rng, namer: Namer): MapData {
  const sz = cfg.sizes[size];
  const { width, height } = sz;
  const T = cfg.terrain, N = cfg.noise;

  // 1. Elevation and moisture noise, sampled in pixel space so hexes are not distorted.
  const cells = [] as { h: HexCoord; elev: number; moist: number; edge: number }[];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const h = fromOffset(col, row);
      const p = toPixel(h, 1);
      cells.push({
        h,
        elev: fbm(seed, 'elev', p.x * N.elevationScale, p.y * N.elevationScale, N.octaves, N.persistence),
        moist: fbm(seed, 'moist', p.x * N.moistureScale, p.y * N.moistureScale, N.octaves, N.persistence),
        edge: Math.min(col, row, width - 1 - col, height - 1 - row),
      });
    }
  }

  // 2. Terrain by quantile, so every seed gets a sensible mix.
  const terrain = new Map<string, TerrainId>();
  const byElev = [...cells].sort((a, b) => b.elev - a.elev);
  const medianElev = byElev[Math.floor(byElev.length / 2)].elev;
  const isCoast = (c: (typeof cells)[number]) => c.edge === 0 || (c.edge <= T.coastEdgeDistance && c.elev < medianElev);
  const land = byElev.filter((c) => !isCoast(c));
  for (const c of cells) if (isCoast(c)) terrain.set(key(c.h), 'coast');
  const nMount = Math.round(cells.length * T.mountainShare), nHill = Math.round(cells.length * T.hillShare);
  land.slice(0, nMount).forEach((c) => terrain.set(key(c.h), 'mountains'));
  land.slice(nMount, nMount + nHill).forEach((c) => terrain.set(key(c.h), 'hills'));
  const rest = land.slice(nMount + nHill).sort((a, b) => b.moist - a.moist);
  const lowCut = rest.length ? [...rest].sort((a, b) => a.elev - b.elev)[Math.floor(rest.length / 2)].elev : 0;
  let marsh = Math.round(cells.length * T.marshShare), forest = Math.round(cells.length * T.forestShare);
  for (const c of rest) {
    if (marsh > 0 && c.elev <= lowCut) { terrain.set(key(c.h), 'marsh'); marsh--; }
    else if (forest > 0) { terrain.set(key(c.h), 'forest'); forest--; }
    else terrain.set(key(c.h), 'plains');
  }

  // 3. Regions: clusters of adjacent same-terrain hexes, each named.
  const tiles: Record<string, Tile> = {};
  const regions: Record<string, Region> = {};
  for (const c of cells) tiles[key(c.h)] = { q: c.h.q, r: c.h.r, terrain: terrain.get(key(c.h))!, regionId: '' };
  let n = 0;
  for (const c of cells) {
    const k0 = key(c.h);
    if (tiles[k0].regionId) continue;
    const t = tiles[k0].terrain;
    const id = `reg${++n}`;
    const hexes: string[] = [];
    const stack = [k0];
    tiles[k0].regionId = id;
    while (stack.length) {
      const k = stack.pop()!;
      hexes.push(k);
      for (const nb of neighbors(parseKey(k))) {
        const nk = key(nb);
        if (tiles[nk] && !tiles[nk].regionId && tiles[nk].terrain === t) { tiles[nk].regionId = id; stack.push(nk); }
      }
    }
    regions[id] = { id, name: namer.region(t), terrain: t, hexes };
  }

  // 4. Overlays: Ancient Forests, Ley Nodes, Ancient Ruins, gold deposits.
  const P = cfg.placement;
  const forests = Object.values(regions).filter((r) => r.terrain === 'forest' && r.hexes.length >= P.ancientForestMinSize).sort((a, b) => b.hexes.length - a.hexes.length);
  for (const reg of forests.slice(0, sz.ancientForests)) {
    const pts = reg.hexes.map(parseKey);
    const mid = { q: pts.reduce((t, p) => t + p.q, 0) / pts.length, r: pts.reduce((t, p) => t + p.r, 0) / pts.length };
    const centre = pts.reduce((m, p) => (distance(p, mid) < distance(m, mid) ? p : m));
    for (const h of withinRadius(centre, P.ancientForestRadius)) {
      const t = tiles[key(h)];
      if (t && t.terrain === 'forest') t.ancientForest = true;
    }
  }
  const inland = cells.map((c) => c.h).filter((h) => tiles[key(h)].terrain !== 'coast');
  const weight = (h: HexCoord) => ({ hills: 3, mountains: 3, forest: 2 } as Partial<Record<TerrainId, number>>)[tiles[key(h)].terrain] ?? 1;
  const weighted = inland.flatMap((h) => Array<HexCoord>(weight(h)).fill(h));
  const leys = scatter(rng, weighted, sz.leyNodes, P.leyMinDistance);
  for (const h of leys) tiles[key(h)].ley = true;
  const ruins = scatter(rng, inland.filter((h) => !tiles[key(h)].ley), sz.ruins, P.ruinsMinDistance);
  for (const h of ruins) tiles[key(h)].ruins = true;
  const gold = scatter(rng, inland.filter((h) => tiles[key(h)].terrain === 'mountains'), sz.goldDeposits, 2);
  for (const h of gold) tiles[key(h)].goldDeposit = true;

  return { width, height, size, tiles, regions };
}
