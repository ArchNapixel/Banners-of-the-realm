import { useEffect } from 'react';
import { newCompany } from '../engine/core/military';
import { PLAYER, useGame } from '../store/game';
import { GameScreen } from './GameScreen';
import { NewGame } from './NewGame';

export function App() {
  const playing = useGame((s) => !!s.game);
  const start = useGame((s) => s.start);

  // Shortcut for development and links: /?seed=abc&race=ghor&size=small skips the setup screen.
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const seed = q.get('seed');
    if (!seed || useGame.getState().game) return;
    const race = (q.get('race') ?? 'valdren') as never;
    const size = (q.get('size') ?? 'medium') as never;
    start({ seed, mapSize: size, playerRace: race, aiRaces: q.get('ai') === '0' ? [] : ['ghor', 'durrakin'] });
    // Dev only: &demo=battle | report | capture | siege stages a fight or conquest next to the capital.
    const demo = import.meta.env.DEV ? q.get('demo') : null;
    if (demo) {
      const g = useGame.getState().game!;
      const mine = Object.values(g.companies).find((c) => c.ownerId === PLAYER)!;
      const hex = { q: mine.hex.q + 1, r: mine.hex.r };
      const ids = [mine.id];
      if (demo === 'capture' || demo === 'siege') {
        const cap = g.villages[g.kingdoms[PLAYER].capitalId];
        g.villages.demo = { ...structuredClone(cap), id: 'demo', name: 'Demoford', ownerId: 'k2', hex, buildings: demo === 'siege' ? [{ id: 'palisade' }, { id: 'stone_walls' }] : [] };
        g.villages.demo.populationByRace = { ghor: 900 };
        if (demo === 'siege') {
          newCompany(g, 'k2', 'militia', 'ghor', 500, hex);
          for (let i = 0; i < 2; i++) ids.push(newCompany(g, PLAYER, 'siege_engineers', g.kingdoms[PLAYER].race, 200, mine.hex).id);
        }
      } else {
        newCompany(g, 'k2', 'militia', 'ghor', 500, hex);
        if (demo === 'report') for (let i = 0; i < 3; i++) { const c = newCompany(g, PLAYER, 'swordsmen', g.kingdoms[PLAYER].race, 500, mine.hex); c.rank = 'elite'; ids.push(c.id); }
      }
      useGame.setState({ game: { ...g } });
      useGame.getState().order({ type: 'merge', companyIds: ids });
      const army = Object.values(useGame.getState().game!.armies)[0];
      useGame.getState().order({ type: 'move', unitId: army.id, to: hex });
      if (demo === 'battle' || demo === 'report') useGame.getState().endTurn();
      else if (demo === 'siege') { useGame.getState().endTurn(); useGame.getState().endTurn(); useGame.getState().select(hex); }
    }
    // Dev only: &skip=N ends N turns with the player idle, to watch the AI kingdoms play.
    const skip = import.meta.env.DEV ? Number(q.get('skip') ?? 0) : 0;
    for (let i = 0; i < skip; i++) useGame.getState().endTurn();
    // Dev only: &reveal=1 lifts the fog so the whole generated map can be inspected.
    if (import.meta.env.DEV && q.get('reveal')) {
      const g = useGame.getState().game!;
      g.kingdoms.k1.explored = Object.keys(g.map.tiles);
      useGame.setState({ game: { ...g } });
    }
  }, [start]);

  return playing ? <GameScreen /> : <NewGame />;
}
