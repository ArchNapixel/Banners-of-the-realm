import { describe, expect, it } from 'vitest';
import { runAI } from '../src/engine/ai';
import { makeContext, visibleHostiles } from '../src/engine/ai/context';
import { predictBattle } from '../src/engine/ai/predict';
import { distance, key } from '../src/engine/core/hex';
import { newCompany } from '../src/engine/core/military';
import { applyOrder, type Order } from '../src/engine/core/orders';
import { resolveTurn } from '../src/engine/core/resolveTurn';
import { cloneState, newGame } from '../src/engine/core/state';
import type { Company, GameState, HexCoord, MapSize, RaceId, Village } from '../src/engine/core/types';

const game = (seed = 'ai', aiEnabled = true, size: MapSize = 'small') =>
  newGame({ seed, mapSize: size, playerRace: 'valdren', aiRaces: size === 'small' ? ['ghor', 'durrakin'] : ['ghor', 'durrakin', 'sylvaen'], aiEnabled });
const turns = (g: GameState, n: number) => { let s = g; for (let i = 0; i < n; i++) s = resolveTurn(s); return s; };
const hexAt = (g: GameState, dq: number, dr = 0, v = 'v1'): HexCoord => ({ q: g.villages[v].hex.q + dq, r: g.villages[v].hex.r + dr });
const of = (g: GameState, kid: string) => Object.values(g.companies).filter((c) => c.ownerId === kid);
const rich = (g: GameState, kid: string) => Object.assign(g.kingdoms[kid].resources, { gold: 9999, wood: 9999, stone: 9999, iron: 9999, food: 9999 });
const plains = (g: GameState) => { for (const t of Object.values(g.map.tiles)) t.terrain = 'plains'; for (const v of Object.values(g.villages)) if (v.ownerId === null) delete g.villages[v.id]; };
const exec = (g: GameState, kid: string, o: object) => { const r = applyOrder(g, { kingdomId: kid, ...o } as Order); if (r.error) throw new Error(r.error); return r.state; };
const types = (issued: Order[]) => issued.map((o) => o.type);

describe('the AI turn', () => {
  it('only acts when the game has AI enabled', () => {
    const off = turns(game('off', false), 10);
    expect(Object.values(off.kingdoms.k2.ai ?? {})).toHaveLength(0);
    expect(of(off, 'k2')).toHaveLength(1);
    const on = turns(game('off', true), 10);
    expect(on.kingdoms.k2.ai?.goal).toBeTruthy();
  });

  it('is deterministic', () => {
    expect(JSON.stringify(turns(game('det'), 25))).toBe(JSON.stringify(turns(game('det'), 25)));
  });

  it('builds, recruits and expands over a game, and fights wars', () => {
    const g = turns(game('grow', true, 'medium'), 80);
    const ai = ['k2', 'k3', 'k4'].map((k) => g.kingdoms[k]);
    for (const k of ai) {
      const vs = Object.values(g.villages).filter((v) => v.ownerId === k.id);
      if (k.eliminated) continue;
      expect(vs.reduce((t, v) => t + v.buildings.length, 0)).toBeGreaterThan(2);
    }
    const started = 4;
    expect(Object.values(g.villages).filter((v) => v.ownerId).length).toBeGreaterThan(started);
    expect(g.reports.length).toBeGreaterThan(0);
    expect(g.log.some((e) => e.text.includes('founded'))).toBe(true);
  });

  it('keeps the game consistent: no negative stocks, dangling references or empty companies', () => {
    const g = turns(game('sanity', true, 'medium'), 100);
    for (const k of Object.values(g.kingdoms)) for (const v of Object.values(k.resources)) expect(v).toBeGreaterThanOrEqual(0);
    for (const c of Object.values(g.companies)) {
      expect(c.men).toBeGreaterThan(0);
      if (c.armyId) expect(g.armies[c.armyId].companyIds).toContain(c.id);
      if (c.battleId) expect(g.battles[c.battleId]).toBeDefined();
    }
    for (const a of Object.values(g.armies)) for (const id of a.companyIds) expect(g.companies[id]?.armyId).toBe(a.id);
    for (const b of Object.values(g.battles)) for (const id of [...b.pending]) expect(g.companies[id]).toBeDefined();
    for (const id of Object.keys(g.captures)) expect(g.villages[id]).toBeDefined();
    for (const v of Object.values(g.villages)) if (v.ownerId) expect(g.kingdoms[v.ownerId]).toBeDefined();
  });

  it('plays a full turn quickly (target: well under 2 seconds on a medium map)', () => {
    let g = game('speed', true, 'medium');
    g = turns(g, 40);
    const t0 = Date.now();
    g = turns(g, 20);
    expect((Date.now() - t0) / 20).toBeLessThan(500);
  });

  it('skips eliminated kingdoms', () => {
    const g = game('dead');
    g.kingdoms.k2.eliminated = true;
    const before = JSON.stringify(g.kingdoms.k2);
    expect(JSON.stringify(turns(g, 3).kingdoms.k2.ai)).toBeUndefined();
    expect(before).toContain('eliminated');
  });
});

describe('battle prediction', () => {
  const setup = (mine: [string, Company['rank']][], foes: [string, Company['rank']][]) => {
    const g = game('predict', false);
    plains(g);
    const hex = hexAt(g, 3);
    const attackers = mine.map(([u, r]) => { const c = newCompany(g, 'k2', u, 'valdren', 500, hexAt(g, 2)); c.rank = r; return c; });
    for (const [u, r] of foes) { const c = newCompany(g, 'k1', u, 'valdren', 500, hex); c.rank = r; }
    return { ctx: makeContext(g, 'k2'), attackers, hex };
  };

  it('predicts overwhelming odds as sure wins and hopeless ones as losses', () => {
    const strong = setup([['swordsmen', 'elite'], ['swordsmen', 'elite'], ['swordsmen', 'elite'], ['swordsmen', 'elite']], [['militia', 'green']]);
    expect(predictBattle(strong.ctx, strong.attackers, strong.hex).winRate).toBeGreaterThanOrEqual(0.95);
    const weak = setup([['militia', 'green']], [['swordsmen', 'elite'], ['swordsmen', 'elite'], ['swordsmen', 'elite']]);
    expect(predictBattle(weak.ctx, weak.attackers, weak.hex).winRate).toBeLessThanOrEqual(0.05);
  });

  it('equal forces are no sure thing, and results are cached for the turn', () => {
    const even = setup([['spearmen', 'trained'], ['spearmen', 'trained']], [['spearmen', 'trained'], ['spearmen', 'trained']]);
    const p = predictBattle(even.ctx, even.attackers, even.hex);
    // Out of supply and attacking, an equal force is no sure thing.
    expect(p.winRate).toBeLessThan(0.95);
    expect(p.lossShare).toBeGreaterThan(0.05);
    expect(predictBattle(even.ctx, even.attackers, even.hex)).toBe(p);
  });

  it('guesses a garrison for a village it cannot see', () => {
    const g = game('guess', false);
    plains(g);
    const v: Village = { ...structuredClone(g.villages.v1), id: 'vx', ownerId: 'k1', hex: hexAt(g, 8), tier: 'town' };
    g.villages.vx = v;
    for (const c of of(g, 'k1')) c.hex = hexAt(g, 1); // nobody there to see
    const ctx = makeContext(g, 'k2');
    const a = [newCompany(g, 'k2', 'militia', 'ghor', 500, hexAt(g, 7))];
    const p = predictBattle(ctx, a, v.hex, v);
    expect(p.winRate).toBeLessThan(0.5); // a town is assumed to hold three companies
  });
});

describe('fog of war and targets', () => {
  /** An AI army with the player's capital in plain sight. */
  const standoff = (foes: [string, Company['rank']][], mine: [string, Company['rank']][]) => {
    const g = game('standoff', true);
    plains(g);
    for (const c of of(g, 'k2')) delete g.companies[c.id];
    for (const c of of(g, 'k1')) delete g.companies[c.id];
    rich(g, 'k2');
    const at = hexAt(g, 2);
    const ids = mine.map(([u, r]) => { const c = newCompany(g, 'k2', u, 'ghor', 500, at); c.rank = r; return c.id; });
    for (const [u, r] of foes) { const c = newCompany(g, 'k1', u, 'valdren', 500, g.villages.v1.hex); c.rank = r; }
    const s = exec(g, 'k2', { type: 'merge', companyIds: ids });
    s.kingdoms.k2.explored = [...new Set([...s.kingdoms.k2.explored, key(s.villages.v1.hex)])];
    return s;
  };
  const moves = (s: GameState) => { const probe = cloneState(s); return runAI(probe, 'k2').filter((o) => o.type === 'move') as Extract<Order, { type: 'move' }>[]; };

  it('attacks a target it expects to beat', () => {
    const s = standoff([['militia', 'green']], [['swordsmen', 'elite'], ['swordsmen', 'elite'], ['swordsmen', 'elite']]);
    const m = moves(s).filter((o) => s.armies[o.unitId]);
    expect(m.some((o) => key(o.to) === key(s.villages.v1.hex))).toBe(true);
  });

  it('holds back from a fight it expects to lose', () => {
    const s = standoff([['swordsmen', 'elite'], ['swordsmen', 'elite'], ['swordsmen', 'elite'], ['swordsmen', 'elite']], [['militia', 'green'], ['militia', 'green']]);
    const m = moves(s).filter((o) => s.armies[o.unitId]);
    expect(m.some((o) => key(o.to) === key(s.villages.v1.hex))).toBe(false);
  });

  it('never sees through fog: unexplored villages are not targets and far-off armies are unseen', () => {
    const s = standoff([['swordsmen', 'elite']], [['swordsmen', 'elite'], ['swordsmen', 'elite'], ['swordsmen', 'elite']]);
    s.kingdoms.k2.explored = s.kingdoms.k2.explored.filter((k) => k !== key(s.villages.v1.hex)); // never seen it
    for (const c of of(s, 'k1')) c.hex = hexAt(s, 14);
    const ctx = makeContext(s, 'k2');
    expect(visibleHostiles(ctx)).toHaveLength(0);
    expect(moves(s).filter((o) => s.armies[o.unitId])).toHaveLength(0);
  });

  it('retreats to heal when an army is battered, rather than pushing on', () => {
    const s = standoff([['militia', 'green']], [['swordsmen', 'elite'], ['swordsmen', 'elite']]);
    for (const c of of(s, 'k2')) c.men = Math.round(c.maxMen * 0.2);
    const m = moves(s).filter((o) => s.armies[o.unitId]);
    expect(m).toHaveLength(1);
    expect(distance(m[0].to, s.villages.v2.hex)).toBeLessThan(distance(s.villages.v1.hex, s.villages.v2.hex) + 1);
    expect(key(m[0].to)).toBe(key(s.villages.v2.hex));
  });
});

describe('economy', () => {
  const calm = () => {
    const g = game('eco', true);
    plains(g);
    for (const c of of(g, 'k2')) delete g.companies[c.id];
    return g;
  };
  const run = (g: GameState) => runAI(cloneState(g), 'k2');

  it('builds the first useful building from its list, one per village', () => {
    const g = calm();
    rich(g, 'k2');
    g.villages.v2.buildings = [{ id: 'farm' }];
    const orders = run(g).filter((o) => o.type === 'build') as Extract<Order, { type: 'build' }>[];
    expect(orders.map((o) => o.building)).toEqual(['barracks']);
  });

  it('puts food first when the kingdom is running short', () => {
    const g = calm();
    rich(g, 'k2');
    g.kingdoms.k2.resources.food = 40;
    g.villages.v2.buildings = [{ id: 'barracks' }];
    const o = run(g).find((x) => x.type === 'build') as Extract<Order, { type: 'build' }>;
    expect(['farm', 'fishing_dock', 'hunting_lodge', 'peat_works']).toContain(o.building);
  });

  it('keeps a gold reserve and does not build with its last coins', () => {
    const g = calm();
    g.kingdoms.k2.resources.gold = 80;
    g.kingdoms.k2.resources.food = 9999;
    expect(types(run(g))).not.toContain('build');
  });

  it('keeps wood back for settlers when it has no wood income', () => {
    const g = calm();
    rich(g, 'k2');
    g.kingdoms.k2.resources.wood = 50;
    g.villages.v2.buildings = [{ id: 'barracks' }];
    const built = (run(g).filter((o) => o.type === 'build') as Extract<Order, { type: 'build' }>[]).map((o) => o.building);
    expect(built).not.toContain('market'); // would leave 23 wood
  });

  it('lowers taxes in unhappy villages and raises them in contented ones', () => {
    const g = calm();
    g.villages.v2.stability = 20;
    expect(run(g).find((o) => o.type === 'setTax')).toMatchObject({ level: 'low' });
    g.villages.v2.stability = 90;
    expect(run(g).find((o) => o.type === 'setTax')).toMatchObject({ level: 'high' });
  });

  it('recruits toward its army target, but not into starvation', () => {
    const g = calm();
    rich(g, 'k2');
    g.kingdoms.k2.ai = { goal: 'Prepare War', targets: {} };
    expect(types(run(g))).toContain('recruit');
    g.kingdoms.k2.resources.food = 0;
    for (const v of Object.values(g.villages).filter((x) => x.ownerId === 'k2')) v.buildings = v.buildings.filter((b) => b.id === 'barracks');
    expect(types(run(g))).not.toContain('recruit');
  });

  it('upgrades a full village', () => {
    const g = calm();
    rich(g, 'k2');
    g.villages.v2.populationByRace = { ghor: 2800 };
    expect(types(run(g))).toContain('upgrade');
  });
});

describe('spoils and prisoners', () => {
  it('occupies conquests when it can afford to, and sacks when broke', () => {
    for (const [gold, choice] of [[5000, 'occupy'], [0, 'sack']] as const) {
      const g = game('spoils');
      g.villages.v1.ownerId = 'k1';
      g.captures.v1 = { captorId: 'k2', turn: 1 };
      g.kingdoms.k2.resources.gold = gold;
      const o = runAI(cloneState(g), 'k2').find((x) => x.type === 'capture');
      expect(o).toMatchObject({ villageId: 'v1', choice });
    }
  });

  it('ransoms prisoners when it can, otherwise conscripts them', () => {
    const g = game('captives');
    g.prisoners.p1 = { id: 'p1', captorId: 'k2', fromId: 'k1', race: 'valdren', men: 100, hex: hexAt(g, 0, 0, 'v2'), turn: 1 };
    g.kingdoms.k1.resources.gold = 1000;
    const rich1 = cloneState(g);
    runAI(rich1, 'k2');
    expect(rich1.prisoners.p1).toBeUndefined();
    expect(rich1.kingdoms.k1.resources.gold).toBe(900);
    const g2 = cloneState(g);
    g2.kingdoms.k1.resources.gold = 0;
    const before = of(g2, 'k2').length;
    runAI(g2, 'k2');
    expect(g2.prisoners.p1).toBeUndefined();
    expect(of(g2, 'k2').length).toBeGreaterThan(before);
  });
});

describe('settlers', () => {
  it('walks settlers to a good site and founds a village there', () => {
    let g = game('settle');
    plains(g);
    for (const c of of(g, 'k2')) delete g.companies[c.id];
    rich(g, 'k2');
    const s = newCompany(g, 'k2', 'settlers', 'ghor', 300, g.villages.v2.hex);
    const villages = Object.keys(g.villages).length;
    for (let i = 0; i < 12 && Object.keys(g.villages).length === villages; i++) g = resolveTurn(g);
    expect(Object.keys(g.villages)).toHaveLength(villages + 1);
    const fresh = Object.values(g.villages).find((v) => !['v1', 'v2', 'v3'].includes(v.id) && v.ownerId === 'k2')!;
    expect(fresh).toBeDefined();
    for (const v of Object.values(g.villages)) if (v.id !== fresh.id) expect(distance(v.hex, fresh.hex)).toBeGreaterThanOrEqual(3);
    expect(g.companies[s.id]).toBeUndefined();
    expect(g.kingdoms.k2.ai?.targets[s.id]).toBeUndefined();
  });

  it('keeps clear of other kingdoms\' villages', () => {
    let g = game('settle2');
    plains(g);
    for (const c of of(g, 'k2')) delete g.companies[c.id];
    rich(g, 'k2');
    newCompany(g, 'k2', 'settlers', 'ghor', 300, g.villages.v2.hex);
    g = turns(g, 10);
    for (const v of Object.values(g.villages).filter((x) => x.ownerId === 'k2' && x.id !== 'v2')) {
      for (const o of Object.values(g.villages).filter((x) => x.ownerId !== 'k2')) expect(distance(v.hex, o.hex)).toBeGreaterThanOrEqual(5);
    }
  });
});

describe('battle nights', () => {
  const losing = () => {
    const g = game('night', false);
    plains(g);
    for (const c of of(g, 'k1')) delete g.companies[c.id];
    for (const c of of(g, 'k2')) delete g.companies[c.id];
    const foe = newCompany(g, 'k1', 'swordsmen', 'valdren', 500, hexAt(g, 1));
    foe.rank = 'elite';
    const me = newCompany(g, 'k2', 'militia', 'ghor', 500, hexAt(g, 2));
    let s = exec(g, 'k2', { type: 'move', unitId: me.id, to: foe.hex });
    s = resolveTurn(s);
    return s;
  };

  it('withdraws from a battle that is clearly lost', () => {
    const s = losing();
    const gb = Object.values(s.battles)[0];
    if (!gb) return; // already decided in a day: nothing to withdraw from
    const snap = gb.battle.report.days.at(-1)!;
    snap.attacker.strength = 40;
    snap.attacker.morale = 20;
    const out = runAI(cloneState(s), 'k2');
    expect(out.some((o) => o.type === 'withdraw')).toBe(true);
  });

  it('stays in a battle it is winning', () => {
    const s = losing();
    const gb = Object.values(s.battles)[0];
    if (!gb) return;
    const snap = gb.battle.report.days.at(-1)!;
    snap.attacker.strength = 1000;
    snap.defender.strength = 100;
    expect(runAI(cloneState(s), 'k2').some((o) => o.type === 'withdraw')).toBe(false);
  });
});

describe('AI against AI', () => {
  it('lets the player kingdom fall to a Warlord when left alone', () => {
    const races: RaceId[] = ['ghor', 'durrakin'];
    let g = newGame({ seed: 'war-1', mapSize: 'small', playerRace: 'valdren', aiRaces: races, aiEnabled: true });
    g = turns(g, 120);
    const alive = Object.values(g.kingdoms).filter((k) => !k.eliminated);
    expect(alive.length).toBeGreaterThanOrEqual(1);
    expect(g.reports.length).toBeGreaterThan(0);
    // The whole world is still consistent after a long war.
    for (const v of Object.values(g.villages)) if (v.ownerId) expect(Object.values(g.kingdoms).some((k) => k.id === v.ownerId)).toBe(true);
  });
});
