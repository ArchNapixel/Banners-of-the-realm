import { buildBlocker, buildCost, canAfford, popCap, totalPop } from './economy';
import { BUILDINGS, ECON, TIERS } from './data';
import { prisonerAction, setChampion, withdraw } from './battles';
import { annex, resolveCapture } from './siege';
import { buildRoad, found, merge, recruit, replenish, setStance, setStatus, split } from './military';
import { moveUnit } from './movement';
import { cloneState } from './state';
import type { RevealTrigger } from '../battle/types';
import type { GameState, HexCoord, KingdomId, RaceId, Resources, Stance, TaxLevel, VillageId } from './types';

export type Order =
  | { type: 'setTax'; kingdomId: KingdomId; villageId: VillageId; level: TaxLevel }
  | { type: 'build'; kingdomId: KingdomId; villageId: VillageId; building: string }
  | { type: 'upgrade'; kingdomId: KingdomId; villageId: VillageId }
  | { type: 'setWorkerPriority'; kingdomId: KingdomId; villageId: VillageId; order: string[] }
  | { type: 'recruit'; kingdomId: KingdomId; villageId: VillageId; unit: string; race: RaceId }
  | { type: 'replenish'; kingdomId: KingdomId; companyId: string }
  | { type: 'move'; kingdomId: KingdomId; unitId: string; to: HexCoord; forced?: boolean }
  | { type: 'merge'; kingdomId: KingdomId; companyIds: string[] }
  | { type: 'split'; kingdomId: KingdomId; companyIds: string[] }
  | { type: 'setStance'; kingdomId: KingdomId; armyId: string; stance: Stance }
  | { type: 'setStatus'; kingdomId: KingdomId; companyId: string; status: 'ready' | 'garrison' }
  | { type: 'found'; kingdomId: KingdomId; companyId: string }
  | { type: 'buildRoad'; kingdomId: KingdomId; hex: HexCoord }
  | { type: 'capture'; kingdomId: KingdomId; villageId: VillageId; choice: 'occupy' | 'sack' | 'raze' }
  | { type: 'annex'; kingdomId: KingdomId; villageId: VillageId }
  | { type: 'withdraw'; kingdomId: KingdomId; battleId: string }
  | { type: 'setChampion'; kingdomId: KingdomId; characterId: string; role: 'captain' | 'hidden'; trigger?: RevealTrigger }
  | { type: 'prisoners'; kingdomId: KingdomId; prisonerId: string; action: 'ransom' | 'conscript' | 'release' };

/** An order without its issuer; the store fills that in. */
export type OrderInput = Order extends infer O ? (O extends Order ? Omit<O, 'kingdomId'> : never) : never;

const pay = (res: Resources, cost: Partial<Resources>) => {
  for (const [k, n] of Object.entries(cost) as [keyof Resources, number][]) res[k] -= n;
};

function villageOrder(s: GameState, o: Exclude<Extract<Order, { villageId: string }>, { type: 'capture' | 'annex' }>): string | undefined {
  const v = s.villages[o.villageId];
  const k = s.kingdoms[o.kingdomId];
  if (!v || !k) return 'Unknown village or kingdom';
  if (v.ownerId !== o.kingdomId) return 'Not your village';

  switch (o.type) {
    case 'setTax':
      if (!ECON.tax[o.level]) return 'Unknown tax level';
      v.taxLevel = o.level;
      return;
    case 'build': {
      const err = buildBlocker(s, o.kingdomId, v, o.building);
      if (err) return err;
      pay(k.resources, buildCost(k.race, o.building));
      v.buildQueue.push({ id: o.building, turnsLeft: BUILDINGS[o.building].turns });
      return;
    }
    case 'upgrade': {
      const next = TIERS[v.tier].next;
      const cost = next && TIERS[next].upgrade; // the table lists the cost to reach each tier
      if (!next || !cost) return 'Already at the highest tier';
      if (totalPop(v) < popCap(v) * ECON.upgradePopShare) return `Needs ${Math.round(ECON.upgradePopShare * 100)}% of the population cap`;
      if (!canAfford(k.resources, cost)) return 'Not enough resources';
      pay(k.resources, cost);
      v.tier = next;
      return;
    }
    case 'setWorkerPriority':
      v.workerPriority = o.order.filter((id) => BUILDINGS[id]);
      return;
    case 'recruit':
      return recruit(s, o.kingdomId, o.villageId, o.unit, o.race);
  }
}

/** Applies one order to `s` in place; returns an error message, or undefined on success. */
export function execute(s: GameState, o: Order): string | undefined {
  if (!s.kingdoms[o.kingdomId]) return 'Unknown kingdom';
  switch (o.type) {
    case 'capture': return resolveCapture(s, o.kingdomId, o.villageId, o.choice);
    case 'annex': return annex(s, o.kingdomId, o.villageId);
    case 'replenish': return replenish(s, o.kingdomId, o.companyId);
    case 'move': return moveUnit(s, o.kingdomId, o.unitId, o.to, o.forced);
    case 'merge': return merge(s, o.kingdomId, o.companyIds);
    case 'split': return split(s, o.kingdomId, o.companyIds);
    case 'setStance': return setStance(s, o.kingdomId, o.armyId, o.stance);
    case 'setStatus': return setStatus(s, o.kingdomId, o.companyId, o.status);
    case 'found': return found(s, o.kingdomId, o.companyId);
    case 'buildRoad': return buildRoad(s, o.kingdomId, o.hex);
    case 'withdraw': return withdraw(s, o.kingdomId, o.battleId);
    case 'setChampion': return setChampion(s, o.kingdomId, o.characterId, o.role, o.trigger);
    case 'prisoners': return prisonerAction(s, o.kingdomId, o.prisonerId, o.action);
    default: return villageOrder(s, o);
  }
}

/** Immediate-feedback helper for the UI: returns a new state, or the old one plus an error. */
export function applyOrder(state: GameState, order: Order): { state: GameState; error?: string } {
  const next = cloneState(state);
  const error = execute(next, order);
  return error ? { state, error } : { state: next };
}
