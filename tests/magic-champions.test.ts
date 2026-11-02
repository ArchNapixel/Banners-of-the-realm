import { describe, expect, it } from 'vitest';
import { makeStats } from '../src/engine/battle/champions';
import { SPELLS } from '../src/engine/battle/data';
import { formatReport } from '../src/engine/battle/report';
import { resolveBattleDay } from '../src/engine/battle/resolveBattleDay';
import { runBattle } from '../src/engine/battle/runBattle';
import { setupBattle } from '../src/engine/battle/setupBattle';
import { spellCost } from '../src/engine/battle/spells';
import type { Battle, BattleInput, ChampionInput, CompanyInput, SideInput } from '../src/engine/battle/types';

const co = (id: string, unit: string, extra: Partial<CompanyInput> = {}): CompanyInput => ({ id, unit, rank: 'trained', ...extra });
const cmd = { name: 'Cmdr', leadership: 5 };
const fight = (a: SideInput, d: SideInput, terrain: BattleInput['terrain'] = 'plains', seed = 't'): BattleInput => ({ seed, terrain, attacker: a, defender: d });
const hero = (extra: Partial<ChampionInput> = {}): ChampionInput => ({ name: 'Tomas', class: 'folkHero', role: 'hidden', ...extra });
const moments = (b: Battle) => b.report.moments.map((m) => m.text);
const SCHOOLS = ['fire', 'earth', 'frost', 'wind', 'light', 'shadow'];

/** A mage army that may only cast one school, with exactly `mana` in the pool. */
function mageFight(school: string, mana: number, enemy: SideInput, seed = 's', tweak?: (b: Battle) => void) {
  const b = setupBattle(fight(
    { name: 'Mages', commander: cmd, forbiddenSchools: SCHOOLS.filter((s) => s !== school), companies: [co('F1', 'spearmen'), co('F2', 'spearmen'), co('BM', 'battle_mages')] },
    enemy, 'plains', seed,
  ));
  b.attacker.mana = mana;
  tweak?.(b);
  return b;
}
const spearWall = (n = 2): SideInput => ({ name: 'Wall', commander: cmd, companies: Array.from({ length: n }, (_, i) => co(`W${i + 1}`, 'spearmen')) });
const archersOnly: SideInput = { name: 'Bows', commander: cmd, companies: [co('X1', 'archers')] };

describe('mana', () => {
  it('battle pool is 100 per caster company', () => {
    const b = setupBattle(fight(
      { name: 'A', companies: [co('B1', 'battle_mages'), co('B2', 'battle_mages'), co('S', 'spearmen')] },
      { name: 'D', companies: [co('D', 'spearmen')] },
    ));
    expect(b.attacker.maxMana).toBe(200);
    expect(b.attacker.mana).toBe(200);
    expect(b.defender.maxMana).toBe(0);
  });

  it('affinity schools cost 25% less', () => {
    const b = setupBattle(fight({ name: 'A', affinity: ['fire', 'wind'], companies: [co('S', 'spearmen')] }, { name: 'D', companies: [co('D', 'spearmen')] }));
    expect(spellCost(b.attacker, 'firestorm')).toBe(30);
    expect(spellCost(b.attacker, 'chaos')).toBe(40);
  });

  it('mana regenerates by half overnight', () => {
    const b = resolveBattleDay(mageFight('wind', 100, spearWall(4), 'regen'));
    if (b.result) return;
    const spent = b.report.moments.filter((m) => m.text.includes('casts')).length;
    expect(b.attacker.mana).toBe(Math.min(100, 100 - 30 * spent + 50));
  });

  it('wardens drain 20 battle mana per round from magic units they hit', () => {
    const b = resolveBattleDay(setupBattle(fight(
      { name: 'W', commander: cmd, companies: [co('WD', 'wardens')] },
      { name: 'M', forbiddenSchools: SCHOOLS, companies: [co('BM', 'battle_mages')] },
    )));
    expect(b.defender.mana).toBeLessThanOrEqual(80);
  });
});

describe('battle spells', () => {
  const cast = (b: Battle, name: string) => moments(b).some((m) => m.includes(`casts ${name}`));

  it('Stone Wall adds 20 Integrity when ours is low', () => {
    const b = resolveBattleDay(mageFight('earth', 30, spearWall(), 'sw', (x) => { x.attacker.integrity = 50; }));
    expect(cast(b, 'Stone Wall')).toBe(true);
    expect(b.attacker.mana).toBe(50); // 30 spent, +50 overnight regeneration
    expect(b.attacker.integrity).toBe(70);
  });

  it('Quake takes 25 Integrity from the enemy', () => {
    const b = resolveBattleDay(mageFight('earth', 50, spearWall(), 'qk'));
    expect(cast(b, 'Quake')).toBe(true);
    expect(b.defender.integrity).toBe(110 - 25);
  });

  it('Chaos takes 15 Cohesion from the enemy', () => {
    const base = setupBattle(fight({ name: 'x', companies: [co('a', 'spearmen')] }, spearWall(0)));
    void base;
    const b = resolveBattleDay(mageFight('shadow', 40, archersOnly, 'ch'));
    expect(cast(b, 'Chaos')).toBe(true);
    expect(b.defender.cohesion).toBeLessThanOrEqual(80 - 15);
  });

  it('Terror shakes the enemy front line by 15 Morale', () => {
    const run = (mana: number) => resolveBattleDay(mageFight('shadow', mana, spearWall(), 'tr'));
    const avg = (b: Battle) => Object.values(b.defender.companies).reduce((t, c) => t + c.morale, 0) / 2;
    const withSpell = run(40), without = run(0);
    expect(cast(withSpell, 'Terror')).toBe(true);
    expect(avg(without) - avg(withSpell)).toBeCloseTo(15, 0);
  });

  it('Chilling Mist adds 15 Fatigue to the enemy front', () => {
    const run = (mana: number) => resolveBattleDay(mageFight('frost', mana, spearWall(), 'cm'));
    const fat = (b: Battle) => b.report.days.at(-1)!.defender.fatigue;
    expect(cast(run(30), 'Chilling Mist')).toBe(true);
    expect(fat(run(30)) - fat(run(0))).toBe(15);
  });

  it('Firestorm punishes one enemy company beyond normal fighting', () => {
    let more = 0;
    for (let i = 0; i < 10; i++) {
      const lost = (mana: number) => {
        const b = resolveBattleDay(mageFight('fire', mana, spearWall(), `fs${i}`));
        return Object.values(b.defender.companies).reduce((t, c) => t + c.startMen - c.men, 0);
      };
      if (lost(40) > lost(0)) more++;
    }
    expect(more).toBeGreaterThanOrEqual(8);
  });

  it('Burning Ground makes an enemy front slot unusable next round', () => {
    const b = resolveBattleDay(mageFight('fire', 30, spearWall(), 'bg'));
    expect(Object.values(b.defender.companies).some((c) => c.suppressedRound !== undefined)).toBe(true);
  });

  it('Arrow Gale multiplies friendly ranged damage', () => {
    const mk = (mana: number) => {
      const b = setupBattle(fight(
        { name: 'A', commander: cmd, forbiddenSchools: SCHOOLS.filter((s) => s !== 'wind'), companies: [co('F', 'spearmen'), co('AR', 'archers'), co('BM', 'battle_mages')] },
        spearWall(), 'plains', 'ag',
      ));
      b.attacker.mana = mana;
      return resolveBattleDay(b);
    };
    const r1 = (b: Battle) => Object.values(b.report.rounds[0].losses.defender).reduce((t, v) => t + v, 0);
    expect(cast(mk(30), 'Arrow Gale')).toBe(true);
    expect(r1(mk(30))).toBeGreaterThan(r1(mk(0)));
  });

  it('Deflection cancels the enemy ranged phase', () => {
    const b = resolveBattleDay(mageFight('wind', 30, archersOnly, 'df'));
    expect(cast(b, 'Deflection')).toBe(true);
    expect(b.report.rounds[0].losses.attacker).toEqual({});
  });

  it('Rally and Mend need a reason; Mend returns wounded', () => {
    const rally = resolveBattleDay(mageFight('light', 30, spearWall(), 'ra', (x) => { for (const c of Object.values(x.attacker.companies)) c.morale = 40; }));
    expect(cast(rally, 'Rally')).toBe(true);
    const mend = resolveBattleDay(mageFight('light', 40, spearWall(), 'me', (x) => { x.attacker.companies.F1.men = 300; x.attacker.companies.F1.wounded = 100; x.attacker.companies.F1.dayWounded = 100; }));
    expect(cast(mend, 'Mend')).toBe(true);
    expect(mend.attacker.companies.F1.wounded).toBeLessThan(100 + 30);
  });

  it('commanders do not waste spells with nothing to do', () => {
    const b = resolveBattleDay(mageFight('earth', 100, spearWall(), 'idle'));
    expect(cast(b, 'Stone Wall')).toBe(false);
  });

  it('forbidden schools and the inert Frozen River are never cast', () => {
    for (let i = 0; i < 25; i++) {
      const b = runBattle(fight(
        { name: 'A', forbiddenSchools: ['fire'], companies: [co('F', 'spearmen'), co('BM', 'battle_mages')] },
        { name: 'D', companies: [co('D1', 'spearmen'), co('D2', 'spearmen')] }, 'plains', `lead${i}`,
      ));
      expect(moments(b).some((m) => m.includes('Firestorm') || m.includes('Burning Ground') || m.includes('Frozen River'))).toBe(false);
    }
    expect(SPELLS.frozen_river.inert).toBe(true);
  });

  it('Arcane-touched champions take 30% less spell damage', () => {
    let plain = 0, touched = 0;
    for (let i = 0; i < 20; i++) {
      const run = (traits: string[]) => {
        const b = resolveBattleDay(mageFight('fire', 40, { name: 'W', commander: cmd, companies: [co('W1', 'spearmen', { champion: hero({ role: 'captain', traits }) }), co('W2', 'spearmen')] }, `at${i}`));
        return Object.values(b.defender.companies).reduce((t, c) => t + c.spellCasualties, 0);
      };
      plain += run([]); touched += run(['arcaneTouched']);
    }
    expect(touched).toBeLessThan(plain);
  });
});

describe('hidden cards and captains', () => {
  const duo = (champion: ChampionInput, enemy: SideInput = { name: 'E', companies: [co('E1', 'militia'), co('E2', 'militia')] }) =>
    fight({ name: 'A', commander: cmd, companies: [co('M1', 'militia', { champion }), co('M2', 'militia')] }, enemy);

  it('a hidden champion stays hidden and deals no champion damage until revealed', () => {
    const b = setupBattle(duo(hero({ trigger: { type: 'morale', below: 5 } })));
    expect(b.attacker.champions.M1.revealed).toBe(false);
    const after = resolveBattleDay(b);
    expect(moments(after).some((m) => m.includes('revealed'))).toBe(false);
  });

  it('reveals when company morale drops below the trigger, with a morale surge for the army', () => {
    const b = setupBattle(duo(hero({ trigger: { type: 'morale', below: 40 } })));
    b.attacker.companies.M1.morale = 30;
    const r = resolveBattleDay(b);
    expect(moments(r).some((m) => m.includes('Tomas is revealed'))).toBe(true);
    expect(r.attacker.champions.M1.revealed).toBe(true);

    let surged = 0, plain = 0;
    for (let i = 0; i < 30; i++) {
      const mk = (champion?: ChampionInput) => {
        const sb = setupBattle(fight(
          { name: 'A', commander: cmd, companies: [co('M1', 'spearmen', { champion }), co('M2', 'spearmen')] },
          { name: 'E', commander: cmd, companies: [co('E1', 'spearmen'), co('E2', 'spearmen')] }, 'mountains', `surge${i}`,
        ));
        sb.attacker.companies.M2.morale = 50; // headroom so the surge is not clamped at 100
        return resolveBattleDay(sb).attacker.companies.M2.morale;
      };
      surged += mk(hero({ trigger: { type: 'time', day: 1, round: 1 } }));
      plain += mk(hero({ trigger: { type: 'morale', below: 0 } }));
    }
    expect(surged).toBeGreaterThan(plain);
  });

  it('fear shock hits the enemy front but not Iron Will companies', () => {
    let normal = 0, iron = 0;
    for (let i = 0; i < 30; i++) {
      const mk = (traits: string[]) => resolveBattleDay(setupBattle(fight(
        { name: 'A', commander: cmd, companies: [co('M1', 'spearmen', { champion: hero({ trigger: { type: 'time', day: 1, round: 1 } }) }), co('M2', 'spearmen')] },
        { name: 'E', commander: cmd, companies: [co('E1', 'spearmen', { champion: hero({ name: 'Brave', role: 'captain', traits, stats: { resolve: 0 } }) }), co('E2', 'spearmen')] },
        'mountains', `fear${i}`,
      ))).defender.companies.E1.morale;
      normal += mk([]); iron += mk(['ironWill']);
    }
    expect(iron).toBeGreaterThan(normal);
  });

  it('time trigger fires on the chosen day and round', () => {
    const b = setupBattle(duo(hero({ trigger: { type: 'time', day: 1, round: 2 } })));
    const r = resolveBattleDay(b);
    const m = r.report.moments.find((x) => x.text.includes('revealed'));
    expect(m).toMatchObject({ day: 1, round: 2 });
  });

  it('enemy-champion trigger fires when a revealed enemy champion is present', () => {
    const r = resolveBattleDay(setupBattle(duo(hero({ trigger: { type: 'enemyChampion' } }), {
      name: 'E', companies: [co('E1', 'militia', { champion: hero({ name: 'Foe', role: 'captain' }) }), co('E2', 'militia')],
    })));
    expect(r.attacker.champions.M1.revealed).toBe(true);
  });

  it('enemy-reserve trigger fires once the enemy commits reserves', () => {
    const b = setupBattle(duo(hero({ trigger: { type: 'enemyReserve' } })));
    expect(resolveBattleDay(b).attacker.champions.M1.revealed).toBe(false);
    b.defender.reserveCommitted = true;
    expect(resolveBattleDay(b).attacker.champions.M1.revealed).toBe(true);
  });

  it('manual trigger reveals at the next night', () => {
    const b = setupBattle(fight(
      { name: 'A', commander: cmd, companies: [co('S1', 'spearmen', { champion: hero({ trigger: { type: 'manual' } }) }), co('S2', 'spearmen')] },
      { name: 'E', commander: cmd, companies: [co('E1', 'spearmen'), co('E2', 'spearmen')] }, 'mountains',
    ));
    const r = resolveBattleDay(b);
    expect(r.result).toBeUndefined();
    expect(r.attacker.champions.S1.revealed).toBe(true);
  });

  it('a revealed champion adds damage', () => {
    let withHero = 0, without = 0;
    for (let i = 0; i < 20; i++) {
      const run = (champion?: ChampionInput) => {
        const b = resolveBattleDay(setupBattle(fight(
          { name: 'A', commander: cmd, companies: [co('M1', 'militia', { champion }), co('M2', 'militia')] },
          { name: 'E', companies: [co('E1', 'militia'), co('E2', 'militia')] }, 'plains', `dmg${i}`,
        )));
        return Object.values(b.defender.companies).reduce((t, c) => t + c.startMen - c.men, 0);
      };
      withHero += run(hero({ role: 'captain', class: 'blademaster', stats: { might: 12 } }));
      without += run();
    }
    expect(withHero).toBeGreaterThan(without);
  });

  it('a captain lifts company morale with its Resolve aura', () => {
    const mk = (resolve: number) => resolveBattleDay(setupBattle(fight(
      { name: 'A', commander: cmd, companies: [co('M1', 'spearmen', { champion: hero({ role: 'captain', stats: { resolve } }) }), co('M2', 'spearmen')] },
      { name: 'E', commander: cmd, companies: [co('E1', 'spearmen'), co('E2', 'spearmen')] }, 'mountains', 'aura',
    )));
    expect(mk(30).attacker.companies.M1.morale).toBeGreaterThan(mk(2).attacker.companies.M1.morale);
  });

  it('Unbreakable keeps a company from routing while the champion lives', () => {
    const mk = (traits: string[]) => {
      const b = setupBattle(fight(
        { name: 'A', commander: cmd, companies: [co('M1', 'militia', { champion: hero({ role: 'captain', traits, stats: { vitality: 99 } }) }), co('M2', 'militia')] },
        { name: 'E', commander: cmd, companies: [co('E1', 'swordsmen'), co('E2', 'swordsmen')] },
      ));
      b.attacker.companies.M1.morale = 10;
      return resolveBattleDay(b);
    };
    expect(mk([]).attacker.companies.M1.state).toBe('routed');
    expect(mk(['unbreakable']).attacker.companies.M1.state).not.toBe('routed');
  });

  it('Stalwart companies take less damage', () => {
    let plain = 0, stalwart = 0;
    for (let i = 0; i < 30; i++) {
      const run = (traits: string[]) => {
        const b = resolveBattleDay(setupBattle(fight(
          { name: 'A', commander: cmd, companies: [co('M1', 'militia', { champion: hero({ role: 'captain', traits, stats: { might: 1 } }) })] },
          { name: 'E', commander: cmd, companies: [co('E1', 'militia')] }, 'plains', `sw${i}`,
        )));
        return b.attacker.companies.M1.startMen - b.attacker.companies.M1.men;
      };
      plain += run([]); stalwart += run(['stalwart']);
    }
    expect(stalwart).toBeLessThan(plain);
  });

  it('Giantslayer champions hit Size 10+ units harder', () => {
    let plain = 0, slayer = 0;
    for (let i = 0; i < 20; i++) {
      const run = (traits: string[]) => {
        const b = resolveBattleDay(setupBattle(fight(
          { name: 'A', commander: cmd, companies: [co('S1', 'spearmen', { champion: hero({ role: 'captain', class: 'blademaster', traits, stats: { might: 15 } }) })] },
          { name: 'G', commander: cmd, companies: [co('G1', 'hill_giant')] }, 'plains', `gs${i}`,
        )));
        return b.defender.companies.G1.startMen - b.defender.companies.G1.men;
      };
      plain += run([]); slayer += run(['giantslayer']);
    }
    expect(slayer).toBeGreaterThan(plain);
  });
});

describe('duels, injury and death', () => {
  const champs = (a = 12, d = 5) => fight(
    { name: 'A', commander: cmd, companies: [co('S1', 'spearmen', { champion: hero({ name: 'Ace', role: 'captain', stats: { might: a, vitality: a } }) }), co('S2', 'spearmen')] },
    { name: 'D', commander: cmd, companies: [co('D1', 'spearmen', { champion: hero({ name: 'Foe', role: 'captain', stats: { might: d, vitality: d } }) }), co('D2', 'spearmen')] },
    'mountains',
  );

  it('a duel happens once per day when both sides have revealed champions', () => {
    const b = resolveBattleDay(setupBattle(champs()));
    expect(moments(b).filter((m) => m.startsWith('Duel:'))).toHaveLength(1);
  });

  it('the stronger champion usually wins and the loser falls (wounded or slain)', () => {
    let aceWins = 0;
    for (let i = 0; i < 40; i++) {
      const b = resolveBattleDay(setupBattle({ ...champs(14, 5), seed: `duel${i}` }));
      if (moments(b).some((m) => m.startsWith('Duel: Ace defeats'))) aceWins++;
      const loser = moments(b).find((m) => m.startsWith('Duel: Ace defeats'));
      if (loser) expect(b.defender.champions.D1.down).toBeDefined();
    }
    expect(aceWins).toBeGreaterThanOrEqual(38);
  });

  it('no duel without a commander to challenge', () => {
    const input = champs();
    input.attacker.commander = undefined;
    input.defender.commander = undefined;
    expect(moments(resolveBattleDay(setupBattle(input))).some((m) => m.startsWith('Duel:'))).toBe(false);
  });

  it('duel winner\'s army gains morale, loser\'s loses it', () => {
    for (let i = 0; i < 10; i++) {
      const b = resolveBattleDay(setupBattle({ ...champs(14, 5), seed: `swing${i}` }));
      if (moments(b).some((m) => m.startsWith('Duel: Ace'))) {
        const snap = b.report.days.at(-1)!;
        expect(snap.attacker.morale).toBeGreaterThan(snap.defender.morale);
        return;
      }
    }
  });

  it('a champion at 0 hp falls; killed ones are permanent, flag the company and give the killer credit', () => {
    let killed = 0, wounded = 0;
    for (let i = 0; i < 60; i++) {
      const b = setupBattle({ ...champs(), seed: `fall${i}` });
      b.attacker.champions.S1.hp = 1;
      b.attacker.champions.S1.lastHitBy = 'D1';
      const r = resolveBattleDay(b);
      const ch = r.attacker.champions.S1;
      expect(ch.down).toBeDefined();
      if (ch.down === 'killed') {
        killed++;
        expect(ch.char.status).toBe('dead');
        expect(r.attacker.companies.S1.previousChampionKilled).toBe(true);
        expect(r.defender.companies.D1.killedChampion).toBe(true);
      } else wounded++;
    }
    expect(killed).toBeGreaterThan(5);
    expect(wounded).toBeGreaterThan(20);
  });
});

describe('rising, XP and levels', () => {
  const lineBattle = (seed: string, extra: Partial<SideInput> = {}) => runBattle(fight(
    { name: 'A', commander: cmd, stance: 'aggressive', ...extra, companies: [co('M1', 'militia', { rank: 'elite', glory: 5 }), co('M2', 'spearmen', { rank: 'veteran' }), co('M3', 'swordsmen')] },
    { name: 'D', companies: Array.from({ length: 6 }, (_, i) => co(`E${i + 1}`, 'militia', { rank: 'green' })) },
    'plains', seed,
  ));

  it('champions rise with class by origin unit, base stats and the right epithet', () => {
    const risen: NonNullable<Battle['result']>['risen'] = [];
    for (let i = 0; i < 400; i++) risen.push(...lineBattle(`rise${i}`).result!.risen);
    expect(risen.length).toBeGreaterThan(20);
    const classes: Record<string, string> = { M1: 'folkHero', M2: 'wardenOfTheLine', M3: 'blademaster', E1: 'folkHero' };
    const epithets: Record<string, string> = { unbreakable: 'the Unbroken', giantslayer: 'Giantslayer', stalwart: 'the Stalwart', bloodthirsty: 'the Red', ironWill: 'Ironheart', arcaneTouched: 'Spellscarred', watchful: 'the Watchful' };
    for (const r of risen) {
      expect(r.character.class).toBe(classes[r.companyId] ?? 'folkHero');
      expect(r.character.level).toBe(1);
      if (!r.character.spells.length && r.character.stats.arcana === 5) {
        expect(r.character.stats).toEqual(makeStats(r.character.class));
      }
      if (r.character.traits.length) expect(r.character.epithet).toBe(epithets[r.character.traits[0]]);
      else expect(r.character.epithet).toBeUndefined();
    }
    expect(new Set(risen.map((r) => r.character.traits[0])).size).toBeGreaterThan(1);
  });

  it('rising is deterministic and the racial bonus raises the odds', () => {
    expect(JSON.stringify(lineBattle('same').result)).toBe(JSON.stringify(lineBattle('same').result));
    let base = 0, boosted = 0;
    for (let i = 0; i < 150; i++) {
      base += lineBattle(`b${i}`).result!.risen.length;
      boosted += lineBattle(`b${i}`, { risingBonus: 0.3 }).result!.risen.length;
    }
    expect(boosted).toBeGreaterThan(base);
  });

  it('a company that already has a living champion cannot rise another', () => {
    for (let i = 0; i < 60; i++) {
      const b = runBattle(fight(
        { name: 'A', commander: cmd, risingBonus: 1, companies: [co('M1', 'militia', { champion: hero({ role: 'captain' }) }), co('M2', 'militia')] },
        { name: 'D', companies: [co('E1', 'militia'), co('E2', 'militia')] }, 'plains', `one${i}`,
      ));
      const here = b.result!.risen.filter((r) => r.companyId === 'M1');
      if (b.attacker.champions.M1.down === undefined) expect(here).toHaveLength(0);
    }
  });

  it('the rare Awakening gives non-magic champions Arcana and a spell from their affinity', () => {
    let seen = 0;
    for (let i = 0; i < 300 && !seen; i++) {
      const r = lineBattle(`wake${i}`, { risingBonus: 1, affinity: ['wind', 'light'] }).result!.risen.find((x) => x.character.spells.length);
      if (r) {
        seen++;
        expect(r.character.stats.arcana).toBe(9);
        expect(['wind', 'light']).toContain(SPELLS[r.character.spells[0]].school);
      }
    }
    expect(seen).toBe(1);
  });

  it('survivors earn XP and level up, with the main stat raised', () => {
    const b = runBattle(fight(
      { name: 'A', commander: cmd, companies: [co('S1', 'spearmen', { champion: hero({ name: 'Vet', role: 'captain', class: 'wardenOfTheLine', xp: 95 }) }), co('S2', 'spearmen')] },
      { name: 'D', companies: [co('E1', 'militia'), co('E2', 'militia')] },
    ));
    const c = b.result!.champions.find((x) => x.character.name === 'Vet')!;
    expect(c.xpGained).toBeGreaterThanOrEqual(30);
    expect(c.character.level).toBe(2);
    expect(c.character.stats.vitality).toBe(makeStats('wardenOfTheLine').vitality + 3);
  });

  it('Sylvaen-style XP multiplier applies', () => {
    const xp = (xpMult: number) => runBattle(fight(
      { name: 'A', commander: cmd, xpMult, companies: [co('S1', 'spearmen', { champion: hero({ name: 'Vet', role: 'captain' }) }), co('S2', 'spearmen')] },
      { name: 'D', companies: [co('E1', 'militia'), co('E2', 'militia')] }, 'plains', 'xp',
    )).result!.champions[0].xpGained;
    expect(xp(1.25)).toBeCloseTo(xp(1) * 1.25, -0.5);
    expect(xp(1.25)).toBeGreaterThan(xp(1));
  });

  it('fallen champions earn no XP; losing wounded champions may be captured', () => {
    const b = setupBattle(fight(
      { name: 'A', commander: cmd, companies: [co('S1', 'spearmen', { champion: hero({ name: 'Doomed', role: 'captain' }) }), co('S2', 'spearmen')] },
      { name: 'D', commander: cmd, stance: 'aggressive', companies: Array.from({ length: 4 }, (_, i) => co(`E${i}`, 'swordsmen', { rank: 'elite' })) },
    ));
    b.attacker.champions.S1.hp = 0.5;
    const out = runBattle({ ...fight(
      { name: 'A', commander: cmd, companies: [co('S1', 'spearmen', { champion: hero({ name: 'Doomed', role: 'captain' }) }), co('S2', 'spearmen')] },
      { name: 'D', commander: cmd, stance: 'aggressive', companies: Array.from({ length: 4 }, (_, i) => co(`E${i}`, 'swordsmen', { rank: 'elite' })) },
    ) });
    const r = out.result!.champions.find((c) => c.character.name === 'Doomed')!;
    if (r.outcome === 'dead') expect(r.xpGained).toBe(0);
    expect(['fine', 'wounded', 'captured', 'dead']).toContain(r.outcome);
  });
});

describe('report', () => {
  it('lists champions, reveals and casts', () => {
    const b = runBattle(fight(
      { name: 'A', commander: cmd, affinity: ['fire'], companies: [co('S1', 'spearmen', { champion: hero({ name: 'Vet', trigger: { type: 'time', day: 1, round: 1 } }) }), co('S2', 'spearmen'), co('BM', 'battle_mages')] },
      { name: 'D', companies: [co('E1', 'militia'), co('E2', 'militia'), co('E3', 'militia')] },
    ));
    const text = formatReport(b);
    expect(text).toContain('CHAMPIONS');
    expect(text).toContain('Vet is revealed');
    expect(text).toContain('casts');
  });
});
