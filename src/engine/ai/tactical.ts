import type { AIContext } from './context';

/** Each battle night: withdraw from a fight that is clearly lost; otherwise keep going. */
export function runBattleNight(c: AIContext) {
  const { s, kid, P } = c;
  for (const gb of Object.values(s.battles)) {
    const side = gb.attackerId === kid ? 'attacker' : gb.defenderId === kid ? 'defender' : null;
    if (!side || gb.battle[side].withdraw) continue;
    const snap = gb.battle.report.days.at(-1)!;
    const me = snap[side], foe = snap[side === 'attacker' ? 'defender' : 'attacker'];
    const reinforcing = gb.pending.some((id) => s.companies[id]?.ownerId === kid);
    if (gb.battle.day > 0 && !reinforcing && me.strength < P.withdrawBelow * foe.strength && me.morale < 50) c.act({ type: 'withdraw', battleId: gb.id });
  }
}
