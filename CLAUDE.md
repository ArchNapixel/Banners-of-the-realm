# Banners of Valdrys

Single-player turn-based fantasy strategy game (browser, Vercel). Full design: `docs/GAME_DESIGN.md`. Work one milestone (Section 21) at a time; write tests first.

## Engineering rules
1. **The engine is pure.** No React, DOM, `Math.random()` or `Date` anywhere in `src/engine`.
2. **Deterministic.** All randomness goes through the seeded RNG. Turn seed = hash(game seed, turn number). Same state + orders + seed = same result.
3. **Data-driven.** All balance numbers live in `src/engine/data`. No magic numbers in logic.
4. **Orders only.** UI and AI change the game only by submitting orders.
5. **Immutable turns.** `resolveTurn(state, orders, seed)` returns a new state plus an event log.
6. **Tested.** Every battle mechanic has unit tests. Run the balance script before closing a milestone.
7. **Reloading a save and replaying the same orders gives the same results.**

## Commands
- `npm test` — Vitest
- `npm run sim -- hills` — print a multi-day battle report
- `npm run balance` — run many battles, print win rates and losses
- `npm run aiwar -- 100 medium` — an all-AI game: kingdoms, companies and gold every 10 turns, plus ms per turn
- `npm run dev` — the game in the browser (dev shortcut: `/?seed=abc&size=small&race=ghor`, add `&reveal=1` to lift the fog, `&demo=battle|report|capture|siege` to stage a fight or conquest, `&skip=60` to end 60 turns and watch the AI)
- `npm run build` — typecheck and production build
- `npm run typecheck`

## Git
Never push. Commit locally only when asked.
