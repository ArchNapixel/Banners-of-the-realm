import { describe, expect, it } from 'vitest';
import { RACES } from '../src/engine/core/data';
import { distance, fromOffset, fromPixel, key, neighbors, toPixel, withinRadius } from '../src/engine/core/hex';
import { newGame } from '../src/engine/core/state';
import type { GameSettings, RaceId } from '../src/engine/core/types';
import { visibleKeys } from '../src/engine/core/vision';
import cfg from '../src/engine/data/mapgen.json';

const settings = (seed: string, extra: Partial<GameSettings> = {}): GameSettings => ({
  seed, mapSize: 'medium', playerRace: 'valdren', aiRaces: ['ghor', 'durrakin', 'sylvaen'], ...extra,
});

describe('hex maths', () => {
  it('has six neighbours at distance 1 and the right radius sizes', () => {
    const h = { q: 3, r: -2 };
    expect(neighbors(h)).toHaveLength(6);
    expect(neighbors(h).every((n) => distance(h, n) === 1)).toBe(true);
    for (const n of [0, 1, 2, 3]) expect(withinRadius(h, n)).toHaveLength(3 * n * (n + 1) + 1);
  });

  it('round-trips hex ↔ pixel', () => {
    for (const [c, r] of [[0, 0], [5, 7], [12, 3], [29, 19]]) {
      const h = fromOffset(c, r);
      const p = toPixel(h, 28);
      expect(fromPixel(p.x, p.y, 28)).toEqual(h);
      expect(fromPixel(p.x + 5, p.y - 5, 28)).toEqual(h);
    }
  });
});

describe('map generation', () => {
  it('is deterministic per seed and differs between seeds', () => {
    const a = newGame(settings('alpha')), b = newGame(settings('alpha')), c = newGame(settings('beta'));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a.map)).not.toBe(JSON.stringify(c.map));
  });

  it.each(['small', 'medium', 'large'] as const)('%s map has the configured size and a full terrain mix', (size) => {
    const ai = size === 'small' ? ['ghor'] : ['ghor', 'durrakin'];
    const g = newGame(settings('mix', { mapSize: size, aiRaces: ai as RaceId[] }));
    const { width, height } = cfg.sizes[size];
    const tiles = Object.values(g.map.tiles);
    expect(tiles).toHaveLength(width * height);
    const seen = new Set(tiles.map((t) => t.terrain));
    for (const t of ['plains', 'forest', 'hills', 'mountains', 'marsh', 'coast']) expect(seen.has(t as never)).toBe(true);
    expect(tiles.filter((t) => t.terrain === 'plains').length / tiles.length).toBeGreaterThan(0.1);
  });

  it('puts every hex in a named region of one terrain, with unique names', () => {
    const g = newGame(settings('regions'));
    const regions = Object.values(g.map.regions);
    expect(new Set(regions.map((r) => r.name)).size).toBe(regions.length);
    expect(regions.reduce((t, r) => t + r.hexes.length, 0)).toBe(Object.keys(g.map.tiles).length);
    for (const r of regions) {
      expect(r.name).toMatch(/\w+ \w+/);
      for (const k of r.hexes) {
        expect(g.map.tiles[k].regionId).toBe(r.id);
        expect(g.map.tiles[k].terrain).toBe(r.terrain);
      }
    }
  });

  it('places overlays on suitable hexes in the configured numbers', () => {
    const g = newGame(settings('overlays'));
    const tiles = Object.values(g.map.tiles);
    const sz = cfg.sizes.medium;
    expect(tiles.filter((t) => t.ley)).toHaveLength(sz.leyNodes);
    expect(tiles.filter((t) => t.ruins)).toHaveLength(sz.ruins);
    expect(tiles.filter((t) => t.ley && t.ruins)).toHaveLength(0);
    expect(tiles.filter((t) => t.ancientForest).every((t) => t.terrain === 'forest')).toBe(true);
    expect(tiles.filter((t) => t.goldDeposit).every((t) => t.terrain === 'mountains')).toBe(true);
  });
});

describe('faction placement', () => {
  it('starts every kingdom with a 1,500-strong capital, Farm and Barracks, and its race bonus', () => {
    const g = newGame(settings('start'));
    const v = g.villages[g.kingdoms.k1.capitalId];
    expect(v.populationByRace).toEqual({ valdren: 1500 });
    expect(v.tier).toBe('village');
    expect(v.buildings.map((b) => b.id).sort()).toEqual(['barracks', 'farm']);
    expect(g.kingdoms.k1.resources).toMatchObject({ gold: 400, wood: 50, stone: 20 });
    expect(g.kingdoms.k2.resources.food).toBe(200); // Ghor: base 100 + 100
    expect(g.kingdoms.k3.resources.iron).toBe(40); // Durrakin
    expect(g.kingdoms.k4.resources.wood).toBe(100); // Sylvaen
  });

  it('keeps capitals 10+ apart, neutrals clear of them, and nobody on the coast', () => {
    for (const seed of ['p1', 'p2', 'p3', 'p4', 'p5']) {
      const g = newGame(settings(seed));
      const caps = Object.values(g.kingdoms).map((k) => g.villages[k.capitalId]);
      const neutrals = Object.values(g.villages).filter((v) => v.ownerId === null);
      expect(neutrals).toHaveLength(cfg.sizes.medium.neutralVillages);
      for (const a of caps) {
        for (const b of caps) if (a !== b) expect(distance(a.hex, b.hex)).toBeGreaterThanOrEqual(10);
        for (const n of neutrals) expect(distance(a.hex, n.hex)).toBeGreaterThanOrEqual(4);
      }
      for (const a of neutrals) for (const b of neutrals) if (a !== b) expect(distance(a.hex, b.hex)).toBeGreaterThanOrEqual(3);
      for (const v of Object.values(g.villages)) expect(g.map.tiles[key(v.hex)].terrain).not.toBe('coast');
    }
  });

  it('biases capitals towards their race\'s homeland', () => {
    let home = 0, total = 0;
    for (let i = 0; i < 25; i++) {
      const g = newGame(settings(`home${i}`));
      for (const k of Object.values(g.kingdoms)) {
        total++;
        if (RACES[k.race].homeland.includes(g.map.tiles[key(g.villages[k.capitalId].hex)].terrain)) home++;
      }
    }
    expect(home / total).toBeGreaterThan(0.9);
  });

  it('gives every village, kingdom, and region a unique name drawn from its culture', () => {
    const g = newGame(settings('names'));
    expect(new Set(g.usedNames).size).toBe(g.usedNames.length);
    const names = Object.values(g.villages).map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
    expect(g.kingdoms.k1.name).toContain(g.villages.v1.name);
  });

  it('rejects more AI kingdoms than the map allows', () => {
    expect(() => newGame(settings('x', { mapSize: 'small', aiRaces: ['ghor', 'ghor', 'ghor'] }))).toThrow();
  });
});

describe('fog of war', () => {
  it('starts with only the area around your villages explored', () => {
    const g = newGame(settings('fog'));
    const cap = g.villages.v1;
    const explored = new Set(g.kingdoms.k1.explored);
    for (const h of withinRadius(cap.hex, 2)) expect(explored.has(key(h))).toBe(true);
    expect(explored.size).toBeLessThan(Object.keys(g.map.tiles).length / 10);
    expect(visibleKeys(g, 'k1').size).toBe(explored.size);
  });

  it('a Watchtower extends vision to 3', () => {
    const g = newGame(settings('fog2'));
    const before = visibleKeys(g, 'k1').size;
    g.villages.v1.buildings.push({ id: 'watchtower' });
    expect(visibleKeys(g, 'k1').size).toBeGreaterThan(before);
  });
});
