import type { RevealTrigger } from '../../engine/battle/types';
import type { GameBattle } from '../../engine/core/types';
import { PLAYER, useGame } from '../../store/game';

type Preset = 'morale' | 'enemyChampion' | 'nextDay' | 'enemyReserve' | 'manual';
const PRESETS: { id: Preset; label: string }[] = [
  { id: 'morale', label: 'Company morale below 40' },
  { id: 'enemyChampion', label: 'An enemy champion appears' },
  { id: 'nextDay', label: 'Next battle day, morning' },
  { id: 'enemyReserve', label: 'Enemy commits its reserve' },
  { id: 'manual', label: 'Manual (at the next night)' },
];
const toTrigger = (p: Preset, day: number): RevealTrigger =>
  p === 'morale' ? { type: 'morale', below: 40 } : p === 'enemyChampion' ? { type: 'enemyChampion' } : p === 'nextDay' ? { type: 'time', day: day + 1, round: 1 } : p === 'enemyReserve' ? { type: 'enemyReserve' } : { type: 'manual' };
const presetOf = (t?: RevealTrigger): Preset => (!t ? 'morale' : t.type === 'time' ? 'nextDay' : t.type === 'morale' ? 'morale' : t.type);

/** One ongoing battle with the choices the player has between battle days. */
export function BattleCard({ gb }: { gb: GameBattle }) {
  const game = useGame((s) => s.game)!;
  const order = useGame((s) => s.order);
  const openReport = useGame((s) => s.openReport);
  const b = gb.battle;
  const side = gb.attackerId === PLAYER ? 'attacker' : gb.defenderId === PLAYER ? 'defender' : null;
  const snap = b.report.days.at(-1)!;
  const name = `Battle of ${game.map.regions[game.map.tiles[`${gb.hex.q},${gb.hex.r}`].regionId].name}`;
  const heroes = side ? Object.values(b[side].champions).filter((h) => !h.down) : [];

  const row = (label: string, s: typeof snap.attacker, color: string) => (
    <div className="flex justify-between text-xs"><span style={{ color }}>{label}</span><span className="text-slate-300">{s.strength.toLocaleString('en-US')} men · morale {s.morale} · cohesion {s.cohesion} · fatigue {s.fatigue}</span></div>
  );

  return (
    <div className="space-y-2 rounded border border-red-400/30 bg-red-500/5 p-3 text-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-red-200">{name}</h3>
        <span className="text-xs text-slate-400">day {b.day}{gb.pending.length ? ` · ${gb.pending.length} reinforcing` : ''}</span>
      </div>
      {row(b.attacker.name, snap.attacker, '#6fb1ff')}
      {row(b.defender.name, snap.defender, '#ff7a7a')}
      {b.report.nights.at(-1) && <p className="text-xs text-slate-500">Night {b.report.nights.at(-1)!.day}: {b.report.nights.at(-1)!.text}</p>}

      {side && heroes.map((h) => {
        const ch = game.characters[h.char.id];
        return (
          <label key={h.char.id} className="block text-xs text-slate-300">
            <span className="mb-0.5 block">{h.char.epithet ? `${h.char.name} ${h.char.epithet}` : h.char.name} — {h.revealed ? 'revealed' : 'hidden card'}</span>
            {!h.revealed && ch && (
              <select
                className="w-full rounded bg-[#0b0e14] p-1"
                value={presetOf(h.trigger)}
                onChange={(e) => order({ type: 'setChampion', characterId: ch.id, role: 'hidden', trigger: toTrigger(e.target.value as Preset, b.day) })}
              >
                {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            )}
          </label>
        );
      })}

      <p className="text-xs text-slate-500">Armies without a commander fight on Hold and cannot rotate reserves.</p>
      <div className="flex gap-2">
        <button className="rounded bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600" onClick={() => openReport(gb.id)}>Report</button>
        {side && (
          b[side].withdraw
            ? <span className="px-2 py-1 text-xs text-amber-300">Withdrawing at dawn…</span>
            : <button className="rounded bg-red-900/60 px-2 py-1 text-xs hover:bg-red-800/70" onClick={() => { if (confirm('Withdraw? Without a commander the retreat is disorderly: the wounded are captured and pursuit hits harder.')) order({ type: 'withdraw', battleId: gb.id }); }}>Withdraw</button>
        )}
      </div>
    </div>
  );
}
