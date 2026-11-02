import { createRng, hashSeed } from './rng';
import { ECON, RACES } from './data';
import type { GameSettings, GameState, HexCoord, Kingdom, RaceId, Resources, Village } from './types';
import cfg from '../data/mapgen.json';
import { generateMap } from '../mapgen/generateMap';
import { createNamer } from '../mapgen/names';
import { placeCapitals, placeNeutrals } from '../mapgen/placeFactions';
import { newCompany } from './military';
import { companyMen } from './units';
import { updateExplored } from './vision';

const PLAYABLE = Object.keys(RACES) as RaceId[];

/** Copy of the parts of state that change; the (large, immutable) map is shared. */
export const cloneState = (s: GameState): GameState => ({
  ...s,
  kingdoms: structuredClone(s.kingdoms),
  villages: structuredClone(s.villages),
  companies: structuredClone(s.companies),
  armies: structuredClone(s.armies),
  characters: structuredClone(s.characters),
  battles: structuredClone(s.battles),
  reports: [...s.reports],
  prisoners: structuredClone(s.prisoners),
  sieges: structuredClone(s.sieges),
  captures: structuredClone(s.captures),
  roads: { ...s.roads },
  usedNames: [...s.usedNames],
  log: [...s.log],
});

const startResources = (race: RaceId): Resources => {
  const r: Resources = { food: ECON.start.food, gold: ECON.start.gold, wood: ECON.start.wood, stone: ECON.start.stone, iron: 0, horses: 0, mana: 0 };
  for (const [k, n] of Object.entries(RACES[race].start) as [keyof Resources, number][]) r[k] += n;
  return r;
};

function newVillage(id: string, name: string, ownerId: string | null, hex: HexCoord, race: RaceId, pop: number, capital: boolean): Village {
  return {
    id, name, ownerId, hex: { q: hex.q, r: hex.r },
    tier: capital ? (ECON.start.tier as Village['tier']) : 'hamlet',
    populationByRace: { [race]: pop },
    stability: capital ? ECON.start.stability : ECON.neutralStability,
    taxLevel: 'normal',
    buildings: capital ? ECON.start.buildings.map((b) => ({ id: b })) : [],
    buildQueue: [], trainQueue: [], workerPriority: [],
    stores: 3, recentConscription: 0, conquestPenalty: 0, borderRadius: 2,
  };
}

export function newGame(settings: GameSettings): GameState {
  const sz = cfg.sizes[settings.mapSize];
  if (settings.aiRaces.length > sz.maxAi) throw new Error(`${settings.mapSize} maps hold at most ${sz.maxAi} AI kingdoms`);
  const rng = createRng(hashSeed(settings.seed, 'newgame'));
  const usedNames: string[] = [];
  const namer = createNamer(rng, usedNames);

  const map = generateMap(settings.seed, settings.mapSize, rng, namer);
  const races = [settings.playerRace, ...settings.aiRaces];
  const capitals = placeCapitals(map, races, rng);
  const neutrals = placeNeutrals(map, sz.neutralVillages, capitals, rng);

  const kingdoms: GameState['kingdoms'] = {};
  const villages: GameState['villages'] = {};
  races.forEach((race, i) => {
    const kid = `k${i + 1}`, vid = `v${i + 1}`;
    const capName = namer.village(race);
    villages[vid] = newVillage(vid, capName, kid, capitals[i], race, cfg.placement.capitalPopulation, true);
    kingdoms[kid] = {
      id: kid,
      name: i === 0 && settings.kingdomName ? settings.kingdomName : namer.kingdom(race, capName),
      color: cfg.colors[i % cfg.colors.length],
      kind: i === 0 ? 'player' : 'ai',
      aiPersonality: i === 0 ? undefined : 'warlord',
      race, resources: startResources(race), capitalId: vid, warWeariness: 0, explored: [], startingVillageCount: 1,
    } satisfies Kingdom;
  });
  neutrals.forEach((hex, i) => {
    const race = PLAYABLE[Math.floor(rng() * PLAYABLE.length)];
    const [lo, hi] = cfg.placement.neutralPopulation;
    const id = `v${races.length + i + 1}`;
    villages[id] = newVillage(id, namer.village(race), null, hex, race, Math.round(lo + rng() * (hi - lo)), false);
  });

  const state: GameState = {
    seed: settings.seed, turn: 1, settings, map, kingdoms, villages, companies: {}, armies: {}, characters: {}, battles: {}, reports: [], prisoners: {}, sieges: {}, captures: {}, roads: {}, nextId: 1, usedNames, log: [],
  };
  for (const k of Object.values(kingdoms)) {
    for (const u of ECON.military.startCompanies) newCompany(state, k.id, u, k.race, companyMen(u, k.race), villages[k.capitalId].hex);
  }
  updateExplored(state);
  return state;
}
