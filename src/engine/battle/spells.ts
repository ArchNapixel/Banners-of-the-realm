import { pickOne } from '../core/rng';
import { championArcana, hasTrait, immuneToFear } from './champions';
import { opp, type RoundCtx } from './ctx';
import { B, SPELLS, UNITS } from './data';
import type { BCompany, BSide, SideKey } from './types';

const clamp = (x: number) => Math.min(100, Math.max(0, x));
const activeOf = (ctx: RoundCtx, s: SideKey) => Object.values(ctx.b[s].companies).filter((c) => c.state === 'active');
const hasRanged = (ctx: RoundCtx, s: SideKey) => ctx.b[s].lines.rear.some((id) => ctx.b[s].companies[id].unit.rangedAtk);

export const spellCost = (side: BSide, id: string) =>
  Math.round(SPELLS[id].mana * (side.affinity.includes(SPELLS[id].school) ? B.affinityDiscount : 1));

/** Would a commander cast this right now? */
function useful(ctx: RoundCtx, s: SideKey, id: string): boolean {
  const me = ctx.b[s], en = ctx.b[opp(s)], ai = B.ai;
  const e = SPELLS[id].effect;
  const enemyThere = en.lines.front.length + en.lines.flank.length + en.lines.rear.length > 0;
  switch (e.type) {
    case 'damage': case 'suppress': case 'fatigue': return enemyThere;
    case 'integrity': return e.who === 'self' ? me.integrity < ai.integrityLow : en.integrity > ai.enemyIntegrityMin && en.lines.front.length > 0;
    case 'morale': {
      if (e.who === 'self') {
        const act = activeOf(ctx, s);
        return act.length > 0 && act.reduce((t, c) => t + c.morale, 0) / act.length < ai.moraleLow;
      }
      return en.lines.front.length > 0;
    }
    case 'mend': return activeOf(ctx, s).reduce((t, c) => t + c.dayWounded, 0) >= ai.woundedMin;
    case 'cohesion': return en.cohesion > ai.cohesionMin;
    case 'buff': return enemyThere && (e.buff === 'rangedMult' ? hasRanged(ctx, s) : hasRanged(ctx, opp(s)));
    default: return false;
  }
}

/** Phase 1: every caster company casts one spell. Commanders pick sensibly, leaderless armies pick at random. */
export function castSpells(ctx: RoundCtx) {
  const { b } = ctx;
  for (const s of ['attacker', 'defender'] as SideKey[]) {
    const me = b[s];
    for (const id of me.lines.rear) {
      const caster = me.companies[id];
      if (caster.state !== 'active' || !caster.unit.tags.includes('caster')) continue;
      const known = Object.keys(SPELLS).filter(
        (sp) => !SPELLS[sp].inert && !me.forbiddenSchools.includes(SPELLS[sp].school) && spellCost(me, sp) <= me.mana,
      );
      const options = me.commander ? known.filter((sp) => useful(ctx, s, sp)).sort((x, y) => SPELLS[x].priority - SPELLS[y].priority) : known;
      if (!options.length) continue;
      cast(ctx, s, caster, me.commander ? options[0] : pickOne(ctx.rng, options));
    }
  }
}

function cast(ctx: RoundCtx, s: SideKey, caster: BCompany, id: string) {
  const { b } = ctx;
  const me = b[s], en = b[opp(s)];
  const sp = SPELLS[id];
  const e = sp.effect as Record<string, number | string>;
  me.mana -= spellCost(me, id);
  const power = Math.min(1, caster.men / caster.unit.baseMen) * (1 + championArcana(me, caster.id) * B.arcanaPower);
  ctx.moment(`${caster.name} (${me.name}) casts ${sp.name}`);

  const fear = (c: BCompany, amount: number) => { if (!immuneToFear(en, c)) c.morale = clamp(c.morale + amount); };
  switch (sp.effect.type) {
    case 'damage': {
      const to = ctx.pick(me, en, ['front', 'flank', 'rear']);
      if (!to) break;
      const reduce = hasTrait(en, to.id, 'arcaneTouched') ? 0.7 : 1;
      ctx.inflict(opp(s), to, (e.fraction as number) * power * to.men * reduce, caster, true);
      fear(to, e.morale as number);
      break;
    }
    case 'suppress': {
      const to = ctx.pick(me, en, ['front']);
      if (to) to.suppressedRound = ctx.abs + 1;
      break;
    }
    case 'integrity': {
      const side = e.who === 'self' ? me : en;
      side.integrity = Math.max(0, side.integrity + (e.amount as number));
      break;
    }
    case 'fatigue':
      for (const id2 of en.lines.front) en.companies[id2].fatigue = Math.min(B.fatigue.max, en.companies[id2].fatigue + (e.amount as number));
      break;
    case 'morale':
      if (e.who === 'self') {
        for (const c of activeOf(ctx, s)) if (!c.unit.noMorale) c.morale = clamp(c.morale + (e.amount as number));
      } else for (const id2 of en.lines.front) fear(en.companies[id2], e.amount as number);
      break;
    case 'mend':
      for (const c of activeOf(ctx, s)) {
        const back = Math.min(c.wounded, Math.round(c.dayWounded * (e.share as number)));
        c.men += back; c.wounded -= back; c.dayWounded -= back;
      }
      break;
    case 'cohesion':
      en.cohesion = Math.max(0, en.cohesion + (e.amount as number));
      break;
    case 'buff':
      if (e.buff === 'rangedMult') me.buff.rangedMult = e.value as number;
      else me.buff.deflected = true;
      break;
  }
}
