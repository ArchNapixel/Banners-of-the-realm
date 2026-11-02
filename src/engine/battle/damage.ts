import { B, COUNTERS } from './data';
import type { AttackKind, Rank, Stance, TerrainData, UnitType } from './types';

export interface Combatant {
  unit: UnitType;
  men: number;
  rank: Rank;
  fatigue: number;
}

export interface DamageParams {
  attacker: Combatant;
  target: Combatant;
  kind: AttackKind;
  terrain: TerrainData;
  attackerIsDefender: boolean;
  attackerCohesion: number;
  attackerStance?: Stance;
  targetStance?: Stance;
  flanked?: boolean;
  /** racial / trait / spell multiplier hook (M2+) */
  extra?: number;
  /** random roll multiplier; 1 for the deterministic part */
  roll?: number;
}

/** Highest applicable counter multiplier for the pair (1 if none). */
export function counterMult(att: UnitType, tgt: UnitType, kind: AttackKind): number {
  const hits = COUNTERS.filter(
    (r) =>
      att.tags.includes(r.by) &&
      (!r.kind || r.kind === kind) &&
      (!r.vs || tgt.tags.includes(r.vs)) &&
      (!r.vsAll || r.vsAll.every((t) => tgt.tags.includes(t))) &&
      (r.vsMinArmor === undefined || tgt.armor >= r.vsMinArmor) &&
      (r.vsMaxArmor === undefined || tgt.armor <= r.vsMaxArmor) &&
      (!r.unlessTag || !att.tags.includes(r.unlessTag)),
  );
  return hits.length ? Math.max(...hits.map((r) => r.mult)) : 1;
}

/** Expected casualties (in target men, fractional) from one attack. */
export function damage(p: DamageParams): number {
  const { attacker: a, target: t } = p;
  const atk = p.kind === 'ranged' ? (a.unit.rangedAtk ?? a.unit.atk) : a.unit.atk;
  const effMen = a.men * a.unit.size;
  const raw = (effMen * atk) / (atk + t.unit.def + t.unit.armor || 1);

  const terrainDealt = p.terrain.effects
    .filter((e) => a.unit.tags.includes(e.tag) && (!e.defenderOnly || p.attackerIsDefender))
    .reduce((m, e) => m * e.dealt, 1);
  const terrainTaken = p.attackerIsDefender ? 1 : 1 / (1 + p.terrain.defense);

  return (
    raw *
    B.k[p.kind] *
    counterMult(a.unit, t.unit, p.kind) *
    terrainDealt *
    terrainTaken *
    B.rank[a.rank].mult *
    (B.cohesionBase + p.attackerCohesion / B.cohesionDivisor) *
    (1 - a.fatigue / B.fatigueDivisor) *
    (p.attackerStance ? B.stance[p.attackerStance].dealt : 1) *
    (p.targetStance ? B.stance[p.targetStance].taken : 1) *
    (p.flanked ? B.flankedDamage : 1) *
    (p.extra ?? 1) *
    (p.roll ?? 1) /
    t.unit.size
  );
}
