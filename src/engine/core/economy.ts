import { AFFINITY, BUILDINGS, ECON, RACES, TIERS } from './data';
import { key, withinRadius } from './hex';
import { upkeep } from './upkeep';
import type { GameState, KingdomId, RaceId, Resources, TerrainId, Village } from './types';

const clamp = (x: number) => Math.min(100, Math.max(0, x));
const RES: (keyof Resources)[] = ['food', 'gold', 'wood', 'stone', 'iron', 'horses', 'mana'];

export const totalPop = (v: Village) => Object.values(v.populationByRace).reduce((t, n) => t + (n ?? 0), 0);

export function majorityRace(v: Village): RaceId {
  const e = Object.entries(v.populationByRace) as [RaceId, number][];
  return e.sort((a, b) => b[1] - a[1])[0][0];
}

const has = (v: Village, id: string) => v.buildings.some((b) => b.id === id);
const sumB = (v: Village, f: (b: (typeof BUILDINGS)[string]) => number | undefined) =>
  v.buildings.reduce((t, b) => t + (f(BUILDINGS[b.id]) ?? 0), 0);

export const popCap = (v: Village) => Math.round(TIERS[v.tier].popCap * (1 + sumB(v, (b) => b.popCapPct)));
export const slotsFree = (v: Village) => TIERS[v.tier].slots - v.buildings.length - v.buildQueue.length;

export function terrainInRadius(state: GameState, v: Village, terrain: TerrainId): number {
  return withinRadius(v.hex, TIERS[v.tier].radius).filter((h) => state.map.tiles[key(h)]?.terrain === terrain).length;
}
const overlayInRadius = (state: GameState, v: Village, o: 'ley' | 'goldDeposit') =>
  withinRadius(v.hex, TIERS[v.tier].radius).some((h) => state.map.tiles[key(h)]?.[o]);

export function buildCost(race: RaceId, id: string): Partial<Resources> {
  const r = RACES[race];
  const mult = r.buildingCostMult * (r.costMult?.[id] ?? 1);
  return Object.fromEntries(Object.entries(BUILDINGS[id].cost).map(([k, n]) => [k, Math.round(n * mult)]));
}

export const canAfford = (have: Resources, cost: Partial<Resources>) => RES.every((k) => have[k] >= (cost[k] ?? 0));

/** Returns the reason a building cannot be started, or null. */
export function buildBlocker(state: GameState, kid: KingdomId, v: Village, id: string): string | null {
  const b = BUILDINGS[id];
  const k = state.kingdoms[kid];
  if (!b) return 'Unknown building';
  if (v.ownerId !== kid) return 'Not your village';
  if (has(v, id) || v.buildQueue.some((q) => q.id === id)) return 'Already built or under construction';
  if (slotsFree(v) <= 0) return 'No free building slots';
  if (RACES[k.race].forbiddenBuildings.includes(id)) return `${RACES[k.race].name} cannot build ${b.name}`;
  if (b.race && !(v.populationByRace[b.race] && v.populationByRace[b.race]! > 0)) return `Needs ${RACES[b.race].name} people in the village`;
  if (b.minTier && ECON.tierOrder.indexOf(v.tier) < ECON.tierOrder.indexOf(b.minTier)) return `Requires ${b.minTier} tier`;
  if (b.capitalOnly && k.capitalId !== v.id) return 'Capital only';
  if (b.onTerrain && !b.onTerrain.includes(state.map.tiles[key(v.hex)].terrain)) return `Must stand on ${b.onTerrain.join(' or ')}`;
  if (b.terrain && !b.terrain.some((t) => terrainInRadius(state, v, t) > 0)) return `Needs ${b.terrain.join(' or ')} in work radius`;
  if (b.overlay && !overlayInRadius(state, v, b.overlay)) return b.overlay === 'ley' ? 'Needs a Ley Node in work radius' : 'Needs a gold deposit in work radius';
  if (b.onOverlay && !state.map.tiles[key(v.hex)]?.[b.onOverlay]) return 'Must stand on a Ley Node';
  if (b.needsBuilding && !has(v, b.needsBuilding)) return `Requires ${BUILDINGS[b.needsBuilding].name}`;
  if (b.needsIncome && !Object.values(state.villages).some((o) => o.ownerId === kid && o.buildings.some((x) => BUILDINGS[x.id].produces?.[b.needsIncome!])))
    return `Needs ${b.needsIncome} income`;
  if (!canAfford(k.resources, buildCost(k.race, id))) return 'Not enough resources';
  return null;
}

/** Workers go to buildings in priority order; output scales with staffing. */
export function assignWorkers(v: Village): Record<string, number> {
  const order = [...v.workerPriority.filter((id) => has(v, id)), ...v.buildings.map((b) => b.id).filter((id) => !v.workerPriority.includes(id))];
  let left = totalPop(v);
  const out: Record<string, number> = {};
  for (const id of order) {
    const need = BUILDINGS[id].workers;
    out[id] = Math.min(need, left);
    left -= out[id];
  }
  return out;
}

export function effectiveStability(state: GameState, v: Village): number {
  const S = ECON.stability;
  const pop = totalPop(v);
  const major = pop ? majorityRace(v) : null;
  let s = v.stability - v.conquestPenalty;
  if (major) s += RACES[major].stabilityBase;
  s += sumB(v, (b) => b.stability);
  if (v.recentConscription > pop * S.conscriptionShare) s += S.conscription;
  if (v.ownerId && Object.values(state.companies).some((c) => c.ownerId === v.ownerId && c.status === 'garrison' && key(c.hex) === key(v.hex))) s += S.garrison;
  if (major) {
    const temple = has(v, 'temple') ? 0.5 : 1;
    for (const [r, n] of Object.entries(v.populationByRace) as [RaceId, number][]) {
      if (r === major || n <= pop * S.minorityShare) continue;
      const a = AFFINITY[major][r];
      s += a < 0 ? S.minorityPenalty * temple : a > 0 ? S.minorityBonus : 0;
    }
  }
  if (v.ownerId) s -= state.kingdoms[v.ownerId].warWeariness / S.warWeariness;
  return clamp(s);
}

export const stabilityMult = (s: number) =>
  s >= ECON.stability.bonusAt ? ECON.stability.bonusMult : s < ECON.stability.penaltyBelow ? ECON.stability.penaltyMult : 1;

export interface VillageEconomy {
  produced: Resources;
  taxGold: number;
  foodUse: number;
  stability: number;
  workers: Record<string, number>;
}

export function villageEconomy(state: GameState, v: Village): VillageEconomy {
  const stab = effectiveStability(state, v);
  const mult = stabilityMult(stab);
  const pop = totalPop(v);
  const major = pop ? majorityRace(v) : 'valdren';
  const workers = assignWorkers(v);
  const produced = Object.fromEntries(RES.map((k) => [k, 0])) as unknown as Resources;
  if (v.ownerId) produced.food += ECON.villageCenterFood;
  for (const inst of v.buildings) {
    const def = BUILDINGS[inst.id];
    if (!def.produces) continue;
    const staff = def.workers ? Math.min(1, workers[inst.id] / def.workers) : 1;
    const race = RACES[major].outputMult[inst.id] ?? 1;
    for (const [k, n] of Object.entries(def.produces) as [keyof Resources, number][]) produced[k] += n * staff * race * mult;
  }
  const rate = ECON.tax[v.taxLevel].gold;
  const taxGold = v.ownerId ? (pop / 100) * rate * (1 + sumB(v, (b) => b.taxBonus)) * mult : 0;
  return { produced, taxGold, foodUse: (pop / 100) * ECON.foodPer100Civilians, stability: stab, workers };
}

/** Per-turn income of a kingdom, after the upkeep of its soldiers. */
export function kingdomIncome(state: GameState, kid: KingdomId) {
  const net = Object.fromEntries(RES.map((k) => [k, 0])) as unknown as Resources;
  for (const v of Object.values(state.villages)) {
    if (v.ownerId !== kid) continue;
    const e = villageEconomy(state, v);
    for (const k of RES) net[k] += e.produced[k];
    net.gold += e.taxGold;
    net.food -= e.foodUse;
  }
  const u = upkeep(state, kid);
  net.gold -= u.gold;
  net.mana -= u.mana;
  net.food -= u.food;
  return net;
}
