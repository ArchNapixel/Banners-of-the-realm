import { describe, expect, it } from 'vitest';
import { assignWorkers, buildBlocker, buildCost, effectiveStability, popCap, totalPop, villageEconomy } from '../src/engine/core/economy';
import { key, withinRadius } from '../src/engine/core/hex';
import { applyOrder, type Order } from '../src/engine/core/orders';
import { resolveTurn } from '../src/engine/core/resolveTurn';
import { newGame } from '../src/engine/core/state';
import type { GameSettings, GameState, TerrainId } from '../src/engine/core/types';

const game = (race: GameSettings['playerRace'] = 'valdren', seed = 'eco') =>
  newGame({ seed, mapSize: 'small', playerRace: race, aiRaces: ['ghor'] });

/** Rewrites the terrain around the capital so building requirements are predictable. */
function terrainAround(g: GameState, terrain: TerrainId, radius = 1) {
  const v = g.villages.v1;
  for (const h of withinRadius(v.hex, radius)) if (g.map.tiles[key(h)]) g.map.tiles[key(h)].terrain = terrain;
}
const order = (type: Order['type'], extra: object = {}) => ({ type, kingdomId: 'k1', villageId: 'v1', ...extra }) as Order;
const give = (g: GameState, res: Partial<GameState['kingdoms']['k1']['resources']>) => Object.assign(g.kingdoms.k1.resources, res);

describe('building', () => {
  it('pays up front, then completes after its build time', () => {
    const g = game();
    terrainAround(g, 'forest');
    const { state, error } = applyOrder(g, order('build', { building: 'lumber_camp' }));
    expect(error).toBeUndefined();
    expect(state.kingdoms.k1.resources.gold).toBe(g.kingdoms.k1.resources.gold - 45); // Valdren -10%
    expect(state.villages.v1.buildQueue).toEqual([{ id: 'lumber_camp', turnsLeft: 2 }]);
    const t1 = resolveTurn(state);
    expect(t1.villages.v1.buildings.some((b) => b.id === 'lumber_camp')).toBe(false);
    const t2 = resolveTurn(t1);
    expect(t2.villages.v1.buildings.some((b) => b.id === 'lumber_camp')).toBe(true);
    expect(t2.log.some((e) => e.text.includes('Lumber Camp completed'))).toBe(true);
  });

  it('applies racial cost modifiers', () => {
    expect(buildCost('valdren', 'market')).toEqual({ gold: 108, wood: 27 });
    expect(buildCost('durrakin', 'stone_walls')).toEqual({ gold: 240, stone: 120 });
    expect(buildCost('ghor', 'stone_walls')).toEqual({ gold: 600, stone: 300 });
  });

  it('enforces terrain, tier, prerequisites, slots and funds', () => {
    const g = game();
    terrainAround(g, 'plains');
    const v = g.villages.v1;
    const why = (id: string) => buildBlocker(g, 'k1', v, id);
    expect(why('farm')).toBe('Already built or under construction');
    expect(why('lumber_camp')).toMatch(/forest/);
    expect(why('mine')).toMatch(/mountains/);
    expect(why('harbor')).toMatch(/coast|town/);
    expect(why('stone_walls')).toMatch(/Palisade/);
    expect(why('mage_tower')).toMatch(/Ley Node/);
    expect(why('mana_well')).toMatch(/Ley Node/);
    expect(why('gold_mine')).toMatch(/gold deposit/);
    expect(why('blacksmith')).toMatch(/iron income/);
    expect(why('siege_workshop')).toMatch(/town/);
    expect(why('stables')).toBeNull();
    give(g, { gold: 0 });
    expect(why('stables')).toBe('Not enough resources');
    give(g, { gold: 5000, wood: 5000, stone: 5000 });
    expect(why('market')).toBeNull();
    v.buildings.push({ id: 'market' }, { id: 'shrine' }, { id: 'granary' });
    expect(why('temple')).toBe('No free building slots');
  });

  it('Ley Node buildings need the node in range or underfoot; Court is capital-only', () => {
    const g = game();
    const v = g.villages.v1;
    give(g, { gold: 5000, wood: 5000, stone: 5000 });
    g.map.tiles[key(v.hex)].ley = true;
    expect(buildBlocker(g, 'k1', v, 'mana_well')).toBeNull();
    expect(buildBlocker(g, 'k1', v, 'mage_tower')).toBeNull();
    expect(buildBlocker(g, 'k1', v, 'court')).toBeNull();
    const other = Object.values(g.villages).find((x) => x.ownerId === null)!;
    other.ownerId = 'k1';
    expect(buildBlocker(g, 'k1', other, 'court')).toBe('Capital only');
  });

  it('refuses orders for villages you do not own', () => {
    const g = game();
    const { error } = applyOrder(g, { type: 'setTax', kingdomId: 'k2', villageId: 'v1', level: 'high' });
    expect(error).toBe('Not your village');
  });

  it('cannot build with the same building twice or exceed slots via the queue', () => {
    const g = game();
    terrainAround(g, 'plains');
    give(g, { gold: 5000, wood: 5000, stone: 5000 });
    let s = applyOrder(g, order('build', { building: 'market' })).state;
    expect(applyOrder(s, order('build', { building: 'market' })).error).toMatch(/Already/);
    s = applyOrder(s, order('build', { building: 'shrine' })).state;
    s = applyOrder(s, order('build', { building: 'granary' })).state;
    expect(applyOrder(s, order('build', { building: 'temple' })).error).toBe('No free building slots');
  });
});

describe('workers and production', () => {
  it('scales output by staffing', () => {
    const g = game();
    terrainAround(g, 'plains');
    const v = g.villages.v1;
    v.populationByRace = { valdren: 100 };
    expect(assignWorkers(v)).toEqual({ farm: 100, barracks: 0 });
    expect(villageEconomy(g, v).produced.food).toBeCloseTo(10 + 5, 5); // village centre + half-staffed farm
    v.populationByRace = { valdren: 1500 };
    expect(villageEconomy(g, v).produced.food).toBeCloseTo(20, 5);
  });

  it('honours the worker priority list', () => {
    const g = game();
    const v = g.villages.v1;
    v.buildings.push({ id: 'market' });
    v.populationByRace = { valdren: 220 };
    expect(assignWorkers(v)).toMatchObject({ farm: 200, barracks: 20 });
    v.workerPriority = ['market', 'barracks'];
    expect(assignWorkers(v)).toMatchObject({ market: 100, barracks: 50, farm: 70 });
  });

  it('racial output bonuses apply (Durrakin mines +50%)', () => {
    const g = game('durrakin');
    const v = g.villages.v1;
    v.buildings.push({ id: 'mine' });
    expect(villageEconomy(g, v).produced.iron).toBeCloseTo(5 * 1.5, 5);
  });

  it('taxes pay gold per 100 civilians and Markets add 10% on top', () => {
    const g = game();
    const v = g.villages.v1;
    expect(villageEconomy(g, v).taxGold).toBeCloseTo(30, 5); // 1,500 / 100 × 2
    v.taxLevel = 'high';
    expect(villageEconomy(g, v).taxGold).toBeCloseTo(45, 5);
    v.buildings.push({ id: 'market' });
    expect(villageEconomy(g, v).taxGold).toBeCloseTo(49.5, 5);
  });

  it('adds a turn\'s income to the kingdom pools', () => {
    const g = game();
    const before = g.kingdoms.k1.resources;
    const after = resolveTurn(g).kingdoms.k1.resources;
    expect(after.gold - before.gold).toBeCloseTo(30 - 8, 1); // tax − Militia upkeep
    expect(after.food - before.food).toBeCloseTo(10 + 10 - 15 - 10, 1); // centre + farm − civilians − 500 soldiers
  });
});

describe('stability', () => {
  it('taxes drift stability; modifiers sit on top', () => {
    const g = game();
    const run = (level: 'low' | 'normal' | 'high') => {
      const s = applyOrder(g, order('setTax', { level })).state;
      return resolveTurn(s).villages.v1.stability;
    };
    expect(run('low')).toBe(62);
    expect(run('normal')).toBe(60);
    expect(run('high')).toBe(57);
  });

  it('Temples add 10; Ghor start 10 lower; conquest penalty and war weariness subtract', () => {
    const g = game();
    const v = g.villages.v1;
    expect(effectiveStability(g, v)).toBe(60);
    v.buildings.push({ id: 'temple' });
    expect(effectiveStability(g, v)).toBe(70);
    v.conquestPenalty = 30;
    g.kingdoms.k1.warWeariness = 20;
    expect(effectiveStability(g, v)).toBe(70 - 30 - 2);
    const orcs = game('ghor');
    expect(effectiveStability(orcs, orcs.villages.v1)).toBe(50);
  });

  it('conquest penalty decays by 3 a turn', () => {
    const g = game();
    g.villages.v1.conquestPenalty = 30;
    expect(resolveTurn(g).villages.v1.conquestPenalty).toBe(27);
  });

  it('minority races with negative affinity cost stability, positive ones add; Temples halve the penalty', () => {
    const g = game();
    const v = g.villages.v1;
    v.populationByRace = { valdren: 1000, ghor: 500 };
    expect(effectiveStability(g, v)).toBe(55);
    v.buildings.push({ id: 'temple' });
    expect(effectiveStability(g, v)).toBe(60 + 10 - 2.5);
    v.populationByRace = { valdren: 1000, durrakin: 500 };
    expect(effectiveStability(g, v)).toBe(60 + 10 + 3);
    v.populationByRace = { valdren: 1000, ghor: 50 };
    v.buildings = v.buildings.filter((b) => b.id !== 'temple');
    expect(effectiveStability(g, v)).toBe(60);
  });

  it('low stability cuts production by 20%, high stability adds 10%', () => {
    const g = game();
    const v = g.villages.v1;
    const base = villageEconomy(g, v).taxGold;
    v.stability = 30;
    expect(villageEconomy(g, v).taxGold).toBeCloseTo(base * 0.8, 5);
    v.stability = 85;
    expect(villageEconomy(g, v).taxGold).toBeCloseTo(base * 1.1, 5);
  });

  it('warns when a village nears revolt', () => {
    const g = game();
    g.villages.v1.stability = 5;
    expect(resolveTurn(g).log.some((e) => e.text.includes('revolt'))).toBe(true);
  });
});

describe('population', () => {
  it('grows at the race rate, plus a food-surplus bonus and Granary', () => {
    const g = game();
    const v = g.villages.v1;
    v.buildings.push({ id: 'farm' }); // already has one; extra output via Granary test below
    const grown = totalPop(resolveTurn(g).villages.v1);
    expect(grown).toBeGreaterThan(1500 + 29); // at least 2% of 1,500
    const g2 = game();
    g2.villages.v1.buildings.push({ id: 'granary' });
    expect(totalPop(resolveTurn(g2).villages.v1)).toBeGreaterThan(totalPop(resolveTurn(game()).villages.v1));
  });

  it('race growth rates differ', () => {
    const rate = (race: GameSettings['playerRace']) => {
      const g = game(race);
      g.kingdoms.k1.resources.food = 1000; // avoid starvation noise
      return totalPop(resolveTurn(g).villages.v1) - 1500;
    };
    expect(rate('ghor')).toBeGreaterThan(rate('valdren'));
    expect(rate('valdren')).toBeGreaterThan(rate('sylvaen'));
  });

  it('never exceeds the tier cap; Housing District raises it by 25%', () => {
    const g = game();
    const v = g.villages.v1;
    v.populationByRace = { valdren: 2990 };
    g.kingdoms.k1.resources.food = 1000;
    expect(totalPop(resolveTurn(g).villages.v1)).toBe(3000);
    v.buildings.push({ id: 'housing_district' });
    expect(popCap(v)).toBe(3750);
  });

  it('low stability halves growth', () => {
    const grow = (stability: number) => {
      const g = game();
      g.villages.v1.stability = stability;
      g.kingdoms.k1.resources.food = 1000;
      return totalPop(resolveTurn(g).villages.v1) - 1500;
    };
    expect(grow(20)).toBeLessThan(grow(60) * 0.7);
  });

  it('starvation shrinks population by 2% and costs 5 stability', () => {
    const g = game();
    g.kingdoms.k1.resources.food = 0;
    g.villages.v1.buildings = []; // no farm: food deficit
    const n = resolveTurn(g);
    expect(totalPop(n.villages.v1)).toBe(1470);
    expect(n.villages.v1.stability).toBe(55);
    expect(n.log.some((e) => e.text.includes('starving'))).toBe(true);
  });
});

describe('village tiers', () => {
  it('upgrade needs 80% of the cap and the resources', () => {
    const g = game();
    give(g, { gold: 1000, stone: 200 });
    g.villages.v1.populationByRace = { valdren: 2000 };
    expect(applyOrder(g, order('upgrade')).error).toMatch(/80%/);
    g.villages.v1.populationByRace = { valdren: 2500 };
    const { state, error } = applyOrder(g, order('upgrade'));
    expect(error).toBeUndefined();
    expect(state.villages.v1.tier).toBe('town');
    expect(state.kingdoms.k1.resources).toMatchObject({ gold: 200, stone: 50 });
    expect(applyOrder(applyOrder(state, order('upgrade')).state, order('upgrade')).error).toBeDefined();
  });

  it('a higher tier widens the work radius and slot count', () => {
    const g = game();
    const s = (() => {
      give(g, { gold: 1000, stone: 200 });
      g.villages.v1.populationByRace = { valdren: 2500 };
      return applyOrder(g, order('upgrade')).state;
    })();
    expect(s.villages.v1.tier).toBe('town');
    // Town: 8 slots, radius 2 — Harbor becomes possible once the tier is high enough
    s.map.tiles[key(s.villages.v1.hex)].terrain = 'coast';
    give(s, { gold: 1000, wood: 1000 });
    expect(buildBlocker(s, 'k1', s.villages.v1, 'harbor')).toBeNull();
  });
});

describe('resolveTurn purity and fog', () => {
  it('does not mutate its input and is repeatable', () => {
    const g = game();
    const snap = JSON.stringify(g);
    const a = resolveTurn(g, [order('setTax', { level: 'high' })]);
    expect(JSON.stringify(g)).toBe(snap);
    expect(JSON.stringify(resolveTurn(g, [order('setTax', { level: 'high' })]))).toBe(JSON.stringify(a));
    expect(a.turn).toBe(2);
  });

  it('logs failed orders instead of throwing', () => {
    const g = game();
    const a = resolveTurn(g, [order('build', { building: 'mine' })]);
    expect(a.log.some((e) => e.text.startsWith('Order failed'))).toBe(true);
  });

  it('exploring a new village reveals more of the map and keeps old knowledge', () => {
    const g = game();
    const before = g.kingdoms.k1.explored.length;
    const neutral = Object.values(g.villages).find((v) => v.ownerId === null)!;
    neutral.ownerId = 'k1';
    const after = resolveTurn(g).kingdoms.k1.explored;
    expect(after.length).toBeGreaterThan(before);
    expect(g.kingdoms.k1.explored.every((k) => after.includes(k))).toBe(true);
  });
});
