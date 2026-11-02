import { distance, key } from '../../engine/core/hex';
import { TIERS } from '../../engine/core/data';
import type { HexCoord } from '../../engine/core/types';
import { kingdomOf } from '../../engine/core/kingdoms';
import { visibleKeys } from '../../engine/core/vision';
import { PLAYER, useGame } from '../../store/game';

export function HexPanel({ hex }: { hex: HexCoord }) {
  const game = useGame((s) => s.game)!;
  const tile = game.map.tiles[key(hex)];
  const explored = game.kingdoms[PLAYER].explored.includes(key(hex));
  if (!tile) return null;
  if (!explored) return <p className="text-sm text-slate-500">Unexplored territory.</p>;

  const region = game.map.regions[tile.regionId];
  const near = Object.values(game.villages)
    .filter((v) => v.ownerId === PLAYER)
    .map((v) => ({ v, d: distance(v.hex, hex) }))
    .sort((a, b) => a.d - b.d)[0];
  const inRadius = near && near.d <= TIERS[near.v.tier].radius;

  // Enemy forces are only seen where we can see, and only roughly.
  const foes = visibleKeys(game, PLAYER).has(key(hex)) ? Object.values(game.companies).filter((c) => c.ownerId !== PLAYER && key(c.hex) === key(hex)) : [];
  const foeMen = foes.reduce((t, c) => t + c.men, 0);

  const features = [
    tile.ancientForest && 'Ancient Forest (sacred to the Eldergrove)',
    tile.ley && 'Ley Node — Mage Tower and Mana Well',
    tile.ruins && 'Ancient Ruins — unexplored',
    tile.goldDeposit && 'Gold deposit',
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-2 text-sm">
      <h2 className="text-lg font-semibold capitalize text-amber-200">{tile.terrain}</h2>
      <p className="text-slate-300">{region.name}</p>
      <p className="text-xs text-slate-500">Hex {hex.q}, {hex.r}</p>
      {features.length > 0 && <ul className="list-disc pl-5 text-slate-300">{features.map((f) => <li key={f}>{f}</li>)}</ul>}
      {foes.length > 0 && <p className="rounded bg-red-500/10 px-2 py-1 text-red-300">{kingdomOf(game, foes[0].ownerId).name}: about {Math.round(foeMen / 50) * 50} men in {foes.length} compan{foes.length > 1 ? 'ies' : 'y'}</p>}
      {near && <p className="text-xs text-slate-400">{near.d} hex{near.d === 1 ? '' : 'es'} from {near.v.name}{inRadius ? ' · inside its work radius' : ''}</p>}
    </div>
  );
}
