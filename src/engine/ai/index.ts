import type { GameState, KingdomId } from '../core/types';
import { makeContext } from './context';
import { runEconomy } from './economic';
import { runOperations } from './operational';
import { chooseGoal } from './strategic';
import { runBattleNight } from './tactical';

/**
 * One AI kingdom's turn. It plays through the same order system as the player:
 * every action is an order executed on `s`, which the caller owns (resolveTurn works on a copy).
 */
export function runAI(s: GameState, kid: KingdomId) {
  const c = makeContext(s, kid);
  runBattleNight(c);
  const goal = chooseGoal(c);
  const k = s.kingdoms[kid];
  k.ai = { goal, targets: k.ai?.targets ?? {} };
  runEconomy(c, goal);
  runOperations(c);
  return c.issued;
}
