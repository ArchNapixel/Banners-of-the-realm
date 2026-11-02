import { describe, expect, it } from 'vitest';
import { effectiveStability } from '../src/engine/core/economy';
import { BUILDINGS, RACES } from '../src/engine/core/data';
import { distance, key, withinRadius } from '../src/engine/core/hex';
import { inSupply, newCompany } from '../src/engine/core/military';
import { speedOf, startingFatigue } from '../src/engine/core/movement';
import { applyOrder, type Order } from '../src/engine/core/orders';
import { recruitBlocker, unlockSlot } from '../src/engine/core/recruit';
import { resolveTurn } from '../src/engine/core/resolveTurn';
import { newGame } from '../src/engine/core/state';
import type { GameSettings, GameState, HexCoord, RaceId } from '../src/engine/core/types';
import { UNIT_DEFS, companyMen, effectiveUnit, unlockingBuildings } from '../src/engine/core/units';
import { upkeep } from '../src/engine/core/upkeep';
import { visibleKeys } from '../src/engine/core/vision';

const game = (race: GameSettings['playerRace'] = 'valdren', seed = 'mil') =>
  newGame({ seed, mapSize: 'small', playerRace: race, aiRaces: ['ghor'] });
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
const rich = (g: GameState) => Object.assign(g.kingdoms.k1.resources, { gold: 9999, wood: 9999, stone: 9999, iron: 9999, horses: 9999, mana: 9999, food: 9999 });
const hexAt = (g: GameState, dq: number, dr = 0): HexCoord => ({ q: g.villages.v1.hex.q + dq, r: g.villages.v1.hex.r + dr });
const mine = (g: GameState) => Object.values(g.companies).filter((c) => c.ownerId === 'k1');

/** All plains, no foreign villages: predictable movement. */
function flat(g: GameState) {
  for (const t of Object.values(g.map.tiles)) t.terrain = 'plains';
  for (const v of Object.values(g.villages)) if (v.ownerId !== 'k1') delete g.villages[v.id];
  for (const c of Object.values(g.companies)) if (c.ownerId !== 'k1') delete g.companies[c.id];
  return g;
}

describe('units and races', () => {
  it('applies racial stat modifiers', () => {
    const sp = UNIT_DEFS.spearmen;
    expect(effectiveUnit('spearmen', 'valdren')).toMatchObject({ atk: sp.atk, def: sp.def, armor: sp.armor, discipline: sp.discipline });
    expect(effectiveUnit('spearmen', 'durrakin')).toMatchObject({ armor: sp.armor + 1, discipline: sp.discipline + 10, atk: sp.atk });
    expect(effectiveUnit('spearmen', 'sylvaen')).toMatchObject({ atk: sp.atk + 1, def: sp.def + 1, discipline: sp.discipline + 10 });
    expect(effectiveUnit('spearmen', 'ghor')).toMatchObject({ atk: sp.atk + 1, discipline: sp.discipline - 10 });
    expect(effectiveUnit('spearmen', 'vashkari')).toMatchObject({ armor: sp.armor + 1 });
    expect(effectiveUnit('archers', 'durrakin').armor).toBe(UNIT_DEFS.archers.armor); // infantry only
    expect(effectiveUnit('archers', 'sylvaen').rangedAtk).toBe(UNIT_DEFS.archers.rangedAtk! + 1);
  });

  it('plain infantry and ranged use the race company size, others keep theirs', () => {
    expect(companyMen('spearmen', 'durrakin')).toBe(400);
    expect(companyMen('militia', 'sylvaen')).toBe(300);
    expect(companyMen('archers', 'valdren')).toBe(500);
    expect(companyMen('light_cavalry', 'sylvaen')).toBe(300);
    expect(companyMen('battle_mages', 'valdren')).toBe(50);
    expect(companyMen('settlers', 'ghor')).toBe(300);
  });

  it('every playable race has three unique units tied to one unique building', () => {
    for (const [race, def] of Object.entries(RACES)) {
      const unique = Object.entries(UNIT_DEFS).filter(([, u]) => u.allowedRaces?.includes(race as RaceId));
      expect(unique.length, race).toBeGreaterThanOrEqual(3);
      const uniqueBuildings = Object.entries(BUILDINGS).filter(([, b]) => b.race === race);
      expect(uniqueBuildings, race).toHaveLength(1);
      expect(def.playable).toBe(true);
    }
    expect(unlockingBuildings('heavy_cavalry').sort()).toEqual(['blacksmith', 'stables']);
    expect(unlockSlot('heavy_cavalry')).toBe('stables');
  });

  it('starts every kingdom with one Militia company of its race at the capital', () => {
    const g = game('sylvaen');
    const [c] = mine(g);
    expect(mine(g)).toHaveLength(1);
    expect(c).toMatchObject({ unitType: 'militia', race: 'sylvaen', men: 300, rank: 'green', status: 'ready' });
    expect(c.hex).toEqual(g.villages.v1.hex);
    expect(Object.values(g.companies).filter((x) => x.ownerId === 'k2')).toHaveLength(1);
  });
});

describe('recruitment', () => {
  it('pays up front, removes the men from the people, and finishes as a Green company', () => {
    const g = game();
    const before = g.kingdoms.k1.resources;
    const s = run(g, o('recruit', { villageId: 'v1', unit: 'spearmen', race: 'valdren' }));
    expect(s.kingdoms.k1.resources.gold).toBe(before.gold - 220);
    expect(s.kingdoms.k1.resources.wood).toBe(before.wood - 20);
    expect(s.villages.v1.populationByRace.valdren).toBe(1000);
    expect(s.villages.v1.trainQueue).toMatchObject([{ id: 'spearmen', turnsLeft: 3, men: 500, race: 'valdren', slot: 'barracks' }]);
    let t = resolveTurn(s);
    t = resolveTurn(t);
    expect(mine(t)).toHaveLength(1);
    t = resolveTurn(t);
    const fresh = mine(t).find((c) => c.unitType === 'spearmen')!;
    expect(fresh).toMatchObject({ men: 500, rank: 'green', race: 'valdren', armyId: null });
    expect(fresh.hex).toEqual(t.villages.v1.hex);
    expect(t.log.some((e) => e.text.includes('Spearmen finished training'))).toBe(true);
  });

  it('allows one company at a time per military building', () => {
    const g = rich(game()) && game();
    rich(g);
    const s = run(g, o('recruit', { villageId: 'v1', unit: 'militia', race: 'valdren' }));
    expect(err(s, o('recruit', { villageId: 'v1', unit: 'spearmen', race: 'valdren' }))).toBe('Training slot busy');
    s.villages.v1.buildings.push({ id: 'archery_range' });
    expect(err(s, o('recruit', { villageId: 'v1', unit: 'archers', race: 'valdren' }))).toBeUndefined();
  });

  it('lets you choose which people to draw from: Durrakin spearmen from a mixed village', () => {
    const g = game();
    rich(g);
    g.villages.v1.populationByRace = { valdren: 1000, durrakin: 600 };
    const s = run(g, o('recruit', { villageId: 'v1', unit: 'spearmen', race: 'durrakin' }));
    expect(s.villages.v1.populationByRace).toEqual({ valdren: 1000, durrakin: 200 });
    const t = resolveTurn(resolveTurn(resolveTurn(s)));
    const c = Object.values(t.companies).find((x) => x.unitType === 'spearmen')!;
    expect(c).toMatchObject({ men: 400, race: 'durrakin' });
    expect(effectiveUnit(c.unitType, c.race).armor).toBe(UNIT_DEFS.spearmen.armor + 1);
  });

  it('enforces racial restrictions', () => {
    const g = game();
    rich(g);
    g.villages.v1.populationByRace = { valdren: 800, durrakin: 800, sylvaen: 800, ghor: 800, vashkari: 800 };
    for (const b of ['stables', 'blacksmith', 'archery_range', 'temple', 'mage_tower', 'siege_workshop']) g.villages.v1.buildings.push({ id: b });
    const why = (u: string, r: RaceId) => recruitBlocker(g, 'k1', g.villages.v1, u, r);
    expect(why('light_cavalry', 'durrakin')).toMatch(/cannot field/);
    expect(why('heavy_cavalry', 'durrakin')).toMatch(/cannot field/);
    expect(why('heavy_cavalry', 'sylvaen')).toMatch(/cannot field/);
    expect(why('siege_engineers', 'sylvaen')).toMatch(/cannot field/);
    expect(why('clerics', 'ghor')).toMatch(/cannot field/);
    expect(why('crossbowmen', 'ghor')).toMatch(/cannot field/);
    expect(why('light_cavalry', 'vashkari')).toMatch(/cannot field/);
    expect(why('battle_mages', 'durrakin')).toMatch(/cannot field/);
    expect(why('light_cavalry', 'valdren')).toBeNull();
    expect(why('heavy_cavalry', 'valdren')).toBeNull();
    expect(why('runecasters', 'durrakin')).toBeNull();
    expect(why('runecasters', 'valdren')).toMatch(/Only Durrakin/);
    expect(why('shamans', 'ghor')).toBeNull();
  });

  it('Vashkari cannot build Stables, Durrakin neither', () => {
    for (const race of ['vashkari', 'durrakin'] as const) {
      const g = game(race);
      rich(g);
      for (const h of withinRadius(g.villages.v1.hex, 1)) g.map.tiles[key(h)].terrain = 'plains';
      expect(err(g, o('build', { villageId: 'v1', building: 'stables' }))).toMatch(/cannot build/);
    }
  });

  it('unique units need their unique building; heavy cavalry needs Stables and a Blacksmith', () => {
    const g = game();
    rich(g);
    const v = g.villages.v1;
    expect(recruitBlocker(g, 'k1', v, 'knights_of_the_order', 'valdren')).toBe('Needs Chapter House');
    v.buildings.push({ id: 'chapter_house' });
    expect(recruitBlocker(g, 'k1', v, 'knights_of_the_order', 'valdren')).toBeNull();
    v.buildings.push({ id: 'stables' });
    expect(recruitBlocker(g, 'k1', v, 'heavy_cavalry', 'valdren')).toBe('Needs Blacksmith');
    v.buildings.push({ id: 'blacksmith' });
    expect(recruitBlocker(g, 'k1', v, 'heavy_cavalry', 'valdren')).toBeNull();
  });

  it("another people's unique units need their building and stability 60", () => {
    const g = game();
    rich(g);
    const v = g.villages.v1;
    v.populationByRace = { valdren: 1000, durrakin: 600 };
    v.buildings.push({ id: 'deep_forge' });
    v.stability = 55; // +3 for the friendly Durrakin minority
    expect(recruitBlocker(g, 'k1', v, 'ironshields', 'durrakin')).toMatch(/stability 60/);
    v.stability = 60;
    expect(recruitBlocker(g, 'k1', v, 'ironshields', 'durrakin')).toBeNull();
    expect(recruitBlocker(g, 'k1', v, 'ironshields', 'valdren')).toMatch(/Only Durrakin/);
  });

  it('checks people and resources', () => {
    const g = game();
    g.villages.v1.populationByRace = { valdren: 400 };
    expect(recruitBlocker(g, 'k1', g.villages.v1, 'militia', 'valdren')).toBe('Not enough people');
    g.villages.v1.populationByRace = { valdren: 1500 };
    g.kingdoms.k1.resources.gold = 10;
    expect(recruitBlocker(g, 'k1', g.villages.v1, 'militia', 'valdren')).toBe('Not enough resources');
    expect(recruitBlocker(g, 'k1', g.villages.v1, 'militia', 'ghor')).toMatch(/No Ghor/);
    expect(recruitBlocker(g, 'k2', g.villages.v1, 'militia', 'valdren')).toBe('Not your village');
  });

  it('Fighting Pits shave a turn off training (minimum 1)', () => {
    const g = game('ghor');
    rich(g);
    g.villages.v1.buildings.push({ id: 'fighting_pits' }, { id: 'blacksmith' });
    const s = run(g, o('recruit', { villageId: 'v1', unit: 'swordsmen', race: 'ghor' }), o('recruit', { villageId: 'v1', unit: 'boar_riders', race: 'ghor' }));
    expect(s.villages.v1.trainQueue.find((q) => q.id === 'swordsmen')!.turnsLeft).toBe(3);
    const t = run(g, o('recruit', { villageId: 'v1', unit: 'militia', race: 'ghor' }));
    expect(t.villages.v1.trainQueue[0].turnsLeft).toBe(1);
  });

  it('heavy conscription costs stability', () => {
    const g = game();
    rich(g);
    const before = effectiveStability(g, g.villages.v1);
    g.villages.v1.populationByRace = { valdren: 2000 };
    const s = run(g, o('recruit', { villageId: 'v1', unit: 'militia', race: 'valdren' }));
    expect(effectiveStability(s, s.villages.v1)).toBe(before - 10); // 500 > 10% of the village
  });

  it('unique buildings: terrain, race, tier and prerequisites', () => {
    const g = game('sylvaen');
    rich(g);
    const v = g.villages.v1;
    g.map.tiles[key(v.hex)].terrain = 'plains';
    expect(err(g, o('build', { villageId: 'v1', building: 'heart_tree' }))).toMatch(/Must stand on forest/);
    g.map.tiles[key(v.hex)].terrain = 'forest';
    expect(err(g, o('build', { villageId: 'v1', building: 'heart_tree' }))).toBeUndefined();
    expect(err(g, o('build', { villageId: 'v1', building: 'chapter_house' }))).toMatch(/Valdren people/);
    const d = game('durrakin');
    rich(d);
    expect(err(d, o('build', { villageId: 'v1', building: 'deep_forge' }))).toMatch(/Mine/);
    const h = game();
    rich(h);
    expect(err(h, o('build', { villageId: 'v1', building: 'chapter_house' }))).toMatch(/town/);
  });
});

describe('armies', () => {
  const trio = () => {
    const g = flat(game());
    rich(g);
    const a = mine(g)[0];
    const b = newCompany(g, 'k1', 'spearmen', 'valdren', 500, a.hex);
    const c = newCompany(g, 'k1', 'light_cavalry', 'valdren', 300, a.hex);
    return { g, a, b, c };
  };

  it('merges companies on one hex into an army with the slowest speed', () => {
    const { g, a, b, c } = trio();
    const s = run(g, o('merge', { companyIds: [a.id, b.id, c.id] }));
    const army = Object.values(s.armies)[0];
    expect(army.companyIds.sort()).toEqual([a.id, b.id, c.id].sort());
    expect(army.stance).toBe('hold');
    expect(mine(s).every((x) => x.armyId === army.id)).toBe(true);
    expect(Math.min(...mine(s).map(speedOf))).toBe(2);
    expect(mine(s).every((x) => x.movementLeft === 2)).toBe(true);
  });

  it('refuses to merge across hexes, and joins an existing army', () => {
    const { g, a, b, c } = trio();
    c.hex = hexAt(g, 3);
    expect(err(g, o('merge', { companyIds: [a.id, c.id] }))).toBe('Companies must be on the same hex');
    const s = run(g, o('merge', { companyIds: [a.id, b.id] }));
    s.companies[c.id].hex = { ...a.hex };
    const s2 = run(s, o('merge', { companyIds: [b.id, c.id] }));
    expect(Object.values(s2.armies)[0].companyIds).toHaveLength(3);
    expect(Object.keys(s2.armies)).toHaveLength(1);
  });

  it('merging two armies keeps one army and drops the empty one', () => {
    const { g, a, b, c } = trio();
    const s = run(g, o('merge', { companyIds: [a.id] }), o('merge', { companyIds: [b.id] }));
    expect(Object.keys(s.armies)).toHaveLength(2);
    const t = run(s, o('merge', { companyIds: [a.id, b.id, c.id] }));
    expect(Object.keys(t.armies)).toHaveLength(1);
    expect(Object.values(t.armies)[0].companyIds).toHaveLength(3);
  });

  it('splits companies out; an emptied army disbands', () => {
    const { g, a, b } = trio();
    const s = run(g, o('merge', { companyIds: [a.id, b.id] }), o('split', { companyIds: [a.id] }));
    expect(s.companies[a.id].armyId).toBeNull();
    expect(Object.values(s.armies)[0].companyIds).toEqual([b.id]);
    const t = run(s, o('split', { companyIds: [b.id] }));
    expect(Object.keys(t.armies)).toHaveLength(0);
    expect(err(t, o('split', { companyIds: [b.id] }))).toBe('Not in an army');
  });

  it('armies without a commander are locked to Hold', () => {
    const { g, a } = trio();
    const s = run(g, o('merge', { companyIds: [a.id] }));
    const id = Object.keys(s.armies)[0];
    expect(err(s, o('setStance', { armyId: id, stance: 'aggressive' }))).toMatch(/locked to Hold/);
    expect(err(s, o('setStance', { armyId: id, stance: 'hold' }))).toBeUndefined();
  });

  it('garrisons sit in villages and steady them', () => {
    const { g, a } = trio();
    const base = effectiveStability(g, g.villages.v1);
    const s = run(g, o('setStatus', { companyId: a.id, status: 'garrison' }));
    expect(effectiveStability(s, s.villages.v1)).toBe(base + 5);
    s.companies[a.id].hex = hexAt(s, 4);
    expect(err(s, o('setStatus', { companyId: a.id, status: 'garrison' }))).toMatch(/village/);
  });
});

describe('movement', () => {
  const setup = (race: GameSettings['playerRace'] = 'valdren') => {
    const g = flat(game(race));
    return { g, c: mine(g)[0] };
  };

  it('spends movement points: a speed-2 company covers two plains hexes a turn', () => {
    const { g, c } = setup();
    const s = run(g, o('move', { unitId: c.id, to: hexAt(g, 5) }));
    expect(distance(s.companies[c.id].hex, g.villages.v1.hex)).toBe(2);
    expect(s.companies[c.id].movementLeft).toBe(0);
    expect(err(s, o('move', { unitId: c.id, to: hexAt(g, 5) }))).toBe('Not enough movement');
    const t = resolveTurn(s);
    expect(t.companies[c.id].movementLeft).toBe(2);
    expect(distance(run(t, o('move', { unitId: c.id, to: hexAt(g, 5) })).companies[c.id].hex, hexAt(g, 5))).toBe(1);
  });

  it('terrain costs: forest 2, mountains 3, with racial exceptions', () => {
    const cost = (race: GameSettings['playerRace'], terrain: 'forest' | 'mountains' | 'marsh') => {
      const { g, c } = setup(race);
      g.map.tiles[key(hexAt(g, 1))].terrain = terrain;
      g.map.tiles[key(hexAt(g, 2))].terrain = 'plains';
      for (const n of withinRadius(g.villages.v1.hex, 1)) if (key(n) !== key(hexAt(g, 1)) && key(n) !== key(g.villages.v1.hex)) g.map.tiles[key(n)].terrain = terrain;
      const s = run(g, o('move', { unitId: c.id, to: hexAt(g, 1) }));
      return 2 - s.companies[c.id].movementLeft;
    };
    expect(cost('valdren', 'forest')).toBe(2);
    expect(cost('sylvaen', 'forest')).toBe(1);
    expect(cost('valdren', 'mountains')).toBe(2); // a fresh unit can always enter one hex
    expect(cost('durrakin', 'mountains')).toBe(2);
    expect(cost('vashkari', 'marsh')).toBe(1);
    expect(cost('valdren', 'marsh')).toBe(2);
  });

  it('a unit that has already moved cannot afford a costly hex', () => {
    const { g, c } = setup();
    const east = hexAt(g, 2);
    g.map.tiles[key(east)].terrain = 'mountains';
    const s = run(g, o('move', { unitId: c.id, to: hexAt(g, 1) }));
    expect(err(s, o('move', { unitId: c.id, to: east }))).toBe('Not enough movement');
  });

  it('forced march: +1 movement, and 30 starting Fatigue (15 for a plain full move)', () => {
    const { g, c } = setup();
    const normal = run(g, o('move', { unitId: c.id, to: hexAt(g, 5) }));
    expect(distance(normal.companies[c.id].hex, g.villages.v1.hex)).toBe(2);
    expect(startingFatigue(normal.companies[c.id])).toBe(15);
    const forced = run(g, o('move', { unitId: c.id, to: hexAt(g, 5), forced: true }));
    expect(distance(forced.companies[c.id].hex, g.villages.v1.hex)).toBe(3);
    expect(startingFatigue(forced.companies[c.id])).toBe(30);
    const short = run(g, o('move', { unitId: c.id, to: hexAt(g, 1) }));
    expect(startingFatigue(short.companies[c.id])).toBe(0);
    expect(startingFatigue(resolveTurn(forced).companies[c.id])).toBe(0);
  });

  it('an army moves together at the pace of its slowest company', () => {
    const { g, c } = setup();
    const horse = newCompany(g, 'k1', 'light_cavalry', 'valdren', 300, c.hex);
    expect(speedOf(horse)).toBe(4);
    const s = run(g, o('merge', { companyIds: [c.id, horse.id] }));
    const armyId = Object.keys(s.armies)[0];
    const t = run(s, o('move', { unitId: armyId, to: hexAt(g, 6) }));
    expect(distance(t.armies[armyId].hex, g.villages.v1.hex)).toBe(2);
    expect(t.companies[horse.id].hex).toEqual(t.armies[armyId].hex);
    expect(err(t, o('move', { unitId: c.id, to: hexAt(g, 6) }))).toMatch(/Move the army/);
  });

  it('enemy armies exert a zone of control, and the hex they hold can only be entered to fight', () => {
    const { g, c } = setup();
    c.movementLeft = 4;
    const foe = newCompany(g, 'k2', 'militia', 'ghor', 500, hexAt(g, 2, 1));
    const s = run(g, o('move', { unitId: c.id, to: hexAt(g, 4) }));
    const at = s.companies[c.id].hex;
    expect(distance(at, foe.hex)).toBe(1);
    expect(s.companies[c.id].movementLeft).toBe(0);
    expect(err(g, o('move', { unitId: c.id, to: foe.hex }))).toBeUndefined(); // moving onto them starts a battle
  });

  it('foreign villages can be entered: walking into an empty one takes it', () => {
    const { g, c } = setup();
    g.villages.vx = { ...g.villages.v1, id: 'vx', ownerId: 'k2', hex: hexAt(g, 2), name: 'Elsewhere' };
    expect(err(g, o('move', { unitId: c.id, to: hexAt(g, 2) }))).toBeUndefined();
    expect(run(g, o('move', { unitId: c.id, to: hexAt(g, 2) })).captures.vx).toBeDefined();
  });

  it('roads cost half a point, and are built inside your territory', () => {
    const { g, c } = setup();
    rich(g);
    expect(err(g, o('buildRoad', { hex: hexAt(g, 9) }))).toMatch(/territory/);
    const gold = g.kingdoms.k1.resources.gold;
    const s = run(g, o('buildRoad', { hex: hexAt(g, 0) }), o('buildRoad', { hex: hexAt(g, 1) }), o('buildRoad', { hex: hexAt(g, 2) }), o('buildRoad', { hex: hexAt(g, 3) }), o('buildRoad', { hex: hexAt(g, 4) }));
    expect(s.kingdoms.k1.resources.gold).toBe(gold - 100);
    expect(err(s, o('buildRoad', { hex: hexAt(g, 1) }))).toMatch(/already/);
    const t = run(s, o('move', { unitId: c.id, to: hexAt(g, 4) }));
    expect(t.companies[c.id].hex).toEqual(hexAt(g, 4)); // 4 hexes for 2 points
    expect(t.companies[c.id].movementLeft).toBe(0);
  });

  it('companies reveal the map as they move; scouts see further', () => {
    const { g, c } = setup();
    const scout = newCompany(g, 'k1', 'scouts', 'valdren', 100, c.hex);
    const before = g.kingdoms.k1.explored.length;
    const s = run(g, o('move', { unitId: scout.id, to: hexAt(g, 5) }));
    expect(s.kingdoms.k1.explored.length).toBeGreaterThan(before);
    expect(visibleKeys(s, 'k1').has(key(hexAt(g, 9)))).toBe(true); // scout at 5 sees 4 further
    expect(speedOf(scout)).toBe(5);
  });
});

describe('upkeep', () => {
  it('companies cost gold, mana and food', () => {
    const g = game();
    const mage = newCompany(g, 'k1', 'battle_mages', 'valdren', 50, g.villages.v1.hex);
    expect(upkeep(g, 'k1')).toEqual({ gold: 8 + 20, mana: 5, food: 10 + 1 });
    expect(mage.men).toBe(50);
    const giants = newCompany(g, 'k1', 'mire_beasts', 'vashkari', 30, g.villages.v1.hex);
    expect(upkeep(g, 'k1').food).toBeCloseTo(10 + 1 + (30 * 15) / 100 * 2, 5); // Size counts toward food
    expect(giants.maxMen).toBe(30);
  });

  it('upkeep is paid each turn', () => {
    const g = game();
    g.kingdoms.k1.resources.gold = 100;
    const t = resolveTurn(g);
    expect(t.kingdoms.k1.resources.gold).toBeCloseTo(100 + 30 - 8, 1);
  });

  it('unpaid troops desert', () => {
    const g = game();
    g.kingdoms.k1.resources.gold = 0;
    g.villages.v1.taxLevel = 'low';
    g.villages.v1.populationByRace = { valdren: 100 }; // almost no tax income
    for (let i = 0; i < 3; i++) newCompany(g, 'k1', 'swordsmen', 'valdren', 500, g.villages.v1.hex);
    const t = resolveTurn(g);
    expect(t.log.some((e) => e.text.includes('desert'))).toBe(true);
    expect(mine(t).every((c) => c.men < c.maxMen)).toBe(true);
    expect(t.kingdoms.k1.resources.gold).toBe(0);
  });

  it('soldiers eat: a big army with no food starves the kingdom', () => {
    const g = game();
    g.kingdoms.k1.resources.food = 0;
    for (let i = 0; i < 20; i++) newCompany(g, 'k1', 'militia', 'valdren', 500, g.villages.v1.hex);
    expect(resolveTurn(g).log.some((e) => e.text.includes('starving'))).toBe(true);
  });
});

describe('supply and attrition', () => {
  const far = (g: GameState, d: number) => {
    const c = mine(g)[0];
    c.hex = hexAt(g, d);
    return c;
  };

  it('companies within 3 hexes of a village are supplied, others lose 3% a turn', () => {
    const g = flat(game());
    const c = far(g, 3);
    expect(inSupply(g, c)).toBe(true);
    expect(resolveTurn(g).companies[c.id].men).toBe(500);
    const g2 = flat(game());
    const c2 = far(g2, 6);
    expect(inSupply(g2, c2)).toBe(false);
    expect(resolveTurn(g2).companies[c2.id].men).toBe(485);
  });

  it('a road connected to a village extends supply', () => {
    const g = flat(game());
    rich(g);
    const c = far(g, 6);
    const s = run(g, ...[0, 1, 2, 3, 4, 5, 6].map((d) => o('buildRoad', { hex: hexAt(g, d) })));
    expect(inSupply(s, s.companies[c.id])).toBe(true);
    expect(resolveTurn(s).companies[c.id].men).toBe(500);
    delete s.roads[key(hexAt(g, 3))];
    expect(inSupply(s, s.companies[c.id])).toBe(false);
  });

  it('foraging in enemy land halves attrition, and hurts the nearest enemy village', () => {
    const g = flat(game());
    const enemy = { ...g.villages.v1, id: 'ev', ownerId: 'k2', hex: hexAt(g, 8), name: 'Enemyton', stability: 60 };
    g.villages.ev = enemy;
    g.kingdoms.k2.resources.food = 100;
    const c = far(g, 7);
    const t = resolveTurn(g);
    expect(t.companies[c.id].men).toBe(492); // 3% halved = 7.5 men, rounded up
    expect(t.villages.ev.stability).toBeLessThan(60);
    expect(t.kingdoms.k2.resources.food).toBeLessThan(100);
  });

  it('Ghor forage without attrition', () => {
    const g = flat(game('ghor'));
    g.villages.ev = { ...g.villages.v1, id: 'ev', ownerId: 'k2', hex: hexAt(g, 8), name: 'Enemyton', stability: 60 };
    const c = far(g, 7);
    expect(resolveTurn(g).companies[c.id].men).toBe(c.men);
  });

  it('marsh wears companies down even in supply, except the Vashkari', () => {
    const wear = (race: GameSettings['playerRace']) => {
      const g = flat(game(race));
      const c = mine(g)[0];
      g.map.tiles[key(c.hex)].terrain = 'marsh';
      return c.men - resolveTurn(g).companies[c.id].men;
    };
    expect(wear('valdren')).toBeGreaterThan(0);
    expect(wear('vashkari')).toBe(0);
  });

  it('companies that waste away are removed, and their army disbands', () => {
    const g = flat(game());
    const c = far(g, 6);
    c.men = 1;
    const s = run(g, o('merge', { companyIds: [c.id] }));
    const t = resolveTurn(s);
    expect(t.companies[c.id]).toBeUndefined();
    expect(Object.keys(t.armies)).toHaveLength(0);
  });
});

describe('replenishing and founding', () => {
  it('refills losses from the village for a share of the gold cost; large refills cost a rank', () => {
    const g = game();
    const c = mine(g)[0];
    c.men = 400;
    c.rank = 'veteran';
    const gold = g.kingdoms.k1.resources.gold;
    const s = run(g, o('replenish', { companyId: c.id }));
    expect(s.companies[c.id].men).toBe(500);
    expect(s.companies[c.id].rank).toBe('veteran');
    expect(s.kingdoms.k1.resources.gold).toBe(gold - 24); // 100/500 × 120
    expect(s.villages.v1.populationByRace.valdren).toBe(1400);
    const d = game();
    const c2 = mine(d)[0];
    c2.men = 100;
    c2.rank = 'veteran';
    expect(run(d, o('replenish', { companyId: c2.id })).companies[c2.id].rank).toBe('trained');
    expect(err(s, o('replenish', { companyId: c.id }))).toBe('Already at full strength');
  });

  it('only in your own villages', () => {
    const g = flat(game());
    const c = mine(g)[0];
    c.men = 100;
    c.hex = hexAt(g, 5);
    expect(err(g, o('replenish', { companyId: c.id }))).toMatch(/villages/);
  });

  it('settlers found a Hamlet with their 300 people, at least 3 hexes from other villages', () => {
    const g = flat(game());
    rich(g);
    const s0 = run(g, o('recruit', { villageId: 'v1', unit: 'settlers', race: 'valdren' }));
    let s = resolveTurn(resolveTurn(s0));
    const settlers = mine(s).find((c) => c.unitType === 'settlers')!;
    expect(settlers.men).toBe(300);
    expect(err(s, o('found', { companyId: settlers.id }))).toMatch(/Too close/);
    s.companies[settlers.id].hex = hexAt(g, 5);
    const names = Object.values(s.villages).map((v) => v.name);
    s = run(s, o('found', { companyId: settlers.id }));
    const v = Object.values(s.villages).find((x) => !names.includes(x.name))!;
    expect(v).toMatchObject({ ownerId: 'k1', tier: 'hamlet', populationByRace: { valdren: 300 } });
    expect(v.hex).toEqual(hexAt(g, 5));
    expect(s.companies[settlers.id]).toBeUndefined();
    expect(new Set(s.usedNames).size).toBe(s.usedNames.length);
    expect(err(s, o('found', { companyId: mine(s)[0].id }))).toBe('Only settlers can found a village');
  });
});

describe('determinism', () => {
  it('orders and turns are pure and repeatable', () => {
    const g = flat(game());
    const c = mine(g)[0];
    const snap = JSON.stringify(g);
    const a = resolveTurn(run(g, o('move', { unitId: c.id, to: hexAt(g, 4) }), o('recruit', { villageId: 'v1', unit: 'militia', race: 'valdren' })));
    expect(JSON.stringify(g)).toBe(snap);
    const b = resolveTurn(run(g, o('move', { unitId: c.id, to: hexAt(g, 4) }), o('recruit', { villageId: 'v1', unit: 'militia', race: 'valdren' })));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
