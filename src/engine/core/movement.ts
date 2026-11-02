import { TERRAINS } from '../battle/data';
import { battleAt, sideOf } from './battles';
import { engageHex, villageAt } from './siege';
import { ECON, RACES } from './data';
import { key, neighbors } from './hex';
import type { Army, Company, GameState, HexCoord, KingdomId } from './types';
import { updateExplored } from './vision';
import { effectiveUnit } from './units';

export const speedOf = (c: Company) => effectiveUnit(c.unitType, c.race).speed;

/** Starting Fatigue in the next battle: 15 for a full-speed move, 30 for a forced march. */
export const startingFatigue = (c: Company) =>
  c.forced ? ECON.military.fatigueForced : c.moved >= speedOf(c) && c.moved > 0 ? ECON.military.fatigueFullMove : 0;

/** The companies that move together: an army, or one company on its own. */
export function members(s: GameState, id: string): { army?: Army; companies: Company[] } | null {
  const army = s.armies[id];
  if (army) return { army, companies: army.companyIds.map((c) => s.companies[c]) };
  const c = s.companies[id];
  return c ? { companies: [c] } : null;
}

export function stepCost(s: GameState, c: Company, from: HexCoord, to: HexCoord): number {
  if (s.roads[key(from)] === c.ownerId && s.roads[key(to)] === c.ownerId) return ECON.military.roadMove;
  const terrain = s.map.tiles[key(to)].terrain;
  return RACES[c.race].terrainMove[terrain] ?? TERRAINS[terrain].move;
}

const hostileHexes = (s: GameState, kid: KingdomId) =>
  new Set(Object.values(s.companies).filter((c) => c.ownerId !== kid).map((c) => key(c.hex)));

/** Zone of control: entering a hex next to an enemy army ends movement. */
export const inZoc = (hostile: Set<string>, h: HexCoord) => neighbors(h).some((n) => hostile.has(key(n)));

/** Cheapest route for the whole group; enemy-held hexes and foreign villages are closed until M5/M6. */
export function findPath(s: GameState, group: Company[], to: HexCoord): { path: HexCoord[]; cost: number } | null {
  const kid = group[0].ownerId;
  const from = group[0].hex;
  const hostile = hostileHexes(s, kid);
  const foreign = new Set(Object.values(s.villages).filter((v) => v.ownerId !== kid).map((v) => key(v.hex)));
  const goal = key(to);
  if (!s.map.tiles[goal]) return null;
  // The goal may hold an enemy army (that is how battles start) or an ongoing battle we are part of; nothing else is passable.
  if (hostile.has(goal)) {
    const gb = battleAt(s, to);
    if (gb && !sideOf(gb, kid)) return null;
  }
  // A village under someone else's siege is closed to everybody but the besieger and the owner.
  const goalVillage = villageAt(s, to);
  const sg = goalVillage && s.sieges[goalVillage.id];
  if (sg && sg.attackerId !== kid && goalVillage.ownerId !== kid) return null;

  const dist = new Map<string, number>([[key(from), 0]]);
  const prev = new Map<string, HexCoord>();
  const open = new Map<string, HexCoord>([[key(from), from]]);
  while (open.size) {
    let bestK = '', best = Infinity;
    for (const k of open.keys()) if (dist.get(k)! < best) { best = dist.get(k)!; bestK = k; }
    const cur = open.get(bestK)!;
    open.delete(bestK);
    if (bestK === goal) break;
    for (const n of neighbors(cur)) {
      const nk = key(n);
      if (!s.map.tiles[nk] || (nk !== goal && (hostile.has(nk) || foreign.has(nk)))) continue;
      const c = best + Math.max(...group.map((g) => stepCost(s, g, cur, n)));
      if (c < (dist.get(nk) ?? Infinity)) { dist.set(nk, c); prev.set(nk, cur); open.set(nk, n); }
    }
  }
  if (!dist.has(goal)) return null;
  const path: HexCoord[] = [];
  for (let h: HexCoord | undefined = to; h && key(h) !== key(from); h = prev.get(key(h))) path.unshift(h);
  return { path, cost: dist.get(goal)! };
}

/** Moves an army or company as far along the cheapest route as its movement allows. */
export function moveUnit(s: GameState, kid: KingdomId, unitId: string, to: HexCoord, forced = false): string | undefined {
  const m = members(s, unitId);
  if (!m) return 'Unknown unit';
  const { army, companies } = m;
  if (companies.some((c) => c.ownerId !== kid)) return 'Not your unit';
  if (!army && companies[0].armyId) return 'Move the army, or split the company out first';
  if (companies.some((c) => c.battleId)) return 'In battle: only a withdrawal is possible';
  if (companies.some((c) => c.status === 'broken')) return 'The company is regrouping';
  const from = companies[0].hex;
  if (key(from) === key(to)) return 'Already there';

  const route = findPath(s, companies, to);
  if (!route) return 'No route there (enemy armies and foreign villages block the way)';

  let mp = Math.min(...companies.map((c) => c.movementLeft));
  const wasForced = companies.some((c) => c.forced);
  if (forced && !wasForced) mp += ECON.military.forcedMarchMove;

  const hostile = hostileHexes(s, kid);
  let at = from, spent = 0, steps = 0;
  for (const h of route.path) {
    const cost = Math.max(...companies.map((c) => stepCost(s, c, at, h)));
    // A fresh unit can always enter one hex, however costly.
    const fresh = steps === 0 && companies.every((c) => c.moved === 0);
    if (mp + 1e-9 < cost && !fresh) break;
    const pay = Math.min(cost, mp);
    mp -= pay; spent += pay; steps++; at = h;
    if (inZoc(hostile, h)) { mp = 0; break; }
    if (mp <= 0) break;
  }
  if (!steps) return 'Not enough movement';

  for (const c of companies) {
    c.hex = { q: at.q, r: at.r };
    c.moved += spent;
    c.movementLeft = Math.max(0, mp);
    c.forced = wasForced || forced;
  }
  if (army) army.hex = { q: at.q, r: at.r };
  const village = villageAt(s, at);
  if (hostile.has(key(at)) || (village && village.ownerId !== kid)) {
    for (const c of companies) c.movementLeft = 0;
    engageHex(s, kid, companies, at);
  }
  updateExplored(s);
  return;
}

/** New turn: everyone gets their movement back. */
export function resetMovement(s: GameState) {
  for (const c of Object.values(s.companies)) { c.movementLeft = speedOf(c); c.moved = 0; c.forced = false; }
}
