import { createRng, hashSeed, pickOne } from '../core/rng';
import { opp, SIDES, type Atk, type RoundCtx } from './ctx';
import type { Combatant } from './damage';
import { CH, CLASSES, CLASS_BY_UNIT, SPELLS, TRAITS, UNITS } from './data';
import type {
  BChampion, BCompany, BSide, Battle, Character, ChampionClass, ChampionInput, SideKey, Stats, UnitType,
} from './types';

const PSEUDO: UnitType = {
  name: 'Champion', baseMen: 1, size: 1, atk: CH.attackerAtk, def: 0, armor: 0, discipline: 0, speed: 0, tags: [],
};
const clamp = (x: number) => Math.min(100, Math.max(0, x));

export function makeStats(cls: ChampionClass, level = 1, override: Partial<Stats> = {}): Stats {
  const k = CLASSES[cls];
  const s: Stats = { might: CH.baseStat, vitality: CH.baseStat, leadership: CH.baseStat, tactics: CH.baseStat, arcana: CH.baseStat, resolve: CH.baseStat };
  s[k.main] += CH.mainBonus + (level - 1) * CH.statPointsPerLevel;
  s[k.secondary] += CH.secondaryBonus;
  return { ...s, ...override };
}

export const displayName = (c: Character) => (c.epithet ? `${c.name} ${c.epithet}` : c.name);

export function makeChampion(input: ChampionInput, companyId: string): BChampion {
  const level = input.level ?? 1;
  const stats = makeStats(input.class, level, input.stats);
  const epithet = input.epithet ?? input.traits?.map((t) => TRAITS[t]?.epithet).find(Boolean);
  const char: Character = {
    id: input.id ?? `${companyId}-hero`, name: input.name, epithet, class: input.class, level, xp: input.xp ?? 0, stats,
    traits: input.traits ?? [], spells: input.spells ?? [], status: 'active',
  };
  const hp = stats.vitality * CH.hpPerVitality;
  return {
    char, companyId, role: input.role, revealed: input.role === 'captain',
    trigger: input.role === 'hidden' ? (input.trigger ?? { type: 'morale', below: 40 }) : undefined,
    hp, maxHp: hp, duelsWon: 0,
  };
}

/** The champion currently fighting with this company, if any. */
export const liveChampion = (side: BSide, companyId: string): BChampion | undefined =>
  Object.values(side.champions).find((c) => c.companyId === companyId && !c.down);

export const hasTrait = (side: BSide, companyId: string, trait: string) =>
  !!liveChampion(side, companyId)?.char.traits.includes(trait);

const liveRevealed = (side: BSide) => Object.values(side.champions).filter((c) => c.revealed && !c.down);
export const championArcana = (side: BSide, companyId: string) => liveChampion(side, companyId)?.char.stats.arcana ?? 0;

/** Fear effects skip no-morale units and companies led by an Iron Will champion. */
export const immuneToFear = (side: BSide, c: BCompany) => !!c.unit.noMorale || hasTrait(side, c.id, 'ironWill');

export function reveal(b: Battle, s: SideKey, ch: BChampion, note: (t: string) => void) {
  ch.revealed = true;
  note(`${displayName(ch.char)} is revealed!`);
  const enemy = b[opp(s)];
  for (const id of enemy.lines.front) {
    const c = enemy.companies[id];
    if (!immuneToFear(enemy, c)) c.morale = clamp(c.morale + CH.reveal.fear);
  }
  for (const c of Object.values(b[s].companies)) {
    if (c.state === 'active' && !c.unit.noMorale) c.morale = clamp(c.morale + CH.reveal.surge);
  }
}

function checkReveals(ctx: RoundCtx) {
  const { b } = ctx;
  for (const s of SIDES) {
    for (const ch of Object.values(b[s].champions)) {
      if (ch.revealed || ch.down || !ch.trigger) continue;
      const c = b[s].companies[ch.companyId];
      if (c.state !== 'active') continue;
      const t = ch.trigger;
      const hit =
        t.type === 'morale' ? c.morale < t.below
        : t.type === 'enemyChampion' ? liveRevealed(b[opp(s)]).length > 0
        : t.type === 'time' ? b.day > t.day || (b.day === t.day && ctx.round >= t.round)
        : t.type === 'enemyReserve' ? b[opp(s)].reserveCommitted
        : false;
      if (hit) reveal(b, s, ch, ctx.moment);
    }
  }
}

export function downChampion(ctx: RoundCtx, s: SideKey, ch: BChampion, forceKilled = false) {
  const side = ctx.b[s];
  ch.hp = 0;
  const c = side.companies[ch.companyId];
  if (forceKilled || ctx.rng() < CH.downKilledChance) {
    ch.down = 'killed';
    ch.char.status = 'dead';
    c.previousChampionKilled = true;
    if (!c.unit.noMorale) c.morale = clamp(c.morale + CH.killedMorale);
    const killer = ch.lastHitBy && ctx.b[opp(s)].companies[ch.lastHitBy];
    if (killer) killer.killedChampion = true;
    ctx.moment(`${displayName(ch.char)} is slain`);
  } else {
    ch.down = 'wounded';
    ch.char.status = 'wounded';
    ctx.moment(`${displayName(ch.char)} is wounded and carried from the field`);
  }
}

/** Champions deal damage, and may duel. Runs as phase 5 of each round. */
export function championPhase(ctx: RoundCtx) {
  checkReveals(ctx);
  const { b } = ctx;
  const attacks: Atk[] = [];
  const hits: { ch: BChampion; by: BChampion; hp: number }[] = [];

  for (const s of SIDES) {
    const me = b[s], en = b[opp(s)];
    for (const ch of liveRevealed(me)) {
      const from = me.companies[ch.companyId];
      if (from.state !== 'active' || (from.suppressedRound === ctx.abs)) continue;
      const foes = liveRevealed(en).filter((e) => en.companies[e.companyId].state === 'active');
      let to: BCompany | undefined;
      if (ch.char.class === 'marksman' && foes.length) to = en.companies[foes[0].companyId];
      else {
        const i = me.lines.front.indexOf(from.id);
        to = (i >= 0 && en.companies[en.lines.front[i]]) || ctx.pick(me, en, ['front', 'flank', 'rear']);
      }
      if (!to) continue;
      const foe = liveChampion(en, to.id);
      const big = to.unit.size >= CH.giantslayer.sizeAtLeast || !!foe?.revealed;
      const combatant: Combatant = { unit: PSEUDO, men: ch.char.stats.might * CH.menPerMight, rank: 'trained', fatigue: 0 };
      attacks.push({
        from, fs: s, to, ts: opp(s), kind: 'melee', attacker: combatant,
        extra: ch.char.traits.includes('giantslayer') && big ? CH.giantslayer.mult : 1,
      });
      if (foe) hits.push({ ch: foe, by: ch, hp: ch.char.stats.might * CH.directHitHp });
    }
  }
  ctx.apply(attacks);
  for (const h of hits) {
    if (h.ch.down) continue;
    h.ch.lastHitBy = h.by.companyId;
    h.ch.hp -= h.hp;
  }

  duel(ctx);
}

/** A commanded side challenges when its best champion is at least as strong as theirs. */
function duel(ctx: RoundCtx) {
  const { b, rng } = ctx;
  const best = (s: SideKey) => liveRevealed(b[s]).filter((c) => b[s].companies[c.companyId].state === 'active')
    .sort((x, y) => y.char.stats.might + y.char.stats.vitality - (x.char.stats.might + x.char.stats.vitality))[0];
  const a = best('attacker'), d = best('defender');
  if (!a || !d || b.attacker.lastDuelDay === b.day) return;
  const score = (c: BChampion) => c.char.stats.might + c.char.stats.vitality;
  const challenger: SideKey | undefined =
    b.attacker.commander && score(a) >= score(d) ? 'attacker' : b.defender.commander && score(d) >= score(a) ? 'defender' : undefined;
  if (!challenger) return;
  b.attacker.lastDuelDay = b.defender.lastDuelDay = b.day;

  const roll = () => CH.duel.rollMin + Math.floor(rng() * (CH.duel.rollMax - CH.duel.rollMin + 1));
  let wa = 0, wd = 0, ta = 0, td = 0;
  for (let i = 0; i < CH.duel.exchanges; i++) {
    const sa = score(a) + roll(), sd = score(d) + roll();
    ta += sa; td += sd;
    if (sa > sd) wa++; else if (sd > sa) wd++;
  }
  const winner: SideKey = wa !== wd ? (wa > wd ? 'attacker' : 'defender') : ta >= td ? 'attacker' : 'defender';
  const [w, l] = winner === 'attacker' ? [a, d] : [d, a];
  ctx.moment(`Duel: ${displayName(w.char)} defeats ${displayName(l.char)}`);
  w.duelsWon++;
  for (const c of Object.values(b[winner].companies)) if (c.state === 'active' && !c.unit.noMorale) c.morale = clamp(c.morale + CH.duel.moraleSwing);
  for (const c of Object.values(b[opp(winner)].companies)) if (c.state === 'active' && !immuneToFear(b[opp(winner)], c)) c.morale = clamp(c.morale - CH.duel.moraleSwing);
  l.lastHitBy = w.companyId;
  downChampion(ctx, opp(winner), l, rng() < CH.duel.killedChance);
}

/** Champions share their company's pain; at 0 hp they fall. */
export function championExposure(ctx: RoundCtx) {
  for (const s of SIDES) {
    for (const ch of Object.values(ctx.b[s].champions)) {
      if (ch.down) continue;
      const a = ctx.acc[ctx.key(s, ctx.b[s].companies[ch.companyId])];
      if (a) ch.hp -= a.taken * CH.exposure;
      if (ch.hp <= 0) downChampion(ctx, s, ch);
    }
  }
}

/** Resolve aura for morale: Resolve ÷ 2 for companies with a revealed champion. */
export const resolveAura = (side: BSide, companyId: string) => {
  const ch = liveChampion(side, companyId);
  return ch?.revealed ? ch.char.stats.resolve / 2 : 0;
};

export function nightReveals(b: Battle) {
  for (const s of SIDES) for (const ch of Object.values(b[s].champions)) {
    if (!ch.revealed && !ch.down && ch.trigger?.type === 'manual') {
      reveal(b, s, ch, (t) => b.report.moments.push({ day: b.day, round: 0, text: t }));
    }
  }
}

function levelUp(ch: Character) {
  const main = CLASSES[ch.class].main;
  while (ch.level < 20 && ch.xp >= CH.levelXp * ch.level) {
    ch.xp -= CH.levelXp * ch.level;
    ch.level++;
    ch.stats[main] += CH.statPointsPerLevel;
  }
}

/** After the battle: XP, captures, and champions rising from surviving companies. */
export function finishChampions(b: Battle, loser?: SideKey) {
  const res = b.result!;
  const rng = createRng(hashSeed(b.seed, 'champions'));

  for (const s of SIDES) {
    for (const ch of Object.values(b[s].champions)) {
      const c = b[s].companies[ch.companyId];
      let outcome: 'fine' | 'wounded' | 'captured' | 'dead' = 'fine';
      if (ch.down === 'killed') outcome = 'dead';
      else if (ch.down === 'wounded') outcome = s === loser && rng() < CH.downCapturedChance ? 'captured' : 'wounded';
      ch.char.status = outcome === 'fine' ? 'active' : outcome;
      let xp = 0;
      if (outcome !== 'dead') {
        xp = CH.xp.survive + c.daysFought * CH.xp.day + Math.floor(c.kills / CH.xp.killsPer) + c.routsCaused * CH.xp.rout + ch.duelsWon * CH.xp.duel;
        xp = Math.round(xp * b[s].xpMult);
        ch.char.xp += xp;
        levelUp(ch.char);
      }
      res.champions.push({ side: s, companyId: ch.companyId, character: structuredClone(ch.char), outcome, xpGained: xp });
    }
  }

  const start = (s: SideKey) => Object.values(b[s].companies).reduce((t, c) => t + c.startMen, 0);
  const used = new Set(res.champions.map((c) => c.character.name));
  for (const s of SIDES) {
    const side = b[s];
    for (const c of Object.values(side.companies)) {
      if (c.state === 'destroyed') continue;
      const own = Object.values(side.champions).filter((h) => h.companyId === c.id);
      if (own.some((h) => !h.down)) continue; // one champion at a time
      const R = CH.rising;
      const outnumbered = start(opp(s)) >= R.outnumberedRatio * start(s);
      const flags: Record<string, boolean> = {
        heldLine: c.heldLine, killedChampion: c.killedChampion, ambush: false, outnumbered,
        causedRout: c.routsCaused > 0, siege: b.siege, heavyMagic: c.spellCasualties >= CH.heavyMagicShare * c.startMen,
      };
      const chance =
        R.base + (c.rank === 'veteran' ? R.veteran : c.rank === 'elite' ? R.elite : 0) +
        (outnumbered ? R.outnumbered : 0) + (flags.causedRout ? R.causedRout : 0) + (c.heldLine ? R.heldLine : 0) +
        (c.killedChampion ? R.killedChampion : 0) + c.glory * R.glory + side.risingBonus +
        (c.previousChampionKilled || own.some((h) => h.down === 'killed') ? R.previousKilled : 0);
      if (rng() >= chance) continue;

      const cls = CLASS_BY_UNIT[c.unitId] ?? 'folkHero';
      const moment = CH.traitMoments.find((m) => flags[m]);
      const trait = moment && Object.keys(TRAITS).find((t) => TRAITS[t].moment === moment);
      const stats = makeStats(cls);
      const spells: string[] = [];
      if ((cls !== 'archmage' && cls !== 'saint') && rng() < R.awakeningChance) {
        stats.arcana += R.awakeningArcana;
        const pool = Object.entries(SPELLS).filter(([, sp]) => !sp.inert && side.affinity.includes(sp.school)).map(([id]) => id);
        if (pool.length) spells.push(pickOne(rng, pool));
      }
      const free = CH.names.filter((n) => !used.has(n));
      const name = free.length ? pickOne(rng, free) : `Hero ${used.size + 1}`;
      used.add(name);
      res.risen.push({
        side: s, companyId: c.id,
        character: {
          id: `${c.id}-hero`, name, epithet: trait ? TRAITS[trait].epithet : undefined, class: cls, level: 1, xp: 0,
          stats, traits: trait ? [trait] : [], spells, status: 'active',
        },
      });
    }
  }
}
