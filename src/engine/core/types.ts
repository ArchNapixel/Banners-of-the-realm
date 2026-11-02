import type { Battle, Character, RevealTrigger, Rank, Stance, TerrainId } from '../battle/types';

export type { Rank, Stance, TerrainId };
export type HexCoord = { q: number; r: number };
export type RaceId = 'valdren' | 'sylvaen' | 'durrakin' | 'ghor' | 'vashkari';
export type MapSize = 'small' | 'medium' | 'large';
export type Tier = 'hamlet' | 'village' | 'town' | 'city';
export type TaxLevel = 'low' | 'normal' | 'high';
export type KingdomId = string;
export type VillageId = string;

export interface Resources { food: number; gold: number; wood: number; stone: number; iron: number; horses: number; mana: number }

export interface GameSettings {
  seed: string;
  mapSize: MapSize;
  playerRace: RaceId;
  aiRaces: RaceId[];
  kingdomName?: string;
  /** AI kingdoms take their turns; off in most engine tests */
  aiEnabled?: boolean;
}

export interface Tile {
  q: number;
  r: number;
  terrain: TerrainId;
  regionId: string;
  ley?: true;
  ruins?: true;
  ancientForest?: true;
  goldDeposit?: true;
}

export interface Region { id: string; name: string; terrain: TerrainId; hexes: string[] }

export interface MapData {
  width: number;
  height: number;
  size: MapSize;
  tiles: Record<string, Tile>;
  regions: Record<string, Region>;
}

export interface BuildingInstance { id: string }
export interface QueueItem { id: string; turnsLeft: number }
/** A company in training: the men are already out of the village's population. */
export interface TrainItem extends QueueItem { race: RaceId; men: number; slot: string }

export interface Village {
  id: VillageId;
  name: string;
  ownerId: KingdomId | null;
  hex: HexCoord;
  tier: Tier;
  populationByRace: Partial<Record<RaceId, number>>;
  /** drifts with taxes, starvation and events; modifiers are added on top (see effectiveStability) */
  stability: number;
  taxLevel: TaxLevel;
  buildings: BuildingInstance[];
  buildQueue: QueueItem[];
  trainQueue: TrainItem[];
  /** workers go to buildings in this order; unlisted buildings follow */
  workerPriority: string[];
  stores: number;
  recentConscription: number;
  conqueredTurn?: number;
  /** temporary stability penalty from conquest, decays each turn */
  conquestPenalty: number;
  borderRadius: number;
  isBarrow?: boolean;
}

export interface Kingdom {
  id: KingdomId;
  name: string;
  color: string;
  kind: 'player' | 'ai';
  race: RaceId;
  resources: Resources;
  capitalId: VillageId;
  warWeariness: number;
  explored: string[];
  startingVillageCount: number;
  /** lost its last village */
  eliminated?: boolean;
  aiPersonality?: string;
  /** what the AI remembers between turns */
  ai?: { goal: string; targets: Record<string, HexCoord> };
}

export interface Company {
  id: string;
  ownerId: KingdomId;
  unitType: string;
  race: RaceId;
  men: number;
  /** full strength, for replenishing */
  maxMen: number;
  rank: Rank;
  battlesSurvived: number;
  armyId: string | null;
  hex: HexCoord;
  movementLeft: number;
  /** movement spent this turn, and whether it was a forced march: both feed starting Fatigue in battle */
  moved: number;
  forced: boolean;
  status: 'ready' | 'broken' | 'garrison';
  /** 0-100; broken companies start at 30 and recover 10 a turn */
  morale: number;
  battleId?: string;
  /** wounded who will rejoin once the turns run out (only while in supply) */
  recovering: { men: number; turnsLeft: number }[];
  /** the champion fighting with this company */
  captainId?: string;
  /** this company's last champion was killed (+15% rising chance) */
  heroLost?: boolean;
}

export interface GameCharacter extends Character {
  ownerId: KingdomId;
  role: 'captain' | 'hidden';
  trigger?: RevealTrigger;
  /** turns until a wounded champion can fight again */
  woundedTurns?: number;
}

export interface GameBattle {
  id: string;
  hex: HexCoord;
  turnStarted: number;
  attackerId: KingdomId;
  defenderId: KingdomId;
  battle: Battle;
  /** companies that arrived and join on the next battle day */
  pending: string[];
}

export interface FinishedBattle {
  id: string;
  name: string;
  hex: HexCoord;
  turnStarted: number;
  turnEnded: number;
  attackerId: KingdomId;
  defenderId: KingdomId;
  battle: Battle;
}

/** An army camped outside a walled village, waiting for the walls to fall or the stores to run out. */
export interface Siege {
  villageId: VillageId;
  attackerId: KingdomId;
  since: number;
  /** 0 to 1; at 1 the walls are breached and the assault begins */
  breach: number;
  stores: number;
  garrisonMorale: number;
}

export interface PendingCapture { captorId: KingdomId; turn: number }

export interface Prisoners {
  id: string;
  captorId: KingdomId;
  fromId: KingdomId;
  race: RaceId;
  men: number;
  hex: HexCoord;
  turn: number;
}

export interface Army {
  id: string;
  ownerId: KingdomId;
  name: string;
  companyIds: string[];
  hex: HexCoord;
  stance: Stance;
  commanderId?: string;
}

export interface GameEvent { turn: number; text: string; villageId?: VillageId; kingdomId?: KingdomId }

export interface GameState {
  seed: string;
  turn: number;
  settings: GameSettings;
  map: MapData;
  kingdoms: Record<KingdomId, Kingdom>;
  villages: Record<VillageId, Village>;
  companies: Record<string, Company>;
  armies: Record<string, Army>;
  characters: Record<string, GameCharacter>;
  battles: Record<string, GameBattle>;
  /** finished battles, newest last, for the report screen */
  reports: FinishedBattle[];
  prisoners: Record<string, Prisoners>;
  sieges: Record<VillageId, Siege>;
  /** villages taken but not yet occupied, sacked or razed */
  captures: Record<VillageId, PendingCapture>;
  /** hex key -> kingdom that built a road there */
  roads: Record<string, KingdomId>;
  nextId: number;
  usedNames: string[];
  log: GameEvent[];
}
