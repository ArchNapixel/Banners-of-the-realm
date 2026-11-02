import { distance } from '../core/hex';
import { kingdomIncome, popCap, totalPop } from '../core/economy';
import { armyTarget, isMilitary, myCompanies, myVillages, visibleHostiles, type AIContext } from './context';

export type Goal = 'Grow' | 'Expand' | 'Prepare War' | 'Attack' | 'Defend';

/** Hostile troops near one of our villages. */
export function threatened(c: AIContext): boolean {
  const mine = myVillages(c);
  return visibleHostiles(c).some((h) => mine.some((v) => distance(v.hex, h.hex) <= 4));
}

/** Utility-style choice of this turn's goal; the other layers weigh their decisions by it. */
export function chooseGoal(c: AIContext): Goal {
  const villages = myVillages(c);
  const army = myCompanies(c).filter(isMilitary).length;
  const k = c.s.kingdoms[c.kid];
  const crowded = villages.some((v) => totalPop(v) >= popCap(v) * c.P.expandPopShare) || kingdomIncome(c.s, c.kid).food < 1;

  if (threatened(c)) return 'Defend';
  if (crowded && villages.length < c.P.maxVillages && (army >= 2 || c.s.turn > 5) && k.resources.gold > 150 && !myCompanies(c).some((x) => x.unitType === 'settlers')) return 'Expand';
  if (army >= armyTarget(c)) return 'Attack';
  if (c.s.turn < 8 || villages.every((v) => v.buildings.length < 3)) return 'Grow';
  return 'Prepare War';
}
