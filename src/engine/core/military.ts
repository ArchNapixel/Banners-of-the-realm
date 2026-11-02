import { createRng, hashSeed } from './rng';
import { createNamer } from '../mapgen/names';
import { NEUTRAL } from './kingdoms';
import { recruitBlocker, unlockSlot } from './recruit';
import { BUILDINGS, ECON, RACES } from './data';
import { canAfford } from './economy';
import { distance, key, neighbors } from './hex';
import { speedOf } from './movement';
import { UNIT_DEFS, companyMen } from './units';
import { upkeep } from './upkeep';
import type { Army, Company, GameState, HexCoord, KingdomId, RaceId, Rank, Resources, TrainItem } from './types';
import { updateExplored } from './vision';

const RANKS: Rank[] = ['green', 'trained', 'veteran', 'elite'];
const clamp = (x: number) => Math.min(100, Math.max(0, x));
const pay = (res: Resources, cost: Partial<Resources>) => {
  for (const [k, n] of Object.entries(cost) as [keyof Resources, number][]) res[k] -= n;
};

export function newCompany(s: GameState, kid: KingdomId, unitType: string, race: RaceId, men: number, hex: HexCoord): Company {
  const c: Company = {
    id: `c${s.nextId++}`, ownerId: kid, unitType, race, men, maxMen: men, rank: 'green', battlesSurvived: 0,
    armyId: null, hex: { q: hex.q, r: hex.r }, movementLeft: 0, moved: 0, forced: false, status: 'ready', morale: 100, recovering: [],
  };
  c.movementLeft = speedOf(c);
  s.companies[c.id] = c;
  return c;
}

/** Takes a company out of the game, and out of its army (which disbands when empty). */
export function removeCompany(s: GameState, c: Company) {
  if (c.armyId && s.armies[c.armyId]) {
    const a = s.armies[c.armyId];
    a.companyIds = a.companyIds.filter((id) => id !== c.id);
    if (!a.companyIds.length) delete s.armies[a.id];
  }
  delete s.companies[c.id];
}

// ---- recruitment ----

export function recruit(s: GameState, kid: KingdomId, villageId: string, unitId: string, race: RaceId): string | undefined {
  const v = s.villages[villageId];
  const err = recruitBlocker(s, kid, v, unitId, race);
  if (err) return err;
  const def = UNIT_DEFS[unitId];
  const men = companyMen(unitId, race);
  const bonus = v.buildings.reduce((t, b) => t + (BUILDINGS[b.id].trainingBonus ?? 0), 0);
  pay(s.kingdoms[kid].resources, def.cost!);
  v.populationByRace[race] = v.populationByRace[race]! - men;
  v.recentConscription += men;
  const slot = unlockSlot(unitId);
  const item: TrainItem = { id: unitId, turnsLeft: Math.max(1, def.turns! - bonus), race, men, slot };
  v.trainQueue.push(item);
}

/** Step 3: finished training turns into companies standing in the village, Green. */
export function advanceTraining(s: GameState, say: (t: string, villageId?: string, kid?: string) => void) {
  for (const v of Object.values(s.villages)) {
    for (const q of v.trainQueue) q.turnsLeft--;
    for (const q of v.trainQueue.filter((x) => x.turnsLeft <= 0)) {
      if (!v.ownerId) continue;
      newCompany(s, v.ownerId, q.id, q.race, q.men, v.hex);
      say(`${UNIT_DEFS[q.id].name} finished training in ${v.name}`, v.id, v.ownerId);
    }
    v.trainQueue = v.trainQueue.filter((x) => x.turnsLeft > 0);
  }
}

// ---- armies ----

const sync = (s: GameState, a: Army) => {
  const cs = a.companyIds.map((id) => s.companies[id]);
  const mp = Math.min(...cs.map((c) => c.movementLeft)), moved = Math.max(...cs.map((c) => c.moved));
  for (const c of cs) { c.movementLeft = mp; c.moved = moved; c.forced = cs.some((x) => x.forced); }
};

/** Forms an army from companies on one hex, or joins them to the army one of them already belongs to. */
export function merge(s: GameState, kid: KingdomId, ids: string[]): string | undefined {
  const cs = ids.map((id) => s.companies[id]);
  if (!cs.length || cs.some((c) => !c)) return 'Unknown company';
  if (cs.some((c) => c.ownerId !== kid)) return 'Not your company';
  if (cs.some((c) => key(c.hex) !== key(cs[0].hex))) return 'Companies must be on the same hex';
  if (cs.some((c) => c.battleId)) return 'Companies in battle cannot change formation';
  const target = cs.find((c) => c.armyId);
  let army = target ? s.armies[target.armyId!] : undefined;
  if (!army) {
    const n = Object.values(s.armies).filter((a) => a.ownerId === kid).length + 1;
    army = { id: `a${s.nextId++}`, ownerId: kid, name: `Army ${n}`, companyIds: [], hex: { ...cs[0].hex }, stance: 'hold' };
    s.armies[army.id] = army;
  }
  for (const c of cs) {
    if (c.armyId === army.id) continue;
    if (c.armyId) {
      const old = s.armies[c.armyId];
      old.companyIds = old.companyIds.filter((x) => x !== c.id);
      if (!old.companyIds.length) delete s.armies[old.id];
    }
    c.armyId = army.id;
    army.companyIds.push(c.id);
  }
  sync(s, army);
}

/** Companies leave their army and stand alone on the same hex. */
export function split(s: GameState, kid: KingdomId, ids: string[]): string | undefined {
  const cs = ids.map((id) => s.companies[id]);
  if (!cs.length || cs.some((c) => !c)) return 'Unknown company';
  if (cs.some((c) => c.ownerId !== kid)) return 'Not your company';
  if (cs.some((c) => !c.armyId)) return 'Not in an army';
  if (cs.some((c) => c.battleId)) return 'Companies in battle cannot change formation';
  for (const c of cs) {
    const a = s.armies[c.armyId!];
    a.companyIds = a.companyIds.filter((x) => x !== c.id);
    c.armyId = null;
    if (!a.companyIds.length) delete s.armies[a.id];
  }
}

export function setStance(s: GameState, kid: KingdomId, armyId: string, stance: Army['stance']): string | undefined {
  const a = s.armies[armyId];
  if (!a || a.ownerId !== kid) return 'Not your army';
  if (!a.commanderId && stance !== 'hold') return 'Armies without a commander are locked to Hold';
  a.stance = stance;
}

export function setStatus(s: GameState, kid: KingdomId, companyId: string, status: 'ready' | 'garrison'): string | undefined {
  const c = s.companies[companyId];
  if (!c || c.ownerId !== kid) return 'Not your company';
  if (c.battleId) return 'In battle';
  if (status === 'garrison' && !Object.values(s.villages).some((v) => v.ownerId === kid && key(v.hex) === key(c.hex))) return 'Garrisons must be in one of your villages';
  c.status = status;
}

// ---- replenishing, founding, roads ----

/** Refill lost men from the village (of the company's race) for a share of the original gold cost. */
export function replenish(s: GameState, kid: KingdomId, companyId: string): string | undefined {
  const c = s.companies[companyId];
  if (!c || c.ownerId !== kid) return 'Not your company';
  if (c.battleId) return 'In battle';
  const v = Object.values(s.villages).find((x) => x.ownerId === kid && key(x.hex) === key(c.hex));
  if (!v) return 'Must be in one of your villages';
  const def = UNIT_DEFS[c.unitType];
  if (!def.cost) return 'This company cannot be replenished';
  const lost = c.maxMen - c.men;
  if (lost <= 0) return 'Already at full strength';
  const avail = v.populationByRace[c.race] ?? 0;
  const take = Math.min(lost, avail);
  if (take <= 0) return `No ${RACES[c.race].name} people here`;
  const gold = Math.ceil((take / c.maxMen) * (def.cost.gold ?? 0));
  const k = s.kingdoms[kid];
  if (!canAfford(k.resources, { gold })) return 'Not enough resources';
  pay(k.resources, { gold });
  v.populationByRace[c.race] = avail - take;
  v.recentConscription += take;
  c.men += take;
  if (take / c.maxMen > ECON.military.replenishNewShare) c.rank = RANKS[Math.max(0, RANKS.indexOf(c.rank) - 1)];
}

export function found(s: GameState, kid: KingdomId, companyId: string): string | undefined {
  const c = s.companies[companyId];
  if (!c || c.ownerId !== kid) return 'Not your company';
  if (c.unitType !== 'settlers') return 'Only settlers can found a village';
  if (c.battleId) return 'In battle';
  const tile = s.map.tiles[key(c.hex)];
  if (!tile) return 'Off the map';
  if (Object.values(s.villages).some((v) => distance(v.hex, c.hex) < ECON.military.foundMinDistance)) return `Too close to another village (needs ${ECON.military.foundMinDistance}+ hexes)`;
  const rng = createRng(hashSeed(s.seed, 'found', s.nextId));
  const id = `v${Object.keys(s.villages).length + 1}`;
  s.villages[id] = {
    id, name: createNamer(rng, s.usedNames).village(c.race), ownerId: kid, hex: { ...c.hex }, tier: 'hamlet',
    populationByRace: { [c.race]: c.men }, stability: ECON.military.newVillageStability, taxLevel: 'normal',
    buildings: [], buildQueue: [], trainQueue: [], workerPriority: [], stores: 3, recentConscription: 0, conquestPenalty: 0, borderRadius: 2,
  };
  removeCompany(s, c);
  s.log.push({ turn: s.turn, text: `${s.villages[id].name} founded`, villageId: id, kingdomId: kid });
  updateExplored(s);
}

export function buildRoad(s: GameState, kid: KingdomId, hex: HexCoord): string | undefined {
  const k = s.kingdoms[kid];
  const h = key(hex);
  if (!s.map.tiles[h]) return 'Off the map';
  if (s.roads[h]) return 'There is already a road here';
  const own = Object.values(s.villages).filter((v) => v.ownerId === kid);
  const near = own.some((v) => distance(v.hex, hex) <= v.borderRadius) || neighbors(hex).some((n) => s.roads[key(n)] === kid);
  if (!near) return 'Roads must start in your territory and connect to your roads';
  const cost = ECON.military.roadCost;
  if (!canAfford(k.resources, cost)) return 'Not enough resources';
  pay(k.resources, cost);
  s.roads[h] = kid;
}

// ---- upkeep, supply, attrition (resolution steps 5 and 6) ----

export function applyUpkeep(s: GameState, say: (t: string, villageId?: string, kid?: string) => void) {
  for (const k of Object.values(s.kingdoms)) {
    const u = upkeep(s, k.id);
    k.resources.gold -= u.gold;
    k.resources.mana -= u.mana;
    const broke = k.resources.gold < 0, drained = k.resources.mana < 0;
    k.resources.gold = Math.max(0, k.resources.gold);
    k.resources.mana = Math.max(0, k.resources.mana);
    if (!broke && !drained) continue;
    say(`${k.name} cannot pay its troops: companies desert!`, undefined, k.id);
    for (const c of Object.values(s.companies).filter((x) => x.ownerId === k.id)) {
      if (!broke && !(UNIT_DEFS[c.unitType].upkeep?.mana)) continue;
      c.men -= Math.max(1, Math.round(c.men * ECON.military.desertionShare));
      if (c.men <= 0) removeCompany(s, c);
    }
  }
}

/** Hexes on a road network connected to one of the kingdom's villages. */
function roadNetwork(s: GameState, kid: KingdomId): Set<string> {
  const seen = new Set<string>();
  const stack = Object.values(s.villages).filter((v) => v.ownerId === kid).map((v) => v.hex);
  for (const h of stack) seen.add(key(h));
  while (stack.length) {
    for (const n of neighbors(stack.pop()!)) {
      const k = key(n);
      if (!seen.has(k) && s.roads[k] === kid) { seen.add(k); stack.push(n); }
    }
  }
  return seen;
}

export function inSupply(s: GameState, c: Company, net = roadNetwork(s, c.ownerId)): boolean {
  if (net.has(key(c.hex))) return true;
  return Object.values(s.villages).some((v) => v.ownerId === c.ownerId && distance(v.hex, c.hex) <= ECON.military.supplyRadius);
}

export function applySupply(s: GameState, say: (t: string, villageId?: string, kid?: string) => void) {
  const nets = new Map<KingdomId, Set<string>>();
  const foraged = new Set<string>();
  const lost: Record<KingdomId, number> = {};
  for (const c of Object.values(s.companies)) {
    if (c.unitType === 'settlers' || c.ownerId === NEUTRAL) continue;
    if (!nets.has(c.ownerId)) nets.set(c.ownerId, roadNetwork(s, c.ownerId));
    const supplied = inSupply(s, c, nets.get(c.ownerId));
    const race = RACES[c.race];
    const marsh = s.map.tiles[key(c.hex)].terrain === 'marsh' && !race.marshImmune;
    if (supplied && !marsh) continue;

    // Foraging in another kingdom's land halves attrition (Ghor: none) and hurts the nearest village there.
    const enemyVillage = Object.values(s.villages)
      .filter((v) => v.ownerId && v.ownerId !== c.ownerId && distance(v.hex, c.hex) <= v.borderRadius)
      .sort((a, b) => distance(a.hex, c.hex) - distance(b.hex, c.hex))[0];
    const foraging = !supplied && !!enemyVillage;
    if (foraging && !foraged.has(enemyVillage.id)) {
      foraged.add(enemyVillage.id);
      enemyVillage.stability = clamp(enemyVillage.stability + ECON.military.forageStability);
      const owner = s.kingdoms[enemyVillage.ownerId!];
      owner.resources.food = Math.max(0, owner.resources.food - ECON.military.forageFood);
    }
    if (foraging && race.foragingNoAttrition) continue;
    const loss = Math.max(1, Math.round(c.men * ECON.military.attritionShare * (foraging ? ECON.military.forageMult : 1)));
    c.men -= loss;
    lost[c.ownerId] = (lost[c.ownerId] ?? 0) + loss;
    if (c.men <= 0) removeCompany(s, c);
  }
  for (const [kid, n] of Object.entries(lost)) say(`Attrition: ${n} men lost to hunger and hardship`, undefined, kid);
}
