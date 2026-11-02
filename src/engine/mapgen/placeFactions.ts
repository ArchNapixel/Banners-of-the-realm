import { distance, key, toOffset, withinRadius } from '../core/hex';
import { RACES } from '../core/data';
import type { Rng } from '../core/rng';
import type { HexCoord, MapData, RaceId } from '../core/types';
import cfg from '../data/mapgen.json';

const P = cfg.placement;

const edgeDistance = (map: MapData, h: HexCoord) => {
  const { col, row } = toOffset(h);
  return Math.min(col, row, map.width - 1 - col, map.height - 1 - row);
};

/** Capitals sit in their race's homeland, spread apart, preferring a few plains hexes for the starting farm. */
export function placeCapitals(map: MapData, races: RaceId[], rng: Rng): HexCoord[] {
  const placed: HexCoord[] = [];
  const all = Object.values(map.tiles).filter((t) => t.terrain !== 'coast' && !t.ruins && edgeDistance(map, t) >= P.capitalEdgeMargin);
  for (const race of races) {
    const home = RACES[race].homeland;
    let found: HexCoord | undefined;
    for (let minDist = P.capitalMinDistance; minDist >= 0 && !found; minDist -= 2) {
      for (const homeOnly of [true, false]) {
        const cands = all
          .filter((t) => (!homeOnly || home.includes(t.terrain)) && placed.every((p) => distance(p, t) >= minDist))
          .sort(() => rng() - 0.5)
          .slice(0, P.candidateSample);
        if (!cands.length) continue;
        const score = (t: HexCoord) =>
          withinRadius(t, 1).filter((h) => map.tiles[key(h)]?.terrain === 'plains').length +
          Math.min(20, Math.min(99, ...placed.map((p) => distance(p, t)))) / 10 +
          rng();
        found = cands.reduce((m, c) => (score(c) > score(m) ? c : m));
        break;
      }
    }
    if (!found) throw new Error('no room for a capital');
    placed.push({ q: found.q, r: found.r });
  }
  return placed;
}

/** Independent villages, away from capitals and each other. */
export function placeNeutrals(map: MapData, count: number, capitals: HexCoord[], rng: Rng): HexCoord[] {
  const land = Object.values(map.tiles)
    .filter((t) => t.terrain !== 'coast' && !t.ruins && !t.ley)
    .map((t) => ({ q: t.q, r: t.r }));
  const out: HexCoord[] = [];
  const pool = land.sort(() => rng() - 0.5);
  for (const h of pool) {
    if (out.length >= count) break;
    if (capitals.every((c) => distance(c, h) >= P.neutralMinCapitalDistance) && out.every((o) => distance(o, h) >= P.villageMinDistance)) out.push(h);
  }
  return out;
}
