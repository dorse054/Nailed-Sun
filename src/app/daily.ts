/**
 * The Daily Battle: one battle a day, the same all day long. The date picks
 * the matchup, the field and both armies, and the battle is fought for medals
 * like a Legend. The book keeps each day's best medal and the run of days won.
 */
import { factionDef } from '../data/index';
import { matchupNote } from '../data/lore';
import { BANDS } from '../data/rules';
import { BAND_IDS, FACTION_IDS, WIND_NAMES, type BandId, type WindLevel } from '../data/schema';
import { Rng } from '../core/rng';
import { generateArmy } from '../game/armyGen';
import type { MapSetup } from '../sim/terrain';
import type { Legend } from './legends';

/** Daily battles are Legends whose id is this prefix and the day: daily:2026-09-23. */
export const DAILY_PREFIX = 'daily:';

/** A day as the player's own calendar has it: 2026-09-23. */
export function dayKey(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The day before a day. */
export function dayBefore(key: string): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return dayKey(new Date(y, m - 1, d - 1));
}

/** A day in words: Wednesday 23 September. */
export function dayName(key: string): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

type Landmark = NonNullable<MapSetup['landmark']>;

/** Famous fields a day's battle may be fought on, by band, with their names. */
const PLACES: Partial<Record<BandId, { landmark: Landmark; glow?: boolean; title: string }[]>> = {
  evernight: [
    { landmark: 'candle', glow: true, title: 'The Burning Candle' },
    { landmark: 'candle', glow: false, title: 'The Dead Candle' },
    { landmark: 'pole', title: 'The Pole of Night' },
    { landmark: 'rimeSea', title: 'On the Rime Sea' },
  ],
  gloaming: [
    { landmark: 'stoppedDial', title: 'At the Stopped Dial' },
    { landmark: 'mistfalls', title: 'The Mistfalls' },
    { landmark: 'leaningWood', title: 'The Leaning Wood' },
    { landmark: 'umbralVale', title: 'In the Umbral Vale' },
  ],
  longAfternoon: [
    { landmark: 'umbralVale', title: 'In the Umbral Vale' },
    { landmark: 'furnaces', title: 'The Glass Furnaces' },
  ],
  glare: [{ landmark: 'nailSpire', title: 'Under the Nail Spire' }],
};

/** Names for a field with no landmark, by band. */
const FIELDS: Record<BandId, string[]> = {
  evernight: ['Aurora Field', 'The Frozen Ford', 'Starlit Ridge', 'The Vent Fields'],
  dimmark: ['The Moth Barrens', 'The Pale Wood', 'Under the Red Rim', 'The Tundra Crossing'],
  gloaming: ['The Amber Fields', 'The Canal Road', 'Sunset Ridge', 'The Long Shadow'],
  longAfternoon: ['The Salt Pans', 'Mesa Pass', 'The Oasis Road', 'The Dry Wells'],
  glare: ['The White Plain', 'The Glass Dunes', 'The Noon Road', 'The Burning Field'],
};
const STEPPE = ['The Gale Roads', 'The Kite Wind', 'The Open Steppe'];

const PRESETS: NonNullable<MapSetup['preset']>[] = ['default', 'default', 'open', 'wooded', 'hilly', 'river'];
/** Where the sun stands as the player deploys (facing north), in words. */
const SUNS: { bearing: number; words: string }[] = [
  { bearing: -Math.PI / 2, words: 'in your eyes' },
  { bearing: Math.PI / 2, words: 'at your back' },
  { bearing: Math.PI, words: 'on your left' },
  { bearing: 0, words: 'on your right' },
];
const WINDS: Record<WindLevel, string> = { 0: 'The air is still.', 1: 'A breeze blows toward the sun.', 2: 'A gale blows toward the sun.' };

/** A name after the start of a sentence: the Hush. */
export const lowerThe = (name: string) => name.replace(/^The /, 'the ');

/** Both armies spend this much. */
export const DAILY_BUDGET = 10000;

/** A day's battle, the same for everyone who plays it that day. */
export function dailyLegend(key: string): Legend {
  const rng = new Rng(`daily:${key}`);
  const me = rng.pick(FACTION_IDS);
  const foe = rng.pick(FACTION_IDS.filter((f) => f !== me));
  const band = rng.pick(BAND_IDS.filter((b) => b !== 'glare' || rng.chance(0.4)));
  const wind = rng.int(3) as WindLevel;
  const sun = rng.pick(SUNS);
  const steppe = (me === 'drift' || foe === 'drift') && (band === 'gloaming' || band === 'longAfternoon') && rng.chance(0.4);
  const places = steppe ? undefined : PLACES[band];
  const place = places && rng.chance(0.3) ? rng.pick(places) : null;
  const preset = rng.pick(PRESETS);
  const mine = generateArmy(me, DAILY_BUDGET, rng.fork('mine')).map((s) => s.def);
  const theirs = generateArmy(foe, DAILY_BUDGET, rng.fork('theirs')).map((s) => s.def);
  const title = place ? place.title : rng.pick(steppe ? STEPPE : FIELDS[band]);
  const light = BANDS[band].light;
  const sunLine = light >= 2 ? `The sun is ${sun.words}.` : 'The sun is below the horizon: no glare today.';
  const note = matchupNote(me, foe);
  const fieldName = steppe ? 'the Gale Roads' : lowerThe(BANDS[band].name);
  return {
    id: `${DAILY_PREFIX}${key}`,
    title,
    hook: `${factionDef(me).name} against ${lowerThe(factionDef(foe).name)} in ${fieldName}.`,
    story: `Two armies of equal worth meet in ${fieldName}. ${sunLine} ${WINDS[wind]} Everyone who plays today fights this same battle.`,
    lesson: note ?? `Every day brings a new field. ${WIND_NAMES[wind]} wind and ${BANDS[band].name} light decided this one; tomorrow it is another.`,
    me,
    foe,
    map: { band, wind, sunBearing: sun.bearing, steppe, preset, ...(place ? { landmark: place.landmark, ...(place.glow !== undefined ? { glow: place.glow } : {}) } : {}) },
    mine,
    theirs,
    silver: 0.5,
    gold: 0.3,
    seed: new Rng(`daily-seed:${key}`).int(1e9),
  };
}

/** The day a daily battle's id names, or null for any other id. */
export function dailyDay(id: string): string | null {
  return id.startsWith(DAILY_PREFIX) && /^\d{4}-\d{2}-\d{2}$/.test(id.slice(DAILY_PREFIX.length)) ? id.slice(DAILY_PREFIX.length) : null;
}

/** Days in a row won, up to today (or up to yesterday, while today is still to fight). */
export function dailyStreak(won: Record<string, unknown> | undefined, today = dayKey()): number {
  if (!won) return 0;
  let day = won[today] ? today : dayBefore(today);
  let n = 0;
  while (won[day] && n < 3660) {
    n++;
    day = dayBefore(day);
  }
  return n;
}
