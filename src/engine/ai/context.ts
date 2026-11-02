import { execute, type Order, type OrderInput } from '../core/orders';
import { distance, key } from '../core/hex';
import { createRng, hashSeed, type Rng } from '../core/rng';
import type { Company, GameState, HexCoord, KingdomId, Village } from '../core/types';
import { visibleKeys } from '../core/vision';
import personalities from '../data/personalities.json';

export type Personality = (typeof personalities)['warlord'];
export const PERSONALITIES: Record<string, Personality> = personalities;

/** Everything one AI kingdom's layers share for a single turn. */
export interface AIContext {
  s: GameState;
  kid: KingdomId;
  rng: Rng;
  P: Personality;
  /** what this kingdom can see right now: the AI never sees through fog */
  visible: Set<string>;
  /** predictions already made this turn, keyed by army and target */
  cache: Map<string, { winRate: number; lossShare: number }>;
  /** orders the AI issued (for debugging and tests) */
  issued: Order[];
  act(o: OrderInput): string | undefined;
}

export function makeContext(s: GameState, kid: KingdomId): AIContext {
  const P = PERSONALITIES[s.kingdoms[kid].aiPersonality ?? 'warlord'];
  const ctx: AIContext = {
    s, kid, P, rng: createRng(hashSeed(s.seed, 'ai', s.turn, kid)), visible: visibleKeys(s, kid), cache: new Map(), issued: [],
    act(o) {
      const order = { ...o, kingdomId: kid } as Order;
      const err = execute(s, order);
      if (!err) ctx.issued.push(order);
      return err;
    },
  };
  return ctx;
}

export const myVillages = (c: AIContext): Village[] => Object.values(c.s.villages).filter((v) => v.ownerId === c.kid);
export const myCompanies = (c: AIContext): Company[] => Object.values(c.s.companies).filter((x) => x.ownerId === c.kid);
export const isMilitary = (x: Company) => x.unitType !== 'settlers' && x.unitType !== 'scouts';

export const nearestVillage = (c: AIContext, hex: HexCoord): Village | undefined =>
  myVillages(c).sort((a, b) => distance(a.hex, hex) - distance(b.hex, hex))[0];

/** Hostile companies the kingdom can currently see. */
export const visibleHostiles = (c: AIContext): Company[] =>
  Object.values(c.s.companies).filter((x) => x.ownerId !== c.kid && c.visible.has(key(x.hex)));

export const armyTarget = (c: AIContext) => {
  const t = c.P.armyTarget;
  return Math.min(t.max, Math.round(t.base + t.perVillage * (myVillages(c).length - 1) + (c.s.turn / 10) * t.perTenTurns));
};
