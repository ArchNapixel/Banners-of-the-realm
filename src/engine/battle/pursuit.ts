import { B } from './data';
import type { UnitType } from './types';

export interface PursuitInput {
  /** unit types of the winner's surviving companies */
  pursuers: UnitType[];
  /** men running: routed companies, plus the whole army if it withdrew */
  fleeing: number;
  leaderless: boolean;
  withdrawing: boolean;
}

export function pursue(i: PursuitInput): { killed: number; captured: number } {
  const P = B.pursuit;
  let k = P.base.killed;
  let c = P.base.captured;
  for (const u of i.pursuers) {
    const t = u.tags.includes('cavalry') ? (u.tags.includes('heavy') ? P.heavy : u.tags.includes('light') ? P.light : null) : null;
    if (t) { k += t.killed; c += t.captured; }
  }
  const mult = (i.leaderless ? P.leaderlessMult : 1) * (i.withdrawing ? P.withdrawMult : 1);
  k *= mult;
  c *= mult;
  if (k + c > P.cap) {
    const s = P.cap / (k + c);
    k *= s;
    c *= s;
  }
  return { killed: Math.round(i.fleeing * k), captured: Math.round(i.fleeing * c) };
}
