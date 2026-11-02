import { buildBlocker, buildCost, effectiveStability, kingdomIncome, majorityRace, popCap, totalPop } from '../core/economy';
import { ECON, TIERS } from '../core/data';
import { recruitBlocker } from '../core/recruit';
import { UNIT_DEFS } from '../core/units';
import { upkeep } from '../core/upkeep';
import type { RaceId, TaxLevel, Village } from '../core/types';
import { armyTarget, isMilitary, myCompanies, myVillages, type AIContext } from './context';

/** Gold the AI keeps back before spending on anything optional. */
export const reserve = (c: AIContext) => upkeep(c.s, c.kid).gold * c.P.goldReserveTurns + c.P.goldReserveBase;

export function runEconomy(c: AIContext, goal: string) {
  const { s, kid, P } = c;
  const k = s.kingdoms[kid];
  const villages = myVillages(c);
  const income = kingdomIncome(s, kid);
  const keep = reserve(c);

  // Taxes: soothe unhappy villages, squeeze happy ones.
  for (const v of villages) {
    const stab = effectiveStability(s, v);
    const want: TaxLevel = stab < P.taxLowBelow ? 'low' : stab > P.taxHighAbove ? 'high' : 'normal';
    if (v.taxLevel !== want) c.act({ type: 'setTax', villageId: v.id, level: want });
  }

  // Buildings: the first affordable entry of the personality's list whose condition holds, one per village.
  const when: Record<string, (v: Village) => boolean> = {
    always: () => true,
    foodShort: () => income.food < 1 && k.resources.food < 250,
    lowWood: () => k.resources.wood < 120,
    lowStone: () => k.resources.stone < 60,
    lowIron: () => k.resources.iron < 60 && income.iron <= 0,
    hasIron: () => income.iron > 0,
    stabilityLow: (v) => effectiveStability(s, v) < 50,
    crowded: (v) => totalPop(v) > popCap(v) * 0.8,
  };
  for (const v of villages) {
    if (v.buildQueue.length) continue;
    for (const cand of P.buildPriority) {
      if (!when[cand.when](v)) continue;
      if (buildBlocker(s, kid, v, cand.id) !== null) continue;
      const cost = buildCost(k.race, cand.id);
      const urgent = cand.when === 'foodShort';
      if (!urgent && k.resources.gold - (cost.gold ?? 0) < keep) continue;
      // Settlers need wood: without a wood income, keep enough back for them.
      if (cand.id !== 'lumber_camp' && income.wood <= 0 && k.resources.wood - (cost.wood ?? 0) < P.woodReserve) continue;
      if (!c.act({ type: 'build', villageId: v.id, building: cand.id })) break;
    }
  }

  // Grow villages that are full enough.
  for (const v of villages) {
    const next = TIERS[v.tier].next;
    if (next && totalPop(v) >= popCap(v) * ECON.upgradePopShare && k.resources.gold - (TIERS[next].upgrade?.gold ?? 0) >= keep) c.act({ type: 'upgrade', villageId: v.id });
  }

  recruit(c, goal);
}

/** Companies in the field plus those in training, not counting scouts and settlers. */
const militaryCount = (c: AIContext) =>
  myCompanies(c).filter(isMilitary).length +
  myVillages(c).reduce((t, v) => t + v.trainQueue.filter((q) => q.id !== 'settlers' && q.id !== 'scouts').length, 0);

function recruit(c: AIContext, goal: string) {
  const { s, kid, P } = c;
  const k = s.kingdoms[kid];
  const villages = myVillages(c);
  const keep = reserve(c);
  const income = kingdomIncome(s, kid);
  const sustain = (id: string) => {
    if (id === 'settlers') return true; // a new village pays for itself
    const u = UNIT_DEFS[id];
    // Do not recruit into bankruptcy or starvation: stocks must cover the deficit for a dozen turns.
    return income.gold - (u.upkeep?.gold ?? 0) >= -k.resources.gold / 12 && income.food - (u.baseMen * u.size) / 100 * ECON.military.foodPer100Soldiers >= -k.resources.food / 12;
  };
  const pick = (v: Village, ids: Record<string, number>) => {
    const race = majorityRace(v) as RaceId;
    const opts = Object.entries(ids).filter(([id]) => recruitBlocker(s, kid, v, id, race) === null && sustain(id));
    const total = opts.reduce((t, [, w]) => t + w, 0);
    if (!total) return null;
    let r = c.rng() * total;
    for (const [id, w] of opts) if ((r -= w) <= 0) return { id, race };
    return { id: opts[0][0], race };
  };

  // One scout early on, and settlers when the kingdom wants to grow.
  const has = (u: string) => myCompanies(c).some((x) => x.unitType === u) || villages.some((v) => v.trainQueue.some((q) => q.id === u));
  for (const v of villages) {
    if (P.scouts && !has('scouts') && s.turn >= 2 && k.resources.gold > keep) { const r = pick(v, { scouts: 1 }); if (r && !c.act({ type: 'recruit', villageId: v.id, unit: r.id, race: r.race })) return; }
    if (wantsSettlers(c, goal) && !has('settlers') && totalPop(v) >= 600) {
      const r = pick(v, { settlers: 1 });
      if (r && k.resources.gold - UNIT_DEFS.settlers.cost!.gold! >= keep && !c.act({ type: 'recruit', villageId: v.id, unit: r.id, race: r.race })) return;
    }
  }

  // The army: weighted choice from the personality's mix, plus its people's unique units.
  let want = armyTarget(c) - militaryCount(c);
  let issued = 0;
  for (const v of villages) {
    if (want <= 0 || issued >= P.recruitPerTurn) break;
    const race = majorityRace(v);
    const mix: Record<string, number> = { ...P.recruitMix };
    for (const [id, u] of Object.entries(UNIT_DEFS)) if (u.allowedRaces?.includes(race)) mix[id] = P.uniqueUnitWeight;
    const choice = pick(v, mix);
    if (!choice) continue;
    const cost = UNIT_DEFS[choice.id].cost!;
    if (k.resources.gold - (cost.gold ?? 0) < (goal === 'Defend' ? 0 : keep)) continue;
    if (!c.act({ type: 'recruit', villageId: v.id, unit: choice.id, race: choice.race })) { want--; issued++; }
  }
}

export function wantsSettlers(c: AIContext, goal: string): boolean {
  return goal === 'Expand' && myVillages(c).length < c.P.maxVillages;
}
