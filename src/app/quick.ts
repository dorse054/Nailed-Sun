/**
 * One-click battles: a random matchup, or two AI generals to watch.
 */
import type { BandId, FactionId, WindLevel } from '../data/schema';
import { BAND_IDS, FACTION_IDS } from '../data/schema';
import { Rng } from '../core/rng';
import { generateArmy } from '../game/armyGen';
import type { BattleSetup } from '../sim/types';
import type { MapSetup } from '../sim/terrain';
import { go, settings } from './store';

/** Landmarks a random battle can be fought at, by band. */
const PLACES: Partial<Record<BandId, { landmark: NonNullable<MapSetup['landmark']>; glow?: boolean }[]>> = {
  evernight: [{ landmark: 'candle', glow: true }, { landmark: 'candle', glow: false }, { landmark: 'pole' }, { landmark: 'rimeSea' }],
  gloaming: [{ landmark: 'stoppedDial' }, { landmark: 'mistfalls' }, { landmark: 'leaningWood' }, { landmark: 'umbralVale' }],
  longAfternoon: [{ landmark: 'umbralVale' }, { landmark: 'furnaces' }],
  glare: [{ landmark: 'nailSpire' }],
};
/** Share of random battles fought at a landmark. */
const PLACE_CHANCE = 0.2;

export function randomSetup(seed: number, a: FactionId, b: FactionId, budget = 9000, opts: { band?: BandId; wind?: WindLevel; sun?: number; steppe?: boolean } = {}): BattleSetup {
  const rng = new Rng(seed);
  const band = opts.band ?? rng.pick(BAND_IDS.filter((x) => x !== 'glare' || rng.chance(0.3)));
  const wind = opts.wind ?? (rng.int(3) as WindLevel);
  const sun = opts.sun ?? rng.pick([-Math.PI / 2, Math.PI / 2, 0, Math.PI, -Math.PI / 4, (Math.PI * 3) / 4]);
  const steppe = opts.steppe ?? (a === 'drift' || b === 'drift' ? rng.chance(0.4) : false);
  const armies: BattleSetup['armies'] = [
    { faction: a, controller: 'player', units: generateArmy(a, budget, rng) },
    { faction: b, controller: 'ai', units: generateArmy(b, budget, rng) },
  ];
  // Now and then, a famous field (drawn last, so a seed's armies stay the same).
  const places = steppe ? undefined : PLACES[band];
  const place = places && rng.chance(PLACE_CHANCE) ? rng.pick(places) : null;
  return {
    seed,
    map: { seed, band, wind, sunBearing: sun, steppe, ...(place ?? {}) },
    armies,
    unitScale: settings.value.unitScale,
  };
}

export function quickBattle(): void {
  const seed = Math.floor(Math.random() * 1e9);
  const rng = new Rng(seed);
  const a = rng.pick(FACTION_IDS);
  const b = rng.pick(FACTION_IDS.filter((f) => f !== a));
  go({ name: 'battle', req: { setup: randomSetup(seed, a, b), playerSide: 0, mode: 'custom' } });
}

export interface DemoOptions {
  seed?: number;
  a?: FactionId;
  b?: FactionId;
  band?: BandId;
  wind?: WindLevel;
  budget?: number;
  steppe?: boolean;
}

export function demoBattle(o: DemoOptions = {}): void {
  const seed = o.seed ?? Math.floor(Math.random() * 1e9);
  const rng = new Rng(seed);
  const a = o.a ?? rng.pick(FACTION_IDS);
  const b = o.b ?? rng.pick(FACTION_IDS.filter((f) => f !== a));
  const setup = randomSetup(seed, a, b, o.budget ?? 11000, { band: o.band, wind: o.wind, steppe: o.steppe });
  setup.armies[0].controller = 'ai';
  go({ name: 'battle', req: { setup, playerSide: 0, mode: 'demo', skipDeploy: true } });
}
