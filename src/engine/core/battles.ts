import { resolveBattleDay } from '../battle/resolveBattleDay';
import { reinforce, setupBattle } from '../battle/setupBattle';
import type { BattleInput, ChampionInput, CompanyInput, RevealTrigger, SideInput, SideKey } from '../battle/types';
import { ECON, RACES } from './data';
import { key } from './hex';
import { NEUTRAL, kingdomOf } from './kingdoms';
import { inSupply, newCompany, removeCompany } from './military';
import { defenseBonusAt, secede, setCapture, villageAt } from './siege';
import { startingFatigue } from './movement';
import { createRng, hashSeed } from './rng';
import { companyMen, effectiveUnit } from './units';
import type { Company, GameBattle, GameState, HexCoord, KingdomId, Prisoners, Rank, RaceId } from './types';

type Say = (text: string, villageId?: string, kingdomId?: string) => void;
const RANKS: Rank[] = ['green', 'trained', 'veteran', 'elite'];
const opp = (s: SideKey): SideKey => (s === 'attacker' ? 'defender' : 'attacker');
const clamp = (x: number) => Math.min(100, Math.max(0, x));
const M = ECON.military;

export const battleAt = (s: GameState, hex: HexCoord) => Object.values(s.battles).find((b) => key(b.hex) === key(hex));
export const sideOf = (gb: GameBattle, kid: KingdomId): SideKey | null => (kid === gb.attackerId ? 'attacker' : kid === gb.defenderId ? 'defender' : null);

function championInput(s: GameState, c: Company): ChampionInput | undefined {
  const ch = c.captainId ? s.characters[c.captainId] : undefined;
  if (!ch || ch.status !== 'active') return undefined;
  return { id: ch.id, name: ch.name, epithet: ch.epithet, class: ch.class, level: ch.level, xp: ch.xp, stats: ch.stats, traits: ch.traits, spells: ch.spells, role: ch.role, trigger: ch.trigger };
}

function companyInput(s: GameState, c: Company): CompanyInput {
  return {
    id: c.id, unit: c.unitType, unitStats: effectiveUnit(c.unitType, c.race), men: c.men, rank: c.rank,
    fatigue: startingFatigue(c) + (inSupply(s, c) ? 0 : M.outOfSupplyFatigue),
    morale: c.morale, glory: c.battlesSurvived, previousChampionKilled: !!c.heroLost, champion: championInput(s, c),
  };
}

function sideInput(s: GameState, kid: KingdomId, cs: Company[]): SideInput {
  const k = kingdomOf(s, kid);
  const race = RACES[kid === NEUTRAL && cs[0] ? cs[0].race : k.race];
  const pits = Object.values(s.villages).some((v) => v.ownerId === kid && v.buildings.some((b) => b.id === 'fighting_pits'));
  return {
    name: k.name,
    companies: cs.map((c) => companyInput(s, c)),
    outOfSupply: cs.filter((c) => !inSupply(s, c)).length > cs.length / 2,
    affinity: race.affinitySchools,
    forbiddenSchools: race.forbiddenSchools ?? [],
    risingBonus: (race.risingBonus ?? 0) + (pits ? (race.pitsRisingBonus ?? 0) : 0),
    xpMult: race.xpMult ?? 1,
  };
}

/** The battle engine's input for a fight on `hex`; the AI uses it too, to predict outcomes. */
export function battleInputFor(s: GameState, seed: string, attackerId: KingdomId, attackers: Company[], defenderId: KingdomId, defenders: Company[], hex: HexCoord): BattleInput {
  return {
    seed,
    terrain: s.map.tiles[key(hex)].terrain,
    attacker: sideInput(s, attackerId, attackers),
    defender: sideInput(s, defenderId, defenders),
    siege: false,
    defenseBonus: defenseBonusAt(s, hex, defenderId),
  };
}

/** An army enters an enemy army's hex: every company of both sides there is drawn in. */
export function beginBattle(s: GameState, attackerId: KingdomId, attackers: Company[], hex: HexCoord): void {
  const defenders = Object.values(s.companies).filter((c) => key(c.hex) === key(hex) && c.ownerId !== attackerId && !c.battleId);
  if (!defenders.length) return;
  const id = `b${s.nextId++}`;
  const defenderId = defenders[0].ownerId;
  const all = [...attackers, ...defenders];
  const battle = setupBattle(battleInputFor(s, `${s.seed}#${id}`, attackerId, attackers, defenderId, defenders, hex));
  for (const c of all) c.battleId = id;
  s.battles[id] = { id, hex: { ...hex }, turnStarted: s.turn, attackerId, defenderId, battle, pending: [] };
  const region = s.map.regions[s.map.tiles[key(hex)].regionId].name;
  s.log.push({ turn: s.turn, text: `Battle of ${region}: ${kingdomOf(s, attackerId).name} attacks ${kingdomOf(s, defenderId).name}`, kingdomId: undefined });
}

/** Companies that move into an ongoing battle join on the next battle day. */
export function joinBattle(gb: GameBattle, cs: Company[]) {
  for (const c of cs) { c.battleId = gb.id; gb.pending.push(c.id); }
}

// ---- resolution (step 1 of the turn) ----

export function resolveBattles(s: GameState, say: Say) {
  for (const gb of Object.values(s.battles)) {
    for (const id of gb.pending) {
      const c = s.companies[id];
      if (c && c.battleId === gb.id) reinforce(gb.battle, sideOf(gb, c.ownerId)!, [companyInput(s, c)]);
    }
    gb.pending = [];
    gb.battle = resolveBattleDay(gb.battle);
    if (gb.battle.result) { finishBattle(s, gb, say); continue; }
    const last = gb.battle.report.days.at(-1)!;
    say(`${battleName(s, gb)}, day ${gb.battle.day}: ${gb.battle.attacker.name} ${last.attacker.strength.toLocaleString('en-US')} vs ${gb.battle.defender.name} ${last.defender.strength.toLocaleString('en-US')} men standing`);
  }
}

const battleName = (s: GameState, gb: GameBattle) => `Battle of ${s.map.regions[s.map.tiles[key(gb.hex)].regionId].name}`;

/** Where a company goes when it leaves the field; broken companies are shaken, orderly ones are not. */
function retreat(s: GameState, c: Company, broken: boolean) {
  const mine = Object.values(s.villages).filter((v) => v.ownerId === c.ownerId);
  const near = mine.map((v) => ({ v, d: Math.max(Math.abs(v.hex.q - c.hex.q), Math.abs(v.hex.r - c.hex.r), Math.abs(v.hex.q + v.hex.r - c.hex.q - c.hex.r)) }))
    .sort((a, b) => a.d - b.d)[0];
  if (near && near.d <= M.retreatRadius) {
    if (c.armyId) {
      const a = s.armies[c.armyId];
      a.companyIds = a.companyIds.filter((id) => id !== c.id);
      if (!a.companyIds.length) delete s.armies[a.id];
      c.armyId = null;
    }
    c.hex = { ...near.v.hex };
    c.movementLeft = 0;
    if (broken) { c.status = 'broken'; c.morale = M.brokenMorale; }
    return;
  }
  // Nowhere to run: the men melt back into the population.
  const home = near?.v;
  if (home) home.populationByRace[c.race] = (home.populationByRace[c.race] ?? 0) + c.men;
  removeCompany(s, c);
}

function finishBattle(s: GameState, gb: GameBattle, say: Say) {
  const b = gb.battle;
  const res = b.result!;
  const loser: SideKey | undefined = res.winner ? opp(res.winner) : undefined;
  const rng = createRng(hashSeed(s.seed, 'aftermath', gb.id));
  const idOf = (sk: SideKey) => (sk === 'attacker' ? gb.attackerId : gb.defenderId);
  const taken = new Map<string, Prisoners>();
  const capture = (captor: KingdomId, from: KingdomId, race: RaceId, men: number) => {
    if (men <= 0 || captor === NEUTRAL) return;
    const k = `${captor}|${from}|${race}`;
    const p = taken.get(k) ?? { id: '', captorId: captor, fromId: from, race, men: 0, hex: { ...gb.hex }, turn: s.turn };
    p.men += men;
    taken.set(k, p);
  };

  for (const sk of ['attacker', 'defender'] as SideKey[]) {
    const kid = idOf(sk), foe = idOf(opp(sk));
    const isLoser = sk === loser;
    const eng = Object.values(b[sk].companies);
    const leaves = (st: string) => st === 'routed' || (st === 'active' && (res.outcome === 'draw' || (isLoser && res.withdrawn)));
    const fleeingMen = eng.filter((c) => leaves(c.state)).reduce((t, c) => t + c.men, 0);
    const lost = isLoser ? res.pursuit.killed + res.pursuit.captured : 0;
    const capShare = lost ? res.pursuit.captured / lost : 0;
    const woundedKept = isLoser ? res.summary[sk].wounded : Infinity;
    const keepFrac = isLoser ? (woundedKept + res.pursuit.woundedCaptured ? woundedKept / (woundedKept + res.pursuit.woundedCaptured) : 1) : 1;

    for (const bc of eng) {
      const gc = s.companies[bc.id];
      if (!gc) continue;
      gc.battleId = undefined;
      if (bc.state === 'destroyed' || bc.men <= 0) { removeCompany(s, gc); continue; }

      const flees = leaves(bc.state);
      let men = bc.men;
      if (flees && fleeingMen) {
        const share = Math.round((lost * bc.men) / fleeingMen);
        men -= share;
        capture(foe, kid, gc.race, Math.round(share * capShare));
      }
      const w = bc.wounded, back = Math.round(w * keepFrac);
      if (back > 0) gc.recovering.push({ men: back, turnsLeft: M.woundedTurns });
      capture(foe, kid, gc.race, w - back);
      if (men <= 0) { removeCompany(s, gc); continue; }

      gc.men = men;
      gc.battlesSurvived++;
      const need = (ECON.military.rankBattles as number[])[RANKS.indexOf(gc.rank) + 1];
      if (need !== undefined && gc.battlesSurvived >= need) gc.rank = RANKS[RANKS.indexOf(gc.rank) + 1];
      gc.morale = Math.round(clamp(bc.morale));
      if (flees) retreat(s, gc, bc.state === 'routed');
    }
  }

  // Champions: XP, injuries, deaths, and new heroes.
  for (const r of res.champions) {
    const ch = s.characters[r.character.id];
    const owner = idOf(r.side);
    const company = s.companies[r.companyId];
    if (r.outcome === 'dead') {
      delete s.characters[r.character.id];
      if (company) { company.captainId = undefined; company.heroLost = true; }
      say(`${r.character.name} fell at ${battleName(s, gb)}`, undefined, owner);
      continue;
    }
    const base = ch ?? { ...r.character, ownerId: owner, role: 'captain' as const };
    const woundedTurns = r.outcome === 'wounded' ? M.championWoundedTurns[0] + Math.floor(rng() * (M.championWoundedTurns[1] - M.championWoundedTurns[0] + 1)) : undefined;
    s.characters[r.character.id] = { ...base, ...r.character, ownerId: owner, role: base.role, trigger: base.trigger, woundedTurns };
  }
  for (const h of res.risen) {
    const owner = idOf(h.side);
    const company = s.companies[h.companyId];
    if (!company) continue;
    s.characters[h.character.id] = { ...h.character, ownerId: owner, role: 'captain' };
    company.captainId = h.character.id;
    company.heroLost = false;
    const title = h.character.epithet ? `${h.character.name} ${h.character.epithet}` : h.character.name;
    say(`${title} rises from the ranks of ${company.unitType.replace(/_/g, ' ')} (${h.character.class})`, undefined, owner);
  }

  if (res.pyrrhic && res.winner) {
    for (const v of Object.values(s.villages)) if (v.ownerId === idOf(res.winner)) v.stability = clamp(v.stability + M.pyrrhicStability);
  }

  for (const p of taken.values()) {
    p.id = `p${s.nextId++}`;
    s.prisoners[p.id] = p;
  }

  const name = battleName(s, gb);
  const text = res.outcome === 'draw'
    ? `${name} ends in a draw`
    : `${name}: ${kingdomOf(s, idOf(res.winner!)).name} wins${res.outcome === 'decisive' ? ' decisively' : ''}${res.pyrrhic ? ' (Pyrrhic)' : ''}`;
  s.log.push({ turn: s.turn, text });
  s.reports.push({ id: gb.id, name, hex: gb.hex, turnStarted: gb.turnStarted, turnEnded: s.turn, attackerId: gb.attackerId, defenderId: gb.defenderId, battle: b });
  if (s.reports.length > M.reportsKept) s.reports.shift();
  // Conquest: the victor holds the field; if a village is there and nobody is left to defend it, it falls.
  const v = villageAt(s, gb.hex);
  if (v && res.winner) {
    const wk = idOf(res.winner);
    if (wk === NEUTRAL) { if (v.ownerId) secede(s, v); }
    else if (v.ownerId !== wk && !Object.values(s.companies).some((c) => key(c.hex) === key(gb.hex) && c.ownerId !== wk)) setCapture(s, v.id, wk);
  }
  for (const c of Object.values(s.companies)) if (c.ownerId === NEUTRAL) removeCompany(s, c);
  delete s.battles[gb.id];
}

/** Between-turn recovery: morale mends, the wounded return (in supply), wounded champions heal. */
export function recoverTroops(s: GameState) {
  for (const c of Object.values(s.companies)) {
    if (c.battleId) continue;
    if (c.morale < 100) {
      c.morale = Math.min(100, c.morale + M.moraleRecovery);
      if (c.status === 'broken' && c.morale >= 100) c.status = 'ready';
    }
    if (c.recovering.length && inSupply(s, c)) {
      for (const r of c.recovering) r.turnsLeft--;
      for (const r of c.recovering.filter((x) => x.turnsLeft <= 0)) c.men = Math.min(c.maxMen, c.men + r.men);
      c.recovering = c.recovering.filter((x) => x.turnsLeft > 0);
    }
  }
  for (const ch of Object.values(s.characters)) {
    if (ch.status === 'wounded' && ch.woundedTurns !== undefined && --ch.woundedTurns <= 0) { ch.status = 'active'; ch.woundedTurns = undefined; }
  }
}

// ---- orders ----

export function withdraw(s: GameState, kid: KingdomId, battleId: string): string | undefined {
  const gb = s.battles[battleId];
  if (!gb) return 'No such battle';
  const sk = sideOf(gb, kid);
  if (!sk) return 'You are not fighting in this battle';
  gb.battle[sk].withdraw = true;
}

export function setChampion(s: GameState, kid: KingdomId, characterId: string, role: 'captain' | 'hidden', trigger?: RevealTrigger): string | undefined {
  const ch = s.characters[characterId];
  if (!ch || ch.ownerId !== kid) return 'Not your champion';
  ch.role = role;
  ch.trigger = role === 'hidden' ? (trigger ?? { type: 'morale', below: 40 }) : undefined;
  // A hidden champion already in a battle can still have their trigger changed at night.
  const comp = Object.values(s.companies).find((c) => c.captainId === characterId && c.battleId);
  const gb = comp && s.battles[comp.battleId!];
  const sk = gb && sideOf(gb, kid);
  const live = gb && sk && gb.battle[sk].champions[comp!.id];
  if (live && role === 'hidden' && !live.revealed) live.trigger = ch.trigger;
}

export function prisonerAction(s: GameState, kid: KingdomId, prisonerId: string, action: 'ransom' | 'conscript' | 'release'): string | undefined {
  const p = s.prisoners[prisonerId];
  if (!p || p.captorId !== kid) return 'Not your prisoners';
  const captor = s.kingdoms[kid];
  if (action === 'ransom') {
    const price = p.men * M.ransomPerMan;
    const owner = s.kingdoms[p.fromId];
    if (!owner) return 'No one will pay a ransom for them';
    if (owner.resources.gold < price) return `${owner.name} cannot pay the ransom`;
    owner.resources.gold -= price;
    captor.resources.gold += price;
  } else if (action === 'conscript') {
    const home = Object.values(s.villages).filter((v) => v.ownerId === kid)
      .sort((a, b) => (Math.abs(a.hex.q - p.hex.q) + Math.abs(a.hex.r - p.hex.r)) - (Math.abs(b.hex.q - p.hex.q) + Math.abs(b.hex.r - p.hex.r)))[0];
    if (!home) return 'You have no village to muster them in';
    const size = companyMen('militia', p.race);
    for (let left = p.men; left > 0; left -= size) {
      const c = newCompany(s, kid, 'militia', p.race, Math.min(size, left), home.hex);
      c.morale = M.conscriptMorale;
    }
  } else {
    for (const v of Object.values(s.villages)) if (v.ownerId === kid && v.conquestPenalty > 0) v.stability = clamp(v.stability + M.releaseStability);
  }
  delete s.prisoners[prisonerId];
}
