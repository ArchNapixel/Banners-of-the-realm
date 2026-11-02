import { totalPop } from '../engine/core/economy';
import { BUILDINGS, ECON, RACES } from '../engine/core/data';
import { majorityRace } from '../engine/core/economy';
import { PLAYER, useGame } from '../store/game';

/** The conquest choice for every village the player has taken but not yet dealt with. */
export function CaptureDialog() {
  const game = useGame((s) => s.game)!;
  const order = useGame((s) => s.order);
  const mine = Object.entries(game.captures).filter(([, c]) => c.captorId === PLAYER);
  if (!mine.length) return null;
  const k = game.kingdoms[PLAYER];

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6">
      <div className="max-h-full w-[620px] space-y-4 overflow-y-auto rounded-lg border border-white/10 bg-[#141923] p-5 shadow-2xl">
        {mine.map(([id]) => {
          const v = game.villages[id];
          if (!v) return null;
          const pop = totalPop(v);
          const same = majorityRace(v) === k.race;
          const penalty = same ? ECON.capture.sameRacePenalty : ECON.capture.otherRacePenalty;
          const loot = Math.round(pop * ECON.capture.sackGoldPerResident * (1 + (RACES[k.race].sackBonus ?? 0)));
          const former = v.ownerId ? game.kingdoms[v.ownerId]?.name : 'its independent people';
          return (
            <div key={id} className="space-y-3">
              <div>
                <h2 className="text-lg font-semibold text-amber-200">{v.name} has fallen</h2>
                <p className="text-sm text-slate-400">
                  {pop.toLocaleString('en-US')} {RACES[majorityRace(v)].name} · {v.tier} · {v.buildings.map((b) => BUILDINGS[b.id].name).join(', ') || 'no buildings'}. What will you do with it?
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <button className="rounded border border-white/10 bg-slate-700/60 p-3 text-left hover:bg-slate-600" onClick={() => order({ type: 'capture', villageId: id, choice: 'occupy' })}>
                  <div className="font-semibold">Occupy</div>
                  <p className="mt-1 text-xs text-slate-300">Keep the people and buildings. Training is lost. Stability −{penalty}, recovering 3 a turn{same ? '' : ' (a different people)'}.</p>
                </button>
                <button className="rounded border border-white/10 bg-slate-700/60 p-3 text-left hover:bg-slate-600" onClick={() => order({ type: 'capture', villageId: id, choice: 'sack' })}>
                  <div className="font-semibold">Sack</div>
                  <p className="mt-1 text-xs text-slate-300">+{loot.toLocaleString('en-US')} gold, −30% of the people, and every village of {former} loses 20 stability. Then occupied.</p>
                </button>
                <button className="rounded border border-red-400/30 bg-red-900/30 p-3 text-left hover:bg-red-800/40" onClick={() => { if (confirm(`Raze ${v.name}? The village is destroyed for good.`)) order({ type: 'capture', villageId: id, choice: 'raze' }); }}>
                  <div className="font-semibold text-red-200">Raze</div>
                  <p className="mt-1 text-xs text-slate-300">Destroy the village entirely.</p>
                </button>
              </div>
            </div>
          );
        })}
        <p className="text-xs text-slate-500">Left undecided, the village is occupied when the turn ends.</p>
      </div>
    </div>
  );
}
