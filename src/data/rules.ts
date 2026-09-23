/**
 * World rules from the design doc, as numbers.
 * "World rules on the battlefield": light, glare, wind, shadow, zones.
 */
import type { BandId, LightLevel, WindLevel } from './schema';

export interface LightRule {
  name: string;
  /** Accuracy change (%) when facing within 45 degrees of the sun. */
  glareAccuracyPct: number;
  /** Melee attack change when facing the sun. */
  glareMa: number;
  /** Spotting range multiplier. */
  spotMult: number;
  /** Beam damage multiplier. */
  beamMult: number;
  /** Fatigue rate multiplier for non-Choir units. */
  fatigueMult: number;
  /** Sun elevation in degrees, for baked shadows (null: no direct sun). */
  sunElevation: number | null;
  note: string;
}

/** The doc's light table: Dark, Dim, Dusk, Bright, Blaze. */
export const LIGHT_RULES: Record<LightLevel, LightRule> = {
  0: { name: 'Dark', glareAccuracyPct: 0, glareMa: 0, spotMult: 0.5, beamMult: 0.2, fatigueMult: 1, sunElevation: null, note: 'Spotting range -50%. Beams only from stored light, at 20%.' },
  1: { name: 'Dim', glareAccuracyPct: 0, glareMa: 0, spotMult: 0.75, beamMult: 0.5, fatigueMult: 1, sunElevation: null, note: 'Spotting range -25%. Beams at 50%.' },
  2: { name: 'Dusk', glareAccuracyPct: -20, glareMa: -4, spotMult: 1, beamMult: 1, fatigueMult: 1, sunElevation: 6, note: 'Very long shadows. Beams at 100%.' },
  3: { name: 'Bright', glareAccuracyPct: -10, glareMa: 0, spotMult: 1, beamMult: 1.15, fatigueMult: 1, sunElevation: 32, note: 'Short shadows. Beams at 115%.' },
  4: { name: 'Blaze', glareAccuracyPct: 0, glareMa: 0, spotMult: 1, beamMult: 1.3, fatigueMult: 1.5, sunElevation: 88, note: 'Non-Choir units tire 50% faster. Beams at 130%.' },
};

/** Glare applies when facing within this angle of the sun. */
export const GLARE_HALF_ANGLE_DEG = 45;

/** Artificial glare (Walking Noon, Mirrorflash in its strongest form, dazzle). */
export const ARTIFICIAL_GLARE = { accuracyPct: -20, ma: -4 };

export interface WindRule {
  name: string;
  /** Range change for a shot fired straight downwind (%); upwind is the negative. */
  rangePct: number;
  /** Accuracy change for all missiles (%). */
  accuracyPct: number;
  /** Flyer speed bonus when moving downwind (%). */
  flyerDownwindSpeedPct: number;
  /** Seconds between fire spreading one step sunward (0: no spread). */
  fireSpreadSeconds: number;
  note: string;
}

export const WIND_RULES: Record<WindLevel, WindRule> = {
  0: { name: 'Calm', rangePct: 0, accuracyPct: 0, flyerDownwindSpeedPct: 0, fireSpreadSeconds: 0, note: 'Gliders lose altitude; smoke and spores linger.' },
  1: { name: 'Breeze', rangePct: 10, accuracyPct: 0, flyerDownwindSpeedPct: 0, fireSpreadSeconds: 9, note: 'Fire spreads sunward.' },
  2: { name: 'Gale', rangePct: 20, accuracyPct: -5, flyerDownwindSpeedPct: 25, fireSpreadSeconds: 4, note: 'All missiles -5% accuracy. Fire spreads fast. Flyers +25% speed downwind.' },
};

/** Shadow rule: units in shadow stay hidden until an enemy is this close. */
export const SHADOW_REVEAL_RANGE = 60;

export interface BandRule {
  id: BandId;
  name: string;
  light: LightLevel;
  sun: string;
  land: string;
  home: string;
  /** Ground palette for the renderer: base, alt, shadow tint, sky. */
  colors: { ground: string; ground2: string; shadow: string; sky: string; ambient: string; accent: string };
  /** Default terrain features. */
  terrain: { forest: number; hills: number; water: number; rocks: number; special: 'glass' | 'salt' | 'grain' | 'fungus' | 'ice' | 'steppe' };
}

export const BANDS: Record<BandId, BandRule> = {
  evernight: {
    id: 'evernight',
    name: 'The Evernight',
    light: 0,
    sun: 'Below the horizon; aurora and stars',
    land: 'Glaciers, the frozen Rime Sea, steaming vents, glowing fungal gardens',
    home: 'The Hush',
    colors: { ground: '#1b2140', ground2: '#262d52', shadow: '#0b0e22', sky: '#070918', ambient: '#3a4a8a', accent: '#56e0d0' },
    terrain: { forest: 0.35, hills: 0.6, water: 0.15, rocks: 0.5, special: 'ice' },
  },
  dimmark: {
    id: 'dimmark',
    name: 'The Dimmark',
    light: 1,
    sun: 'Hidden; a red rim on the horizon',
    land: 'Tundra, pale fungal forests, moth-haunted barrens',
    home: 'Hush borderlands',
    colors: { ground: '#4a4552', ground2: '#5b5361', shadow: '#2a2433', sky: '#3a2a3a', ambient: '#9a6a7a', accent: '#d9a3b8' },
    terrain: { forest: 0.5, hills: 0.5, water: 0.2, rocks: 0.4, special: 'fungus' },
  },
  gloaming: {
    id: 'gloaming',
    name: 'The Gloaming',
    light: 2,
    sun: 'On the horizon: eternal sunset',
    land: 'Amber grain fields, rivers, canals, forests bowed sunward',
    home: 'The Vesperate',
    colors: { ground: '#9a7a45', ground2: '#b08a4a', shadow: '#3e3a66', sky: '#e39a5a', ambient: '#f0b070', accent: '#ffcf80' },
    terrain: { forest: 0.55, hills: 0.5, water: 0.35, rocks: 0.25, special: 'grain' },
  },
  longAfternoon: {
    id: 'longAfternoon',
    name: 'The Long Afternoon',
    light: 3,
    sun: 'High and harsh',
    land: 'Salt pans, mesas, glass furnaces, oases',
    home: 'The Choir',
    colors: { ground: '#c9a86a', ground2: '#dcc18a', shadow: '#7a6048', sky: '#f4e2b0', ambient: '#fff0c8', accent: '#ffffff' },
    terrain: { forest: 0.15, hills: 0.7, water: 0.1, rocks: 0.6, special: 'salt' },
  },
  glare: {
    id: 'glare',
    name: 'The Glare',
    light: 4,
    sun: 'Straight overhead: endless noon',
    land: 'A desert of fused glass; lethal heat',
    home: 'No one; Choir pilgrims only',
    colors: { ground: '#eadcb0', ground2: '#f6ecc8', shadow: '#c8b88a', sky: '#ffffff', ambient: '#fffbe8', accent: '#fff6c0' },
    terrain: { forest: 0.02, hills: 0.4, water: 0, rocks: 0.3, special: 'glass' },
  },
};

/** The Gale Roads: open steppe across all five bands. */
export const GALE_ROADS = {
  name: 'The Gale Roads',
  desc: 'Open steppes where the wind blows strongest, home of the Drift.',
  colors: { ground: '#8a8a5a', ground2: '#9c9a66' },
};

/** Beam damage multiplier by light, used by every light-scaled weapon. */
export function beamMult(light: LightLevel): number {
  return LIGHT_RULES[light].beamMult;
}

/** Combat constants. The two formulas are the doc's "Combat math". */
export const COMBAT = {
  hitBase: 0.35,
  hitMin: 0.08,
  hitMax: 0.9,
  /** u ~ U(0.5, 1) in D = B(1 - u A/100) + AP. */
  armorRollMin: 0.5,
  armorRollMax: 1,
  /** Melee defense lost when attacked from the flank or rear. */
  flankMdMult: 0.7,
  rearMdMult: 0.4,
  /** Seconds a charge bonus lasts after impact, fading linearly. */
  chargeDuration: 5,
  /** Brittle units take this much extra from cold and resonance. */
  brittleMult: 1.5,
  /** Chill: -20% speed and attack speed for 8 s. */
  chill: { speedPct: -20, attackSpeedPct: -20, duration: 8 },
  /** Knocked-down soldiers stay down this long. */
  knockdownTime: 1.6,
  /** Colossi cannot be stunned or knocked down more than once per 20 s. */
  colossusStunLockout: 20,
};

/** Morale constants. States: Steady, Wavering below 50%, Broken at 0. */
export const MORALE = {
  waveringAt: 0.5,
  /** % of max morale lost when the unit loses 100% of its soldiers. */
  casualtyShock: 85,
  /** Extra drain per second while recent losses are heavy. */
  heavyLossDrain: 3,
  flankDrain: 2.5,
  rearDrain: 5,
  routingAllyDrain: 1.2,
  routingAllyRadius: 70,
  generalDeadShock: 20,
  generalDeadDrain: 0.4,
  generalAuraRadius: 90,
  generalAuraRegen: 1,
  outOfCombatRegen: 2.5,
  /** Seconds a routing unit must be unpressed before it can rally. */
  rallyDelay: 12,
  rallyMorale: 0.4,
  /** A unit that routs this many times is Shattered and leaves the field. */
  shatterRouts: 3,
  /** A unit below this share of its soldiers shatters when it routs. */
  shatterStrength: 0.12,
  fearDrain: 2,
  losingMeleeDrain: 2.2,
  winningMeleeRegen: 0.6,
};

export const FATIGUE = {
  /** Per second while running / fighting / walking; recovery while still. */
  run: 0.006,
  fight: 0.004,
  walk: 0.0012,
  recover: 0.006,
  /** Thresholds and penalties. */
  winded: 0.45,
  tired: 0.7,
  exhausted: 0.9,
};

/** Spotting base range in meters (before light multipliers). */
export const SPOT_RANGE = 800;
/** Units hidden in forest are revealed this close. */
export const FOREST_REVEAL_RANGE = 45;
/** Stealth units in darkness are revealed this close. */
export const STEALTH_REVEAL_RANGE = 40;
/** Seconds a unit stays visible after it was last spotted. */
export const VISIBILITY_LINGER = 2;

/** Army rules from the campaign layer that battles also enforce. */
export const ARMY = {
  maxUnits: 16,
  customBudget: 12000,
  /** Each extra copy of the same unit adds 5% upkeep to every copy. */
  duplicateUpkeepPct: 5,
  maxColossi: 1,
};

/** Vesperate Toll defaults. */
export const TOLL = {
  window: 6,
  lordInterval: 45,
  lordRange: 180,
};
