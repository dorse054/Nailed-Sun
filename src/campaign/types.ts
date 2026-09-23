/**
 * Campaign state. Everything here is plain JSON so a campaign saves and
 * loads as-is, and the turn logic stays deterministic from its seed.
 */
import type { FactionId } from '../data/schema';
import type { BattleResult, BattleSetup } from '../sim/types';

export type Owner = FactionId | 'free';

export interface BuildingSlot {
  chain: string;
  level: number;
  /** Upgrade under way: finishes at the start of the next Toll. */
  building?: { toLevel: number; turnsLeft: number };
}

export interface RegionState {
  id: string;
  owner: Owner;
  /** Settlement level: 1-4 major, 1-3 minor. */
  level: number;
  growth: number;
  slots: (BuildingSlot | null)[];
  /** Public order, -20..20. At -20 the region revolts. */
  order: number;
  /** Toll the current owner took it (for unrest). */
  takenTurn: number;
  /** Candles only: lit or put out by the Hush. */
  lit?: boolean;
  /** A Drift mooring: a trading post that pays the Drift every Toll. */
  mooring?: boolean;
  /** Raided this Toll by an enemy army. */
  raidedBy?: FactionId;
  /** Tolls of sudden Nightfall left (the Great Shudder). */
  nightfall?: number;
  /** Tolls until a Hush ritual here can be repeated. */
  ritualCooldown?: number;
  /** Culture of a free settlement's garrison (which roster it fields). */
  culture: FactionId;
  /** Lost garrison share after a failed assault, recovers over time. */
  garrisonLoss?: number;
}

export interface CampaignUnit {
  def: string;
  /** 0..1 share of full strength. */
  strength: number;
  /** Experience rank 0..3. */
  rank: number;
  xp: number;
}

export type ArmyStance = 'march' | 'raid' | 'fortify' | 'ambush';

export interface LordState {
  name: string;
  def: string;
  legendary: boolean;
  traits: string[];
  /** Battles won, for flavor and AI trust. */
  wins: number;
}

export interface ArmyState {
  id: string;
  faction: FactionId;
  name: string;
  lord: LordState;
  units: CampaignUnit[];
  region: string;
  /** Movement points left this Toll (a full Toll is 100). */
  moves: number;
  stance: ArmyStance;
  /** Where it came from last (sets the approach direction in battle). */
  from?: string;
  /** Drift wind-cities build and recruit on the move. */
  city?: { level: number; slots: (BuildingSlot | null)[] };
  /** Bands visited on the current Drift migration. */
  bandsVisited?: number[];
  /** Crusade target (Choir). */
  crusade?: { target: string; turns: number };
  /** Hidden on the Shadow Roads until it attacks (Hush). */
  shadowed?: boolean;
  /** Fought or moved into battle this Toll. */
  fought?: boolean;
}

export type Stance = 'war' | 'peace' | 'alliance';

export interface Relation {
  stance: Stance;
  /** -100..100 */
  opinion: number;
  trade: boolean;
  /** Toll a peace was signed; breaking it early angers everyone. */
  since: number;
  /** One faction pays the other every Toll. */
  tribute?: { from: FactionId; amount: number; turns: number };
  /** Vassal relationship: the key's second faction serves the first. */
  vassal?: FactionId;
}

export type HymnId = 'noon' | 'lens' | 'unbowed' | 'harvest';
export type ObservanceId = 'harvest' | 'muster' | 'market' | 'vigil';
export type HouseId = 'carillon' | 'lantern' | 'weir';

export interface Herd {
  region: string;
  size: number;
  /** Hunted this Toll. */
  hunted: number;
}

export interface FactionState {
  id: FactionId;
  player: boolean;
  alive: boolean;
  coin: number;
  food: number;
  /** Radiance, Dread, Hours or Renown. */
  res: number;
  // Choir
  zeal: number;
  hymn?: { id: HymnId; turns: number };
  lens: number;
  lensBuilding?: boolean;
  // Hush
  herds: Herd[];
  // Vesperate
  calendar: ObservanceId[];
  houses: Record<HouseId, number>;
  greatTollCooldown: number;
  /** Toll whose Observance lapsed for want of Hours. */
  lapsed?: number;
  // Drift
  migrations: number;
  // Everyone
  colossus: { alive: boolean; rebuildAt: number; built: boolean };
  /** Consecutive Tolls the faction met its hold condition. */
  hold: number;
  /** Began its final victory stage: every rival gets +15% leadership against it. */
  finalStage: boolean;
  /** Toll a legendary lord returns after falling. */
  lordReturns?: number;
  /** Counts for names and ids. */
  armiesRaised: number;
  /** Battles won and lost, for the summary. */
  wins: number;
  losses: number;
  /** Last Toll's income breakdown for the UI. */
  last?: Ledger;
  /** What the campaign AI is set on, carried from Toll to Toll (AI factions only). */
  ai?: AiMemory;
}

export type AiFocusKind = 'expand' | 'defend' | 'victory' | 'war' | 'economy';

export interface AiMemory {
  /** A strategic focus chosen for a few Tolls (by the scripted AI or Jev). */
  focus?: { kind: AiFocusKind; target?: FactionId; until: number; by: 'script' | 'jev' };
  /** Each army's current objective region, so marches are not abandoned halfway. */
  orders?: Record<string, string>;
  /** Last Toll Jev was asked for advice. */
  jevTurn?: number;
  /** A war Jev chose: the script will not sue for peace with them before this Toll. */
  holdWar?: { target: FactionId; until: number };
  /** Last Toll this faction put a deal to the player. */
  lastOffer?: number;
  /** Last Toll the player refused each kind of deal from this faction ('demand' for a tribute demand). */
  refused?: Partial<Record<string, number>>;
  /** Wars joined only to stop a rival's victory, by the Toll they were declared. */
  coalition?: Partial<Record<FactionId, number>>;
}

export interface Ledger {
  coinIn: number;
  coinOut: number;
  foodIn: number;
  foodOut: number;
  resIn: number;
  lines: { label: string; coin?: number; food?: number; res?: number }[];
}

export type EventKind =
  | 'info'
  | 'battle'
  | 'capture'
  | 'loss'
  | 'build'
  | 'tilt'
  | 'diplomacy'
  | 'revolt'
  | 'shudder'
  | 'victory'
  | 'warning';

export interface CampaignEvent {
  turn: number;
  kind: EventKind;
  text: string;
  /** Faction the event matters to, or everyone. */
  faction?: FactionId;
  region?: string;
  /** Set when the Jev advisor made the choice behind it. */
  by?: 'jev';
}

/** A battle waiting for the player: fight it, or let the sim auto-resolve it. */
export interface PendingBattle {
  id: string;
  attacker: { faction: Owner; armies: string[] };
  defender: { faction: Owner; armies: string[]; garrison: boolean };
  region: string;
  from: string;
  /** Settlement assault (garrison and walls) or field battle. */
  assault: boolean;
  setup?: BattleSetup;
}

export interface BattleReport {
  id: string;
  turn: number;
  region: string;
  attacker: Owner;
  defender: Owner;
  winner: Owner | null;
  assault: boolean;
  captured: boolean;
  lossesA: number;
  lossesD: number;
  startA: number;
  startD: number;
  fought: boolean;
  result?: BattleResult;
}

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface CampaignState {
  version: 1;
  seed: number;
  turn: number;
  /** -5 (nightward) .. +5 (sunward). */
  tilt: number;
  /** Pressure toward the next Tilt step, -100..100. */
  tiltProgress: number;
  player: FactionId;
  difficulty: Difficulty;
  factions: Record<FactionId, FactionState>;
  regions: Record<string, RegionState>;
  armies: ArmyState[];
  /** Keyed "a|b" with a < b. */
  relations: Record<string, Relation>;
  events: CampaignEvent[];
  reports: BattleReport[];
  shudder: { active: boolean; next: number; stillness: number };
  winner?: { faction: FactionId; kind: string; turn: number };
  nextId: number;
  rng: [number, number, number, number];
  /** Options set at the start. */
  options: { colossusUnique: boolean; jev: boolean };
}
