import { beforeEach, describe, expect, it } from 'vitest';
import { distance, key } from '../src/engine/core/hex';
import { newCompany } from '../src/engine/core/military';
import { moveTargetOf, PLAYER, useGame } from '../src/store/game';

const start = () => useGame.getState().start({ seed: 'store', mapSize: 'small', playerRace: 'valdren', aiRaces: ['ghor'] });
const st = () => useGame.getState();

beforeEach(() => {
  start();
  const g = st().game!;
  for (const t of Object.values(g.map.tiles)) t.terrain = 'plains';
  for (const v of Object.values(g.villages)) if (v.ownerId !== PLAYER) delete g.villages[v.id];
  for (const c of Object.values(g.companies)) if (c.ownerId !== PLAYER) delete g.companies[c.id];
});

describe('game store', () => {
  it('moves the selected company to a right-clicked hex', () => {
    const g = st().game!;
    const c = Object.values(g.companies).find((x) => x.ownerId === PLAYER)!;
    st().setUnits([c.id]);
    const to = { q: c.hex.q + 4, r: c.hex.r };
    st().moveSelected(to);
    const moved = st().game!.companies[c.id];
    expect(distance(moved.hex, c.hex)).toBe(2);
    expect(st().selectedHex).toEqual(moved.hex);
    expect(st().message).toBeNull();
  });

  it('only moves a whole army or a single company', () => {
    const g = st().game!;
    const a = Object.values(g.companies).find((x) => x.ownerId === PLAYER)!;
    const b = newCompany(g, PLAYER, 'spearmen', 'valdren', 500, a.hex);
    const c = newCompany(g, PLAYER, 'archers', 'valdren', 500, a.hex);
    expect(moveTargetOf(g, [a.id])).toBe(a.id);
    expect(moveTargetOf(g, [a.id, b.id])).toBeNull();
    st().setUnits([a.id, b.id]);
    st().order({ type: 'merge', companyIds: [a.id, b.id, c.id] });
    const army = Object.values(st().game!.armies)[0];
    expect(moveTargetOf(st().game!, [a.id, b.id, c.id])).toBe(army.id);
    expect(moveTargetOf(st().game!, [a.id, b.id])).toBeNull(); // part of an army
    st().setUnits([a.id, b.id]);
    st().moveSelected({ q: a.hex.q + 3, r: a.hex.r });
    expect(st().message).toMatch(/whole army/);
  });

  it('reports order errors and keeps the old game', () => {
    const before = st().game;
    st().order({ type: 'recruit', villageId: 'v1', unit: 'knights_of_the_order', race: 'valdren' });
    expect(st().message).toMatch(/Chapter House/);
    expect(st().game).toBe(before);
  });

  it('cycles through idle units with Tab, skipping garrisons and spent movement', () => {
    const g = st().game!;
    const a = Object.values(g.companies).find((x) => x.ownerId === PLAYER)!;
    const b = newCompany(g, PLAYER, 'spearmen', 'valdren', 500, { q: a.hex.q + 1, r: a.hex.r });
    st().nextIdleUnit();
    expect(st().selectedUnits).toEqual([a.id]);
    st().nextIdleUnit();
    expect(st().selectedUnits).toEqual([b.id]);
    st().order({ type: 'setStatus', companyId: a.id, status: 'garrison' });
    st().nextIdleUnit();
    expect(st().selectedUnits).toEqual([b.id]);
  });

  it('end turn resets movement, drops selections of vanished units, and clears forced march', () => {
    const g = st().game!;
    const c = Object.values(g.companies).find((x) => x.ownerId === PLAYER)!;
    st().setUnits([c.id]);
    st().setForced(true);
    st().moveSelected({ q: c.hex.q + 5, r: c.hex.r });
    expect(distance(st().game!.companies[c.id].hex, c.hex)).toBe(3);
    st().endTurn();
    expect(st().game!.turn).toBe(2);
    expect(st().game!.companies[c.id].movementLeft).toBe(2);
    expect(st().forcedMarch).toBe(false);
    expect(key(st().game!.companies[c.id].hex)).not.toBe(key(c.hex));
  });
});
