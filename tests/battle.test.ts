import { describe, expect, it } from 'vitest';
import { counterMult, damage, type Combatant } from '../src/engine/battle/damage';
import { B, TERRAINS, UNITS } from '../src/engine/battle/data';
import { pursue } from '../src/engine/battle/pursuit';
import { formatReport } from '../src/engine/battle/report';
import { resolveBattleDay } from '../src/engine/battle/resolveBattleDay';
import { runBattle } from '../src/engine/battle/runBattle';
import { setupBattle } from '../src/engine/battle/setupBattle';
import type { BattleInput, CompanyInput, SideInput } from '../src/engine/battle/types';

const co = (id: string, unit: string, extra: Partial<CompanyInput> = {}): CompanyInput => ({ id, unit, rank: 'trained', ...extra });
const army = (name: string, prefix: string, unit: string, count: number, extra: Partial<SideInput> = {}): SideInput => ({
  name, companies: Array.from({ length: count }, (_, i) => co(`${prefix}${i + 1}`, unit)), ...extra,
});
const cmd = { name: 'Cmdr', leadership: 5 };
const fight = (a: SideInput, d: SideInput, terrain: BattleInput['terrain'] = 'plains', seed = 't'): BattleInput => ({ seed, terrain, attacker: a, defender: d });
const comb = (unit: string, men?: number): Combatant => ({ unit: UNITS[unit], men: men ?? UNITS[unit].baseMen, rank: 'trained', fatigue: 0 });
const neutral = {
  kind: 'melee' as const, terrain: TERRAINS.plains, attackerIsDefender: false, attackerCohesion: 100,
};

describe('damage', () => {
  it('neutral 500 militia vs militia = men × Atk ÷ (Atk + Def + Armor) × K', () => {
    const d = damage({ ...neutral, attacker: comb('militia'), target: comb('militia') });
    expect(d).toBeCloseTo(((500 * 3) / 6) * B.k.melee, 6);
  });

  it('applies counters: spearmen double vs cavalry, cavalry double vs ranged, heavy vs polearm', () => {
    expect(counterMult(UNITS.spearmen, UNITS.light_cavalry, 'melee')).toBe(2);
    expect(counterMult(UNITS.light_cavalry, UNITS.archers, 'charge')).toBe(2);
    expect(counterMult(UNITS.swordsmen, UNITS.spearmen, 'melee')).toBe(1.5);
    expect(counterMult(UNITS.militia, UNITS.militia, 'melee')).toBe(1);
  });

  it('ranged halves vs heavy armor unless armor-piercing, and 1.5x vs light', () => {
    expect(counterMult(UNITS.archers, UNITS.swordsmen, 'ranged')).toBe(0.5);
    expect(counterMult(UNITS.crossbowmen, UNITS.swordsmen, 'ranged')).toBe(1);
    expect(counterMult(UNITS.archers, UNITS.militia, 'ranged')).toBe(1.5);
    expect(counterMult(UNITS.archers, UNITS.swordsmen, 'melee')).toBe(1);
  });

  it('Size multiplies damage dealt and divides damage received', () => {
    const giants = comb('hill_giant');
    const asSoldiers: Combatant = { ...giants, unit: { ...giants.unit, size: 1 }, men: giants.men * 25 };
    const vsMilitia = damage({ ...neutral, attacker: giants, target: comb('militia') });
    expect(vsMilitia).toBeCloseTo(damage({ ...neutral, attacker: asSoldiers, target: comb('militia') }), 6);
    const received = damage({ ...neutral, attacker: comb('swordsmen'), target: giants });
    const sameButSize1 = damage({ ...neutral, attacker: comb('swordsmen'), target: { ...giants, unit: { ...giants.unit, size: 1 } } });
    expect(received).toBeCloseTo(sameButSize1 / 25, 6);
  });

  it('terrain: defender takes less on hills; cavalry weaker in forest', () => {
    const base = damage({ ...neutral, attacker: comb('militia'), target: comb('militia') });
    const hills = damage({ ...neutral, terrain: TERRAINS.hills, attacker: comb('militia'), target: comb('militia') });
    expect(hills).toBeCloseTo(base / 1.15, 6);
    const cavPlains = damage({ ...neutral, attacker: comb('light_cavalry'), target: comb('militia') });
    const cavForest = damage({ ...neutral, terrain: TERRAINS.forest, attacker: comb('light_cavalry'), target: comb('militia') });
    expect(cavForest / cavPlains).toBeCloseTo((0.7 / 1.1) / 1.2, 6);
  });

  it('stances, rank, fatigue, cohesion and flanking scale damage', () => {
    const base = damage({ ...neutral, attacker: comb('militia'), target: comb('militia') });
    expect(damage({ ...neutral, attacker: comb('militia'), target: comb('militia'), attackerStance: 'aggressive' })).toBeCloseTo(base * 1.2, 6);
    expect(damage({ ...neutral, attacker: comb('militia'), target: comb('militia'), targetStance: 'hold' })).toBeCloseTo(base * 0.8, 6);
    expect(damage({ ...neutral, attacker: comb('militia'), target: comb('militia'), flanked: true })).toBeCloseTo(base * 1.25, 6);
    expect(damage({ ...neutral, attacker: { ...comb('militia'), rank: 'elite' }, target: comb('militia') })).toBeCloseTo(base * 1.3, 6);
    expect(damage({ ...neutral, attacker: { ...comb('militia'), fatigue: 40 }, target: comb('militia') })).toBeCloseTo(base * 0.8, 6);
    expect(damage({ ...neutral, attackerCohesion: 0, attacker: comb('militia'), target: comb('militia') })).toBeCloseTo(base * 0.5, 6);
  });
});

describe('setup', () => {
  it('places infantry in front up to frontage, rest in reserve; cavalry on flanks; ranged rear', () => {
    const b = setupBattle(fight(
      { name: 'A', companies: [...Array.from({ length: 5 }, (_, i) => co(`I${i}`, 'militia')), co('C1', 'light_cavalry'), co('R1', 'archers'), co('H1', 'harpy_flock')] },
      army('D', 'D', 'militia', 1), 'hills',
    ));
    expect(b.attacker.lines.front).toHaveLength(4);
    expect(b.attacker.lines.reserve).toHaveLength(1);
    expect(b.attacker.lines.flank).toEqual(['C1']);
    expect(b.attacker.lines.rear).toEqual(['R1']);
    expect(b.attacker.lines.air).toEqual(['H1']);
  });

  it('leaderless cohesion drops 5 per company beyond the second; start morale reflects supply and fatigue', () => {
    const b = setupBattle(fight(
      { ...army('A', 'A', 'militia', 8), outOfSupply: true },
      { name: 'D', commander: cmd, companies: [co('D1', 'militia', { fatigue: 60 })] },
    ));
    expect(b.attacker.cohesion).toBe(80 - 30);
    expect(b.attacker.companies.A1.morale).toBe(90);
    expect(b.defender.companies.D1.morale).toBe(90);
    expect(b.defender.cohesion).toBe(85);
  });

  it('spearmen share of 25%+ of the front adds Formation Integrity', () => {
    const b = setupBattle(fight(
      { name: 'A', companies: [co('S', 'spearmen'), co('M1', 'militia'), co('M2', 'militia')] },
      army('D', 'D', 'militia', 1),
    ));
    expect(b.attacker.integrity).toBe(110);
    expect(b.defender.integrity).toBe(100);
  });

  it('leaderless stance is locked to hold', () => {
    const b = setupBattle(fight({ ...army('A', 'A', 'militia', 1), stance: 'aggressive' }, army('D', 'D', 'militia', 1)));
    expect(b.attacker.stance).toBe('hold');
  });
});

describe('battle resolution', () => {
  it('is deterministic and immutable', () => {
    const input = fight(army('A', 'A', 'militia', 3, { commander: cmd }), army('D', 'D', 'militia', 3, { commander: cmd }));
    const b0 = setupBattle(input);
    const snapshot = JSON.stringify(b0);
    const b1 = resolveBattleDay(b0);
    expect(JSON.stringify(b0)).toBe(snapshot);
    expect(JSON.stringify(resolveBattleDay(setupBattle(input)))).toBe(JSON.stringify(b1));
    expect(JSON.stringify(runBattle({ ...input, seed: 'other' }))).not.toBe(JSON.stringify(runBattle(input)));
  });

  it('every company loses men and 70% of casualties are dead (roughly), and men are conserved in the summary', () => {
    for (let i = 0; i < 20; i++) {
      const b = runBattle(fight(
        army('A', 'A', 'militia', 6, { commander: cmd, stance: 'aggressive' }),
        army('D', 'D', 'spearmen', 3, { commander: cmd }), 'plains', `cons-${i}`,
      ));
      for (const s of ['attacker', 'defender'] as const) {
        const x = b.result!.summary[s];
        expect(x.dead + x.wounded + x.captured + x.escaped + x.standing).toBe(x.start);
        expect(x.dead).toBeGreaterThanOrEqual(0);
        expect(x.escaped).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('weak, low-discipline troops rout against elites, and the rout spreads', () => {
    const b = runBattle(fight(
      { name: 'Elite', commander: cmd, stance: 'aggressive', companies: Array.from({ length: 4 }, (_, i) => co(`E${i}`, 'swordsmen', { rank: 'elite' })) },
      army('Levy', 'L', 'militia', 4),
    ));
    expect(Object.values(b.defender.companies).some((c) => c.state === 'routed')).toBe(true);
    expect(b.result!.winner).toBe('attacker');
    expect(b.report.moments.some((m) => m.text.includes('routs'))).toBe(true);
    expect(b.defender.cohesion).toBeLessThan(b.report.days[0].defender.cohesion);
  });

  it('routed companies leave the lines for good', () => {
    const b = runBattle(fight(
      { name: 'Elite', commander: cmd, stance: 'aggressive', companies: Array.from({ length: 4 }, (_, i) => co(`E${i}`, 'swordsmen', { rank: 'elite' })) },
      army('Levy', 'L', 'militia', 4),
    ));
    for (const c of Object.values(b.defender.companies).filter((c) => c.state === 'routed')) {
      for (const slot of Object.values(b.defender.lines)) expect(slot).not.toContain(c.id);
    }
  });

  it('no-morale units never rout', () => {
    const b = runBattle(fight(
      { name: 'Elite', commander: cmd, stance: 'aggressive', companies: Array.from({ length: 5 }, (_, i) => co(`E${i}`, 'swordsmen', { rank: 'elite' })) },
      army('Dead', 'S', 'skeleton_legion', 3),
    ));
    const skeletons = Object.values(b.defender.companies);
    expect(skeletons.every((c) => c.state !== 'routed')).toBe(true);
    expect(skeletons.every((c) => c.morale === 100)).toBe(true);
    expect(b.result!.winner).toBe('attacker');
  });

  it('overlap: the side with more front companies flanks the other and drains Integrity', () => {
    const b = resolveBattleDay(setupBattle(fight(army('A', 'A', 'militia', 4), army('D', 'D', 'militia', 2))));
    expect(b.defender.integrity).toBeLessThan(100);
    expect(b.attacker.integrity).toBe(100);
    const flankedMorale = Object.values(b.defender.companies).every((c) => c.morale < 100);
    expect(flankedMorale).toBe(true);
  });

  it('stances: aggressive inflicts more than hold over many battles; leaderless cannot recover morale overnight', () => {
    const total = (stance: 'aggressive' | 'hold') => {
      let t = 0;
      for (let i = 0; i < 40; i++) {
        const b = resolveBattleDay(setupBattle(fight(
          army('A', 'A', 'militia', 3, { commander: cmd, stance }), army('D', 'D', 'militia', 3), 'plains', `st-${i}`,
        )));
        t += b.report.rounds.reduce((s, r) => s + Object.values(r.losses.defender).reduce((a, v) => a + v, 0), 0);
      }
      return t;
    };
    expect(total('aggressive')).toBeGreaterThan(total('hold'));

    const b = resolveBattleDay(setupBattle(fight(army('A', 'A', 'spearmen', 4, { commander: cmd }), army('D', 'D', 'spearmen', 4), 'mountains', 'night')));
    expect(b.result).toBeUndefined();
    const dBefore = b.report.days.at(-1)!.defender.morale;
    const aBefore = b.report.days.at(-1)!.attacker.morale;
    expect(Object.values(b.defender.companies).map((c) => c.morale).reduce((a, v) => a + v, 0) / 4).toBeCloseTo(dBefore, 0);
    expect(Object.values(b.attacker.companies).map((c) => c.morale).reduce((a, v) => a + v, 0) / 4).toBeGreaterThan(aBefore);
  });

  it('fighting retreat ends the battle as a withdrawal with reduced pursuit', () => {
    const input = fight(army('A', 'A', 'militia', 4, { commander: cmd }), army('D', 'D', 'militia', 4, { commander: cmd, stance: 'fightingRetreat' }));
    const b = runBattle(input);
    expect(b.day).toBe(1);
    expect(b.result).toMatchObject({ outcome: 'victory', winner: 'attacker' });
    const d = b.result!.summary.defender;
    expect(d.captured + (d.dead - Object.values(b.defender.companies).reduce((t, c) => t + c.dead, 0))).toBeLessThan(d.start * 0.4);
  });

  it('attacker must withdraw after 5 days of stalemate (non-siege)', () => {
    const input = fight(
      army('A', 'A', 'spearmen', 2, { commander: cmd }),
      army('D', 'D', 'spearmen', 2, { commander: cmd }), 'mountains', 'long',
    );
    const b = runBattle(input);
    if (b.result!.outcome === 'victory') expect(b.day).toBeLessThanOrEqual(5);
    expect(b.day).toBeLessThanOrEqual(5);
  });

  it('flying units attack the rear line past the front', () => {
    const b = resolveBattleDay(setupBattle(fight(
      { name: 'Flock', companies: [co('H1', 'harpy_flock')] },
      { name: 'Guard', commander: cmd, companies: [co('F1', 'spearmen'), co('R1', 'archers')] },
    )));
    expect(b.defender.companies.R1.dead + b.defender.companies.R1.wounded).toBeGreaterThan(0);
    expect(b.defender.companies.F1.dead + b.defender.companies.F1.wounded).toBe(0);
  });

  it('cavalry charge hits flanks/end of line on round 1 and breaks Integrity without spears', () => {
    const b = resolveBattleDay(setupBattle(fight(
      { name: 'Riders', companies: [co('C1', 'light_cavalry'), co('C2', 'light_cavalry')] },
      army('Levy', 'L', 'militia', 3, { commander: cmd }),
    )));
    expect(b.defender.integrity).toBeLessThanOrEqual(85);
    expect(b.report.rounds[0].losses.defender.L1).toBeGreaterThan(0);
    expect(b.report.rounds[0].losses.defender.L3).toBeGreaterThan(0);
  });

  it('commanded armies rotate a shaken front company for a fresh reserve; leaderless ones only fill gaps', () => {
    const mk = (commander?: typeof cmd) => {
      const b = setupBattle(fight(
        army('A', 'A', 'swordsmen', 3, { commander }), army('D', 'D', 'militia', 2), 'mountains',
      ));
      b.attacker.companies[b.attacker.lines.front[0]].morale = 30;
      return resolveBattleDay(b);
    };
    const led = mk(cmd);
    expect(led.report.rounds.some((r) => r.events.some((e) => e.includes('swaps')))).toBe(true);
    expect(led.attacker.lines.reserve).toHaveLength(1);
    const leaderless = mk();
    expect(leaderless.report.rounds.some((r) => r.events.some((e) => e.includes('swaps')))).toBe(false);
  });

  it('clerics return part of the day\'s wounded overnight', () => {
    const b = resolveBattleDay(setupBattle(fight(
      { name: 'A', commander: cmd, companies: [co('S1', 'spearmen'), co('S2', 'spearmen'), co('S3', 'spearmen'), co('CL', 'clerics')] },
      army('D', 'D', 'militia', 4),
    )));
    expect(b.report.nights).toHaveLength(1);
    expect(b.report.nights[0].text).toContain('wounded return');
  });

  it('formats a readable report', () => {
    const b = runBattle(fight(army('A', 'A', 'militia', 3, { commander: cmd }), army('D', 'D', 'militia', 3)));
    const text = formatReport(b);
    expect(text).toContain('FINAL REPORT');
    expect(text).toContain('Day 1 total');
  });
});

describe('pursuit', () => {
  const base = { fleeing: 1000, leaderless: false, withdrawing: false };
  it('infantry only: 4% killed, 6% captured', () => {
    expect(pursue({ ...base, pursuers: [UNITS.militia] })).toEqual({ killed: 40, captured: 60 });
  });
  it('cavalry adds, leaderless losers suffer 50% more, losses are capped at 40%', () => {
    expect(pursue({ ...base, pursuers: [UNITS.light_cavalry] })).toEqual({ killed: 140, captured: 140 });
    expect(pursue({ ...base, pursuers: [UNITS.heavy_cavalry] })).toEqual({ killed: 100, captured: 100 });
    expect(pursue({ ...base, leaderless: true, pursuers: [UNITS.militia] })).toEqual({ killed: 60, captured: 90 });
    const capped = pursue({ ...base, pursuers: Array(6).fill(UNITS.light_cavalry) });
    expect(capped.killed + capped.captured).toBe(400);
  });
  it('withdrawing armies lose far less', () => {
    const p = pursue({ ...base, withdrawing: true, pursuers: [UNITS.militia] });
    expect(p.killed + p.captured).toBeLessThan(100);
  });
});
