import { effectiveStability, popCap, totalPop, villageEconomy } from './economy';
import { BUILDINGS, ECON, RACES } from './data';
import { execute, type Order } from './orders';
import { cloneState } from './state';
import type { GameState, RaceId, Resources } from './types';
import { runAI } from '../ai';
import { recoverTroops, resolveBattles } from './battles';
import { advanceSieges, autoOccupy, checkRevolts } from './siege';
import { advanceTraining, applySupply, applyUpkeep } from './military';
import { resetMovement } from './movement';
import { upkeep } from './upkeep';
import { updateExplored } from './vision';

const clamp = (x: number) => Math.min(100, Math.max(0, x));

/** Pure: returns a new state. Covers resolution steps 3, 4, 7 and fog of war; later milestones add the rest. */
export function resolveTurn(state: GameState, orders: Order[] = []): GameState {
  const s = cloneState(state);
  const say = (text: string, villageId?: string, kingdomId?: string) => s.log.push({ turn: s.turn, text, villageId, kingdomId });

  for (const o of orders) {
    const err = execute(s, o);
    if (err) say(`Order failed: ${err}`, 'villageId' in o ? o.villageId : undefined, o.kingdomId);
  }

  // AI phase: each AI kingdom gives its orders through the same order system
  if (s.settings.aiEnabled) for (const k of Object.values(s.kingdoms)) if (k.kind === 'ai' && !k.eliminated) runAI(s, k.id);

  // Conquests the player left undecided are occupied.
  autoOccupy(s);

  // 1. Battles: every active battle fights one more day
  resolveBattles(s, say);

  // 2. Sieges: blockades tighten, engineers work on the walls
  advanceSieges(s, say);

  // 3. Building queues advance
  for (const v of Object.values(s.villages)) {
    for (const q of v.buildQueue) q.turnsLeft--;
    for (const q of v.buildQueue.filter((x) => x.turnsLeft <= 0)) {
      v.buildings.push({ id: q.id });
      say(`${BUILDINGS[q.id].name} completed in ${v.name}`, v.id, v.ownerId ?? undefined);
    }
    v.buildQueue = v.buildQueue.filter((x) => x.turnsLeft > 0);
  }

  advanceTraining(s, say);

  // 4. Production and food, per kingdom
  const starving = new Set<string>();
  const surplus = new Set<string>();
  for (const k of Object.values(s.kingdoms)) {
    let foodIn = 0, foodUse = upkeep(s, k.id).food;
    for (const v of Object.values(s.villages).filter((x) => x.ownerId === k.id)) {
      const e = villageEconomy(s, v);
      for (const r of Object.keys(e.produced) as (keyof Resources)[]) if (r !== 'food') k.resources[r] += e.produced[r];
      k.resources.gold += e.taxGold;
      foodIn += e.produced.food;
      foodUse += e.foodUse;
    }
    k.resources.food += foodIn - foodUse;
    if (k.resources.food < 0) {
      k.resources.food = 0;
      starving.add(k.id);
      say(`${k.name} is starving!`, undefined, k.id);
    } else if (foodIn - foodUse > foodUse * ECON.surplusShare) surplus.add(k.id);
    for (const r of Object.keys(k.resources) as (keyof Resources)[]) k.resources[r] = Math.round(k.resources[r] * 100) / 100;
  }

  // 5. Upkeep and 6. supply
  applyUpkeep(s, say);
  applySupply(s, say);

  // 7. Population and stability
  for (const v of Object.values(s.villages)) {
    const hungry = (!!v.ownerId && starving.has(v.ownerId)) || (!!s.sieges[v.id] && s.sieges[v.id].stores <= 0);
    const stab = effectiveStability(s, v);
    const races = Object.keys(v.populationByRace) as RaceId[];
    const cap = popCap(v);

    if (hungry) {
      for (const r of races) v.populationByRace[r] = Math.floor(v.populationByRace[r]! * (1 - ECON.starvationLoss));
    } else {
      const bonus =
        (v.ownerId && surplus.has(v.ownerId) ? ECON.surplusGrowth : 0) + v.buildings.reduce((t, b) => t + (BUILDINGS[b.id].growth ?? 0), 0);
      const mult = stab < ECON.lowStabilityBelow ? ECON.lowStabilityGrowthMult : 1;
      const room = Math.max(0, cap - totalPop(v));
      const gains = races.map((r) => Math.round(v.populationByRace[r]! * ((RACES[r].growth + bonus) / 100) * mult));
      const want = gains.reduce((t, n) => t + n, 0);
      const scale = want > room ? room / want : 1;
      races.forEach((r, i) => { v.populationByRace[r] = v.populationByRace[r]! + Math.floor(gains[i] * scale); });
    }

    let drift = 0;
    if (v.ownerId) drift += ECON.tax[v.taxLevel].stability;
    if (hungry) drift += ECON.starvationStability;
    v.stability = clamp(v.stability + drift);
    v.conquestPenalty = Math.max(0, v.conquestPenalty - ECON.stability.conquestDecay);
    v.recentConscription = Math.max(0, v.recentConscription - v.recentConscription / 5);
    if (v.ownerId && effectiveStability(s, v) < ECON.stability.revoltBelow) say(`${v.name} is on the edge of revolt!`, v.id, v.ownerId);
  }

  checkRevolts(s, say);
  recoverTroops(s);
  resetMovement(s);
  updateExplored(s);
  s.turn += 1;
  return s;
}
