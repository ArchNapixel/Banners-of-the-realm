import { totalPop } from '../src/engine/core/economy';
import { resolveTurn } from '../src/engine/core/resolveTurn';
import { newGame } from '../src/engine/core/state';
import type { GameState, MapSize, RaceId } from '../src/engine/core/types';

/** Every kingdom, the "player" included, is run by the AI. Usage: npm run aiwar -- [turns] [size] [seed] */
const [turnsArg = '100', sizeArg = 'medium', seed = 'aiwar-1'] = process.argv.slice(2);
const size = sizeArg as MapSize;
const races: RaceId[] = ['valdren', 'ghor', 'durrakin', 'sylvaen', 'vashkari'];
const ai = size === 'small' ? 2 : size === 'medium' ? 3 : 5;

let g: GameState = newGame({ seed, mapSize: size, playerRace: 'valdren', aiRaces: races.slice(1, 1 + ai), aiEnabled: true });
g.kingdoms.k1.kind = 'ai';
g.kingdoms.k1.aiPersonality = 'warlord';

const row = (g: GameState) =>
  Object.values(g.kingdoms).map((k) => {
    const vs = Object.values(g.villages).filter((v) => v.ownerId === k.id);
    const cs = Object.values(g.companies).filter((c) => c.ownerId === k.id);
    return `${k.race.slice(0, 3)}:${k.eliminated ? 'DEAD' : `${vs.length}v/${vs.reduce((t, v) => t + totalPop(v), 0)}p/${cs.length}c/${Math.round(k.resources.gold)}g ${k.ai?.goal ?? ''}`}`;
  }).join(' | ');

const started = Date.now();
let battles = 0;
const turns = Number(turnsArg);
for (let t = 1; t <= turns; t++) {
  const before = g.reports.length;
  g = resolveTurn(g);
  battles += g.reports.length - before;
  if (t % 10 === 0 || t === turns) console.log(`T${String(g.turn).padStart(3)} ${row(g)} | battles ${battles}`);
}
const ms = Date.now() - started;
console.log(`${turns} turns in ${ms} ms (${Math.round(ms / turns)} ms/turn); independent villages left: ${Object.values(g.villages).filter((v) => v.ownerId === null).length}`);
