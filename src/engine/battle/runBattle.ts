import { resolveBattleDay } from './resolveBattleDay';
import { setupBattle } from './setupBattle';
import type { Battle, BattleInput } from './types';

/** Runs a battle to its end. `onNight` may edit a copy of the battle (stance, etc.) between days. */
export function runBattle(input: BattleInput, onNight?: (b: Battle) => void): Battle {
  let b = setupBattle(input);
  for (let guard = 0; !b.result && guard < 100; guard++) {
    b = resolveBattleDay(b);
    if (!b.result && onNight) {
      b = structuredClone(b);
      onNight(b);
    }
  }
  return b;
}
