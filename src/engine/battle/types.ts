export type Rank = 'green' | 'trained' | 'veteran' | 'elite';
export type Stance = 'aggressive' | 'hold' | 'fightingRetreat';
export type Slot = 'front' | 'flank' | 'rear' | 'reserve' | 'air';
export type SideKey = 'attacker' | 'defender';
export type TerrainId = 'plains' | 'forest' | 'hills' | 'mountains' | 'marsh' | 'coast';
export type AttackKind = 'melee' | 'ranged' | 'charge';

export interface UnitType {
  name: string;
  baseMen: number;
  size: number;
  atk: number;
  rangedAtk?: number;
  def: number;
  armor: number;
  discipline: number;
  speed: number;
  tags: string[];
  flying?: boolean;
  noMorale?: boolean;
}

export interface TerrainData {
  frontage: number;
  defense: number;
  fatigue: number;
  /** movement points to enter this terrain */
  move: number;
  effects: { tag: string; dealt: number; defenderOnly?: boolean }[];
}

export interface CounterRule {
  by: string;
  vs?: string;
  vsAll?: string[];
  vsMinArmor?: number;
  vsMaxArmor?: number;
  kind?: AttackKind;
  unlessTag?: string;
  mult: number;
}

export type ChampionClass =
  | 'folkHero' | 'wardenOfTheLine' | 'blademaster' | 'marksman' | 'lancerLord' | 'archmage' | 'saint' | 'spellbreaker';

export type RevealTrigger =
  | { type: 'morale'; below: number }
  | { type: 'enemyChampion' }
  | { type: 'time'; day: number; round: number }
  | { type: 'enemyReserve' }
  | { type: 'manual' };

export interface Stats { might: number; vitality: number; leadership: number; tactics: number; arcana: number; resolve: number }

export interface Character {
  id: string;
  name: string;
  epithet?: string;
  class: ChampionClass;
  level: number;
  xp: number;
  stats: Stats;
  traits: string[];
  spells: string[];
  status: 'active' | 'wounded' | 'captured' | 'dead';
}

export interface ChampionInput {
  /** keeps a campaign character's id through the battle */
  id?: string;
  name: string;
  epithet?: string;
  class: ChampionClass;
  level?: number;
  xp?: number;
  stats?: Partial<Stats>;
  traits?: string[];
  spells?: string[];
  role: 'captain' | 'hidden';
  trigger?: RevealTrigger;
}

// ---- input ----
export interface CompanyInput {
  id: string;
  unit: string;
  men?: number;
  rank?: Rank;
  /** starting fatigue (e.g. 15 after a full-speed move, 30 forced march) */
  fatigue?: number;
  champion?: ChampionInput;
  /** battles survived (Glory) */
  glory?: number;
  /** overrides the roster stats, e.g. after racial modifiers */
  unitStats?: UnitType;
  /** starting Morale (broken or freshly conscripted companies start low) */
  morale?: number;
  /** this company's previous champion was killed */
  previousChampionKilled?: boolean;
}

export interface SideInput {
  name: string;
  commander?: { name: string; leadership: number };
  stance?: Stance;
  companies: CompanyInput[];
  outOfSupply?: boolean;
  /** two affinity schools: their spells cost 25% less */
  affinity?: string[];
  forbiddenSchools?: string[];
  /** extra champion rising chance (e.g. 0.02 Valdren, 0.03 Ghor pits) */
  risingBonus?: number;
  /** champion XP multiplier (e.g. 1.25 Sylvaen) */
  xpMult?: number;
}

export interface BattleInput {
  seed: string;
  terrain: TerrainId;
  attacker: SideInput;
  defender: SideInput;
  siege?: boolean;
  /** extra defense for the defender, e.g. a Palisade (+20%) */
  defenseBonus?: number;
}

// ---- state ----
export interface BCompany {
  id: string;
  unitId: string;
  /** stats this company fights with (racial modifiers already applied) */
  unit: UnitType;
  name: string;
  rank: Rank;
  men: number;
  startMen: number;
  morale: number;
  fatigue: number;
  slot: Slot;
  state: 'active' | 'routed' | 'destroyed';
  dead: number;
  wounded: number;
  dayWounded: number;
  /** already rotated out once; cannot be rotated back in */
  spent?: boolean;
  /** absolute round (day*3+round) in which the company cannot fight (Burning Ground) */
  suppressedRound?: number;
  glory: number;
  previousChampionKilled: boolean;
  daysFought: number;
  kills: number;
  routsCaused: number;
  heldLine: boolean;
  killedChampion: boolean;
  spellCasualties: number;
}

export interface BChampion {
  char: Character;
  companyId: string;
  role: 'captain' | 'hidden';
  trigger?: RevealTrigger;
  revealed: boolean;
  hp: number;
  maxHp: number;
  /** out of the fight this battle */
  down?: 'wounded' | 'killed';
  lastHitBy?: string;
  duelsWon: number;
}

export interface BSide {
  name: string;
  commander?: { name: string; leadership: number };
  stance: Stance;
  cohesion: number;
  integrity: number;
  /** battle mana pool; filled in by M2 */
  mana: number;
  maxMana: number;
  /** ordered to withdraw: the battle ends at the start of the next day with this side retreating */
  withdraw?: boolean;
  affinity: string[];
  forbiddenSchools: string[];
  risingBonus: number;
  xpMult: number;
  champions: Record<string, BChampion>;
  /** per-round spell buffs */
  buff: { rangedMult: number; deflected: boolean };
  reserveCommitted: boolean;
  lastDuelDay: number;
  companies: Record<string, BCompany>;
  lines: Record<Slot, string[]>;
}

export interface RoundLog {
  day: number;
  round: number;
  events: string[];
  losses: Record<SideKey, Record<string, number>>;
}

export interface SideSnap {
  strength: number;
  morale: number;
  cohesion: number;
  fatigue: number;
  integrity: number;
}

export interface DaySnap {
  day: number;
  attacker: SideSnap;
  defender: SideSnap;
}

export interface SideSummary {
  start: number;
  dead: number;
  wounded: number;
  captured: number;
  escaped: number;
  standing: number;
}

export interface BattleResult {
  /** decisive: one side destroyed/routed; victory: other side withdrew; draw: mutual */
  outcome: 'decisive' | 'victory' | 'draw';
  winner?: SideKey;
  pyrrhic: boolean;
  /** the loser left the field (withdrew) rather than being broken */
  withdrawn: boolean;
  /** men killed and captured while pursuing the fleeing, and wounded left on the field who were captured */
  pursuit: { killed: number; captured: number; woundedCaptured: number };
  summary: Record<SideKey, SideSummary>;
  /** champions who rose from companies after the battle */
  risen: { side: SideKey; companyId: string; character: Character }[];
  /** end-of-battle state of every champion who fought */
  champions: { side: SideKey; companyId: string; character: Character; outcome: 'fine' | 'wounded' | 'captured' | 'dead'; xpGained: number }[];
}

export interface Battle {
  seed: string;
  terrain: TerrainId;
  siege: boolean;
  defenseBonus: number;
  day: number;
  attacker: BSide;
  defender: BSide;
  result?: BattleResult;
  report: {
    /** sides as they were at the start of the battle */
    initial?: Record<SideKey, BSide>;
    rounds: RoundLog[];
    days: DaySnap[];
    moments: { day: number; round: number; text: string }[];
    nights: { day: number; text: string }[];
  };
}
