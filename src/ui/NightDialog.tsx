import { useEffect } from 'react';
import { PLAYER, useGame } from '../store/game';
import { BattleCard } from './panels/BattleCard';

/** Shown at dawn when battles are still going: reinforce (by moving), change hidden cards, or withdraw. */
export function NightDialog() {
  const game = useGame((s) => s.game)!;
  const dismiss = useGame((s) => s.dismissNight);
  const mine = Object.values(game.battles).filter((b) => b.attackerId === PLAYER || b.defenderId === PLAYER);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Enter') { e.stopPropagation(); dismiss(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [dismiss]);

  if (!mine.length) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6">
      <div className="max-h-full w-[560px] space-y-3 overflow-y-auto rounded-lg border border-white/10 bg-[#141923] p-5 shadow-2xl">
        <h2 className="text-lg font-semibold text-amber-200">Night falls on the battlefield</h2>
        <p className="text-sm text-slate-400">
          Fatigue eases and wounded return only with healers. Reinforce by moving companies onto the battle hex; they join at dawn.
        </p>
        {mine.map((gb) => <BattleCard key={gb.id} gb={gb} />)}
        <div className="flex justify-end"><button className="rounded bg-amber-500 px-4 py-1.5 font-semibold text-black hover:bg-amber-400" onClick={dismiss}>Continue</button></div>
      </div>
    </div>
  );
}
