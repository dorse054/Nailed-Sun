/**
 * Shared zone definitions. The doc's "Light and dark zones" table plus the
 * area effects abilities leave behind (fire, dust, spores, gusts, signals).
 */
import type { ZoneDef } from './schema';

export const ZONES: Record<string, ZoneDef> = {
  // A lit Candle's peak catches the sun above the Evernight: it belongs to no one.
  candleGlow: {
    id: 'candleGlow',
    name: 'Candlelight',
    radius: 170,
    light: { mode: 'floor', level: 2, intensity: 2 },
    visual: 'sunpatch',
  },
  lantern: {
    id: 'lantern',
    name: 'Lantern light',
    radius: 26,
    light: { mode: 'floor', level: 2, intensity: 1 },
    visual: 'lantern',
  },
  lanternSmall: {
    id: 'lanternSmall',
    name: 'Lamp fire',
    radius: 16,
    light: { mode: 'floor', level: 2, intensity: 1 },
    visual: 'lantern',
  },
  kindleLight: {
    id: 'kindleLight',
    name: 'Kindle',
    radius: 40,
    light: { mode: 'floor', level: 2, intensity: 1 },
    visual: 'lantern',
  },
  sunpatch: {
    id: 'sunpatch',
    name: 'Sunpatch',
    radius: 40,
    light: { mode: 'floor', level: 3, intensity: 2 },
    reveals: true,
    visual: 'sunpatch',
  },
  walkingNoon: {
    id: 'walkingNoon',
    name: 'Walking Noon',
    radius: 70,
    light: { mode: 'floor', level: 3, intensity: 3 },
    reveals: true,
    glareSource: true,
    visual: 'noon',
  },
  veil: {
    id: 'veil',
    name: 'Veil',
    radius: 34,
    light: { mode: 'ceiling', level: 0, intensity: 2 },
    blocksBeams: true,
    missileAccuracyInto: -30,
    visual: 'veil',
  },
  listenerVeil: {
    id: 'listenerVeil',
    name: 'Veil',
    radius: 40,
    light: { mode: 'ceiling', level: 0, intensity: 2 },
    blocksBeams: true,
    missileAccuracyInto: -30,
    visual: 'veil',
  },
  eclipse: {
    id: 'eclipse',
    name: 'Eclipse',
    radius: 70,
    light: { mode: 'ceiling', level: 0, intensity: 3 },
    blocksBeams: true,
    visual: 'eclipse',
  },
  burning: {
    id: 'burning',
    name: 'Burning ground',
    radius: 9,
    dps: { damage: 3, type: 'fire', friendly: true },
    spreads: true,
    light: { mode: 'floor', level: 2, intensity: 1 },
    visual: 'fire',
  },
  burningLine: {
    id: 'burningLine',
    name: 'Scorched line',
    radius: 7,
    dps: { damage: 3, type: 'fire', friendly: true },
    spreads: true,
    visual: 'fire',
  },
  moltenGlass: {
    id: 'moltenGlass',
    name: 'Molten glass',
    radius: 11,
    dps: { damage: 3, type: 'fire', friendly: true },
    light: { mode: 'floor', level: 2, intensity: 1 },
    visual: 'fire',
  },
  frostField: {
    id: 'frostField',
    name: 'Frost shards',
    radius: 14,
    enemyMods: { speedPct: -15, attackSpeedPct: -10 },
    visual: 'dust',
  },
  blindingDust: {
    id: 'blindingDust',
    name: 'Blinding Dust',
    radius: 45,
    enemyMods: { accuracyPct: -30 },
    drain: 1.5,
    visual: 'dust',
  },
  spores: {
    id: 'spores',
    name: 'Spore cloud',
    radius: 22,
    enemyMods: { accuracyPct: -20 },
    drain: 1,
    visual: 'spores',
  },
  gust: {
    id: 'gust',
    name: 'Gust',
    radius: 100,
    windDelta: 1,
    visual: 'gust',
  },
  signal: {
    id: 'signal',
    name: 'Heliograph signal',
    radius: 45,
    visual: 'signal',
  },
  verse: {
    id: 'verse',
    name: 'Verse of the Unshadowed',
    radius: 80,
    allyMods: { ignoreDarkness: true, fearImmune: true },
    visual: 'verse',
  },
  lure: {
    id: 'lure',
    name: 'Lure',
    radius: 40,
    enemyMods: { md: -20 },
    affects: ['infantry'],
    visual: 'lure',
  },
};

export function zoneDef(id: string): ZoneDef {
  const z = ZONES[id];
  if (!z) throw new Error(`Unknown zone ${id}`);
  return z;
}
