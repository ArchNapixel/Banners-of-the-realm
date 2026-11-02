import { describe, expect, it } from 'vitest';
import { effectiveStability, totalPop } from '../src/engine/core/economy';
import { key } from '../src/engine/core/hex';
import { newCompany } from '../src/engine/core/military';
import { applyOrder, type Order } from '../src/engine/core/orders';
import { recruitBlocker } from '../src/engine/core/recruit';
import { resolveTurn } from '../src/engine/core/resolveTurn';
import { newGame } from '../src/engine/core/state';
import type { Company, GameSettings, GameState, HexCoord, RaceId, Village } from '../src/engine/core/types';

const game = (race: GameSettings['playerRace'] = 'valdren', seed = 'conq') =>
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
const rich = (g: GameState) => Object.assign(g.kingdoms.k1.resources, { gold: 99999, wood: 9999, stone: 9999, iron: 9999, food: 99999 });

/** Open plains with only the player's capital and troops; enemy capitals stay far away. */
function field(g: GameState) {
  for (const t of Object.values(g.map.tiles)) t.terrain = 'plains';
  for (const v of Object.values(g.villages)) if (v.ownerId === null) delete g.villages[v.id];
  for (const c of Object.values(g.companies)) if (c.ownerId !== 'k1') delete g.companies[c.id];
  rich(g);
  return g;
}

/** A village a couple of hexes from the capital. */
function place(g: GameState, id: string, owner: string | null, at: HexCoord, race: RaceId, pop: number): Village {
  const v: Village = {
    ...structuredClone(g.villages.v1), id, name: `${id}-town`, ownerId: owner, hex: at, tier: 'village',
    populationByRace: { [race]: pop }, buildings: [], buildQueue: [], trainQueue: [], stability: 50, conquestPenalty: 0,
  };
  g.villages[id] = v;
  return v;
}

/** A strong army that wins fights in a day. */
function legion(g: GameState, n = 4) {
  const base = mine(g)[0];
  const cs: Company[] = [base];
  for (let i = 1; i < n; i++) { const c = newCompany(g, 'k1', 'swordsmen', 'valdren', 500, base.hex); c.rank = 'elite'; cs.push(c); }
  base.rank = 'elite';
  const s = run(g, o('merge', { companyIds: cs.map((c) => c.id) }));
  return { s, army: Object.keys(s.armies)[0], cs };
}

describe('independent villages', () => {
  it('are defended by a militia garrison that fights when you walk in', () => {
    const g = field(game());
    const nv = place(g, 'vn', null, hexAt(g, 2), 'durrakin', 600);
    const { s, army } = legion(g);
    const t = run(s, o('move', { unitId: army, to: nv.hex }));
    const gb = Object.values(t.battles)[0];
    expect(gb).toBeDefined();
    expect(gb.defenderId).toBe('neutral');
    expect(gb.battle.defender.name).toBe('Independents');
    expect(Object.values(gb.battle.defender.companies)[0].unit.name).toBe('Militia');
    expect(Object.values(gb.battle.defender.companies)[0].startMen).toBe(300); // half the villagers, not above company size 400
  });

  it('winning the fight leaves the village waiting for your decision; the garrison is gone', () => {
    const g = field(game());
    const nv = place(g, 'vn', null, hexAt(g, 2), 'valdren', 600);
    const { s, army } = legion(g);
    const t = turns(run(s, o('move', { unitId: army, to: nv.hex })), 1);
    expect(Object.keys(t.battles)).toHaveLength(0);
    expect(t.captures.vn).toMatchObject({ captorId: 'k1' });
    expect(Object.values(t.companies).some((c) => c.ownerId === 'neutral')).toBe(false);
    expect(t.villages.vn.ownerId).toBeNull();
  });

  it('can be annexed for 0.3 gold a resident if one of your villages is within 4 hexes', () => {
    const g = field(game());
    place(g, 'vn', null, hexAt(g, 3), 'valdren', 1000);
    place(g, 'far', null, hexAt(g, 9), 'valdren', 1000);
    const gold = g.kingdoms.k1.resources.gold;
    const s = run(g, o('annex', { villageId: 'vn' }));
    expect(s.villages.vn.ownerId).toBe('k1');
    expect(s.kingdoms.k1.resources.gold).toBe(gold - 300);
    expect(err(g, o('annex', { villageId: 'far' }))).toMatch(/within 4 hexes/);
    g.kingdoms.k1.resources.gold = 100;
    expect(err(g, o('annex', { villageId: 'vn' }))).toMatch(/300 gold/);
    expect(err(s, o('annex', { villageId: 'v2' }))).toMatch(/independent/);
  });
});

describe('taking an enemy village', () => {
  it('an undefended village falls as soon as you step in', () => {
    const g = field(game());
    const ev = place(g, 'ev', 'k2', hexAt(g, 2), 'ghor', 800);
    const c = mine(g)[0];
    const s = run(g, o('move', { unitId: c.id, to: ev.hex }));
    expect(Object.keys(s.battles)).toHaveLength(0);
    expect(s.captures.ev).toMatchObject({ captorId: 'k1' });
    expect(s.log.some((e) => e.text.includes('has fallen'))).toBe(true);
  });

  it('occupying keeps people and buildings, clears the queues and applies the conquest penalty', () => {
    const g = field(game());
    const ev = place(g, 'ev', 'k2', hexAt(g, 2), 'ghor', 800);
    ev.buildings.push({ id: 'farm' });
    ev.buildQueue.push({ id: 'market', turnsLeft: 2 });
    ev.trainQueue.push({ id: 'militia', turnsLeft: 1, race: 'ghor', men: 500, slot: 'barracks' });
    const s = run(g, o('move', { unitId: mine(g)[0].id, to: ev.hex }), o('capture', { villageId: 'ev', choice: 'occupy' }));
    const v = s.villages.ev;
    expect(v).toMatchObject({ ownerId: 'k1', populationByRace: { ghor: 800 }, buildQueue: [], trainQueue: [], conquestPenalty: 40 }); // Ghor under a Valdren crown
    expect(v.buildings.map((b) => b.id)).toEqual(['farm']);
    expect(s.captures.ev).toBeUndefined();
    expect(effectiveStability(s, v)).toBe(50 - 40 - 10); // base 50, conquest -40, Ghor -10
  });

  it('same-race conquests cost 30 stability, decaying 3 a turn', () => {
    const g = field(game());
    const ev = place(g, 'ev', 'k2', hexAt(g, 2), 'valdren', 800);
    const s = run(g, o('move', { unitId: mine(g)[0].id, to: ev.hex }), o('capture', { villageId: 'ev', choice: 'occupy' }));
    expect(s.villages.ev.conquestPenalty).toBe(30);
    expect(turns(s, 1).villages.ev.conquestPenalty).toBe(27);
  });

  it('an undecided conquest is occupied when the turn ends', () => {
    const g = field(game());
    const ev = place(g, 'ev', 'k2', hexAt(g, 2), 'valdren', 800);
    const s = turns(run(g, o('move', { unitId: mine(g)[0].id, to: ev.hex })), 1);
    expect(s.villages.ev.ownerId).toBe('k1');
    expect(s.captures.ev).toBeUndefined();
  });

  it('sacking pays 1 gold a resident (Ghor +50%), costs 30% of the people and shakes the old owner', () => {
    const sack = (race: GameSettings['playerRace']) => {
      const g = field(game(race));
      const ev = place(g, 'ev', 'k2', hexAt(g, 2), 'valdren', 1000);
      place(g, 'ev2', 'k2', hexAt(g, 9), 'ghor', 500);
      const gold = g.kingdoms.k1.resources.gold;
      const s = run(g, o('move', { unitId: mine(g)[0].id, to: ev.hex }), o('capture', { villageId: 'ev', choice: 'sack' }));
      return { s, loot: s.kingdoms.k1.resources.gold - gold };
    };
    const a = sack('valdren');
    expect(a.loot).toBe(1000);
    expect(a.s.villages.ev).toMatchObject({ ownerId: 'k1', populationByRace: { valdren: 700 } });
    expect(a.s.villages.ev2.stability).toBe(30); // 50 − 20
    expect(sack('ghor').loot).toBe(1500);
  });

  it('razing destroys the village; a capital moves, and a kingdom with nothing left is eliminated', () => {
    const g = field(game());
    const ev = place(g, 'ev', 'k2', hexAt(g, 2), 'ghor', 800);
    place(g, 'ev2', 'k2', hexAt(g, 9), 'ghor', 500);
    g.kingdoms.k2.capitalId = 'ev';
    delete g.villages.v2;
    const s = run(g, o('move', { unitId: mine(g)[0].id, to: ev.hex }), o('capture', { villageId: 'ev', choice: 'raze' }));
    expect(s.villages.ev).toBeUndefined();
    expect(s.kingdoms.k2.capitalId).toBe('ev2');
    expect(s.kingdoms.k2.eliminated).toBeUndefined();
    // Take the last one too.
    const t = structuredClone(s);
    t.companies[mine(t)[0].id].hex = hexAt(g, 8);
    t.companies[mine(t)[0].id].movementLeft = 2;
    const u = run(t, o('move', { unitId: mine(t)[0].id, to: hexAt(g, 9) }), o('capture', { villageId: 'ev2', choice: 'occupy' }));
    expect(u.kingdoms.k2.eliminated).toBe(true);
  });

  it('capture orders are checked', () => {
    const g = field(game());
    const ev = place(g, 'ev', 'k2', hexAt(g, 2), 'ghor', 800);
    expect(err(g, o('capture', { villageId: 'ev', choice: 'sack' }))).toBe('Nothing to decide here');
    const s = run(g, o('move', { unitId: mine(g)[0].id, to: ev.hex }));
    expect(applyOrder(s, { type: 'capture', kingdomId: 'k3', villageId: 'ev', choice: 'sack' }).error).toBe('Not your conquest');
  });

  it('mixed populations: a conquered Durrakin village cannot field its unique units until it settles', () => {
    const g = field(game());
    const ev = place(g, 'ev', 'k3', hexAt(g, 2), 'durrakin', 1500);
    ev.buildings.push({ id: 'deep_forge' }, { id: 'mine' });
    const s = run(g, o('move', { unitId: mine(g)[0].id, to: ev.hex }), o('capture', { villageId: 'ev', choice: 'occupy' }));
    expect(s.villages.ev.conquestPenalty).toBe(40);
    expect(recruitBlocker(s, 'k1', s.villages.ev, 'ironshields', 'durrakin')).toMatch(/stability 60/);
    s.villages.ev.conquestPenalty = 0;
    s.villages.ev.stability = 62;
    expect(recruitBlocker(s, 'k1', s.villages.ev, 'ironshields', 'durrakin')).toBeNull();
    // Valdren settlers in the village add a friendly minority for stability.
    s.villages.ev.populationByRace = { durrakin: 1500, valdren: 600 };
    expect(effectiveStability(s, s.villages.ev)).toBe(65);
  });
});

describe('defenses and sieges', () => {
  it('a Palisade gives the defenders +20% and can be assaulted straight away', () => {
    let withPal = 0, without = 0;
    for (let i = 0; i < 20; i++) {
      for (const pal of [true, false]) {
        const g = field(game('valdren', `pal${i}`));
        const ev = place(g, 'ev', 'k2', hexAt(g, 1), 'ghor', 800);
        if (pal) ev.buildings.push({ id: 'palisade' });
        newCompany(g, 'k2', 'militia', 'ghor', 500, ev.hex);
        const s = run(g, o('move', { unitId: mine(g)[0].id, to: ev.hex }));
        const gb = Object.values(s.battles)[0];
        expect(gb.battle.defenseBonus).toBe(pal ? 0.2 : 0);
        const t = resolveTurn(s);
        const lost = (Object.values(t.battles)[0]?.battle ?? t.reports.at(-1)!.battle).report.rounds.reduce((a, r) => a + Object.values(r.losses.defender).reduce((x, y) => x + y, 0), 0);
        if (pal) withPal += lost; else without += lost;
      }
    }
    expect(withPal).toBeLessThan(without);
  });

  it('fields have no defense bonus even when the defenders are from a village elsewhere', () => {
    const g = field(game());
    place(g, 'ev', 'k2', hexAt(g, 6), 'ghor', 800).buildings.push({ id: 'palisade' });
    newCompany(g, 'k2', 'militia', 'ghor', 500, hexAt(g, 1));
    const s = run(g, o('move', { unitId: mine(g)[0].id, to: hexAt(g, 1) }));
    expect(Object.values(s.battles)[0].battle.defenseBonus).toBe(0);
  });

  /** A walled village with a garrison, besieged by the player's army. */
  const siege = (opts: { engineers?: number; granary?: boolean } = {}) => {
    const g = field(game());
    const ev = place(g, 'ev', 'k2', hexAt(g, 1), 'ghor', 1000);
    ev.buildings.push({ id: 'palisade' }, { id: 'stone_walls' });
    if (opts.granary) ev.buildings.push({ id: 'granary' });
    newCompany(g, 'k2', 'militia', 'ghor', 500, ev.hex);
    const base = mine(g)[0];
    const army = [base, newCompany(g, 'k1', 'spearmen', 'valdren', 500, base.hex)];
    for (let i = 0; i < (opts.engineers ?? 0); i++) army.push(newCompany(g, 'k1', 'siege_engineers', 'valdren', 200, base.hex));
    const merged = run(g, o('merge', { companyIds: army.map((c) => c.id) }));
    const armyId = Object.keys(merged.armies)[0];
    return { s: run(merged, o('move', { unitId: armyId, to: ev.hex })), armyId, ev };
  };

  it('Stone Walls cannot be assaulted: the army settles in for a siege instead', () => {
    const { s, ev } = siege();
    expect(Object.keys(s.battles)).toHaveLength(0);
    expect(s.sieges.ev).toMatchObject({ attackerId: 'k1', breach: 0, stores: 3, garrisonMorale: 100 });
    expect(mine(s).every((c) => key(c.hex) === key(ev.hex) && !c.battleId)).toBe(true);
    expect(s.log.some((e) => e.text.includes('lays siege'))).toBe(true);
  });

  it('a Granary adds 3 turns of stores', () => {
    expect(siege({ granary: true }).s.sieges.ev.stores).toBe(6);
  });

  it('the blockade drains stores, then the garrison and the people starve until it surrenders', () => {
    let { s } = siege();
    s = turns(s, 1);
    expect(s.sieges.ev.stores).toBe(2);
    s = turns(s, 2);
    expect(s.sieges.ev.stores).toBe(0);
    const pop = totalPop(s.villages.ev); // still growing until the stores ran out
    s = turns(s, 1);
    expect(s.sieges.ev.garrisonMorale).toBe(80);
    expect(totalPop(s.villages.ev)).toBeLessThan(pop);
    for (let i = 0; i < 8 && s.sieges.ev; i++) s = turns(s, 1);
    expect(s.sieges.ev).toBeUndefined();
    expect(s.log.some((e) => e.text.includes('surrenders'))).toBe(true);
    expect(Object.values(s.companies).some((c) => c.ownerId === 'k2' && key(c.hex) === key(hexAt(s, 1)))).toBe(false);
    expect(Object.values(s.prisoners).some((p) => p.captorId === 'k1' && p.fromId === 'k2' && p.men === 500)).toBe(true);
    expect(s.captures.ev).toMatchObject({ captorId: 'k1' }); // waiting for the player's choice
    expect(turns(s, 1).villages.ev.ownerId).toBe('k1'); // ...or occupied when the next turn is resolved
  });

  it('Siege Engineers breach the walls: +25% a day each, then the assault begins', () => {
    let { s } = siege({ engineers: 2 });
    s = turns(s, 1);
    expect(s.sieges.ev.breach).toBe(0.5);
    s = turns(s, 1);
    expect(s.sieges.ev).toBeUndefined();
    expect(Object.values(s.battles)).toHaveLength(1);
    expect(s.log.some((e) => e.text.includes('breached'))).toBe(true);
    const gb = Object.values(s.battles)[0];
    expect(gb.battle.defenseBonus).toBe(0.2); // the Palisade is still there
    expect(Object.keys(gb.battle.attacker.companies)).toHaveLength(4);
  });

  it('a single engineer company needs four days', () => {
    let { s } = siege({ engineers: 1 });
    s = turns(s, 3);
    expect(s.sieges.ev.breach).toBe(0.75);
    expect(Object.keys(s.battles)).toHaveLength(0);
    s = turns(s, 1);
    expect(Object.keys(s.battles)).toHaveLength(1);
  });

  it('the siege is lifted when the besiegers march away', () => {
    const { s, armyId } = siege();
    const t = turns(run(resolveTurn(s), o('move', { unitId: armyId, to: hexAt(s, 0) })), 1);
    expect(t.sieges.ev).toBeUndefined();
    expect(t.log.some((e) => e.text.includes('siege of ev-town is lifted'))).toBe(true);
  });

  it('only the besieger and the owner may enter a besieged village; reinforcements join the siege', () => {
    const { s, ev } = siege();
    const third = newCompany(s, 'k3', 'militia', 'durrakin', 500, hexAt(s, 4));
    third.movementLeft = 4;
    expect(applyOrder(s, { type: 'move', kingdomId: 'k3', unitId: third.id, to: ev.hex }).error).toMatch(/No route/);
    const late = newCompany(s, 'k1', 'archers', 'valdren', 500, hexAt(s, 0));
    const t = run(s, o('move', { unitId: late.id, to: ev.hex }));
    expect(key(t.companies[late.id].hex)).toBe(key(ev.hex));
    expect(t.companies[late.id].battleId).toBeUndefined();
    expect(Object.keys(t.sieges)).toHaveLength(1);
  });
});

describe('revolts', () => {
  it('unhappy villages occasionally rebel: against a garrison they fight, without one they break away', () => {
    let fought = 0, seceded = 0;
    for (let i = 0; i < 120 && (!fought || !seceded); i++) {
      for (const garrisoned of [true, false]) {
        const g = field(game('valdren', `rev${i}`));
        const v = place(g, 'rv', 'k1', hexAt(g, 3), 'valdren', 800);
        v.stability = 0;
        if (garrisoned) newCompany(g, 'k1', 'militia', 'valdren', 500, v.hex);
        const s = resolveTurn(g);
        if (!s.log.some((e) => e.text.includes('Revolt in'))) continue;
        if (garrisoned) {
          fought++;
          expect(Object.values(s.battles)[0].battle.attacker.name).toBe('Independents');
        } else {
          seceded++;
          expect(s.villages.rv.ownerId).toBeNull();
          expect(Object.values(s.companies).some((c) => c.ownerId === 'neutral')).toBe(false);
        }
      }
    }
    expect(fought).toBeGreaterThan(0);
    expect(seceded).toBeGreaterThan(0);
  });

  it('stable villages never rebel', () => {
    const g = field(game());
    place(g, 'rv', 'k1', hexAt(g, 3), 'valdren', 800).stability = 60;
    for (let i = 0; i < 20; i++) expect(turns(g, 1).log.some((e) => e.text.includes('Revolt'))).toBe(false);
  });
});

describe('determinism', () => {
  it('sieges and conquests replay identically', () => {
    const mk = () => {
      const g = field(game('valdren', 'det'));
      const ev = place(g, 'ev', 'k2', hexAt(g, 2), 'ghor', 1000);
      ev.buildings.push({ id: 'stone_walls' });
      newCompany(g, 'k2', 'militia', 'ghor', 500, ev.hex);
      return turns(run(g, o('move', { unitId: mine(g)[0].id, to: ev.hex })), 6);
    };
    expect(JSON.stringify(mk())).toBe(JSON.stringify(mk()));
  });
});
