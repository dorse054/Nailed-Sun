/**
 * Data schema for Nailed Sun.
 *
 * Every unit, ability, zone and faction is declared as data in src/data.
 * The simulation reads these declarations; unit-specific behavior is limited
 * to the named mechanics and ability scripts listed here.
 */

export type FactionId = 'choir' | 'hush' | 'vesperate' | 'drift';
export const FACTION_IDS: readonly FactionId[] = ['choir', 'hush', 'vesperate', 'drift'];

/** Light levels, darkest first. Numeric so they compare with < and >. */
export type LightLevel = 0 | 1 | 2 | 3 | 4;
export const LIGHT = { Dark: 0, Dim: 1, Dusk: 2, Bright: 3, Blaze: 4 } as const;
export const LIGHT_NAMES = ['Dark', 'Dim', 'Dusk', 'Bright', 'Blaze'] as const;

export type WindLevel = 0 | 1 | 2;
export const WIND = { Calm: 0, Breeze: 1, Gale: 2 } as const;
export const WIND_NAMES = ['Calm', 'Breeze', 'Gale'] as const;

/** The five light bands of the campaign map, nightward first. */
export type BandId = 'evernight' | 'dimmark' | 'gloaming' | 'longAfternoon' | 'glare';
export const BAND_IDS: readonly BandId[] = ['evernight', 'dimmark', 'gloaming', 'longAfternoon', 'glare'];

export type SizeClass = 'small' | 'large' | 'colossal';
export type DamageType = 'normal' | 'fire' | 'cold' | 'resonance';

/** Battle roles from the design doc's counters table, plus support and characters. */
export type Role =
  | 'line'
  | 'antiLarge'
  | 'shock'
  | 'missile'
  | 'shockCav'
  | 'missileCav'
  | 'monster'
  | 'artillery'
  | 'flyer'
  | 'support'
  | 'colossus'
  | 'lord'
  | 'hero';

export type Category = 'infantry' | 'cavalry' | 'beast' | 'monster' | 'artillery' | 'flyer' | 'colossus' | 'character';

export type HourId = 'charge' | 'iron' | 'rest';

/** Stat modifiers. Flat values add; Pct values are percentages (+10 = +10%). */
export interface StatMods {
  ma?: number;
  md?: number;
  maPct?: number;
  mdPct?: number;
  dmgPct?: number;
  missileDmgPct?: number;
  accuracyPct?: number;
  rangePct?: number;
  reloadPct?: number;
  speedPct?: number;
  attackSpeedPct?: number;
  chargeBonus?: number;
  chargeBonusPct?: number;
  leadershipPct?: number;
  /** Morale recovered per second, in % of max leadership. */
  moraleRegen?: number;
  /** Morale drained per second, in % of max leadership. */
  moraleDrain?: number;
  missileBlock?: number;
  armor?: number;
  damageTakenPct?: number;
  fatigueRatePct?: number;
  fatigueRecoveryPct?: number;
  spotPct?: number;
  noKnockback?: boolean;
  unbreakable?: boolean;
  fearImmune?: boolean;
  ignoreDarkness?: boolean;
  noFatigue?: boolean;
  /** Forces the unit hidden even while fighting (Queen Ysh's Unlit Step). */
  forceHidden?: boolean;
  /** Revealed to the enemy regardless of stealth. */
  revealed?: boolean;
  /** +damage taken from enemy stealth units (Glowkin mark). */
  markedPct?: number;
}

/** Conditions that gate a passive. All listed conditions must hold. */
export interface Conditions {
  lightMin?: LightLevel;
  lightMax?: LightLevel;
  windMin?: WindLevel;
  windMax?: WindLevel;
  stationary?: boolean;
  moving?: boolean;
  inCombat?: boolean;
  facingSun?: boolean;
  tollActive?: boolean;
}

export interface PassiveDef {
  id: string;
  name: string;
  desc: string;
  when?: Conditions;
  mods: StatMods;
}

/** Effects that ride on a single hit. */
export type OnHit =
  | { kind: 'chill' }
  | { kind: 'burn'; dps: number; duration: number }
  | { kind: 'stagger'; duration: number }
  | { kind: 'knockdown'; chance: number }
  | { kind: 'leadership'; pct: number }
  | { kind: 'mark'; duration: number }
  | { kind: 'slow'; pct: number; duration: number; largeOnly?: boolean; grounds?: boolean }
  | { kind: 'swallow'; chance: number }
  | { kind: 'lightZone'; zone: string; duration: number };

export interface MeleeWeapon {
  base: number;
  ap: number;
  type?: DamageType;
  vsLarge?: number;
  vsInfantry?: number;
  /** Seconds between swings. */
  interval: number;
  /** Reach in meters beyond the two bodies. */
  reach?: number;
  /** Large attackers hit several soldiers per swing. */
  splash?: { targets: number; radius: number };
  onHit?: OnHit[];
}

export type Trajectory = 'arc' | 'direct' | 'beam' | 'lineBeam' | 'cone';

export interface MissileWeapon {
  /** Visual and sound family. */
  kind:
    | 'arrow'
    | 'shard'
    | 'bolt'
    | 'javelin'
    | 'harpoon'
    | 'firebomb'
    | 'stone'
    | 'glassPot'
    | 'frostBall'
    | 'beam'
    | 'heliostat'
    | 'kite'
    | 'ballista'
    | 'shockwave'
    | 'bolas'
    | 'spore'
    | 'dart';
  trajectory: Trajectory;
  range: number;
  minRange?: number;
  /** Shots per soldier or engine. */
  ammo: number;
  /** Seconds between shots. */
  reload: number;
  /** 0..1; sets scatter. */
  accuracy: number;
  damage: number;
  ap: number;
  type?: DamageType;
  vsLarge?: number;
  /** Projectile speed in m/s (ignored by beams). */
  speed?: number;
  /** Area radius for artillery and bombs. */
  splash?: number;
  /** Seconds to focus before the first shot at a new target. */
  focus?: number;
  /** Beam damage scales with local light (130% Blaze ... 20% Dark). */
  lightScaled?: boolean;
  /** Ignores wind for range and accuracy (beams). */
  windless?: boolean;
  needsLOS?: boolean;
  /** Armor counts this much more against it (glass shards: 1.5). */
  armorMult?: number;
  /** Wind-borne range: downwind / upwind extremes (Firekite Battery). */
  windRange?: { down: number; up: number; calm: number };
  /** Can fire while the unit moves. */
  whileMoving?: boolean;
  /** Burning ground left where it lands. */
  ignite?: { radius: number; duration: number; dps: number };
  /** Cone attack (Knell Cannon): angle in degrees. */
  cone?: { angle: number };
  knockback?: number;
  onHit?: OnHit[];
  /** Resonance and similar: shields don't block. */
  ignoresShields?: boolean;
  /** Only fires at large and colossal targets (tether harpoons). */
  preferLarge?: boolean;
  /** Can target flyers (all missiles can, this is a bonus multiplier). */
  vsFlyerPct?: number;
  /** Zone left where the shot lands (spore clouds, frost fields). */
  impactZone?: { zone: string; duration: number };
  /** Hits every soldier near the line (ballista bolts pierce ranks). */
  pierce?: number;
}

/** A light or dark zone, or any area aura. */
export interface ZoneDef {
  id: string;
  name: string;
  radius: number;
  /** Light zones set a floor ("at least"), dark zones a ceiling ("at most"). */
  light?: { mode: 'floor' | 'ceiling'; level: LightLevel; intensity: 1 | 2 | 3 };
  reveals?: boolean;
  blocksBeams?: boolean;
  /** Accuracy change, in %, for missiles fired into the zone (Veil: -30). */
  missileAccuracyInto?: number;
  /** Enemies facing the zone's source suffer glare (Walking Noon). */
  glareSource?: boolean;
  enemyMods?: StatMods;
  allyMods?: StatMods;
  /** Damage per second to soldiers inside (burning ground). */
  dps?: { damage: number; type: DamageType; friendly: boolean };
  /** Leadership drained per second from enemies inside, in %. */
  drain?: number;
  /** Wind steps added inside (Wind-Reader's Gust). */
  windDelta?: number;
  /** Fire spreads sunward in Breeze and Gale. */
  spreads?: boolean;
  /** Limits enemy/ally mods to these categories (Lure: infantry only). */
  affects?: Category[];
  visual: ZoneVisual;
}

export type ZoneVisual =
  | 'lantern'
  | 'sunpatch'
  | 'noon'
  | 'veil'
  | 'eclipse'
  | 'fire'
  | 'dust'
  | 'spores'
  | 'gust'
  | 'signal'
  | 'lure'
  | 'howl'
  | 'verse';

export type Area =
  | { shape: 'circle'; radius: number; at?: 'self' | 'target' }
  | { shape: 'cone'; radius: number; angle: number }
  | { shape: 'line'; length: number; width: number }
  | { shape: 'field' };

export type Who = 'self' | 'allies' | 'enemies' | 'all' | 'target';

/** Shared effect blocks that abilities are built from. */
export type Effect =
  | {
      kind: 'damage';
      who: Who;
      area: Area;
      damage: number;
      ap: number;
      type?: DamageType;
      onHit?: OnHit[];
      /** Only hits this share of soldiers in the area (0..1). */
      share?: number;
    }
  | { kind: 'knockback'; who: Who; area: Area; force: number; knockdown: number; exceptHour?: HourId }
  | { kind: 'zone'; zone: string; at: 'self' | 'target' | 'attached'; duration: number }
  | { kind: 'buff'; who: Who; area?: Area; mods: StatMods; duration: number; tag?: string }
  | { kind: 'leadership'; who: Who; area: Area; pct: number; breakWavering?: boolean }
  | { kind: 'reveal'; area: Area; duration: number }
  | { kind: 'repair'; pct: number; targets: string[] }
  | { kind: 'ground'; who: Who; area: Area; duration: number }
  | { kind: 'summon'; unit: string; count: number }
  | { kind: 'toll' }
  | { kind: 'script'; name: AbilityScript };

/** Abilities whose motion or timing needs bespoke code. */
export type AbilityScript =
  | 'noonLance'
  | 'unveil'
  | 'hourThatNeverComes'
  | 'dive'
  | 'thousandEyes'
  | 'rammingRun'
  | 'harpoonHook'
  | 'gustLeap'
  | 'stoop'
  | 'signal'
  | 'allSails';

export interface AbilityDef {
  id: string;
  name: string;
  desc: string;
  /** Active: fire and forget. Toggle: a stance switched on and off. */
  kind: 'active' | 'toggle';
  target: 'self' | 'point' | 'enemy' | 'ally' | 'direction';
  range?: number;
  cooldown: number;
  /** Uses per battle; undefined means unlimited. */
  uses?: number;
  /** Visible windup before the effect lands (>= 2 s for big abilities). */
  windup?: number;
  /** Seconds the caster stays committed after the windup. */
  channel?: number;
  effects: Effect[];
  /** Stance settings for toggles. */
  stance?: {
    mods?: StatMods;
    formation?: 'ring' | 'square';
    immobile?: boolean;
    /** Turns off the unit's own light zone (Lantern Guard Shutter). */
    lightOff?: boolean;
    /** Braced stance: brace value against charges. */
    brace?: number;
    /** Takes this long to leave the stance (Drop Anchor: 10 s). */
    exitTime?: number;
    /** Switches to the unit's alternate missile (Counterweight lantern-shot). */
    altMissile?: boolean;
  };
  /** Hint for the scripted AI. */
  ai?: AbilityAiHint;
  /** Key shown on the button (1-6 are assigned in order when absent). */
  hotkey?: string;
}

export type AbilityAiHint =
  | 'selfWhenEngaged'
  | 'selfWhenCavalryNear'
  | 'onEnemyCluster'
  | 'onEnemyInFront'
  | 'onAllyCluster'
  | 'onHiddenEnemies'
  | 'onEnemyLarge'
  | 'onEnemyCharacter'
  | 'onEnemyArtillery'
  | 'whenEnemyBeams'
  | 'onToll'
  | 'whenLosing'
  | 'always'
  | 'never';

/** Named mechanics implemented in simulation code. Parameters live here. */
export type Mechanic =
  | { kind: 'brittle' }
  | { kind: 'glassblind' }
  | { kind: 'mirrorflash' }
  | { kind: 'lockMirrors'; block: number; dazzleRange: number }
  | { kind: 'noFatigueInLight' }
  | { kind: 'burningFaith'; hpLossPct: number }
  | { kind: 'coldBlooded'; blazeSpeedPct: number; darkSpeedPct: number }
  | { kind: 'moltenCore'; damage: number }
  | { kind: 'glows' }
  | { kind: 'marks'; pct: number }
  | { kind: 'stealth'; whileMoving: boolean; lightMax?: LightLevel; shadow: boolean; forest: boolean; revealOnFire: 'always' | 'notInDark' }
  | { kind: 'ambush'; dmgPct: number; fear: boolean }
  | { kind: 'silentCharge' }
  | { kind: 'zone'; zone: string; toggleable?: boolean }
  | { kind: 'blind' }
  | { kind: 'flyer'; glider?: { seconds: number } }
  | { kind: 'fireVulnerable'; pct: number }
  | { kind: 'lure'; radius: number; mdPenalty: number }
  | { kind: 'hooks' }
  | { kind: 'braceBonus'; value: number }
  | { kind: 'pavise'; block: number }
  | { kind: 'bell'; interval: number; range: number | 'field'; drainWavering?: number }
  | { kind: 'tollRelay'; extra: number }
  | { kind: 'tollCharge' }
  | { kind: 'scatter'; missileReduction: number }
  | { kind: 'moored' }
  | { kind: 'leapingCharge' }
  | { kind: 'howl'; radius: number; drain: number }
  | { kind: 'fearAura'; radius: number; drain: number }
  | { kind: 'hearHidden'; radius: number }
  | { kind: 'hideAura'; radius: number }
  | { kind: 'heatImmune' }
  | { kind: 'vsRouting'; pct: number }
  | { kind: 'vsMissile'; pct: number }
  | { kind: 'colossus' }
  | { kind: 'garrison'; slots: number }
  | { kind: 'carrier' }
  | { kind: 'sailing' }
  | { kind: 'elkTeam'; hpPct: number }
  | { kind: 'drawnToFlame'; dmgPct: number }
  | { kind: 'coreExposed' }
  | { kind: 'signalMark'; accuracyPct: number }
  | { kind: 'repairer' }
  | { kind: 'refitsOnCarrier' }
  | { kind: 'feignedFlight' }
  | { kind: 'windReader' }
  | { kind: 'lanternSight' };

export interface SilhouetteDef {
  /** Base shape family, read at full zoom-out. */
  shape:
    | 'tall'
    | 'shieldWall'
    | 'pike'
    | 'blade'
    | 'bow'
    | 'staff'
    | 'rider'
    | 'heavyRider'
    | 'giant'
    | 'engine'
    | 'beast'
    | 'hound'
    | 'moth'
    | 'glider'
    | 'kite'
    | 'wagon'
    | 'character'
    | 'colossus';
  /** Body length / width in meters (defaults by category). */
  length?: number;
  width?: number;
  /** Visual accent color (hex). */
  accent?: string;
  /** Emits a glow in the dark (Hush lichen, lanterns, molten glass). */
  glow?: string;
}

/** Stats for the character soldier at the head of a lord's unit. */
export interface LeaderStats {
  hp: number;
  armor: number;
  ma: number;
  md: number;
  weapon: MeleeWeapon;
  mass: number;
  size: SizeClass;
  missile?: MissileWeapon;
}

export interface UnitDef {
  id: string;
  name: string;
  faction: FactionId;
  role: Role;
  /** Role as the doc names it, e.g. "Shield infantry". */
  roleLabel: string;
  category: Category;
  tier: 1 | 2 | 3 | 4 | 5;
  cost: number;
  soldiers: number;
  hp: number;
  armor: number;
  ma: number;
  md: number;
  weapon: MeleeWeapon;
  charge: number;
  mass: number;
  /** Top speed in m/s. Walking is half of this. */
  speed: number;
  leadership: number;
  size: SizeClass;
  /** Missile block chance against shots from the front (0..1). */
  shield?: number;
  missile?: MissileWeapon;
  /** Soldier spacing in meters; ranks default by category. */
  spacing?: number;
  ranks?: number;
  /** Body radius in meters. */
  radius?: number;
  mechanics?: Mechanic[];
  passives?: PassiveDef[];
  abilities?: AbilityDef[];
  /** Alternate ammunition selected by a toggle ability. */
  altMissile?: MissileWeapon;
  /** Lords: the character leads a bodyguard. Soldier 0 uses these stats. */
  leader?: LeaderStats;
  /** Characters: legendary lord or hero. */
  character?: { kind: 'lord' | 'hero'; legendary?: boolean; title?: string };
  /** One-line mechanics text from the doc. */
  summary: string;
  /** Look text from the doc. */
  look: string;
  silhouette: SilhouetteDef;
  /** Excluded from custom battle and campaign recruitment lists. */
  hidden?: boolean;
}

export interface HourDef {
  id: HourId;
  name: string;
  desc: string;
  mods: StatMods;
}

export interface FactionPalette {
  /** Main cloth / banner color. */
  primary: string;
  secondary: string;
  /** Metal and trim. */
  metal: string;
  /** Light signature seen at a distance. */
  glow: string;
  dark: string;
  text: string;
}

export interface FactionDef {
  id: FactionId;
  name: string;
  short: string;
  essence: string;
  motto: string;
  pitch: string;
  who: string;
  look: {
    silhouette: string;
    palette: string;
    materials: string;
    architecture: string;
    sound: string;
  };
  palette: FactionPalette;
  /** Faction-wide battle traits (Sunfed, Nightborn, ...). */
  traits: PassiveDef[];
  /** Traits described for players, including coded ones. */
  traitText: { name: string; desc: string }[];
  mechanics?: Mechanic[];
  strengths: string;
  weaknesses: string;
  playstyle: string;
  hours?: HourDef[];
  units: UnitDef[];
  colossus: UnitDef;
  lord: UnitDef;
  heroes: UnitDef[];
  /** Campaign-layer resource name. */
  resource: { id: 'radiance' | 'dread' | 'hours' | 'renown'; name: string; desc: string };
  campaignText: { name: string; desc: string }[];
  victory: { name: string; desc: string };
}
