import { ECON, RACES } from '../core/data';
import { distance, key, parseKey, withinRadius } from '../core/hex';
import type { Army, HexCoord, Village } from '../core/types';
import { UNIT_DEFS } from '../core/units';
import { upkeep } from '../core/upkeep';
import { wallsIntact } from '../core/siege';
import { totalPop } from '../core/economy';
import { isMilitary, myCompanies, myVillages, nearestVillage, visibleHostiles, type AIContext } from './context';
import { predictBattle } from './predict';

const TIER = ECON.tierOrder;
const memory = (c: AIContext) => (c.s.kingdoms[c.kid].ai ??= { goal: '', targets: {} });

export function runOperations(c: AIContext) {
  captures(c);
  prisoners(c);
  scouts(c);
  settlers(c);
  forces(c);
}

// ---- spoils ----

function captures(c: AIContext) {
  const k = c.s.kingdoms[c.kid];
  for (const [id, cap] of Object.entries(c.s.captures)) {
    if (cap.captorId !== c.kid) continue;
    // Occupy by default; sack when the treasury is nearly empty.
    c.act({ type: 'capture', villageId: id, choice: k.resources.gold < upkeep(c.s, c.kid).gold * c.P.sackBelowTurns ? 'sack' : 'occupy' });
  }
}

function prisoners(c: AIContext) {
  for (const p of Object.values(c.s.prisoners)) {
    if (p.captorId !== c.kid) continue;
    if (c.act({ type: 'prisoners', prisonerId: p.id, action: 'ransom' })) c.act({ type: 'prisoners', prisonerId: p.id, action: 'conscript' });
  }
}

// ---- scouts and settlers ----

function scouts(c: AIContext) {
  const explored = new Set(c.s.kingdoms[c.kid].explored);
  for (const sc of myCompanies(c).filter((x) => x.unitType === 'scouts' && !x.battleId)) {
    let best: HexCoord | null = null, bd = Infinity;
    for (const t of Object.values(c.s.map.tiles)) {
      if (explored.has(key(t))) continue;
      const d = distance(sc.hex, t);
      if (d >= 3 && d < bd) { best = t; bd = d; }
    }
    if (best) c.act({ type: 'move', unitId: sc.id, to: best });
  }
}

/** A good hex for a new village: varied land close to home, clear of other villages. */
function bestSite(c: AIContext, from: HexCoord, taken: HexCoord[]): HexCoord | null {
  const { s } = c;
  const mine = myVillages(c);
  const all = Object.values(s.villages);
  const seen = new Set<string>();
  let best: HexCoord | null = null, bs = -Infinity;
  const home = RACES[s.kingdoms[c.kid].race].homeland;
  const res = s.kingdoms[c.kid].resources;
  // Value what the kingdom is short of: wood from forests, stone and iron from hills and mountains.
  const W = {
    plains: 2, forest: res.wood < 100 ? 3 : 1, hills: res.stone < 60 ? 2 : 1.2, mountains: res.iron < 40 || res.stone < 60 ? 2 : 1, marsh: 0.5, coast: 0.7,
  } as const;
  for (const v of mine) {
    for (const h of withinRadius(v.hex, c.P.siteRadius)) {
      const k = key(h);
      const tile = s.map.tiles[k];
      if (!tile || seen.has(k)) continue;
      seen.add(k);
      if (all.some((o) => distance(o.hex, h) < ECON.military.foundMinDistance + 0)) continue;
      if (all.some((o) => o.ownerId !== c.kid && distance(o.hex, h) < 5)) continue;
      if (taken.some((t) => distance(t, h) < 3)) continue;
      let score = withinRadius(h, 1).reduce((t, n) => t + (s.map.tiles[key(n)] ? W[s.map.tiles[key(n)].terrain] : 0), 0);
      score += withinRadius(h, 1).some((n) => s.map.tiles[key(n)]?.ley || s.map.tiles[key(n)]?.goldDeposit) ? 1 : 0;
      score += home.includes(tile.terrain) ? 1.5 : 0;
      score -= distance(from, h) * 0.25;
      if (score > bs) { bs = score; best = h; }
    }
  }
  return best;
}

function settlers(c: AIContext) {
  const mem = memory(c);
  const targeted: HexCoord[] = [];
  for (const st of myCompanies(c).filter((x) => x.unitType === 'settlers' && !x.battleId)) {
    let target = mem.targets[st.id];
    const stale = target && Object.values(c.s.villages).some((v) => distance(v.hex, target!) < ECON.military.foundMinDistance);
    if (!target || stale) {
      const site = bestSite(c, st.hex, targeted);
      if (!site) continue;
      target = mem.targets[st.id] = site;
    }
    targeted.push(target);
    if (key(st.hex) === key(target)) { if (!c.act({ type: 'found', companyId: st.id })) delete mem.targets[st.id]; }
    else c.act({ type: 'move', unitId: st.id, to: target });
  }
}

// ---- the army ----

interface Target { hex: HexCoord; village?: Village; utility: number }

function targets(c: AIContext, a: Army): Target[] {
  const { s, kid, P } = c;
  const explored = new Set(s.kingdoms[kid].explored);
  const mine = myVillages(c);
  const out: Target[] = [];
  const seenHex = new Set<string>();
  for (const v of Object.values(s.villages)) {
    if (v.ownerId === kid || (v.ownerId === null && !P.conquersNatives)) continue;
    if (!explored.has(key(v.hex)) || s.captures[v.id]) continue;
    seenHex.add(key(v.hex));
    out.push({ hex: v.hex, village: v, utility: (1 + totalPop(v) / 300 + TIER.indexOf(v.tier)) / (1 + distance(a.hex, v.hex) / 6) });
  }
  const byHex = new Map<string, number>();
  for (const h of visibleHostiles(c)) byHex.set(key(h.hex), (byHex.get(key(h.hex)) ?? 0) + h.men);
  for (const [k, men] of byHex) {
    if (seenHex.has(k) || Object.values(s.battles).some((b) => key(b.hex) === k)) continue;
    const hex = parseKey(k);
    const defend = mine.some((v) => distance(v.hex, hex) <= 4) ? 2 : 1;
    out.push({ hex, utility: (men / 400 / (1 + distance(a.hex, hex) / 6)) * 1.2 * defend });
  }
  return out.sort((x, y) => y.utility - x.utility).slice(0, 4);
}

function forces(c: AIContext) {
  const { s, kid, P } = c;
  const villages = myVillages(c);
  const cap = s.villages[s.kingdoms[kid].capitalId] ?? villages[0];
  if (!cap) return;

  // Heal: companies standing in one of our villages are topped up when the treasury allows.
  for (const x of myCompanies(c).filter((u) => isMilitary(u) && !u.battleId && u.men < u.maxMen * 0.95)) {
    if (villages.some((v) => key(v.hex) === key(x.hex))) c.act({ type: 'replenish', companyId: x.id });
  }

  const free = () => myCompanies(c).filter((x) => isMilitary(x) && !x.battleId && x.status !== 'broken');
  // One company keeps the capital.
  const garrisoned = free().some((x) => x.status === 'garrison' && key(x.hex) === key(cap.hex));
  if (!garrisoned && free().length >= 3) {
    const g = free().find((x) => !x.armyId && key(x.hex) === key(cap.hex));
    if (g) c.act({ type: 'setStatus', companyId: g.id, status: 'garrison' });
  }

  // Muster at the capital, then march as one army.
  for (const x of free().filter((u) => !u.armyId && u.status === 'ready' && key(u.hex) !== key(cap.hex))) c.act({ type: 'move', unitId: x.id, to: cap.hex });
  const atRally = free().filter((x) => x.status === 'ready' && key(x.hex) === key(cap.hex) && (!x.armyId || Object.values(s.armies).find((a) => a.id === x.armyId && key(a.hex) === key(cap.hex))));
  const rallyArmy = Object.values(s.armies).find((a) => a.ownerId === kid && key(a.hex) === key(cap.hex) && !a.companyIds.some((id) => s.companies[id].battleId));
  const loose = atRally.filter((x) => !x.armyId);
  if (loose.length >= (rallyArmy ? 1 : P.minArmy)) c.act({ type: 'merge', companyIds: [...loose.map((x) => x.id), ...(rallyArmy?.companyIds ?? [])] });

  for (const a of Object.values(s.armies).filter((x) => x.ownerId === kid && !x.companyIds.some((id) => s.companies[id].battleId))) mission(c, a);
}

function mission(c: AIContext, a: Army) {
  const { s, kid, P } = c;
  const cs = a.companyIds.map((id) => s.companies[id]);
  const men = cs.reduce((t, x) => t + x.men, 0), max = cs.reduce((t, x) => t + x.maxMen, 0);
  const home = nearestVillage(c, a.hex);
  const atHome = !!home && key(home.hex) === key(a.hex);
  const gold = s.kingdoms[kid].resources.gold;

  // Battered armies go home to recover.
  if (men < P.retreatShare * max && home) {
    if (!atHome) c.act({ type: 'move', unitId: a.id, to: home.hex });
    else for (const x of cs) c.act({ type: 'replenish', companyId: x.id });
    return;
  }
  if (atHome && men < P.readyShare * max && gold > 100) {
    for (const x of cs) c.act({ type: 'replenish', companyId: x.id });
    if (a.companyIds.map((id) => s.companies[id]).reduce((t, x) => t + x.men, 0) < P.readyShare * max) return;
  }

  // Help allies in a nearby fight.
  const fight = Object.values(s.battles).find((b) => (b.attackerId === kid || b.defenderId === kid) && distance(b.hex, a.hex) <= 6 && key(b.hex) !== key(a.hex));
  if (fight && !c.act({ type: 'move', unitId: a.id, to: fight.hex })) return;

  // Choose the best target the battle prediction says we can take.
  const walled = (t: Target) => !!t.village && wallsIntact(t.village);
  const engineers = cs.some((x) => UNIT_DEFS[x.unitType].tags.includes('siege'));
  for (const t of targets(c, a)) {
    if (walled(t) && !engineers) continue;
    const p = predictBattle(c, cs, t.hex, t.village);
    if (p.winRate < P.attackThreshold || p.lossShare > P.maxLossShare) continue;
    const err = c.act({ type: 'move', unitId: a.id, to: t.hex });
    if (!err || err === 'Not enough movement') return;
  }
}
