import { BUILDINGS, ECON } from './data';
import { UNIT_DEFS } from './units';
import { key, withinRadius } from './hex';
import type { GameState, KingdomId } from './types';

/** Fog of war: villages see radius 2 (3 with a Watchtower), companies 2, scouts 4. */
export const VILLAGE_VISION = 2;

export function visibleKeys(state: GameState, kid: KingdomId): Set<string> {
  const out = new Set<string>();
  for (const v of Object.values(state.villages)) {
    if (v.ownerId !== kid) continue;
    const r = Math.max(VILLAGE_VISION, ...v.buildings.map((b) => BUILDINGS[b.id].vision ?? 0));
    for (const h of withinRadius(v.hex, r)) if (state.map.tiles[key(h)]) out.add(key(h));
  }
  for (const c of Object.values(state.companies)) {
    if (c.ownerId !== kid) continue;
    const r = UNIT_DEFS[c.unitType].tags.includes('recon') ? ECON.military.visionRecon : ECON.military.visionCompany;
    for (const h of withinRadius(c.hex, r)) if (state.map.tiles[key(h)]) out.add(key(h));
  }
  return out;
}

/** Adds everything currently visible to each kingdom's explored set. Mutates `state`. */
export function updateExplored(state: GameState) {
  for (const k of Object.values(state.kingdoms)) {
    const seen = new Set(k.explored);
    for (const h of visibleKeys(state, k.id)) seen.add(h);
    k.explored = [...seen];
  }
}
