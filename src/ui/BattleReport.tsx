import { useEffect, useState } from 'react';
import type { Battle, SideKey, SideSnap } from '../engine/battle/types';
import { useGame } from '../store/game';

const COLORS: Record<SideKey, string> = { attacker: '#6fb1ff', defender: '#ff7a7a' };
const n = (x: number) => x.toLocaleString('en-US');

/** Two lines over the days of a battle: attacker blue, defender red. */
function LineChart({ title, a, d }: { title: string; a: number[]; d: number[] }) {
  const W = 220, H = 90, P = 6;
  const max = Math.max(1, ...a, ...d);
  const xs = (i: number) => P + (a.length > 1 ? (i / (a.length - 1)) * (W - 2 * P) : (W - 2 * P) / 2);
  const ys = (v: number) => H - P - (v / max) * (H - 2 * P);
  const pts = (arr: number[]) => arr.map((v, i) => `${xs(i)},${ys(v)}`).join(' ');
  return (
    <figure className="rounded border border-white/10 bg-white/5 p-2">
      <figcaption className="mb-1 flex justify-between text-xs text-slate-400"><span>{title}</span><span>max {n(Math.round(max))}</span></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${title} over time`}>
        <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke="#334155" />
        <line x1={P} y1={P} x2={P} y2={H - P} stroke="#334155" />
        {([['attacker', a], ['defender', d]] as const).map(([side, arr]) => (
          <g key={side}>
            <polyline points={pts(arr)} fill="none" stroke={COLORS[side]} strokeWidth="2" />
            {arr.map((v, i) => <circle key={i} cx={xs(i)} cy={ys(v)} r="2.5" fill={COLORS[side]} />)}
          </g>
        ))}
      </svg>
    </figure>
  );
}

const series = (b: Battle, side: SideKey, f: keyof SideSnap) => b.report.days.map((s) => s[side][f]);

export function BattleReport({ id }: { id: string }) {
  const game = useGame((s) => s.game)!;
  const close = useGame((s) => s.openReport);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const finished = game.reports.find((r) => r.id === id);
  const live = game.battles[id];
  const b = finished?.battle ?? live?.battle;
  if (!b) return null;
  const name = finished?.name ?? `Battle (day ${b.day}, ongoing)`;
  const r = b.result;
  const days = [...new Set(b.report.rounds.map((x) => x.day))];
  const label = !r ? 'Ongoing'
    : r.outcome === 'draw' ? 'Draw'
    : `${r.outcome === 'decisive' ? 'Decisive Victory' : 'Victory'} — ${b[r.winner!].name}${r.pyrrhic ? ' (Pyrrhic)' : ''}${r.withdrawn ? ', the enemy withdrew' : ''}`;
  const cell = 'px-2 py-1 text-right tabular-nums';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={() => close(null)}>
      <div className="flex max-h-full w-[1100px] max-w-full flex-col rounded-lg border border-white/10 bg-[#141923] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between border-b border-white/10 p-4">
          <div>
            <h2 className="text-xl font-semibold text-amber-200">{name}</h2>
            <p className="text-sm text-slate-400">
              <span style={{ color: COLORS.attacker }}>{b.attacker.name}</span> attacks <span style={{ color: COLORS.defender }}>{b.defender.name}</span> on {b.terrain} · {label}
            </p>
          </div>
          <button className="rounded bg-slate-700 px-3 py-1 text-sm hover:bg-slate-600" onClick={() => close(null)}>Close (Esc)</button>
        </header>

        <div className="space-y-5 overflow-y-auto p-4 text-sm">
          {r && (
            <table className="w-full">
              <thead className="text-xs uppercase text-slate-500">
                <tr><th className="px-2 py-1 text-left font-normal"></th>{['Start', 'Dead', 'Wounded', 'Captured', 'Escaped', 'Standing'].map((h) => <th key={h} className={`${cell} font-normal`}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {(['attacker', 'defender'] as SideKey[]).map((s) => (
                  <tr key={s} className="border-t border-white/5">
                    <td className="px-2 py-1" style={{ color: COLORS[s] }}>{b[s].name}</td>
                    {Object.values(r.summary[s]).map((v, i) => <td key={i} className={cell}>{n(v)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <section>
            <h3 className="mb-2 text-xs uppercase tracking-wide text-slate-500">Over time <span className="ml-2 normal-case"><span style={{ color: COLORS.attacker }}>■ attacker</span> <span style={{ color: COLORS.defender }}>■ defender</span></span></h3>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {([['Strength', 'strength'], ['Morale', 'morale'], ['Cohesion', 'cohesion'], ['Fatigue', 'fatigue'], ['Formation Integrity', 'integrity']] as const).map(([t, f]) => (
                <LineChart key={f} title={t} a={series(b, 'attacker', f)} d={series(b, 'defender', f)} />
              ))}
            </div>
          </section>

          {b.report.moments.length > 0 && (
            <section>
              <h3 className="mb-1 text-xs uppercase tracking-wide text-slate-500">Key moments</h3>
              <ul className="space-y-0.5">
                {b.report.moments.map((m, i) => <li key={i}><span className="text-slate-500">Day {m.day}{m.round ? `, round ${m.round}` : ', night'}:</span> {m.text}</li>)}
              </ul>
            </section>
          )}

          <section>
            <h3 className="mb-1 text-xs uppercase tracking-wide text-slate-500">Day by day</h3>
            <ul className="space-y-1">
              {days.map((d) => {
                const rounds = b.report.rounds.filter((x) => x.day === d);
                const tot = (s: SideKey) => rounds.reduce((t, x) => t + Object.values(x.losses[s]).reduce((a, v) => a + v, 0), 0);
                return (
                  <li key={d} className="rounded border border-white/10">
                    <button className="flex w-full justify-between px-3 py-1.5 text-left hover:bg-white/5" onClick={() => setOpen(open === d ? null : d)}>
                      <span>Day {d}</span>
                      <span className="text-slate-400">{b.attacker.name} −{n(tot('attacker'))} · {b.defender.name} −{n(tot('defender'))}</span>
                    </button>
                    {open === d && (
                      <div className="space-y-1 border-t border-white/10 px-3 py-2 text-xs">
                        {rounds.map((x) => (
                          <div key={x.round}>
                            <div className="text-slate-300">
                              Round {x.round}: {b.attacker.name} {Object.entries(x.losses.attacker).map(([c, v]) => `${c} −${v}`).join(', ') || 'no losses'} · {b.defender.name} {Object.entries(x.losses.defender).map(([c, v]) => `${c} −${v}`).join(', ') || 'no losses'}
                            </div>
                            {x.events.map((e, i) => <div key={i} className="pl-4 text-slate-500">• {e}</div>)}
                          </div>
                        ))}
                        {b.report.nights.find((x) => x.day === d) && <div className="text-slate-500">Night: {b.report.nights.find((x) => x.day === d)!.text}</div>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          <section>
            <h3 className="mb-1 text-xs uppercase tracking-wide text-slate-500">Companies</h3>
            <table className="w-full">
              <thead className="text-xs uppercase text-slate-500">
                <tr><th className="px-2 py-1 text-left font-normal">Company</th><th className={`${cell} font-normal`}>Start</th><th className={`${cell} font-normal`}>End</th><th className={`${cell} font-normal`}>Lost</th><th className="px-2 py-1 text-left font-normal">State</th></tr>
              </thead>
              <tbody>
                {(['attacker', 'defender'] as SideKey[]).flatMap((s) => Object.values(b[s].companies).map((c) => (
                  <tr key={c.id} className="border-t border-white/5">
                    <td className="px-2 py-1" style={{ color: COLORS[s] }}>{c.name}</td>
                    <td className={cell}>{n(c.startMen)}</td><td className={cell}>{n(c.men)}</td>
                    <td className={cell}>{Math.round((1 - c.men / c.startMen) * 100)}%</td>
                    <td className="px-2 py-1 text-slate-400">{c.state}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </section>

          {r && (r.champions.length > 0 || r.risen.length > 0) && (
            <section>
              <h3 className="mb-1 text-xs uppercase tracking-wide text-slate-500">Champions and rewards</h3>
              <ul className="space-y-0.5">
                {r.champions.map((c) => (
                  <li key={c.character.id}>
                    {c.character.epithet ? `${c.character.name} ${c.character.epithet}` : c.character.name} <span className="text-slate-500">({b[c.side].name}, Lv {c.character.level})</span> — +{c.xpGained} XP, {c.outcome}
                  </li>
                ))}
                {r.risen.map((h) => (
                  <li key={h.character.id} className="text-amber-200">
                    {h.character.epithet ? `${h.character.name} ${h.character.epithet}` : h.character.name} rises from {h.companyId} <span className="text-slate-500">({h.character.class}{h.character.traits.length ? `, ${h.character.traits.join(', ')}` : ''})</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
