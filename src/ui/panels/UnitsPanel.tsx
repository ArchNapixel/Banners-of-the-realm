import { key } from '../../engine/core/hex';
import { RACES } from '../../engine/core/data';
import { speedOf } from '../../engine/core/movement';
import { UNIT_DEFS } from '../../engine/core/units';
import type { Company, HexCoord } from '../../engine/core/types';
import { moveTargetOf, PLAYER, useGame } from '../../store/game';
import { UnitToken } from '../UnitToken';

const RANK_COLOR: Record<Company['rank'], string> = { green: 'text-slate-400', trained: 'text-sky-300', veteran: 'text-violet-300', elite: 'text-amber-300' };

function Row({ c }: { c: Company }) {
  const selected = useGame((s) => s.selectedUnits.includes(c.id));
  const toggle = useGame((s) => s.toggleUnit);
  const def = UNIT_DEFS[c.unitType];
  return (
    <label className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 ${selected ? 'bg-amber-500/15' : 'bg-white/5 hover:bg-white/10'}`}>
      <input type="checkbox" checked={selected} onChange={() => toggle(c.id)} />
      <UnitToken id={c.unitType} />
      <div className="min-w-0 flex-1">
        <div className="truncate">{def.name} <span className="text-xs text-slate-500">· {RACES[c.race].name}</span></div>
        <div className="text-xs text-slate-400">
          {c.men}/{c.maxMen} men · <span className={RANK_COLOR[c.rank]}>{c.rank}</span> · {c.status === 'garrison' ? 'garrison' : `${c.movementLeft.toFixed(1).replace(/\.0$/, '')}/${speedOf(c)} move`}
        </div>
      </div>
    </label>
  );
}

/** Own companies standing on the selected hex, with the actions that make sense for them. */
export function UnitsPanel({ hex }: { hex: HexCoord }) {
  const game = useGame((s) => s.game)!;
  const selected = useGame((s) => s.selectedUnits);
  const setUnits = useGame((s) => s.setUnits);
  const order = useGame((s) => s.order);
  const forced = useGame((s) => s.forcedMarch);
  const setForced = useGame((s) => s.setForced);

  const here = Object.values(game.companies).filter((c) => c.ownerId === PLAYER && key(c.hex) === key(hex));
  if (!here.length) return null;
  const village = Object.values(game.villages).find((v) => v.ownerId === PLAYER && key(v.hex) === key(hex));
  const chosen = selected.map((id) => game.companies[id]).filter((c) => c && key(c.hex) === key(hex));
  const armyIds = [...new Set(here.map((c) => c.armyId).filter(Boolean))] as string[];
  const loose = here.filter((c) => !c.armyId);
  const target = moveTargetOf(game, selected);
  const settlers = chosen.length === 1 && chosen[0].unitType === 'settlers' ? chosen[0] : null;

  const btn = 'rounded bg-slate-700 px-2 py-1 text-xs enabled:hover:bg-slate-600 disabled:opacity-40';
  return (
    <section className="mb-4 space-y-2 border-b border-white/10 pb-4 text-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-wide text-slate-500">Forces here</h3>
        <button className="text-xs text-slate-400 hover:text-slate-200" onClick={() => setUnits(selected.length === here.length ? [] : here.map((c) => c.id), hex)}>
          {selected.length === here.length ? 'Clear' : 'Select all'}
        </button>
      </div>

      {armyIds.map((id) => {
        const a = game.armies[id];
        const cs = a.companyIds.map((c) => game.companies[c]);
        return (
          <div key={id} className="space-y-1 rounded border border-white/10 p-1.5">
            <div className="flex items-center justify-between px-1">
              <button className="font-medium text-amber-200 hover:underline" onClick={() => setUnits(a.companyIds, hex)}>{a.name}</button>
              <span className="text-xs text-slate-400">{cs.reduce((t, c) => t + c.men, 0)} men · speed {Math.min(...cs.map(speedOf))} · {a.stance}</span>
            </div>
            {cs.map((c) => <Row key={c.id} c={c} />)}
          </div>
        );
      })}
      {loose.length > 0 && <div className="space-y-1">{loose.map((c) => <Row key={c.id} c={c} />)}</div>}

      <div className="flex flex-wrap gap-1.5">
        <button className={btn} disabled={chosen.length < 1} onClick={() => order({ type: 'merge', companyIds: chosen.map((c) => c.id) })} title="Form an army, or join the selected army">Merge</button>
        <button className={btn} disabled={!chosen.some((c) => c.armyId)} onClick={() => order({ type: 'split', companyIds: chosen.filter((c) => c.armyId).map((c) => c.id) })} title="Take the ticked companies out of their army">Split</button>
        {village && chosen.length === 1 && (
          <>
            <button className={btn} onClick={() => order({ type: 'setStatus', companyId: chosen[0].id, status: chosen[0].status === 'garrison' ? 'ready' : 'garrison' })}>
              {chosen[0].status === 'garrison' ? 'Stand down' : 'Garrison'}
            </button>
            <button className={btn} disabled={chosen[0].men >= chosen[0].maxMen} onClick={() => order({ type: 'replenish', companyId: chosen[0].id })} title="Refill from the village for gold">Replenish</button>
          </>
        )}
        {settlers && <button className={btn} onClick={() => order({ type: 'found', companyId: settlers.id })}>Found village</button>}
      </div>

      <label className="flex items-center gap-2 text-xs text-slate-300" title="+1 movement; the troops start the next battle with 30 Fatigue">
        <input type="checkbox" checked={forced} onChange={(e) => setForced(e.target.checked)} /> Forced march
      </label>
      <p className="text-xs text-slate-500">
        {target ? 'Right-click a hex on the map to move.' : chosen.length ? 'Tick a whole army or a single company to move it.' : 'Tick companies to give orders.'}
      </p>
    </section>
  );
}
