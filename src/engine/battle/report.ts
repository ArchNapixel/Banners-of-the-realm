import type { BCompany, Battle, BSide, SideKey, SideSnap } from './types';

const SIDES: SideKey[] = ['attacker', 'defender'];
const n = (x: number) => x.toLocaleString('en-US');
const pad = (s: string | number, w: number) => String(s).padEnd(w);
const row = (cells: (string | number)[], widths: number[]) => cells.map((c, i) => pad(c, widths[i])).join(' ').trimEnd();

function lineup(side: BSide): string[] {
  const out = [`${side.name}${side.commander ? ` — commander ${side.commander.name} (Leadership ${side.commander.leadership}), stance ${side.stance}` : ' — no commander'}`];
  out.push(`  Cohesion ${Math.round(side.cohesion)}, Integrity ${Math.round(side.integrity)}${side.maxMana ? `, Mana ${side.maxMana}` : ''}`);
  for (const h of Object.values(side.champions)) {
    out.push(`  champion ${h.char.epithet ? `${h.char.name} ${h.char.epithet}` : h.char.name} (${h.char.class}, Lv ${h.char.level}) with ${h.companyId}, ${h.role === 'hidden' ? 'HIDDEN' : 'captain'}`);
  }
  for (const slot of ['front', 'flank', 'rear', 'air', 'reserve'] as const) {
    const cs = side.lines[slot].map((id) => side.companies[id]);
    if (cs.length) out.push(`  ${pad(slot, 8)} ${cs.map((c) => `${c.name} (${c.startMen}, ${c.rank})`).join('; ')}`);
  }
  return out;
}

function snapLine(s: SideSnap) {
  return `Strength ${n(s.strength)}, Morale ${s.morale}, Cohesion ${s.cohesion}, Fatigue ${s.fatigue}, Integrity ${s.integrity}`;
}

export function formatReport(b: Battle): string {
  const out: string[] = [];
  out.push(`=== BATTLE REPORT — ${b.terrain.toUpperCase()} (seed "${b.seed}") ===`, '');
  out.push('SETUP');
  for (const s of SIDES) out.push(...lineup(b.report.initial?.[s] ?? b[s]), '');

  const days = [...new Set(b.report.rounds.map((r) => r.day))];
  for (const d of days) {
    out.push(`--- DAY ${d} ---`);
    const names = (s: SideKey) => b[s].companies;
    for (const r of b.report.rounds.filter((x) => x.day === d)) {
      const tot = (s: SideKey) => Object.values(r.losses[s]).reduce((t, v) => t + v, 0);
      const detail = (s: SideKey) =>
        Object.entries(r.losses[s]).map(([id, v]) => `${names(s)[id].id} ${v}`).join(', ');
      out.push(`Round ${r.round}: ${b.attacker.name} lose ${tot('attacker')}${detail('attacker') ? ` (${detail('attacker')})` : ''}; ${b.defender.name} lose ${tot('defender')}${detail('defender') ? ` (${detail('defender')})` : ''}`);
      for (const e of r.events) out.push(`    * ${e}`);
    }
    const snap = b.report.days.find((x) => x.day === d)!;
    const dayLoss = (s: SideKey) => b.report.rounds.filter((x) => x.day === d).reduce((t, r) => t + Object.values(r.losses[s]).reduce((a, v) => a + v, 0), 0);
    out.push(`Day ${d} total: ${b.attacker.name} lose ${dayLoss('attacker')} (${n(snap.attacker.strength)} standing); ${b.defender.name} lose ${dayLoss('defender')} (${n(snap.defender.strength)} standing)`);
    out.push(`  End of day — ${b.attacker.name}: ${snapLine(snap.attacker)}`);
    out.push(`               ${b.defender.name}: ${snapLine(snap.defender)}`);
    const night = b.report.nights.find((x) => x.day === d);
    if (night) out.push(`Night ${d}: ${night.text}`);
    out.push('');
  }

  if (b.report.moments.length) {
    out.push('KEY MOMENTS');
    for (const m of b.report.moments) out.push(`  Day ${m.day}, round ${m.round}: ${m.text}`);
    out.push('');
  }

  if (b.result) {
    const r = b.result;
    const label = r.outcome === 'draw' ? 'Draw' : `${r.outcome === 'decisive' ? 'Decisive Victory' : 'Victory'} — ${b[r.winner!].name}${r.pyrrhic ? ' (Pyrrhic)' : ''}`;
    out.push(`FINAL REPORT — ${label} (${b.day} day${b.day > 1 ? 's' : ''})`);
    const w = [22, 7, 7, 8, 9, 8, 8];
    out.push(row(['', 'Start', 'Dead', 'Wounded', 'Captured', 'Escaped', 'Standing'], w));
    for (const s of SIDES) {
      const x = r.summary[s];
      out.push(row([b[s].name, n(x.start), n(x.dead), n(x.wounded), n(x.captured), n(x.escaped), n(x.standing)], w));
    }
    if (r.champions.length) {
      out.push('', 'CHAMPIONS');
      for (const c of r.champions) {
        const ch = c.character;
        out.push(`  ${ch.epithet ? `${ch.name} ${ch.epithet}` : ch.name} (${b[c.side].name}, ${c.companyId}) — Lv ${ch.level}, +${c.xpGained} XP, ${c.outcome}`);
      }
    }
    if (r.risen.length) {
      out.push('', 'RISEN HEROES');
      for (const h of r.risen) {
        const ch = h.character;
        out.push(`  ${ch.epithet ? `${ch.name} ${ch.epithet}` : ch.name} rises from ${h.companyId} (${b[h.side].name}) — ${ch.class}${ch.traits.length ? `, ${ch.traits.join(', ')}` : ''}${ch.spells.length ? `, knows ${ch.spells.join(', ')}` : ''}`);
      }
    }
    out.push('', 'COMPANIES');
    const cw = [28, 7, 7, 9, 7];
    out.push(row(['Company', 'Start', 'End', 'Lost', 'State'], cw));
    for (const s of SIDES) {
      for (const c of Object.values(b[s].companies) as BCompany[]) {
        const lost = Math.round((1 - c.men / c.startMen) * 100);
        out.push(row([c.name, c.startMen, c.men, `${lost}%`, c.state], cw));
      }
    }
  }
  return out.join('\n');
}
