/**
 * The balance simulator's battlefield conditions: the doc's 15 light-and-wind
 * combinations (5 light levels x 3 wind strengths), and the four sun bearings
 * that fixtures rotate through so neither side is always the one facing the sun.
 */
import type { BandId, LightLevel, WindLevel } from '../data/schema';
import { LIGHT_NAMES, WIND_NAMES } from '../data/schema';

export interface Condition {
  /** 0..14, light-major: index = light * 3 + wind. */
  index: number;
  light: LightLevel;
  wind: WindLevel;
  /** Band whose terrain goes with this light level (MapSetup.light still pins the light). */
  band: BandId;
  /** Stable key, e.g. "dusk-breeze". */
  key: string;
  /** Human label, e.g. "Dusk / Breeze". */
  label: string;
}

/** Each light level is fought on the terrain of the band that has it naturally. */
export const LIGHT_BAND: Record<LightLevel, BandId> = {
  0: 'evernight',
  1: 'dimmark',
  2: 'gloaming',
  3: 'longAfternoon',
  4: 'glare',
};

export const LIGHTS: readonly LightLevel[] = [0, 1, 2, 3, 4];
export const WINDS: readonly WindLevel[] = [0, 1, 2];

export const CONDITIONS: readonly Condition[] = LIGHTS.flatMap((light) =>
  WINDS.map((wind) => ({
    index: light * 3 + wind,
    light,
    wind,
    band: LIGHT_BAND[light],
    key: `${LIGHT_NAMES[light].toLowerCase()}-${WIND_NAMES[wind].toLowerCase()}`,
    label: `${LIGHT_NAMES[light]} / ${WIND_NAMES[wind]}`,
  })),
);

export function condition(light: LightLevel, wind: WindLevel): Condition {
  return CONDITIONS[light * 3 + wind]!;
}

/** The doc's default duel condition: Dusk light, Breeze. */
export const DUEL_CONDITION: Condition = condition(2, 1);

export interface SunDir {
  key: 'N' | 'E' | 'S' | 'W';
  /** Radians toward the sun (0 = east, PI/2 = south on screen). */
  bearing: number;
  label: string;
}

/**
 * Sun bearings in the order fixtures use them. North and south put the sun in
 * one army's eyes (side 0 deploys at the bottom facing north); east and west
 * are crosswinds. Seeds cycle N, E, S, W so even two seeds see both kinds.
 */
export const SUN_DIRS: readonly SunDir[] = [
  { key: 'N', bearing: -Math.PI / 2, label: 'north' },
  { key: 'E', bearing: 0, label: 'east' },
  { key: 'S', bearing: Math.PI / 2, label: 'south' },
  { key: 'W', bearing: Math.PI, label: 'west' },
];

export function sunFor(i: number): SunDir {
  return SUN_DIRS[((i % 4) + 4) % 4]!;
}

/**
 * Parse a condition filter such as "all", "dusk-breeze", "light=0,2;wind=1"
 * or a list of indices "0,4,7". Unknown tokens throw so typos are caught.
 */
export function parseConditions(spec: string | undefined): Condition[] {
  if (!spec || spec === 'all') return [...CONDITIONS];
  const s = spec.trim().toLowerCase();
  if (s.includes('=')) {
    let lights = [...LIGHTS] as number[];
    let winds = [...WINDS] as number[];
    for (const part of s.split(';')) {
      const [k, v] = part.split('=');
      const vals = (v ?? '').split(',').filter(Boolean).map((x) => lookupLevel(x.trim(), k === 'light' ? LIGHT_NAMES : WIND_NAMES));
      if (k === 'light') lights = vals;
      else if (k === 'wind') winds = vals;
      else throw new Error(`Unknown condition filter "${k}" (use light= and wind=)`);
    }
    return CONDITIONS.filter((c) => lights.includes(c.light) && winds.includes(c.wind));
  }
  const out: Condition[] = [];
  for (const tok of s.split(',').map((x) => x.trim()).filter(Boolean)) {
    const byKey = CONDITIONS.find((c) => c.key === tok);
    if (byKey) out.push(byKey);
    else if (/^\d+$/.test(tok) && CONDITIONS[Number(tok)]) out.push(CONDITIONS[Number(tok)]!);
    else throw new Error(`Unknown condition "${tok}" (e.g. dusk-breeze, 7, or light=0,1;wind=2)`);
  }
  return out;
}

function lookupLevel(tok: string, names: readonly string[]): number {
  if (/^\d+$/.test(tok) && Number(tok) < names.length) return Number(tok);
  const i = names.findIndex((n) => n.toLowerCase() === tok);
  if (i < 0) throw new Error(`Unknown level "${tok}" (one of ${names.join(', ')})`);
  return i;
}
