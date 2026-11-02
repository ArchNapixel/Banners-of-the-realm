import { UNITS } from '../battle/data';
import type { UnitType } from '../battle/types';
import { BUILDINGS, RACES } from './data';
import type { RaceId, Resources } from './types';

export interface UnitDef extends UnitType {
  raceSize?: boolean;
  cost?: Partial<Resources>;
  turns?: number;
  upkeep?: { gold: number; mana?: number };
  allowedRaces?: RaceId[];
  special?: string;
}

export const UNIT_DEFS = UNITS as Record<string, UnitDef>;

/** Men in a new company: plain infantry and ranged use the race's company size; everything else its listed size. */
export const companyMen = (unitId: string, race: RaceId) => {
  const u = UNIT_DEFS[unitId];
  return u.raceSize ? RACES[race].companySize : u.baseMen;
};

/** Unit stats after racial modifiers (Sylvaen +1/+1/+10, Durrakin infantry +1 armor +10 disc, ...). */
export function effectiveUnit(unitId: string, race: RaceId): UnitType {
  const u = UNIT_DEFS[unitId];
  const out = { ...u, tags: [...u.tags] };
  for (const m of RACES[race].unitMods) {
    if (m.tag && !u.tags.includes(m.tag)) continue;
    out.atk += m.atk ?? 0;
    if (out.rangedAtk !== undefined) out.rangedAtk += m.atk ?? 0;
    out.def += m.def ?? 0;
    out.armor += m.armor ?? 0;
    out.discipline += m.discipline ?? 0;
  }
  return out;
}

/** Every building that lists the unit must be present (Heavy Cavalry needs Stables and a Blacksmith). */
export const unlockingBuildings = (unitId: string) =>
  Object.entries(BUILDINGS).filter(([, b]) => b.unlocks?.includes(unitId)).map(([id]) => id);

export const isRecruitable = (unitId: string) => !!UNIT_DEFS[unitId]?.cost;
