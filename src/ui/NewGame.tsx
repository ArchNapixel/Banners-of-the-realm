import { useState } from 'react';
import { RACES } from '../engine/core/data';
import type { MapSize, RaceId } from '../engine/core/types';
import cfg from '../engine/data/mapgen.json';
import { useGame } from '../store/game';

const RACE_IDS = Object.keys(RACES) as RaceId[];
const SIZES: MapSize[] = ['small', 'medium', 'large'];
const randomSeed = () => Math.random().toString(36).slice(2, 8);
const label = (r: RaceId) => `${RACES[r].name} (${RACES[r].plain})`;

export function NewGame() {
  const start = useGame((s) => s.start);
  const [race, setRace] = useState<RaceId>('valdren');
  const [size, setSize] = useState<MapSize>('medium');
  const [seed, setSeed] = useState(randomSeed);
  const [ai, setAi] = useState(2);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const maxAi = cfg.sizes[size].maxAi;
  const aiCount = Math.min(ai, maxAi);

  const go = () => {
    // AI kingdoms take the other races in turn.
    const others = RACE_IDS.filter((r) => r !== race);
    const aiRaces = Array.from({ length: aiCount }, (_, i) => others[(i + seed.length) % others.length]);
    try {
      start({ seed: seed || randomSeed(), mapSize: size, playerRace: race, aiRaces, kingdomName: name.trim() || undefined });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-[#0b0e14]">
      <div className="w-[460px] rounded-lg border border-white/10 bg-[#141923] p-6 shadow-xl">
        <h1 className="mb-1 text-2xl font-semibold text-amber-300">Banners of Valdrys</h1>
        <p className="mb-5 text-sm text-slate-400">Found a kingdom in the wild lands.</p>

        <label className="mb-3 block text-sm">
          <span className="mb-1 block text-slate-300">Your people</span>
          <select className="w-full rounded bg-[#0b0e14] p-2" value={race} onChange={(e) => setRace(e.target.value as RaceId)}>
            {RACE_IDS.map((r) => <option key={r} value={r}>{label(r)}</option>)}
          </select>
        </label>

        <label className="mb-3 block text-sm">
          <span className="mb-1 block text-slate-300">Kingdom name (optional)</span>
          <input className="w-full rounded bg-[#0b0e14] p-2" value={name} placeholder="Chosen from your culture if blank" onChange={(e) => setName(e.target.value)} />
        </label>

        <div className="mb-3 grid grid-cols-2 gap-3 text-sm">
          <label>
            <span className="mb-1 block text-slate-300">Map size</span>
            <select className="w-full rounded bg-[#0b0e14] p-2" value={size} onChange={(e) => setSize(e.target.value as MapSize)}>
              {SIZES.map((s) => <option key={s} value={s}>{s} ({cfg.sizes[s].width}×{cfg.sizes[s].height})</option>)}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-slate-300">AI kingdoms (max {maxAi})</span>
            <input type="number" min={0} max={maxAi} className="w-full rounded bg-[#0b0e14] p-2" value={aiCount} onChange={(e) => setAi(Math.max(0, Number(e.target.value)))} />
          </label>
        </div>

        <label className="mb-5 block text-sm">
          <span className="mb-1 block text-slate-300">Seed</span>
          <div className="flex gap-2">
            <input className="flex-1 rounded bg-[#0b0e14] p-2" value={seed} onChange={(e) => setSeed(e.target.value)} />
            <button className="rounded bg-slate-700 px-3 hover:bg-slate-600" onClick={() => setSeed(randomSeed())}>Randomise</button>
          </div>
        </label>

        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
        <button className="w-full rounded bg-amber-500 p-2.5 font-semibold text-black hover:bg-amber-400" onClick={go}>Begin</button>
      </div>
    </div>
  );
}
