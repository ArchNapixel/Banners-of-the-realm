import { ECON } from './data';
import { UNIT_DEFS } from './units';
import type { GameState, KingdomId } from './types';

/** What a kingdom's soldiers cost each turn. */
export function upkeep(state: GameState, kid: KingdomId) {
  let gold = 0, mana = 0, food = 0;
  for (const c of Object.values(state.companies)) {
    if (c.ownerId !== kid) continue;
    const u = UNIT_DEFS[c.unitType];
    gold += u.upkeep?.gold ?? 0;
    mana += u.upkeep?.mana ?? 0;
    food += ((c.men * u.size) / 100) * ECON.military.foodPer100Soldiers;
  }
  return { gold, mana, food };
}
