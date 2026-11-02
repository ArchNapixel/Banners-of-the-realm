import { runBattle } from '../battle/runBattle';
import { battleInputFor } from '../core/battles';
import { distance, key } from '../core/hex';
import { hashSeed } from '../core/rng';
import type { Company, HexCoord, KingdomId, Village } from '../core/types';
import { companyMen } from '../core/units';
import { NEUTRAL } from '../core/kingdoms';
import type { AIContext } from './context';

/** An enemy company as the AI believes it to be (not an object in the game state). */
function estimate(c: Company, men: number): Company {
  return { ...c, men, id: `est-${c.id}`, battleId: undefined, armyId: null, recovering: [] };
}

/**
 * What the AI expects to find at `hex`: exact numbers if it has troops next door,
 * otherwise a rough count (±20%); a remembered village it cannot see gets a garrison guess.
 */
export function expectedDefenders(ctx: AIContext, hex: HexCoord, village?: Village): { owner: KingdomId; companies: Company[] } {
  const { s, P, rng } = ctx;
  const seen = ctx.visible.has(key(hex));
  const here = Object.values(s.companies).filter((c) => key(c.hex) === key(hex) && c.ownerId !== ctx.kid);
  const close = Object.values(s.companies).some((c) => c.ownerId === ctx.kid && distance(c.hex, hex) <= 1);
  if (seen && here.length) {
    return { owner: here[0].ownerId, companies: here.map((c) => estimate(c, close ? c.men : Math.max(1, Math.round(c.men * (0.8 + 0.4 * rng()))))) };
  }
  if (village && !here.length) {
    // Out of sight, or an empty independent village: guess a garrison from the village's size.
    const n = P.unknownGarrison[village.tier];
    const race = Object.entries(village.populationByRace).sort((a, b) => b[1] - a[1])[0][0] as Company['race'];
    const owner = village.ownerId ?? NEUTRAL;
    const guess = Array.from({ length: n }, (_, i) => ({
      id: `guess-${village.id}-${i}`, ownerId: owner, unitType: 'militia', race, men: companyMen('militia', race), maxMen: companyMen('militia', race),
      rank: 'trained' as const, battlesSurvived: 1, armyId: null, hex: { ...hex }, movementLeft: 0, moved: 0, forced: false,
      status: 'ready' as const, morale: 100, recovering: [],
    }));
    return { owner, companies: guess };
  }
  return { owner: here[0]?.ownerId ?? NEUTRAL, companies: [] };
}

/** Runs the battle resolver several times with different seeds and reports win rate and expected losses. */
export function predictBattle(ctx: AIContext, mine: Company[], hex: HexCoord, village?: Village): { winRate: number; lossShare: number } {
  const cacheKey = `${mine.map((c) => c.id).join(',')}@${key(hex)}`;
  const hit = ctx.cache.get(cacheKey);
  if (hit) return hit;
  const { companies: defenders, owner } = expectedDefenders(ctx, hex, village);
  if (!defenders.length) return { winRate: 1, lossShare: 0 };

  let wins = 0, loss = 0;
  const runs = ctx.P.predictionRuns;
  for (let i = 0; i < runs; i++) {
    const seed = `${ctx.s.seed}#predict#${hashSeed(cacheKey, ctx.s.turn, i)}`;
    const b = runBattle(battleInputFor(ctx.s, seed, ctx.kid, mine, owner, defenders, hex));
    const r = b.result!;
    if (r.winner === 'attacker') wins++;
    const a = r.summary.attacker;
    loss += (a.dead + a.wounded + a.captured) / Math.max(1, a.start);
  }
  const out = { winRate: wins / runs, lossShare: loss / runs };
  ctx.cache.set(cacheKey, out);
  return out;
}
