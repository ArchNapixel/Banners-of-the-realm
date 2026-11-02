import { battleAt, beginBattle, joinBattle } from './battles';
import { BUILDINGS, ECON, RACES } from './data';
import { effectiveStability, majorityRace, totalPop } from './economy';
import { distance, key } from './hex';
import { NEUTRAL, kingdomOf } from './kingdoms';
import { newCompany, removeCompany } from './military';
import { createRng, hashSeed } from './rng';
import type { Company, GameState, HexCoord, KingdomId, Village } from './types';
import { UNIT_DEFS, companyMen } from './units';

type Say = (text: string, villageId?: string, kingdomId?: string) => void;
const clamp = (x: number) => Math.min(100, Math.max(0, x));

export const villageAt = (s: GameState, hex: HexCoord) => Object.values(s.villages).find((v) => key(v.hex) === key(hex));
export const wallsIntact = (v: Village) => v.buildings.some((b) => b.id === 'stone_walls');

/** A Palisade gives the village's defenders +20% in a battle. Stone Walls are never fought over: they are breached first. */
export const defenseBonusAt = (s: GameState, hex: HexCoord, defenderId: KingdomId) => {
  const v = villageAt(s, hex);
  if (!v || (v.ownerId ?? NEUTRAL) !== defenderId) return 0;
  return v.buildings.reduce((t, b) => t + (b.id === 'palisade' ? (BUILDINGS.palisade.defense ?? 0) : 0), 0);
};

/** Independent villages are held by a militia company that only exists while they are under attack. */
function spawnGarrison(s: GameState, v: Village): Company {
  const race = majorityRace(v);
  return newCompany(s, NEUTRAL, 'militia', race, Math.min(companyMen('militia', race), Math.max(50, Math.round(totalPop(v) * 0.5))), v.hex);
}

// ---- entering an enemy hex ----

/** Called when a moving army ends its move on a hex with enemies or a village that is not its own. */
export function engageHex(s: GameState, kid: KingdomId, cs: Company[], hex: HexCoord) {
  const existing = battleAt(s, hex);
  if (existing) return joinBattle(existing, cs);
  const v = villageAt(s, hex);
  const foreign = v && v.ownerId !== kid ? v : undefined;
  if (foreign && s.sieges[foreign.id]?.attackerId === kid) return; // reinforcing the besiegers
  let defenders = Object.values(s.companies).filter((c) => key(c.hex) === key(hex) && c.ownerId !== kid && !c.battleId);

  if (foreign) {
    if (!defenders.length && foreign.ownerId === null) defenders = [spawnGarrison(s, foreign)];
    if (!defenders.length) return setCapture(s, foreign.id, kid); // nobody home
    if (wallsIntact(foreign)) {
      s.sieges[foreign.id] = {
        villageId: foreign.id, attackerId: kid, since: s.turn, breach: 0,
        stores: ECON.siege.baseStores + foreign.buildings.reduce((t, b) => t + (BUILDINGS[b.id].siegeStores ?? 0), 0), garrisonMorale: 100,
      };
      s.log.push({ turn: s.turn, text: `${kingdomOf(s, kid).name} lays siege to ${foreign.name}`, villageId: foreign.id });
      return;
    }
  }
  if (defenders.length) beginBattle(s, kid, cs, hex);
}

// ---- capture ----

export function setCapture(s: GameState, villageId: string, captorId: KingdomId) {
  const v = s.villages[villageId];
  if (!v || s.captures[villageId]) return;
  delete s.sieges[villageId];
  s.captures[villageId] = { captorId, turn: s.turn };
  s.log.push({ turn: s.turn, text: `${v.name} has fallen to ${kingdomOf(s, captorId).name}`, villageId, kingdomId: captorId === NEUTRAL ? undefined : captorId });
}

/** A kingdom that lost its capital moves it to its largest village, or is eliminated. */
export function ensureCapital(s: GameState, kid: KingdomId | null) {
  const k = kid && s.kingdoms[kid];
  if (!k || s.villages[k.capitalId]?.ownerId === kid) return;
  const best = Object.values(s.villages).filter((v) => v.ownerId === kid).sort((a, b) => totalPop(b) - totalPop(a))[0];
  if (best) { k.capitalId = best.id; s.log.push({ turn: s.turn, text: `${k.name} moves its capital to ${best.name}`, kingdomId: kid! }); }
  else { k.eliminated = true; s.log.push({ turn: s.turn, text: `${k.name} has lost its last village`, kingdomId: kid! }); }
}

function occupy(s: GameState, v: Village, captorId: KingdomId) {
  const prev = v.ownerId;
  v.ownerId = captorId;
  v.buildQueue = [];
  v.trainQueue = [];
  v.workerPriority = [];
  v.recentConscription = 0;
  v.conqueredTurn = s.turn;
  const same = majorityRace(v) === kingdomOf(s, captorId).race;
  v.conquestPenalty = same ? ECON.capture.sameRacePenalty : ECON.capture.otherRacePenalty;
  ensureCapital(s, prev);
}

export function resolveCapture(s: GameState, kid: KingdomId, villageId: string, choice: 'occupy' | 'sack' | 'raze'): string | undefined {
  const v = s.villages[villageId];
  const pending = s.captures[villageId];
  if (!v || !pending) return 'Nothing to decide here';
  if (pending.captorId !== kid) return 'Not your conquest';
  const k = s.kingdoms[kid];
  const prev = v.ownerId;
  delete s.captures[villageId];
  delete s.sieges[villageId];

  if (choice === 'raze') {
    delete s.villages[villageId];
    s.log.push({ turn: s.turn, text: `${v.name} is razed to the ground`, kingdomId: kid });
    ensureCapital(s, prev);
    return;
  }
  if (choice === 'sack') {
    const people = totalPop(v);
    const bonus = 1 + (RACES[k.race].sackBonus ?? 0);
    const loot = Math.round(people * ECON.capture.sackGoldPerResident * bonus);
    k.resources.gold += loot;
    for (const r of Object.keys(v.populationByRace) as (keyof typeof v.populationByRace)[]) v.populationByRace[r] = Math.floor(v.populationByRace[r]! * (1 - ECON.capture.sackPopLoss));
    if (prev) for (const o of Object.values(s.villages)) if (o.ownerId === prev) o.stability = clamp(o.stability + ECON.capture.sackOwnerStability);
    s.log.push({ turn: s.turn, text: `${v.name} is sacked: ${loot} gold taken`, kingdomId: kid });
  }
  occupy(s, v, kid);
}

/** Independent villages near your own can simply be bought. */
export function annex(s: GameState, kid: KingdomId, villageId: string): string | undefined {
  const v = s.villages[villageId];
  if (!v) return 'Unknown village';
  if (v.ownerId !== null) return 'Only independent villages can be annexed';
  const k = s.kingdoms[kid];
  if (!Object.values(s.villages).some((o) => o.ownerId === kid && distance(o.hex, v.hex) <= ECON.capture.annexRadius)) return `Needs one of your villages within ${ECON.capture.annexRadius} hexes`;
  const price = Math.round(totalPop(v) * ECON.capture.annexGoldPerResident);
  if (k.resources.gold < price) return `Annexing costs ${price} gold`;
  k.resources.gold -= price;
  v.ownerId = kid;
  s.log.push({ turn: s.turn, text: `${v.name} joins ${k.name} for ${price} gold`, villageId, kingdomId: kid });
}

/** Unresolved conquests are occupied when the turn is resolved. */
export function autoOccupy(s: GameState) {
  for (const [id, p] of Object.entries(s.captures)) resolveCapture(s, p.captorId, id, 'occupy');
}

/** Rebels won, or the village slipped away: it becomes independent. */
export function secede(s: GameState, v: Village) {
  const prev = v.ownerId;
  v.ownerId = null;
  v.stability = ECON.revolt.independentStability;
  v.conquestPenalty = 0;
  v.buildQueue = [];
  v.trainQueue = [];
  s.log.push({ turn: s.turn, text: `${v.name} breaks away from ${prev ? s.kingdoms[prev].name : 'its rulers'}`, villageId: v.id, kingdomId: prev ?? undefined });
  ensureCapital(s, prev);
}

// ---- sieges (resolution step 2) ----

export function advanceSieges(s: GameState, say: Say) {
  for (const siege of Object.values(s.sieges)) {
    const v = s.villages[siege.villageId];
    const here = Object.values(s.companies).filter((c) => v && key(c.hex) === key(v.hex) && !c.battleId);
    const besiegers = here.filter((c) => c.ownerId === siege.attackerId);
    const defenders = here.filter((c) => c.ownerId !== siege.attackerId);
    if (!v || !besiegers.length) { delete s.sieges[siege.villageId]; if (v) say(`The siege of ${v.name} is lifted`, v.id); continue; }
    if (!defenders.length) { setCapture(s, v.id, siege.attackerId); continue; }

    const engineers = besiegers.filter((c) => UNIT_DEFS[c.unitType].tags.includes('siege')).length;
    siege.breach = Math.min(1, siege.breach + engineers * ECON.siege.breachPerEngineer);
    if (siege.breach >= 1) {
      delete s.sieges[v.id];
      say(`The walls of ${v.name} are breached! The assault begins`, v.id);
      beginBattle(s, siege.attackerId, besiegers, v.hex);
      continue;
    }

    if (siege.stores > 0) siege.stores--;
    else {
      siege.garrisonMorale += ECON.siege.starveMorale;
      // (the people starve in resolveTurn: no growth, -2% and -5 stability)
      if (siege.garrisonMorale <= 0) {
        for (const d of defenders) {
          if (d.ownerId === NEUTRAL) { removeCompany(s, d); continue; }
          const id = `p${s.nextId++}`;
          s.prisoners[id] = { id, captorId: siege.attackerId, fromId: d.ownerId, race: d.race, men: d.men, hex: { ...v.hex }, turn: s.turn };
          removeCompany(s, d);
        }
        say(`The garrison of ${v.name} surrenders`, v.id);
        setCapture(s, v.id, siege.attackerId);
        continue;
      }
      say(`${v.name} starves: the garrison's morale falls`, v.id);
    }
  }
}

// ---- revolts ----

/** Below 20 stability a village has a 10% chance a turn to rise up: rebels fight the garrison, or simply take over. */
export function checkRevolts(s: GameState, say: Say) {
  for (const v of Object.values(s.villages)) {
    if (!v.ownerId || battleAt(s, v.hex) || s.captures[v.id]) continue;
    if (effectiveStability(s, v) >= ECON.stability.revoltBelow) continue;
    if (createRng(hashSeed(s.seed, 'revolt', s.turn, v.id))() >= ECON.revolt.chance) continue;
    const race = majorityRace(v);
    const rebels = newCompany(s, NEUTRAL, 'militia', race, Math.min(companyMen('militia', race), Math.max(50, Math.round(totalPop(v) * 0.3))), v.hex);
    say(`Revolt in ${v.name}!`, v.id, v.ownerId);
    const garrison = Object.values(s.companies).filter((c) => key(c.hex) === key(v.hex) && c.ownerId === v.ownerId && !c.battleId);
    if (garrison.length) beginBattle(s, NEUTRAL, [rebels], v.hex);
    else { removeCompany(s, rebels); secede(s, v); }
  }
}
