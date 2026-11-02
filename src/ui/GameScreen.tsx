import { useEffect, useState } from 'react';
import { kingdomIncome, totalPop } from '../engine/core/economy';
import type { Resources } from '../engine/core/types';
import { PLAYER, useGame } from '../store/game';
import { MapView } from './map/MapView';
import { HexPanel } from './panels/HexPanel';
import { BattleReport } from './BattleReport';
import { CaptureDialog } from './CaptureDialog';
import { NightDialog } from './NightDialog';
import { kingdomOf } from '../engine/core/kingdoms';
import { BattleCard } from './panels/BattleCard';
import { UnitsPanel } from './panels/UnitsPanel';
import { VillagePanel } from './panels/VillagePanel';
import { UNIT_DEFS } from '../engine/core/units';
import { RACES } from '../engine/core/data';
import { key } from '../engine/core/hex';

const RES: { key: keyof Resources; label: string }[] = [
  { key: 'gold', label: 'Gold' }, { key: 'food', label: 'Food' }, { key: 'wood', label: 'Wood' }, { key: 'stone', label: 'Stone' },
  { key: 'iron', label: 'Iron' }, { key: 'horses', label: 'Horses' }, { key: 'mana', label: 'Mana' },
];

function TopBar() {
  const game = useGame((s) => s.game)!;
  const endTurn = useGame((s) => s.endTurn);
  const quit = useGame((s) => s.quit);
  const k = game.kingdoms[PLAYER];
  const income = kingdomIncome(game, PLAYER);
  const pop = Object.values(game.villages).filter((v) => v.ownerId === PLAYER).reduce((t, v) => t + totalPop(v), 0);
  return (
    <header className="flex h-14 items-center gap-5 border-b border-white/10 bg-[#141923] px-4">
      <div className="flex items-center gap-2 font-semibold">
        <span className="inline-block h-3 w-3 rounded-full" style={{ background: k.color }} />
        {k.name}
      </div>
      <div className="flex flex-1 gap-4 text-sm">
        {RES.map(({ key, label }) => (
          <div key={key} title={`${label}: ${income[key] >= 0 ? '+' : ''}${income[key].toFixed(1)} per turn`}>
            <span className="text-slate-400">{label} </span>
            <span>{Math.floor(k.resources[key]).toLocaleString('en-US')}</span>
            {income[key] !== 0 && <span className={`ml-1 text-xs ${income[key] > 0 ? 'text-green-400' : 'text-red-400'}`}>{income[key] > 0 ? '+' : ''}{income[key].toFixed(0)}</span>}
          </div>
        ))}
      </div>
      <div className="text-sm text-slate-300">Pop {pop.toLocaleString('en-US')}</div>
      <div className="text-sm text-slate-300">Turn {game.turn}</div>
      <button className="rounded bg-amber-500 px-4 py-1.5 font-semibold text-black hover:bg-amber-400" onClick={endTurn} title="Enter">End Turn</button>
      <button className="text-xs text-slate-500 hover:text-slate-300" onClick={quit}>Menu</button>
    </header>
  );
}

function Sidebar() {
  const game = useGame((s) => s.game)!;
  const selected = useGame((s) => s.selectedVillageId);
  const selectedUnits = useGame((s) => s.selectedUnits);
  const selectVillage = useGame((s) => s.selectVillage);
  const setUnits = useGame((s) => s.setUnits);
  const order = useGame((s) => s.order);
  const [tab, setTab] = useState<'villages' | 'armies' | 'prisoners'>('villages');
  const captives = Object.values(game.prisoners).filter((p) => p.captorId === PLAYER);
  const mine = Object.values(game.villages).filter((v) => v.ownerId === PLAYER);
  const companies = Object.values(game.companies).filter((c) => c.ownerId === PLAYER);
  const armies = Object.values(game.armies).filter((a) => a.ownerId === PLAYER);
  const loose = companies.filter((c) => !c.armyId);
  const tabBtn = (id: typeof tab, label: string) => (
    <button onClick={() => setTab(id)} className={`flex-1 rounded px-2 py-1 text-xs uppercase tracking-wide ${tab === id ? 'bg-white/10 text-slate-100' : 'text-slate-500 hover:text-slate-300'}`}>{label}</button>
  );
  return (
    <aside className="w-[260px] shrink-0 overflow-y-auto border-r border-white/10 bg-[#141923] p-3">
      <div className="mb-3 flex gap-1">{tabBtn('villages', 'Villages')}{tabBtn('armies', `Armies (${companies.length})`)}{tabBtn('prisoners', `Captives (${captives.length})`)}</div>
      {tab === 'prisoners' ? (
        <ul className="space-y-2">
          {captives.map((p) => (
            <li key={p.id} className="rounded border border-white/10 p-2 text-sm">
              <div>{p.men.toLocaleString('en-US')} {RACES[p.race].name} <span className="text-xs text-slate-500">of {kingdomOf(game, p.fromId).name}</span></div>
              <div className="mt-1 flex gap-1">
                {(['ransom', 'conscript', 'release'] as const).map((a) => (
                  <button key={a} className="flex-1 rounded bg-slate-700 px-1 py-1 text-xs capitalize hover:bg-slate-600"
                    title={a === 'ransom' ? '1 gold a man, if their kingdom can pay' : a === 'conscript' ? 'Green Militia of their people, morale −30' : 'Calms recently conquered villages'}
                    onClick={() => order({ type: 'prisoners', prisonerId: p.id, action: a })}>{a}</button>
                ))}
              </div>
            </li>
          ))}
          {!captives.length && <li className="text-sm text-slate-500">No prisoners.</li>}
        </ul>
      ) : tab === 'villages' ? (
        <ul className="space-y-1">
          {mine.map((v) => (
            <li key={v.id}>
              <button
                onClick={() => selectVillage(v.id)}
                className={`w-full rounded px-2 py-1.5 text-left text-sm ${selected === v.id ? 'bg-amber-500/20 text-amber-200' : 'hover:bg-white/5'}`}
              >
                <div>{v.name}</div>
                <div className="text-xs text-slate-400">{v.tier} · {totalPop(v).toLocaleString('en-US')} people</div>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="space-y-1">
          {armies.map((a) => {
            const cs = a.companyIds.map((id) => game.companies[id]);
            const on = cs.every((c) => selectedUnits.includes(c.id));
            return (
              <li key={a.id}>
                <button onClick={() => setUnits(a.companyIds, a.hex)} className={`w-full rounded px-2 py-1.5 text-left text-sm ${on ? 'bg-amber-500/20 text-amber-200' : 'hover:bg-white/5'}`}>
                  <div>{a.name}</div>
                  <div className="text-xs text-slate-400">{cs.length} companies · {cs.reduce((t, c) => t + c.men, 0)} men</div>
                </button>
              </li>
            );
          })}
          {loose.map((c) => (
            <li key={c.id}>
              <button onClick={() => setUnits([c.id], c.hex)} className={`w-full rounded px-2 py-1.5 text-left text-sm ${selectedUnits.includes(c.id) ? 'bg-amber-500/20 text-amber-200' : 'hover:bg-white/5'}`}>
                <div>{UNIT_DEFS[c.unitType].name}</div>
                <div className="text-xs text-slate-400">{c.men} men · {c.status}</div>
              </button>
            </li>
          ))}
          {!companies.length && <li className="text-sm text-slate-500">No troops. Recruit some in a village.</li>}
        </ul>
      )}
      <p className="mt-6 text-xs text-slate-600">Enter: end turn · V: next village · Tab: next idle unit · Esc: deselect · wheel: zoom · drag: pan · right-click: move</p>
    </aside>
  );
}

function Context() {
  const game = useGame((s) => s.game)!;
  const hex = useGame((s) => s.selectedHex);
  const villageId = useGame((s) => s.selectedVillageId);
  const message = useGame((s) => s.message);
  const village = villageId ? game.villages[villageId] : null;
  const battle = hex ? Object.values(game.battles).find((b) => key(b.hex) === key(hex)) : undefined;
  return (
    <aside className="w-[340px] shrink-0 overflow-y-auto border-l border-white/10 bg-[#141923] p-4">
      {message && <p className="mb-3 rounded bg-red-500/15 px-2 py-1 text-sm text-red-300">{message}</p>}
      {battle && <div className="mb-4"><BattleCard gb={battle} /></div>}
      {hex && <UnitsPanel hex={hex} />}
      {village ? <VillagePanel village={village} /> : hex ? <HexPanel hex={hex} /> : <p className="text-sm text-slate-500">Select a hex or village.</p>}
    </aside>
  );
}

function EventLog() {
  const game = useGame((s) => s.game!);
  const openReport = useGame((s) => s.openReport);
  const recent = game.log.filter((e) => !e.kingdomId || e.kingdomId === PLAYER).slice(-5).reverse();
  const ongoing = Object.values(game.battles).filter((b) => b.attackerId === PLAYER || b.defenderId === PLAYER);
  const reports = game.reports.filter((r) => r.attackerId === PLAYER || r.defenderId === PLAYER).slice(-3).reverse();
  return (
    <footer className="flex h-[110px] shrink-0 gap-6 overflow-y-auto border-t border-white/10 bg-[#141923] px-4 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <h3 className="mb-1 text-xs uppercase tracking-wide text-slate-500">Event log</h3>
        {recent.length === 0 ? <p className="text-slate-600">Nothing yet. End the turn to see what happens.</p> : (
          <ul className="space-y-0.5">{recent.map((e, i) => <li key={i}><span className="text-slate-500">T{e.turn}</span> {e.text}</li>)}</ul>
        )}
      </div>
      <div className="w-[280px] shrink-0">
        <h3 className="mb-1 text-xs uppercase tracking-wide text-slate-500">Battles <span className="normal-case text-slate-600">(B: latest report)</span></h3>
        <ul className="space-y-0.5">
          {ongoing.map((b) => <li key={b.id}><button className="text-red-300 hover:underline" onClick={() => openReport(b.id)}>Ongoing · day {b.battle.day}</button></li>)}
          {reports.map((r) => <li key={r.id}><button className="text-slate-300 hover:underline" onClick={() => openReport(r.id)}>{r.name} <span className="text-slate-500">(T{r.turnEnded})</span></button></li>)}
          {!ongoing.length && !reports.length && <li className="text-slate-600">No battles yet.</li>}
        </ul>
      </div>
    </footer>
  );
}

export function GameScreen() {
  const endTurn = useGame((s) => s.endTurn);
  const nextVillage = useGame((s) => s.nextVillage);
  const select = useGame((s) => s.select);
  const nextIdle = useGame((s) => s.nextIdleUnit);
  const reportId = useGame((s) => s.reportId);
  const night = useGame((s) => s.night);
  const openReport = useGame((s) => s.openReport);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;
      if (e.key === 'Enter') endTurn();
      else if (e.key.toLowerCase() === 'v') nextVillage();
      else if (e.key === 'Tab') { e.preventDefault(); nextIdle(); }
      else if (e.key.toLowerCase() === 'b') {
        const st = useGame.getState().game!;
        const last = st.reports.filter((r) => r.attackerId === PLAYER || r.defenderId === PLAYER).at(-1);
        const live = Object.values(st.battles).find((b) => b.attackerId === PLAYER || b.defenderId === PLAYER);
        if (last || live) openReport((live ?? last)!.id);
      }
      else if (e.key === 'Escape') select(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [endTurn, nextVillage, nextIdle, select, openReport]);

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1"><MapView /></main>
        <Context />
      </div>
      <EventLog />
      {!reportId && <CaptureDialog />}
      {night && !reportId && <NightDialog />}
      {reportId && <BattleReport id={reportId} />}
    </div>
  );
}
