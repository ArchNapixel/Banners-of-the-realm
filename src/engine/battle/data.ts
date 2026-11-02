import unitsJson from '../data/units.json';
import terrainJson from '../data/terrain.json';
import balanceJson from '../data/balance.json';
import type { CounterRule, TerrainData, TerrainId, UnitType } from './types';

export const UNITS = unitsJson as unknown as Record<string, UnitType>;
export const TERRAINS = terrainJson as unknown as Record<TerrainId, TerrainData>;
export const B = balanceJson;
export const COUNTERS = balanceJson.counters as unknown as CounterRule[];
import spellsJson from '../data/spells.json';
import championsJson from '../data/champions.json';
import type { ChampionClass } from './types';

export interface SpellData {
  name: string;
  school: string;
  mana: number;
  priority: number;
  inert?: boolean;
  effect: { type: string; [k: string]: unknown };
}
export const SPELLS = spellsJson as unknown as Record<string, SpellData>;
export const CH = championsJson;
export const CLASSES = championsJson.classes as Record<ChampionClass, { name: string; main: keyof import('./types').Stats; secondary: keyof import('./types').Stats }>;
export const CLASS_BY_UNIT = championsJson.classByUnit as Record<string, ChampionClass>;
export const TRAITS = championsJson.traits as Record<string, { moment: string; epithet: string }>;
