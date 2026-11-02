import { between, createRng, hashSeed, pickOne, stochRound, type Rng } from '../core/rng';
import { championExposure, championPhase, finishChampions, hasTrait, nightReveals, resolveAura } from './champions';
import { opp, SIDES, type Acc, type Atk, type RoundCtx } from './ctx';
import { damage, type Combatant } from './damage';
import { B, CH, TERRAINS, UNITS } from './data';
import { pursue } from './pursuit';
import { snapshot } from './setupBattle';
import { castSpells } from './spells';
import type { BCompany, BSide, Battle, SideKey, SideSummary, Slot } from './types';

const ENGAGED: Slot[] = ['front', 'flank', 'rear', 'air'];
const unit = (c: BCompany) => c.unit;
const stanceOf = (s: BSide) => (s.commander ? s.stance : 'hold');
const lane = (s: BSide, slot: Slot) => s.lines[slot].map((id) => s.companies[id]);
const engaged = (s: BSide) => ENGAGED.flatMap((slot) => lane(s, slot));
const comb = (c: BCompany): Combatant => ({ unit: unit(c), men: c.men, rank: c.rank, fatigue: c.fatigue });
const clamp = (x: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, x));

export function resolveBattleDay(prev: Battle): Battle {
  if (prev.result) return prev;
  const b = structuredClone(prev);
  // A withdrawal ordered during the night takes effect before anyone fights.
  const leaving = SIDES.filter((s) => b[s].withdraw);
  if (leaving.length) {
    b.report.moments.push({ day: b.day, round: 0, text: leaving.map((s) => `${b[s].name} withdraws`).join('; ') });
    return finalize(b, leaving.length === 2 ? 'draw' : 'victory', leaving.length === 2 ? undefined : opp(leaving[0]), true), b;
  }
  b.day += 1;
  for (const s of SIDES) for (const c of Object.values(b[s].companies)) if (c.state === 'active') c.daysFought++;
  const rng = createRng(hashSeed(b.seed, b.day));
  for (let r = 1; r <= B.roundsPerDay; r++) resolveRound(b, r, rng);
  endDay(b);
  return b;
}

function resolveRound(b: Battle, round: number, rng: Rng) {
  const base = TERRAINS[b.terrain];
  const terrain = { ...base, defense: base.defense + b.defenseBonus };
  const log = { day: b.day, round, events: [] as string[], losses: { attacker: {}, defender: {} } as Battle['report']['rounds'][number]['losses'] };
  b.report.rounds.push(log);
  const abs = (b.day - 1) * B.roundsPerDay + round;
  const moment = (text: string) => { b.report.moments.push({ day: b.day, round, text }); log.events.push(text); };
  for (const s of SIDES) b[s].buff = { rangedMult: 1, deflected: false };

  const acc: Record<string, Acc> = {};
  const key = (s: SideKey, c: BCompany) => `${s}:${c.id}`;
  for (const s of SIDES) for (const c of engaged(b[s])) acc[key(s, c)] = { start: c.men, taken: 0, dealt: 0, flanked: false, charged: false };

  function cull() {
    for (const s of SIDES) {
      for (const c of Object.values(b[s].companies)) {
        if (c.state === 'active' && c.men <= 0) {
          c.state = 'destroyed';
          const arr = b[s].lines[c.slot];
          arr.splice(arr.indexOf(c.id), 1);
          log.events.push(`${c.name} is destroyed`);
        }
      }
    }
  }

  function inflict(s: SideKey, c: BCompany, dmg: number, from?: BCompany, spell = false): number {
    const n = Math.min(c.men, stochRound(rng, dmg));
    if (!n) return 0;
    const dead = Math.min(n, stochRound(rng, n * B.casualties.dead));
    c.men -= n;
    c.dead += dead;
    c.wounded += n - dead;
    c.dayWounded += n - dead;
    if (spell) c.spellCasualties += n;
    if (from) from.kills += n;
    const k = key(s, c);
    if (acc[k]) acc[k].taken += n;
    log.losses[s][c.id] = (log.losses[s][c.id] ?? 0) + n;
    if (from) for (const ch of Object.values(b[s].champions)) if (ch.companyId === c.id) ch.lastHitBy = from.id;
    return n;
  }

  function apply(attacks: Atk[]) {
    const totals = new Map<string, { s: SideKey; c: BCompany; dmg: number; from: BCompany }>();
    const drained = new Set<string>();
    for (const a of attacks) {
      if (a.from.men <= 0 || a.from.state !== 'active') continue;
      const stalwart = hasTrait(b[a.ts], a.to.id, 'stalwart') ? 1 / CH.stalwartDefMult : 1;
      const d = damage({
        attacker: a.attacker ?? comb(a.from), target: comb(a.to), kind: a.kind, terrain,
        attackerIsDefender: a.fs === 'defender', attackerCohesion: b[a.fs].cohesion,
        attackerStance: stanceOf(b[a.fs]), targetStance: stanceOf(b[a.ts]),
        flanked: a.flanked, extra: (a.extra ?? 1) * stalwart, roll: between(rng, B.random.min, B.random.max),
      });
      const k = key(a.ts, a.to);
      const t = totals.get(k) ?? { s: a.ts, c: a.to, dmg: 0, from: a.from };
      t.dmg += d;
      totals.set(k, t);
      const ak = acc[key(a.fs, a.from)];
      if (ak) ak.dealt += d;
      // Anti-magic units drain 20 enemy battle mana per round when they hit magic units.
      if (!a.attacker && unit(a.from).tags.includes('antimagic') && unit(a.to).tags.includes('magic') && !drained.has(a.from.id)) {
        drained.add(a.from.id);
        b[a.ts].mana = Math.max(0, b[a.ts].mana - B.manaDrain);
      }
    }
    for (const { s, c, dmg, from } of totals.values()) inflict(s, c, dmg, from);
    cull();
  }

  /** Target selection: commanded armies focus the weakest, leaderless pick at random. */
  function pick(seeker: BSide, enemy: BSide, pool: Slot[], withAir = false): BCompany | undefined {
    let cands: BCompany[] = [];
    for (const slot of pool) {
      cands = lane(enemy, slot);
      if (cands.length) break;
    }
    if (withAir) cands = [...cands, ...lane(enemy, 'air')];
    if (!cands.length) return undefined;
    if (seeker.commander) return cands.reduce((m, c) => (c.men * unit(c).size < m.men * unit(m).size ? c : m));
    return pickOne(rng, cands);
  }

  const ctx: RoundCtx = { b, rng, round, abs, log, acc, key, apply, inflict, pick, moment, cull };
  const able = (c: BCompany) => c.suppressedRound !== abs;
  const endOf = (enemy: BSide, i: number) => {
    const f = lane(enemy, 'front');
    return f.length ? f[i === 0 ? 0 : f.length - 1] : undefined;
  };
  const lowIntegrity = (s: BSide) => s.integrity < B.integrity.low;

  // 1. Spells
  castSpells(ctx);

  // 2. Ranged
  {
    const attacks: Atk[] = [];
    for (const s of SIDES) {
      const me = b[s], en = b[opp(s)];
      if (en.buff.deflected) continue;
      for (const c of lane(me, 'rear')) {
        if (!unit(c).rangedAtk || !able(c)) continue;
        let to: BCompany | undefined;
        const foes = Object.values(en.champions).filter((h) => h.revealed && !h.down && en.companies[h.companyId].state === 'active');
        if (hasChampionClass(me, c.id, 'marksman') && foes.length) to = en.companies[foes[0].companyId];
        else to = pick(me, en, lowIntegrity(en) ? ['rear', 'front', 'flank'] : ['front', 'flank', 'rear'], true);
        if (to) attacks.push({ from: c, fs: s, to, ts: opp(s), kind: 'ranged', extra: me.buff.rangedMult });
      }
    }
    apply(attacks);
  }

  // 3. Charge (first round of each day only)
  if (round === 1) {
    const attacks: Atk[] = [];
    const unmet = new Set<SideKey>();
    for (const s of SIDES) {
      const me = b[s], en = b[opp(s)];
      lane(me, 'flank').forEach((c, i) => {
        if (!able(c)) return;
        const enFlank = lane(en, 'flank')[i];
        const to =
          enFlank ?? (lowIntegrity(en) ? pick(me, en, ['rear', 'front']) : endOf(en, i)) ?? pick(me, en, ['rear', 'flank']);
        if (!to) return;
        attacks.push({ from: c, fs: s, to, ts: opp(s), kind: 'charge' });
        acc[key(opp(s), to)].charged = true;
        if (!enFlank) en.cohesion = Math.max(0, en.cohesion + B.cohesion.charge);
        if (!lane(en, 'front').some((f) => unit(f).tags.includes('polearm'))) unmet.add(opp(s));
      });
    }
    for (const s of unmet) b[s].integrity = Math.max(0, b[s].integrity + B.integrity.unmetCharge);
    apply(attacks);
  }

  // 4. Melee
  {
    const planned: { from: BCompany; fs: SideKey; to: BCompany; ts: SideKey }[] = [];
    const flagged = new Set<string>();
    const overlapped = new Set<SideKey>();
    for (const s of SIDES) {
      const me = b[s], en = b[opp(s)], es = opp(s);
      const mine = lane(me, 'front'), theirs = lane(en, 'front');
      mine.forEach((c, i) => {
        if (!able(c)) return;
        let to: BCompany | undefined;
        if (i < theirs.length) to = theirs[i];
        else if (theirs.length) {
          to = (i - theirs.length) % 2 === 0 ? theirs[theirs.length - 1] : theirs[0];
          flagged.add(key(es, to));
          overlapped.add(es);
        } else to = pick(me, en, ['flank', 'rear']);
        if (to) planned.push({ from: c, fs: s, to, ts: es });
      });
      lane(me, 'flank').forEach((c, i) => {
        if (!able(c)) return;
        const to = lane(en, 'flank')[i] ?? endOf(en, i) ?? pick(me, en, ['rear']);
        if (to) planned.push({ from: c, fs: s, to, ts: es });
      });
      for (const c of lane(me, 'air')) {
        if (!able(c)) continue;
        const to = pick(me, en, ['rear', 'front', 'flank']);
        if (to) planned.push({ from: c, fs: s, to, ts: es });
      }
    }
    for (const s of overlapped) b[s].integrity = Math.max(0, b[s].integrity + B.integrity.overlap);
    for (const k of flagged) acc[k].flanked = true;
    apply(planned.map((p) => ({ ...p, kind: 'melee' as const, flanked: flagged.has(key(p.ts, p.to)) })));
  }

  // 5. Champions: reveals, damage, duels
  championPhase(ctx);
  championExposure(ctx);

  // 6. Morale and routs
  {
    const M = B.morale;
    for (const s of SIDES) {
      for (const c of engaged(b[s])) {
        const u = unit(c);
        if (u.noMorale) continue;
        const a = acc[key(s, c)];
        const disc = u.discipline + B.rank[c.rank].disc;
        let d = -((a.taken / a.start) * 100 * M.lossFactor) * (M.discBase / disc);
        if (a.flanked) d += M.flanked;
        if (a.charged) d += M.charged;
        if (a.dealt > M.laneWinRatio * a.taken && a.dealt > 0) d += M.laneWin;
        if (b[s].commander) d += M.commander;
        if (c.fatigue > M.highFatigue) d += M.highFatigueHit;
        d += resolveAura(b[s], c.id);
        c.morale = clamp(c.morale + d);
      }
    }
    let routs = 0;
    const held = new Set<string>();
    for (;;) {
      // Unbreakable champions keep their company in the line.
      for (const s of SIDES) for (const c of engaged(b[s])) if (hasTrait(b[s], c.id, 'unbreakable')) c.morale = Math.max(c.morale, M.routAt + 1);
      const broken = SIDES.flatMap((s) => engaged(b[s]).filter((c) => !unit(c).noMorale && c.morale <= M.routAt).map((c) => ({ s, c })));
      if (!broken.length) break;
      for (const { s, c } of broken) {
        const side = b[s];
        const arr = side.lines[c.slot];
        const idx = arr.indexOf(c.id);
        if (c.slot === 'front') {
          const foe = b[opp(s)].lines.front[idx];
          if (foe) b[opp(s)].companies[foe].routsCaused++;
        }
        arr.splice(idx, 1);
        c.state = 'routed';
        side.cohesion = Math.max(0, side.cohesion + B.cohesion.routPenalty);
        routs++;
        moment(`${c.name} (${side.name}) routs`);
        if (c.slot === 'front') {
          side.integrity = Math.max(0, side.integrity + B.integrity.frontRout);
          const pen = side.commander ? M.neighborRout : M.neighborRoutLeaderless;
          for (const n of [arr[idx - 1], arr[idx]]) {
            const nc = n && side.companies[n];
            if (nc && !unit(nc).noMorale) { nc.morale = clamp(nc.morale + pen); held.add(`${s}:${nc.id}`); }
          }
        }
      }
    }
    for (const k of held) {
      const [s, id] = k.split(':') as [SideKey, string];
      if (b[s].companies[id].state === 'active') b[s].companies[id].heldLine = true;
    }
    if (routs >= 3) moment(`Rout cascade: ${routs} companies break in one round`);
  }

  // 7. Reserves
  for (const s of SIDES) {
    const side = b[s];
    const frontage = terrain.frontage;
    const freshReserve = () => lane(side, 'reserve').find((c) => !c.spent && unit(c).tags.includes('infantry'));
    if (side.commander) {
      for (const f of lane(side, 'front')) {
        if (f.morale >= B.reserve.swapMorale && f.men >= f.startMen * B.reserve.swapStrength) continue;
        const r = freshReserve();
        if (!r) break;
        side.lines.front[side.lines.front.indexOf(f.id)] = r.id;
        side.lines.reserve[side.lines.reserve.indexOf(r.id)] = f.id;
        r.slot = 'front'; f.slot = 'reserve'; f.spent = true;
        side.reserveCommitted = true;
        log.events.push(`${side.name} swaps ${f.name} for ${r.name}`);
      }
    }
    while (side.lines.front.length < frontage) {
      const r = freshReserve();
      if (!r) break;
      side.lines.reserve.splice(side.lines.reserve.indexOf(r.id), 1);
      side.lines.front.push(r.id);
      r.slot = 'front';
      side.reserveCommitted = true;
      log.events.push(`${r.name} fills the line for ${side.name}`);
    }
  }

  // Fatigue
  for (const s of SIDES) {
    for (const c of engaged(b[s])) {
      const u = unit(c);
      c.fatigue = Math.min(
        B.fatigue.max,
        c.fatigue + B.stance[stanceOf(b[s])].fatigue + (u.armor >= B.fatigue.heavyArmorAt ? B.fatigue.heavyArmor : 0) + terrain.fatigue,
      );
    }
  }
}

const hasChampionClass = (side: BSide, companyId: string, cls: string) =>
  Object.values(side.champions).some((h) => h.companyId === companyId && !h.down && h.char.class === cls);

function endDay(b: Battle) {
  const active = (s: SideKey) => Object.values(b[s].companies).some((c) => c.state === 'active');
  const alive = SIDES.filter(active);
  const retreating = SIDES.filter((s) => b[s].commander && b[s].stance === 'fightingRetreat');
  b.report.days.push(snapshot(b));

  if (alive.length === 0) return finalize(b, 'draw');
  if (alive.length === 1) return finalize(b, 'decisive', alive[0]);
  if (retreating.length === 2) return finalize(b, 'draw');
  if (retreating.length === 1) return finalize(b, 'victory', opp(retreating[0]), true);
  if (b.day >= B.attackerDayLimit && !b.siege) return finalize(b, 'victory', 'defender', true);

  // Night
  nightReveals(b);
  const notes: string[] = [];
  for (const s of SIDES) {
    const side = b[s];
    const healers = engaged(side).some((c) => unit(c).tags.includes('support'));
    let healed = 0;
    for (const c of Object.values(side.companies)) {
      if (c.state !== 'active') continue;
      c.fatigue = Math.max(0, c.fatigue + B.fatigue.night);
      if (side.commander && !unit(c).noMorale) c.morale = clamp(c.morale + B.morale.nightBase + side.commander.leadership);
      if (healers) {
        const back = Math.min(c.wounded, Math.round(c.dayWounded * B.healShare));
        c.men += back; c.wounded -= back; healed += back;
      }
      c.dayWounded = 0;
    }
    side.mana = Math.min(side.maxMana, side.mana + Math.round(side.maxMana * B.manaRegenShare));
    notes.push(`${side.name}: fatigue ${B.fatigue.night}${side.commander ? `, morale +${B.morale.nightBase + side.commander.leadership}` : ', no morale recovery (leaderless)'}${healed ? `, ${healed} wounded return` : ''}${side.maxMana ? `, mana ${side.mana}/${side.maxMana}` : ''}`);
  }
  b.report.nights.push({ day: b.day, text: notes.join(' | ') });
}

function finalize(b: Battle, outcome: 'decisive' | 'victory' | 'draw', winner?: SideKey, withdrawn = false) {
  const sum = (s: SideKey, f: (c: BCompany) => number, st?: BCompany['state']) =>
    Object.values(b[s].companies).filter((c) => !st || c.state === st).reduce((t, c) => t + f(c), 0);
  const summary = {} as Record<SideKey, SideSummary>;
  let pyrrhic = false;
  const pursuit = { killed: 0, captured: 0, woundedCaptured: 0 };

  for (const s of SIDES) {
    const start = sum(s, (c) => c.startMen);
    const dead = sum(s, (c) => c.dead), wounded = sum(s, (c) => c.wounded);
    const routed = sum(s, (c) => c.men, 'routed'), act = sum(s, (c) => c.men, 'active');
    if (outcome === 'draw' || s === winner) {
      summary[s] = { start, dead, wounded, captured: 0, escaped: routed, standing: act };
      if (s === winner) pyrrhic = (dead + wounded) / start > B.pyrrhicLoss;
      continue;
    }
    const fleeing = routed + (withdrawn ? act : 0);
    const win = opp(s);
    const { killed, captured } = pursue({
      pursuers: Object.values(b[win].companies)
        .filter((c) => c.state === 'active')
        .map(unit),
      fleeing, leaderless: !b[s].commander, withdrawing: withdrawn,
    });
    const healers = Object.values(b[s].companies).some((c) => c.state === 'active' && unit(c).tags.includes('support'));
    const keepFrac = (b[s].commander ? B.carryShare.commander : 0) + (healers ? B.carryShare.healers : 0);
    const capturedWounded = Math.round(wounded * (1 - keepFrac));
    Object.assign(pursuit, { killed, captured, woundedCaptured: capturedWounded });
    summary[s] = {
      start, dead: dead + killed, wounded: wounded - capturedWounded, captured: capturedWounded + captured,
      escaped: fleeing - killed - captured, standing: 0,
    };
  }
  b.result = { outcome, winner, pyrrhic, withdrawn, pursuit, summary, risen: [], champions: [] };
  finishChampions(b, winner && opp(winner));
}
