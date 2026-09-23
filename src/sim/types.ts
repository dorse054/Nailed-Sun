/**
 * Runtime state of a battle. Everything here is plain data owned by Battle;
 * the renderer only reads it.
 */
import type {
  AbilityDef,
  DamageType,
  FactionId,
  HourId,
  LightLevel,
  MissileWeapon,
  StatMods,
  UnitDef,
  WindLevel,
  ZoneDef,
} from '../data/schema';
import type { MapSetup } from './terrain';

export type Side = 0 | 1;

export interface Soldier {
  id: number;
  unit: Unit;
  slot: number;
  x: number;
  y: number;
  /** Position at the previous tick, for render interpolation. */
  px: number;
  py: number;
  vx: number;
  vy: number;
  facing: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** The character at the head of a lord's bodyguard. */
  leader: boolean;
  radius: number;
  mass: number;
  armor: number;
  ma: number;
  md: number;
  /** Current melee opponent. */
  target: Soldier | null;
  /** Enemy soldier this soldier is closing on. */
  approach: Soldier | null;
  atkTimer: number;
  /** Seconds of charge bonus left (fades linearly). */
  chargeTimer: number;
  /** Charge bonus this soldier landed with. */
  cb: number;
  /** Running in; the first contact is an impact. */
  charging: boolean;
  downTimer: number;
  staggerTimer: number;
  reload: number;
  ammo: number;
  burn: number;
  burnDps: number;
  seek: number;
  kills: number;
  /** Flyers in the air cannot be reached by ground melee. */
  airborne: boolean;
  /** Direction of the last melee hit taken, for flank checks. */
  hitFrom: number;
  /** Tick of the last melee hit taken from the flank (1) or rear (2). */
  flankTick: number;
  flankKind: number;
  /** Ambush strike available (stealth units). */
  ambush: boolean;
  /** Big bodies: how many enemy soldiers are fighting this one in melee (recounted every tick). */
  attackers: number;
  /** The last burning ground that caught this soldier: when it burns out, its center and radius. */
  hotUntil: number;
  hotX: number;
  hotY: number;
  hotR: number;
}

export type UnitState = 'ready' | 'routing' | 'shattered' | 'dead' | 'fled' | 'embarked';

export type Order =
  | { kind: 'hold' }
  | { kind: 'move'; x: number; y: number; facing: number; files: number; run: boolean }
  | { kind: 'attack'; target: number; run: boolean }
  | { kind: 'embark'; target: number };

export interface Buff {
  mods: StatMods;
  until: number;
  tag?: string;
  source?: number;
}

export interface AbilityState {
  def: AbilityDef;
  cooldown: number;
  uses: number;
  on: boolean;
  windup: number;
  channel: number;
  exit: number;
  tx: number;
  ty: number;
  targetUnit: number;
  /** Script scratch values. */
  t: number;
  hitSet: Set<number> | null;
}

/** Effective stats, rebuilt every tick from traits, passives, buffs and zones. */
export interface UnitStats {
  ma: number;
  md: number;
  maMult: number;
  mdMult: number;
  dmgMult: number;
  missileDmgMult: number;
  accuracyMult: number;
  rangeMult: number;
  reloadMult: number;
  speedMult: number;
  attackSpeedMult: number;
  chargeBonus: number;
  leadershipMult: number;
  moraleRegen: number;
  moraleDrain: number;
  missileBlock: number;
  armorAdd: number;
  damageTakenMult: number;
  fatigueRateMult: number;
  fatigueRecoveryMult: number;
  spotMult: number;
  noKnockback: boolean;
  unbreakable: boolean;
  fearImmune: boolean;
  ignoreDarkness: boolean;
  noFatigue: boolean;
  forceHidden: boolean;
  revealed: boolean;
  markedPct: number;
  /** Glare currently suffered (accuracy %, melee attack). */
  glareAcc: number;
  glareMa: number;
  glareSource: 'none' | 'sun' | 'noon' | 'mirror' | 'dazzle';
}

export interface Unit {
  id: number;
  def: UnitDef;
  side: Side;
  faction: FactionId;
  soldiers: Soldier[];
  alive: number;
  initial: number;
  /** Formation anchor (center) and facing. */
  x: number;
  y: number;
  facing: number;
  files: number;
  formation: 'block' | 'ring';
  order: Order;
  path: { x: number; y: number }[];
  moving: boolean;
  running: boolean;
  /** Committed to leaving a melee (withdraw). */
  withdrawing: boolean;
  meleeTarget: Unit | null;
  missileTarget: Unit | null;
  fireAtWill: boolean;
  engaged: number;
  lastMeleeTime: number;
  lastLossTime: number;
  lastFireTime: number;
  focus: number;
  focusTarget: number;
  morale: number;
  maxMorale: number;
  state: UnitState;
  routs: number;
  rallyTimer: number;
  /** Soldiers lost per second over the last 8 seconds (ring buffer). */
  losses: number[];
  /** Damage dealt and taken in melee over the last seconds, for morale. */
  meleeDealt: number;
  meleeTaken: number;
  fatigue: number;
  buffs: Buff[];
  stats: UnitStats;
  light: LightLevel;
  wind: WindLevel;
  visible: [boolean, boolean];
  lastSeen: [number, number];
  concealed: boolean;
  chill: number;
  slow: number;
  slowPct: number;
  grounded: number;
  marked: number;
  stunLock: number;
  tollUntil: number;
  abilities: AbilityState[];
  /** Per-unit special state for colossi and gliders. */
  special: Record<string, number>;
  kills: number;
  damageDealt: number;
  /** Points of enemy value destroyed: hit points taken off enemies, priced at their unit's cost. */
  valueDealt: number;
  damageTaken: number;
  isGeneral: boolean;
  embarkedOn: Unit | null;
  passengers: Unit[];
  /** Charge bonus locked in when this charge started. */
  chargeValue: number;
  chargeStart: number;
  /** Cached formation slot offsets (right, back), recomputed on change. */
  slots: Float64Array;
  slotsDirty: boolean;
  /** Label used by tutorials and AI scripts. */
  tag: string;
  /** Upkeep/cost reference. */
  cost: number;
  /** Maximum hit points of the whole unit at the start. */
  hpStart: number;
  /**
   * Single entities (colossi, artillery, heroes, monsters) do not shrink with
   * the unit size setting, so at smaller sizes their HP and attack rate scale
   * instead. Battles then play out alike at any unit size.
   */
  entityScale: number;
  /** Alternate ammunition selected. */
  altAmmo: boolean;
}

export interface Zone {
  id: number;
  def: ZoneDef;
  side: Side;
  x: number;
  y: number;
  radius: number;
  until: number;
  source: Unit | null;
  attached: boolean;
  enabled: boolean;
  spreadAt: number;
  generation: number;
  born: number;
  /** Burning ground set by a weapon: its fire damage per second (else the zone definition's). */
  dps?: number;
}

export interface Projectile {
  id: number;
  side: Side;
  weapon: MissileWeapon;
  shooter: Unit;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
  T: number;
  arc: number;
  dmgMult: number;
  /** Intended victim, used by direct shots. */
  victim: Soldier | null;
  alive: boolean;
}

export interface Telegraph {
  id: number;
  unit: number;
  side: Side;
  name: string;
  shape: 'circle' | 'cone' | 'line' | 'ring' | 'arc';
  x: number;
  y: number;
  radius: number;
  dir: number;
  angle: number;
  width: number;
  start: number;
  end: number;
}

export type Command =
  | { type: 'move'; unit: number; x: number; y: number; facing?: number; files?: number; run?: boolean }
  | { type: 'attack'; unit: number; target: number; run?: boolean }
  | { type: 'halt'; unit: number }
  | { type: 'run'; unit: number; on: boolean }
  | { type: 'fireAtWill'; unit: number; on: boolean }
  | { type: 'meleeMode'; unit: number; on: boolean }
  | { type: 'ability'; unit: number; ability: string; x?: number; y?: number; target?: number }
  | { type: 'hour'; side: Side; hour: HourId }
  | { type: 'embark'; unit: number; target: number }
  | { type: 'disembark'; unit: number }
  | { type: 'withdraw'; unit: number }
  /** The side's general changes plan in the middle of the battle (see ArmyPlan), with a word to the army. */
  | { type: 'plan'; stance: 'attack' | 'defend'; patience?: number; speech?: string };

export interface TimedCommand {
  tick: number;
  side: Side;
  cmd: Command;
}

export type SimEvent =
  | { t: 'shot'; kind: MissileWeapon['kind']; x: number; y: number; side: Side }
  | { t: 'beam'; kind: 'beam' | 'heliostat' | 'lance'; x1: number; y1: number; x2: number; y2: number; power: number; blocked: boolean; side: Side }
  | { t: 'impact'; x: number; y: number; kind: MissileWeapon['kind']; splash: number }
  | { t: 'hit'; x: number; y: number; type: DamageType; big: boolean }
  | { t: 'block'; x: number; y: number }
  | { t: 'death'; x: number; y: number; unit: number; big: boolean }
  | { t: 'charge'; x: number; y: number; unit: number; power: number }
  | { t: 'toll'; side: Side; x: number; y: number; hour: HourId; big: boolean }
  | { t: 'ability'; unit: number; name: string; x: number; y: number; side: Side }
  | { t: 'rout'; unit: number; side: Side }
  | { t: 'rally'; unit: number; side: Side }
  | { t: 'shatter'; unit: number; side: Side }
  | { t: 'general'; side: Side }
  | { t: 'shockwave'; x: number; y: number; r: number; kind: 'bell' | 'knell' | 'flash' | 'dust' | 'eyes' | 'ram' }
  | { t: 'text'; x: number; y: number; text: string; side: Side }
  | { t: 'fire'; x: number; y: number }
  | { t: 'plan'; side: Side; stance: 'attack' | 'defend'; speech?: string };

export interface UnitSpec {
  def: string;
  x?: number;
  y?: number;
  facing?: number;
  files?: number;
  /** 0..1 share of soldiers present (campaign casualties). */
  strength?: number;
  tag?: string;
  /** Campaign experience rank 0..3 (+3 MA/MD per rank). */
  rank?: number;
}

export interface ArmySetup {
  faction: FactionId;
  units: UnitSpec[];
  controller: 'player' | 'ai';
  hour?: HourId;
  /** Army-wide leadership modifier in % (campaign traits, Dread, Bell Range). */
  leadershipPct?: number;
  /** Army-wide stat modifiers from the campaign (Hymns, Observances). */
  mods?: StatMods;
  name?: string;
  /** AI style: 'default' uses the faction personality. */
  ai?: 'default' | 'aggressive' | 'defensive' | 'passive';
  /** The AI general's plan, chosen before the battle (by Claude, when asked). Part of the setup, so replays follow it. */
  plan?: ArmyPlan;
}

export interface ArmyPlan {
  /** Bring the enemy to battle, or hold and let them come. */
  stance: 'attack' | 'defend';
  /** Seconds a holding army waits for the enemy before it advances anyway. */
  patience?: number;
  /** What the general tells the army before the battle. */
  speech?: string;
}

export interface BattleSetup {
  seed: number | string;
  map: MapSetup;
  armies: [ArmySetup, ArmySetup];
  /** Soldier count multiplier (unit size setting). */
  unitScale?: number;
  /** Seconds before the defender (side 1) wins by default. */
  timeLimit?: number;
  /** In fortified battles the attacker must take the capture point. */
  attacker?: Side;
}

export interface UnitSummary {
  id: number;
  def: string;
  name: string;
  start: number;
  alive: number;
  kills: number;
  damageDealt: number;
  /** Points of enemy value destroyed (hit points priced at the victim's cost). */
  valueDealt?: number;
  state: UnitState;
  cost: number;
  /** Share of the unit's starting hit points still standing, 0..1. */
  hp: number;
}

export interface SideSummary {
  faction: FactionId;
  soldiersStart: number;
  soldiersLost: number;
  costStart: number;
  costLost: number;
  units: UnitSummary[];
}

export interface BattleResult {
  winner: Side | -1;
  reason: 'rout' | 'timeout' | 'capture' | 'withdraw';
  time: number;
  sides: [SideSummary, SideSummary];
}

export function emptyStats(): UnitStats {
  return {
    ma: 0,
    md: 0,
    maMult: 1,
    mdMult: 1,
    dmgMult: 1,
    missileDmgMult: 1,
    accuracyMult: 1,
    rangeMult: 1,
    reloadMult: 1,
    speedMult: 1,
    attackSpeedMult: 1,
    chargeBonus: 0,
    leadershipMult: 1,
    moraleRegen: 0,
    moraleDrain: 0,
    missileBlock: 0,
    armorAdd: 0,
    damageTakenMult: 1,
    fatigueRateMult: 1,
    fatigueRecoveryMult: 1,
    spotMult: 1,
    noKnockback: false,
    unbreakable: false,
    fearImmune: false,
    ignoreDarkness: false,
    noFatigue: false,
    forceHidden: false,
    revealed: false,
    markedPct: 0,
    glareAcc: 0,
    glareMa: 0,
    glareSource: 'none',
  };
}
