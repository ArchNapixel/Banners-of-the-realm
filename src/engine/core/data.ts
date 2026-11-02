import affinityJson from '../data/affinity.json';
import buildingsJson from '../data/buildings.json';
import econJson from '../data/economy.json';
import racesJson from '../data/races.json';
import type { RaceId, Resources, TerrainId, Tier } from './types';

export interface BuildingDef {
  name: string;
  cost: Partial<Resources>;
  turns: number;
  workers: number;
  terrain?: TerrainId[];
  overlay?: 'ley' | 'goldDeposit';
  onOverlay?: 'ley';
  minTier?: Tier;
  needsBuilding?: string;
  needsIncome?: keyof Resources;
  capitalOnly?: boolean;
  /** village must have people of this race */
  race?: RaceId;
  /** the village's own hex must be one of these */
  onTerrain?: TerrainId[];
  trainingBonus?: number;
  produces?: Partial<Resources>;
  taxBonus?: number;
  growth?: number;
  popCapPct?: number;
  stability?: number;
  vision?: number;
  defense?: number;
  siegeStores?: number;
  unlocks?: string[];
}

export interface RaceDef {
  name: string;
  plain: string;
  playable: boolean;
  homeland: TerrainId[];
  growth: number;
  companySize: number;
  stabilityBase: number;
  start: Partial<Resources>;
  buildingCostMult: number;
  outputMult: Record<string, number>;
  costMult?: Record<string, number>;
  unitMods: { tag?: string; atk?: number; def?: number; armor?: number; discipline?: number }[];
  forbiddenUnits: string[];
  forbiddenBuildings: string[];
  terrainMove: Partial<Record<TerrainId, number>>;
  affinitySchools: string[];
  risingBonus?: number;
  pitsRisingBonus?: number;
  sackBonus?: number;
  xpMult?: number;
  forbiddenSchools?: string[];
  foragingNoAttrition?: boolean;
  marshImmune?: boolean;
}

export const BUILDINGS = buildingsJson as unknown as Record<string, BuildingDef>;
export const RACES = racesJson as unknown as Record<RaceId, RaceDef>;
export const AFFINITY = affinityJson as Record<RaceId, Record<RaceId, number>>;
export const ECON = econJson;
export const TIERS = econJson.tiers as Record<Tier, { popCap: number; slots: number; radius: number; next: Tier | null; upgrade: Partial<Resources> | null }>;
