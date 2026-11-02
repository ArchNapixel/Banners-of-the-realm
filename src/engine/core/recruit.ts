import { BUILDINGS, ECON, RACES } from './data';
import { canAfford, effectiveStability } from './economy';
import { UNIT_DEFS, companyMen, unlockingBuildings } from './units';
import type { GameState, KingdomId, RaceId, Village } from './types';

/** Training slots are per military building: a village trains one company at a time per building type. */
export const unlockSlot = (unitId: string) => unlockingBuildings(unitId)[0] ?? 'barracks';

/** Why this village cannot start training the unit from this race's people, or null. */
export function recruitBlocker(s: GameState, kid: KingdomId, v: Village | undefined, unitId: string, race: RaceId): string | null {
  const def = UNIT_DEFS[unitId];
  if (!def?.cost) return 'Unknown unit';
  if (!v || v.ownerId !== kid) return 'Not your village';
  const k = s.kingdoms[kid];
  const people = v.populationByRace[race] ?? 0;
  if (people <= 0) return `No ${RACES[race]?.name ?? race} people here`;
  if (RACES[race].forbiddenUnits.includes(unitId)) return `${RACES[race].name} cannot field ${def.name}`;
  if (def.allowedRaces && !def.allowedRaces.includes(race)) return `Only ${def.allowedRaces.map((r) => RACES[r].name).join('/')} can field ${def.name}`;
  const missing = unlockingBuildings(unitId).find((b) => !v.buildings.some((x) => x.id === b));
  if (missing) return `Needs ${BUILDINGS[missing].name}`;
  if (race !== k.race && def.allowedRaces && effectiveStability(s, v) < ECON.military.foreignUniqueStability)
    return `Needs stability ${ECON.military.foreignUniqueStability} to field another people's unique units`;
  if (v.trainQueue.some((q) => q.slot === unlockSlot(unitId))) return 'Training slot busy';
  if (people < companyMen(unitId, race)) return 'Not enough people';
  if (!canAfford(k.resources, def.cost)) return 'Not enough resources';
  return null;
}
