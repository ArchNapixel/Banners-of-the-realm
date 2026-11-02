import { create } from 'zustand';
import { applyOrder, type Order, type OrderInput } from '../engine/core/orders';
import { resolveTurn } from '../engine/core/resolveTurn';
import { key } from '../engine/core/hex';
import { newGame } from '../engine/core/state';
import type { GameSettings, GameState, HexCoord } from '../engine/core/types';

export const PLAYER = 'k1';

interface GameStore {
  game: GameState | null;
  selectedHex: HexCoord | null;
  selectedVillageId: string | null;
  /** companies ticked in the army panel */
  selectedUnits: string[];
  forcedMarch: boolean;
  /** battle report being viewed (an ongoing battle id or a finished report id) */
  reportId: string | null;
  /** the night dialog for ongoing battles is open */
  night: boolean;
  message: string | null;
  start: (settings: GameSettings) => void;
  quit: () => void;
  /** Orders are the only way the UI changes the game. */
  order: (o: OrderInput) => void;
  endTurn: () => void;
  select: (hex: HexCoord | null) => void;
  selectVillage: (id: string) => void;
  nextVillage: () => void;
  setUnits: (ids: string[], hex?: HexCoord) => void;
  toggleUnit: (id: string) => void;
  setForced: (on: boolean) => void;
  moveSelected: (hex: HexCoord) => void;
  nextIdleUnit: () => void;
  openReport: (id: string | null) => void;
  dismissNight: () => void;
}

/** The thing an order should move: a whole army, or one company on its own. */
export function moveTargetOf(game: GameState, ids: string[]): string | null {
  const cs = ids.map((id) => game.companies[id]).filter(Boolean);
  if (!cs.length) return null;
  const armyId = cs[0].armyId;
  if (armyId) return cs.every((c) => c.armyId === armyId) && game.armies[armyId].companyIds.length === cs.length ? armyId : null;
  return cs.length === 1 ? cs[0].id : null;
}

export const useGame = create<GameStore>((set, get) => ({
  game: null,
  selectedHex: null,
  selectedVillageId: null,
  selectedUnits: [],
  forcedMarch: false,
  reportId: null,
  night: false,
  message: null,

  start: (settings) => {
    const game = newGame({ aiEnabled: true, ...settings });
    const cap = game.villages[game.kingdoms[PLAYER].capitalId];
    set({ game, selectedHex: cap.hex, selectedVillageId: cap.id, selectedUnits: [], message: null });
  },
  quit: () => set({ game: null, selectedHex: null, selectedVillageId: null, selectedUnits: [], message: null }),

  order: (o) => {
    const { game } = get();
    if (!game) return;
    const r = applyOrder(game, { ...o, kingdomId: PLAYER } as Order);
    // Drop selections that no longer exist (merged-away armies, founded settlers, ...).
    const alive = get().selectedUnits.filter((id) => r.state.companies[id]);
    set({ game: r.state, selectedUnits: alive, message: r.error ?? null });
  },
  endTurn: () => {
    const { game, selectedUnits } = get();
    if (!game) return;
    const next = resolveTurn(game);
    // A battle that just ended opens its report; otherwise ongoing battles open the night dialog.
    const ended = next.reports.filter((r) => r.turnEnded === game.turn && (r.attackerId === PLAYER || r.defenderId === PLAYER)).at(-1);
    const ongoing = Object.values(next.battles).some((b) => b.attackerId === PLAYER || b.defenderId === PLAYER);
    set({
      game: next, selectedUnits: selectedUnits.filter((id) => next.companies[id]), forcedMarch: false, message: null,
      reportId: ended ? ended.id : null, night: !ended && ongoing,
    });
  },

  select: (hex) => {
    const { game } = get();
    if (!game || !hex) return set({ selectedHex: null, selectedVillageId: null, selectedUnits: [] });
    const v = Object.values(game.villages).find((x) => key(x.hex) === key(hex));
    set({
      selectedHex: hex,
      selectedVillageId: v && game.kingdoms[PLAYER].explored.includes(key(hex)) ? v.id : null,
      selectedUnits: [],
    });
  },
  selectVillage: (id) => {
    const v = get().game?.villages[id];
    if (v) set({ selectedVillageId: id, selectedHex: v.hex, selectedUnits: [] });
  },
  nextVillage: () => {
    const { game, selectedVillageId, selectVillage } = get();
    if (!game) return;
    const mine = Object.values(game.villages).filter((v) => v.ownerId === PLAYER);
    if (!mine.length) return;
    const i = mine.findIndex((v) => v.id === selectedVillageId);
    selectVillage(mine[(i + 1) % mine.length].id);
  },

  setUnits: (ids, hex) => {
    const { game } = get();
    const first = game?.companies[ids[0]];
    const at = hex ?? first?.hex ?? get().selectedHex;
    const v = game && at ? Object.values(game.villages).find((x) => key(x.hex) === key(at)) : undefined;
    set({ selectedUnits: ids, selectedHex: at, selectedVillageId: v && v.ownerId === PLAYER ? v.id : null });
  },
  toggleUnit: (id) => {
    const cur = get().selectedUnits;
    set({ selectedUnits: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  },
  setForced: (on) => set({ forcedMarch: on }),
  moveSelected: (hex) => {
    const { game, selectedUnits, forcedMarch, order } = get();
    if (!game) return;
    const target = moveTargetOf(game, selectedUnits);
    if (!target) return set({ message: selectedUnits.length ? 'Select a whole army, or a single company, to move' : null });
    order({ type: 'move', unitId: target, to: hex, forced: forcedMarch });
    // Follow the unit.
    const after = get().game!;
    const c = after.companies[selectedUnits[0]];
    if (c) set({ selectedHex: c.hex });
  },
  nextIdleUnit: () => {
    const { game, selectedUnits, setUnits } = get();
    if (!game) return;
    const idle = Object.values(game.companies).filter((c) => c.ownerId === PLAYER && c.status !== 'garrison' && c.movementLeft > 0);
    if (!idle.length) return;
    const i = idle.findIndex((c) => c.id === selectedUnits[0]);
    const pick = idle[(i + 1) % idle.length];
    setUnits(pick.armyId ? game.armies[pick.armyId].companyIds : [pick.id], pick.hex);
  },
  openReport: (id) => set({ reportId: id }),
  dismissNight: () => set({ night: false }),
}));
