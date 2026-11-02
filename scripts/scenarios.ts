import type { Battle, BattleInput } from '../src/engine/battle/types';

export interface Scenario {
  build: (seed: string) => BattleInput;
  onNight?: (b: Battle) => void;
}

const comp = (id: string, unit: string, rank: 'green' | 'trained' | 'veteran' | 'elite' = 'green') => ({ id, unit, rank });

/** Appendix A: a commanded army attacks a leaderless one on hills. */
const hills: Scenario = {
  build: (seed) => ({
    seed,
    terrain: 'hills',
    attacker: {
      name: 'Halden\'s Army',
      commander: { name: 'Sir Halden Ashby', leadership: 8 },
      stance: 'aggressive',
      affinity: ['light', 'wind'],
      risingBonus: 0.02,
      companies: [
        comp('S1', 'spearmen', 'trained'), comp('S2', 'spearmen', 'trained'),
        {
          ...comp('M1', 'militia', 'trained'),
          champion: {
            name: 'Tomas', class: 'folkHero', level: 6, role: 'hidden', traits: ['unbreakable'],
            trigger: { type: 'morale', below: 40 },
          },
        },
        comp('M2', 'militia', 'trained'),
        comp('A1', 'archers', 'trained'), comp('BM', 'battle_mages', 'trained'),
      ],
    },
    defender: {
      name: 'Hill Levy',
      companies: Array.from({ length: 8 }, (_, i) => comp(`E${i + 1}`, 'militia')),
    },
  }),
  onNight: (b) => { b.attacker.stance = 'hold'; },
};

/** Mirror match on open ground: should land near 50/50. */
const mirror: Scenario = {
  build: (seed) => ({
    seed,
    terrain: 'plains',
    attacker: { name: 'Reds', commander: { name: 'Red', leadership: 5 }, stance: 'hold', companies: [comp('R1', 'militia'), comp('R2', 'militia'), comp('R3', 'spearmen')] },
    defender: { name: 'Blues', commander: { name: 'Blue', leadership: 5 }, stance: 'hold', companies: [comp('B1', 'militia'), comp('B2', 'militia'), comp('B3', 'spearmen')] },
  }),
};

export const SCENARIOS: Record<string, Scenario> = { hills, mirror };
