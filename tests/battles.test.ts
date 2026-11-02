import { describe, expect, it } from 'vitest';
import { key } from '../src/engine/core/hex';
import { newCompany } from '../src/engine/core/military';
import { applyOrder, type Order } from '../src/engine/core/orders';
import { resolveTurn } from '../src/engine/core/resolveTurn';
import { newGame } from '../src/engine/core/state';
import type { Company, GameSettings, GameState, HexCoord, Prisoners } from '../src/engine/core/types';

const game = (race: GameSettings['playerRace'] = 'valdren', seed = 'war') =>
  newGame({ seed, mapSize: 'small', playerRace: race, aiRaces: ['ghor', 'durrakin'] });
const o = (type: string, extra: object = {}) => ({ type, kingdomId: 'k1', ...extra }) as Order;
const run = (g: GameState, ...orders: Order[]) => {
  let s = g;
  for (const x of orders) {
    const r = applyOrder(s, x);
    if (r.error) throw new Error(`${x.type}: ${r.error}`);
    s = r.state;
  }
  return s;
};
const err = (g: GameState, x: Order) => applyOrder(g, x).error;
const hexAt = (g: GameState, dq: number, dr = 0): HexCoord => ({ q: g.villages.v1.hex.q + dq, r: g.villages.v1.hex.r + dr });
const mine = (g: GameState) => Object.values(g.companies).filter((c) => c.ownerId === 'k1');
const turns = (g: GameState, n: number) => { let s = g; for (let i = 0; i < n; i++) s = resolveTurn(s); return s; };

/** All plains, no neutral villages, no enemy troops: a clean field. Enemy capitals stay (far away). */
function field(g: GameState) {
  for (const t of Object.values(g.map.tiles)) t.terrain = 'plains';
  for (const v of Object.values(g.villages)) if (v.ownerId === null) delete g.villages[v.id];
  for (const c of Object.values(g.companies)) if (c.ownerId !== 'k1') delete g.companies[c.id];
  return g;
}

/** A battle at hexAt(1): k1's starting militia (+ extras) attacks k2's company. */
function clash(opts: { mine?: [string, number?, Company['rank']?][]; foe?: [string, number?, Company['rank']?][]; terrain?: 'plains' | 'mountains'; seed?: string; race?: GameSettings['playerRace'] } = {}) {
  const g = field(game(opts.race, opts.seed ?? 'clash'));
  g.map.tiles[key(hexAt(g, 1))].terrain = opts.terrain ?? 'plains';
  const base = mine(g)[0];
  const attackers = [base];
  for (const [u, men, rank] of opts.mine ?? []) {
    const c = newCompany(g, 'k1', u, g.kingdoms.k1.race, men ?? 500, base.hex);
    if (rank) c.rank = rank;
    attackers.push(c);
  }
  const defenders: Company[] = [];
  for (const [u, men, rank] of opts.foe ?? [['militia']]) {
    const c = newCompany(g, 'k2', u, 'ghor', men ?? 500, hexAt(g, 1));
    if (rank) c.rank = rank;
    defenders.push(c);
  }
  const army = attackers.length > 1 ? run(g, o('merge', { companyIds: attackers.map((c) => c.id) })) : g;
  const unitId = attackers.length > 1 ? Object.keys(army.armies)[0] : base.id;
  const s = run(army, o('move', { unitId, to: hexAt(g, 1) }));
  return { s, attackers: attackers.map((c) => c.id), defenders: defenders.map((c) => c.id), unitId };
}
const only = (g: GameState) => Object.values(g.battles)[0];

describe('starting a battle', () => {
  it('moving onto an enemy army starts a battle with everyone on that hex', () => {
    const { s, attackers, defenders } = clash({ foe: [['militia'], ['spearmen']] });
    const gb = only(s);
    expect(Object.keys(s.battles)).toHaveLength(1);
    expect(gb).toMatchObject({ attackerId: 'k1', defenderId: 'k2', turnStarted: 1 });
    expect(Object.keys(gb.battle.attacker.companies)).toEqual(attackers);
    expect(Object.keys(gb.battle.defender.companies).sort()).toEqual([...defenders].sort());
    expect(gb.battle.terrain).toBe('plains');
    for (const id of [...attackers, ...defenders]) expect(s.companies[id].battleId).toBe(gb.id);
    expect(s.companies[attackers[0]].movementLeft).toBe(0);
    expect(s.log.some((e) => e.text.startsWith('Battle of'))).toBe(true);
  });

  it('uses the terrain of the hex, racial stats and starting fatigue', () => {
    const g = field(game('durrakin', 'stats'));
    const c = mine(g)[0];
    const foe = newCompany(g, 'k2', 'militia', 'ghor', 500, hexAt(g, 1));
    g.map.tiles[key(foe.hex)].terrain = 'hills'; // costs a fresh company its whole move
    const s = run(g, o('move', { unitId: c.id, to: foe.hex }));
    const gb = only(s);
    expect(gb.battle.terrain).toBe('hills');
    expect(gb.battle.attacker.companies[c.id].unit.armor).toBe(1); // Durrakin infantry +1 armor
    expect(gb.battle.attacker.companies[c.id].unit.discipline).toBe(45);
    expect(gb.battle.defender.companies[foe.id].unit.atk).toBe(4); // Ghor +1 atk
    expect(gb.battle.attacker.companies[c.id].fatigue).toBe(15); // moved its full speed
  });

  it('is blocked for third parties and for hexes beyond the target', () => {
    const { s } = clash({ foe: [['militia']] });
    const third = newCompany(s, 'k3', 'militia', 'durrakin', 500, hexAt(s, 4));
    third.movementLeft = 4;
    const r = applyOrder(s, { type: 'move', kingdomId: 'k3', unitId: third.id, to: hexAt(s, 1) });
    expect(r.error).toMatch(/No route/);
  });

  it('cannot walk through an enemy army to get behind it', () => {
    const g = field(game('valdren', 'wall'));
    const c = mine(g)[0];
    c.movementLeft = 6;
    newCompany(g, 'k2', 'militia', 'ghor', 500, hexAt(g, 1));
    const s = run(g, o('move', { unitId: c.id, to: hexAt(g, 3) }));
    expect(s.companies[c.id].hex).not.toEqual(hexAt(g, 3));
    expect(Object.keys(s.battles)).toHaveLength(0); // went around
  });

  it('companies in a battle cannot move, merge, split, garrison or replenish', () => {
    const { s, attackers } = clash({ mine: [['spearmen']] });
    const id = attackers[0];
    expect(err(s, o('move', { unitId: s.companies[id].armyId!, to: hexAt(s, 0) }))).toMatch(/In battle/);
    expect(err(s, o('merge', { companyIds: [id] }))).toMatch(/in battle/);
    expect(err(s, o('split', { companyIds: [id] }))).toMatch(/in battle/);
    expect(err(s, o('setStatus', { companyId: id, status: 'garrison' }))).toBe('In battle');
    expect(err(s, o('replenish', { companyId: id }))).toBe('In battle');
  });
});

describe('resolving battles', () => {
  const slog = { mine: [['spearmen'], ['spearmen']] as [string][], foe: [['spearmen'], ['spearmen']] as [string][], terrain: 'mountains' as const };

  it('fights one battle day per turn and keeps going until it is decided', () => {
    let s = clash(slog).s;
    s = resolveTurn(s);
    const gb = only(s);
    expect(gb.battle.day).toBe(1);
    expect(s.log.some((e) => e.text.includes('day 1'))).toBe(true);
    // Casualties accumulate inside the battle; the campaign companies are updated when it ends.
    const standing = (g: GameState) => { const l = only(g).battle.report.days.at(-1)!; return l.attacker.strength + l.defender.strength; };
    const before = standing(s);
    s = resolveTurn(s);
    expect(only(s).battle.day).toBe(2);
    expect(standing(s)).toBeLessThan(before);
  });

  it('a decisive win archives the report, promotes survivors and sends broken enemies home', () => {
    const g = field(game('valdren', 'decisive'));
    g.villages.v2.hex = hexAt(g, 4); // the enemy village is close enough to retreat to
    const c = mine(g)[0];
    const army = [c, ...['swordsmen', 'swordsmen', 'swordsmen'].map((u) => newCompany(g, 'k1', u, 'valdren', 500, c.hex))];
    for (const a of army.slice(1)) a.rank = 'elite';
    const foe = newCompany(g, 'k2', 'militia', 'ghor', 500, hexAt(g, 1));
    let s = run(g, o('merge', { companyIds: army.map((a) => a.id) }));
    s = run(s, o('move', { unitId: Object.keys(s.armies)[0], to: foe.hex }));
    s = turns(s, 1);
    expect(Object.keys(s.battles)).toHaveLength(0);
    expect(s.reports).toHaveLength(1);
    const rep = s.reports[0];
    expect(rep.battle.result).toMatchObject({ winner: 'attacker' });
    expect(rep.name).toMatch(/^Battle of /);
    expect(s.log.some((e) => e.text.includes('wins'))).toBe(true);
    const survivors = mine(s).filter((x) => x.unitType === 'swordsmen');
    expect(survivors.every((x) => x.battleId === undefined && x.battlesSurvived === 1 && x.rank === 'elite')).toBe(true);
    const militia = mine(s).find((x) => x.unitType === 'militia')!;
    expect(militia).toMatchObject({ battlesSurvived: 1, rank: 'trained' });
    const enemy = s.companies[foe.id];
    if (enemy) {
      expect(enemy.status).toBe('broken');
      expect(enemy.hex).toEqual(s.villages.v2.hex);
      expect(enemy.morale).toBe(40); // 30, +10 recovery this turn
      expect(enemy.battleId).toBeUndefined();
    }
  });

  it('routed men with nowhere to run melt back into the nearest village', () => {
    const g = field(game('valdren', 'nowhere'));
    const c = mine(g)[0];
    const army = [c, ...['swordsmen', 'swordsmen', 'swordsmen'].map((u) => newCompany(g, 'k1', u, 'valdren', 500, c.hex))];
    for (const a of army) a.rank = 'elite';
    const foe = newCompany(g, 'k2', 'militia', 'ghor', 500, hexAt(g, 1));
    const pop = g.villages.v2.populationByRace.ghor!;
    let s = run(g, o('merge', { companyIds: army.map((a) => a.id) }));
    s = turns(run(s, o('move', { unitId: Object.keys(s.armies)[0], to: foe.hex })), 1);
    expect(s.companies[foe.id]).toBeUndefined();
    expect(s.villages.v2.populationByRace.ghor!).toBeGreaterThan(pop); // growth plus the deserters
  });

  it('winners recover their wounded over 3 turns, in supply only', () => {
    const { s: s0 } = clash({ mine: [['spearmen'], ['spearmen']], foe: [['militia']], seed: 'heal' });
    const s1 = turns(s0, 6);
    expect(s1.battles).toEqual({});
    const hurt = mine(s1).filter((c) => c.recovering.length || c.men < c.maxMen);
    expect(hurt.length).toBeGreaterThan(0);
    const queued = Object.values(s1.companies).filter((c) => c.recovering.length);
    for (const c of queued) {
      const owed = c.recovering.reduce((t, r) => t + r.men, 0);
      const done = turns(s1, 3).companies[c.id];
      expect(done.men).toBeGreaterThanOrEqual(Math.min(c.maxMen, c.men + owed) - Math.round(c.men * 0.03 * 3) - 5);
    }
  });

  it('is deterministic', () => {
    const a = turns(clash({ ...{ mine: [['spearmen']] as [string][] }, seed: 'same' }).s, 3);
    const b = turns(clash({ ...{ mine: [['spearmen']] as [string][] }, seed: 'same' }).s, 3);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('reinforcements, withdrawal and prisoners', () => {
  const slog = { mine: [['spearmen'], ['spearmen']] as [string][], foe: [['spearmen'], ['spearmen']] as [string][], terrain: 'mountains' as const };

  it('moving into an ongoing battle adds your company on the next battle day', () => {
    let { s } = clash(slog);
    s = turns(s, 1);
    expect(only(s)).toBeDefined();
    const late = newCompany(s, 'k1', 'archers', 'valdren', 500, hexAt(s, 0));
    late.movementLeft = 4;
    s = run(s, o('move', { unitId: late.id, to: hexAt(s, 1) }));
    expect(s.companies[late.id].battleId).toBe(only(s).id);
    expect(only(s).pending).toEqual([late.id]);
    expect(only(s).battle.attacker.companies[late.id]).toBeUndefined();
    s = turns(s, 1);
    const gb = only(s) ?? s.reports.at(-1)!;
    const bat = 'battle' in gb ? gb.battle : gb;
    expect(bat.attacker.companies[late.id]).toBeDefined();
    expect(bat.report.moments.some((m) => m.text.includes('arrives to reinforce'))).toBe(true);
  });

  it('a withdrawal order ends the battle before anyone fights, with a disorderly retreat', () => {
    let { s } = clash(slog);
    s = turns(s, 1);
    const gb = only(s);
    const loserSide = gb.battle.attacker.name;
    s = run(s, o('withdraw', { battleId: gb.id }));
    s = turns(s, 1);
    expect(Object.keys(s.battles)).toHaveLength(0);
    const rep = s.reports.at(-1)!.battle;
    expect(rep.result).toMatchObject({ outcome: 'victory', winner: 'defender', withdrawn: true });
    expect(rep.day).toBe(1); // no further fighting
    expect(rep.report.moments.some((m) => m.text.includes(`${loserSide} withdraws`))).toBe(true);
    expect(Object.values(s.prisoners).length).toBeGreaterThan(0);
    expect(Object.values(s.prisoners).every((p) => p.captorId === 'k2' && p.fromId === 'k1')).toBe(true);
    expect(err(s, o('withdraw', { battleId: gb.id }))).toBe('No such battle');
  });

  it('only participants can order a withdrawal', () => {
    const { s } = clash(slog);
    expect(applyOrder(s, { type: 'withdraw', kingdomId: 'k3', battleId: only(s).id }).error).toMatch(/not fighting/);
  });

  it('broken companies regroup for several turns before they can march again', () => {
    const c = { status: 'broken' } as const;
    const g = field(game());
    const co = mine(g)[0];
    co.status = c.status;
    co.morale = 30;
    expect(err(g, o('move', { unitId: co.id, to: hexAt(g, 1) }))).toMatch(/regrouping/);
    let s = turns(g, 7);
    expect(s.companies[co.id]).toMatchObject({ status: 'ready', morale: 100 });
    s = run(s, o('move', { unitId: co.id, to: hexAt(g, 1) }));
    expect(s.companies[co.id].hex).toEqual(hexAt(g, 1));
  });

  const prisoners = (g: GameState, extra: Partial<Prisoners> = {}) => {
    const p: Prisoners = { id: 'p1', captorId: 'k1', fromId: 'k2', race: 'ghor', men: 120, hex: hexAt(g, 1), turn: 1, ...extra };
    g.prisoners.p1 = p;
    return g;
  };

  it('ransom: the owner pays 1 gold a man if they can', () => {
    const g = prisoners(game());
    g.kingdoms.k2.resources.gold = 50;
    expect(err(g, o('prisoners', { prisonerId: 'p1', action: 'ransom' }))).toMatch(/cannot pay/);
    g.kingdoms.k2.resources.gold = 500;
    const gold = g.kingdoms.k1.resources.gold;
    const s = run(g, o('prisoners', { prisonerId: 'p1', action: 'ransom' }));
    expect(s.kingdoms.k1.resources.gold).toBe(gold + 120);
    expect(s.kingdoms.k2.resources.gold).toBe(380);
    expect(s.prisoners.p1).toBeUndefined();
  });

  it('conscript: they become Green Militia of their own people, shaken', () => {
    const g = prisoners(game(), { men: 700 });
    const before = Object.keys(g.companies).length;
    const s = run(g, o('prisoners', { prisonerId: 'p1', action: 'conscript' }));
    const fresh = Object.values(s.companies).filter((c) => c.ownerId === 'k1' && c.race === 'ghor');
    expect(Object.keys(s.companies).length).toBe(before + 2);
    expect(fresh.map((c) => c.men).sort((a, b) => b - a)).toEqual([500, 200]);
    expect(fresh.every((c) => c.unitType === 'militia' && c.rank === 'green' && c.morale === 70)).toBe(true);
    expect(s.prisoners.p1).toBeUndefined();
  });

  it('release: calms recently conquered villages', () => {
    const g = prisoners(game());
    g.villages.v1.conquestPenalty = 20;
    g.villages.v1.stability = 40;
    const s = run(g, o('prisoners', { prisonerId: 'p1', action: 'release' }));
    expect(s.villages.v1.stability).toBe(45);
    expect(s.prisoners.p1).toBeUndefined();
    expect(err(s, o('prisoners', { prisonerId: 'p1', action: 'release' }))).toBe('Not your prisoners');
  });
});

describe('experience and champions', () => {
  it('companies rank up after 1, 3 and 7 battles survived', () => {
    const rankAfter = (survived: number, rank: Company['rank']) => {
      const g = field(game('valdren', `rank${survived}`));
      const c = mine(g)[0];
      c.battlesSurvived = survived;
      c.rank = rank;
      const army = ['swordsmen', 'swordsmen', 'swordsmen'].map((u) => newCompany(g, 'k1', u, 'valdren', 500, c.hex));
      for (const a of army) a.rank = 'elite';
      newCompany(g, 'k2', 'militia', 'ghor', 500, hexAt(g, 1));
      let s = run(g, o('merge', { companyIds: [c.id, ...army.map((a) => a.id)] }));
      s = run(s, o('move', { unitId: Object.keys(s.armies)[0], to: hexAt(g, 1) }));
      return turns(s, 1).companies[c.id]?.rank;
    };
    expect(rankAfter(0, 'green')).toBe('trained');
    expect(rankAfter(2, 'trained')).toBe('veteran');
    expect(rankAfter(6, 'veteran')).toBe('elite');
    expect(rankAfter(3, 'veteran')).toBe('veteran');
  });

  it('heroes rise from survivors, join the company, and fight in the next battle', () => {
    let found: GameState | undefined;
    for (let i = 0; i < 80 && !found; i++) {
      const g = field(game('valdren', `hero${i}`));
      const c = mine(g)[0];
      c.rank = 'elite';
      c.battlesSurvived = 10;
      const army = ['swordsmen', 'swordsmen', 'swordsmen'].map((u) => newCompany(g, 'k1', u, 'valdren', 500, c.hex));
      for (const a of army) { a.rank = 'elite'; a.battlesSurvived = 10; }
      newCompany(g, 'k2', 'militia', 'ghor', 500, hexAt(g, 1));
      let s = run(g, o('merge', { companyIds: [c.id, ...army.map((a) => a.id)] }));
      s = turns(run(s, o('move', { unitId: Object.keys(s.armies)[0], to: hexAt(g, 1) })), 1);
      if (Object.keys(s.characters).length) found = s;
    }
    expect(found).toBeDefined();
    const s = found!;
    const [ch] = Object.values(s.characters);
    expect(ch.ownerId).toBe('k1');
    expect(ch).toMatchObject({ status: 'active', role: 'captain', level: 1 });
    const company = s.companies[ch.id.replace('-hero', '')];
    expect(company.captainId).toBe(ch.id);
    expect(s.log.some((e) => e.text.includes('rises from the ranks'))).toBe(true);

    // The champion goes into the next battle with their company.
    const foe = newCompany(s, 'k2', 'militia', 'ghor', 500, hexAt(s, 2));
    company.hex = hexAt(s, 1);
    company.armyId = null;
    company.movementLeft = 2;
    const next = run(s, o('move', { unitId: company.id, to: foe.hex }));
    expect(only(next).battle.attacker.champions[company.id].char.name).toBe(ch.name);
  });

  it('hidden-card triggers can be set between battles and at night', () => {
    const g = field(game());
    const c = mine(g)[0];
    g.characters.h1 = {
      id: 'h1', name: 'Tomas', epithet: 'the Unbroken', class: 'folkHero', level: 3, xp: 0, ownerId: 'k1', role: 'captain',
      stats: { might: 9, vitality: 9, leadership: 5, tactics: 5, arcana: 5, resolve: 9 }, traits: ['unbreakable'], spells: [], status: 'active',
    };
    c.captainId = 'h1';
    expect(err(g, o('setChampion', { characterId: 'zz', role: 'hidden' }))).toBe('Not your champion');
    let s = run(g, o('setChampion', { characterId: 'h1', role: 'hidden', trigger: { type: 'time', day: 2, round: 1 } }));
    expect(s.characters.h1).toMatchObject({ role: 'hidden', trigger: { type: 'time', day: 2, round: 1 } });
    newCompany(s, 'k2', 'militia', 'ghor', 500, hexAt(s, 1));
    s = run(s, o('move', { unitId: c.id, to: hexAt(s, 1) }));
    const live = only(s).battle.attacker.champions[c.id];
    expect(live).toMatchObject({ role: 'hidden', revealed: false, trigger: { type: 'time', day: 2, round: 1 } });
    s = run(s, o('setChampion', { characterId: 'h1', role: 'hidden', trigger: { type: 'manual' } }));
    expect(only(s).battle.attacker.champions[c.id].trigger).toEqual({ type: 'manual' });
  });

  it('a champion who falls is gone for good and marks the company', () => {
    let killed = 0, wounded = 0;
    for (let i = 0; i < 60 && (!killed || !wounded); i++) {
      const g = field(game('valdren', `fall${i}`));
      const c = mine(g)[0];
      g.characters.h1 = {
        id: 'h1', name: 'Doomed', class: 'folkHero', level: 1, xp: 0, ownerId: 'k1', role: 'captain',
        stats: { might: 5, vitality: 5, leadership: 5, tactics: 5, arcana: 5, resolve: 5 }, traits: [], spells: [], status: 'active',
      };
      c.captainId = 'h1';
      const foe = newCompany(g, 'k2', 'militia', 'ghor', 500, hexAt(g, 1));
      let s = run(g, o('move', { unitId: c.id, to: foe.hex }));
      only(s).battle.attacker.champions[c.id].hp = 0.1;
      for (let d = 0; d < 8 && Object.keys(s.battles).length; d++) s = turns(s, 1);
      const ch = s.characters.h1;
      if (!ch) {
        killed++;
        expect(s.companies[c.id]?.heroLost ?? true).toBe(true);
        expect(s.companies[c.id]?.captainId).toBeUndefined();
      } else if (ch.status === 'wounded') {
        wounded++;
        expect(ch.woundedTurns).toBeGreaterThanOrEqual(3);
        expect(ch.woundedTurns).toBeLessThanOrEqual(6);
      }
    }
    expect(killed).toBeGreaterThan(0);
    expect(wounded).toBeGreaterThan(0);
  });

  it('wounded champions heal after a few turns', () => {
    const g = game();
    g.characters.h1 = {
      id: 'h1', name: 'Hurt', class: 'folkHero', level: 1, xp: 0, ownerId: 'k1', role: 'captain', woundedTurns: 2,
      stats: { might: 5, vitality: 5, leadership: 5, tactics: 5, arcana: 5, resolve: 5 }, traits: [], spells: [], status: 'wounded',
    };
    expect(turns(g, 1).characters.h1.status).toBe('wounded');
    expect(turns(g, 2).characters.h1.status).toBe('active');
  });
});
