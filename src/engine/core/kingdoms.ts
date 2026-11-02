import type { GameState, Kingdom, KingdomId } from './types';

/** Owner of independent garrisons and rebels. It is not a kingdom: it has no villages, resources or turns. */
export const NEUTRAL = 'neutral';

export const NEUTRAL_KINGDOM: Kingdom = {
  id: NEUTRAL, name: 'Independents', color: '#9aa0a6', kind: 'ai', race: 'valdren',
  resources: { food: 0, gold: 0, wood: 0, stone: 0, iron: 0, horses: 0, mana: 0 },
  capitalId: '', warWeariness: 0, explored: [], startingVillageCount: 0,
};

export const kingdomOf = (s: GameState, id: KingdomId): Kingdom => s.kingdoms[id] ?? NEUTRAL_KINGDOM;
