import { B, TERRAINS, UNITS } from './data';
import { makeChampion } from './champions';
import type { BChampion, BCompany, Battle, BattleInput, BSide, CompanyInput, SideKey, Slot, SideInput, UnitType } from './types';

export function slotFor(u: UnitType): Slot {
  if (u.flying) return 'air';
  if (u.tags.includes('cavalry')) return 'flank';
  if (u.tags.includes('infantry')) return 'front';
  if (u.tags.includes('ranged') || u.tags.includes('magic')) return 'rear';
  return 'reserve';
}

const FLANK_SLOTS = 2;
const power = (c: BCompany) => {
  const u = c.unit;
  return c.men * u.size * (u.atk + (u.rangedAtk ?? 0) + u.def + u.armor);
};

export function makeCompany(ci: CompanyInput, outOfSupply = false): BCompany {
  const u = ci.unitStats ?? UNITS[ci.unit];
  if (!u) throw new Error(`unknown unit ${ci.unit}`);
  const M = B.morale;
  const men = ci.men ?? u.baseMen;
  const fatigue = ci.fatigue ?? 0;
  const morale = u.noMorale
    ? M.start
    : (ci.morale ?? M.start) + (outOfSupply ? M.outOfSupply : 0) + (fatigue > M.startFatigueOver ? M.startFatiguePenalty : 0);
  return {
    id: ci.id, unitId: ci.unit, unit: u, name: `${ci.id} ${u.name}`, rank: ci.rank ?? 'green',
    men, startMen: men, morale: Math.max(0, morale), fatigue, slot: slotFor(u), state: 'active', dead: 0, wounded: 0, dayWounded: 0,
    glory: ci.glory ?? 0, previousChampionKilled: !!ci.previousChampionKilled,
    daysFought: 0, kills: 0, routsCaused: 0, heldLine: false, killedChampion: false, spellCasualties: 0,
  };
}

function setupSide(inp: SideInput, frontage: number): BSide {
  const companies: Record<string, BCompany> = {};
  const lines: Record<Slot, string[]> = { front: [], flank: [], rear: [], reserve: [], air: [] };
  const order: BCompany[] = [];
  const champions: Record<string, BChampion> = {};

  for (const ci of inp.companies) {
    const c = makeCompany(ci, inp.outOfSupply);
    if (ci.champion) champions[c.id] = makeChampion(ci.champion, c.id);
    companies[c.id] = c;
    order.push(c);
  }

  // Commanded armies put the best units in the best slots; leaderless fill in merge order.
  const placed = inp.commander ? [...order].sort((a, b) => power(b) - power(a)) : order;
  for (const c of placed) {
    const cap = c.slot === 'front' ? frontage : c.slot === 'flank' ? FLANK_SLOTS : Infinity;
    if (lines[c.slot].length < cap) lines[c.slot].push(c.id);
    else { c.slot = 'reserve'; lines.reserve.push(c.id); }
  }

  // Cohesion: average rank value + Leadership; leaderless -5 per company beyond the free ones.
  const avg = order.reduce((s, c) => s + B.rank[c.rank].cohesion, 0) / Math.max(1, order.length);
  const cohesion = inp.commander
    ? Math.min(100, avg + inp.commander.leadership)
    : Math.max(0, avg - B.cohesion.leaderlessPenalty * Math.max(0, order.length - B.cohesion.leaderlessFree));

  const front = lines.front.map((id) => companies[id]);
  const polearms = front.filter((c) => c.unit.tags.includes('polearm')).length;
  const integrity =
    B.integrity.start + (front.length && polearms / front.length >= B.integrity.polearmShare ? B.integrity.polearmBonus : 0);

  const maxMana = B.manaPerCaster * order.filter((c) => c.unit.tags.includes('caster')).length;

  return {
    name: inp.name,
    commander: inp.commander,
    stance: inp.commander ? (inp.stance ?? 'hold') : 'hold',
    cohesion, integrity, companies, lines, champions,
    mana: maxMana, maxMana,
    affinity: inp.affinity ?? [], forbiddenSchools: inp.forbiddenSchools ?? [],
    risingBonus: inp.risingBonus ?? 0, xpMult: inp.xpMult ?? 1,
    buff: { rangedMult: 1, deflected: false }, reserveCommitted: false, lastDuelDay: 0,
  };
}

export function snapshot(b: Battle) {
  const snap = (s: BSide) => {
    const act = Object.values(s.companies).filter((c) => c.state === 'active');
    const mean = (f: (c: BCompany) => number) => (act.length ? act.reduce((t, c) => t + f(c), 0) / act.length : 0);
    return {
      strength: act.reduce((t, c) => t + c.men, 0),
      morale: Math.round(mean((c) => c.morale)),
      cohesion: Math.round(s.cohesion),
      fatigue: Math.round(mean((c) => c.fatigue)),
      integrity: Math.round(s.integrity),
    };
  };
  return { day: b.day, attacker: snap(b.attacker), defender: snap(b.defender) };
}

export function setupBattle(input: BattleInput): Battle {
  const frontage = TERRAINS[input.terrain].frontage;
  const ids = [...input.attacker.companies, ...input.defender.companies].map((c) => c.id);
  if (new Set(ids).size !== ids.length) throw new Error('company ids must be unique across both sides');
  const b: Battle = {
    seed: input.seed, terrain: input.terrain, siege: !!input.siege, defenseBonus: input.defenseBonus ?? 0, day: 0,
    attacker: setupSide(input.attacker, frontage),
    defender: setupSide(input.defender, frontage),
    report: { rounds: [], days: [], moments: [], nights: [] },
  };
  b.report.initial = structuredClone({ attacker: b.attacker, defender: b.defender });
  b.report.days.push(snapshot(b));
  return b;
}

/** Reinforcements join on the next battle day: straight into an open slot if there is one, else the reserve. */
export function reinforce(b: Battle, side: SideKey, inputs: CompanyInput[]) {
  const s = b[side];
  const frontage = TERRAINS[b.terrain].frontage;
  for (const ci of inputs) {
    if (b.attacker.companies[ci.id] || b.defender.companies[ci.id]) continue;
    const c = makeCompany(ci);
    if (ci.champion) s.champions[c.id] = makeChampion(ci.champion, c.id);
    const cap = c.slot === 'front' ? frontage : c.slot === 'flank' ? FLANK_SLOTS : Infinity;
    if (s.lines[c.slot].length >= cap) c.slot = 'reserve';
    s.companies[c.id] = c;
    s.lines[c.slot].push(c.id);
    s.maxMana += c.unit.tags.includes('caster') ? B.manaPerCaster : 0;
    s.mana += c.unit.tags.includes('caster') ? B.manaPerCaster : 0;
    s.reserveCommitted = true;
    b.report.moments.push({ day: b.day, round: 0, text: `${c.name} arrives to reinforce ${s.name}` });
  }
}
