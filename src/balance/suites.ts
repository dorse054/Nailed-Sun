/**
 * Balance suites: lists of battles ("jobs") for the headless runner.
 *
 *  - factionMatchups: every faction pair at equal budget, across the 15 light
 *    and wind conditions and N seeds, each fixture fought twice with the
 *    sides swapped.
 *  - unitDuels: every regular unit against every enemy-faction regular unit
 *    at equal cost (the cheaper unit is fielded in several copies), for the
 *    role-efficiency and counters checks.
 *  - colossusVsArms: each colossus alone against an equal-cost combined-arms
 *    force of every enemy faction, across the conditions.
 *
 * Every job is fully described by its BattleSetup, so the same job list gives
 * the same results in Node workers, a browser worker or a test.
 */
import type { BandId, FactionId, UnitDef } from '../data/schema';
import { FACTION_IDS } from '../data/schema';
import { FACTIONS, unitDef } from '../data/index';
import { Rng } from '../core/rng';
import { armyCost, generateArmy } from '../game/armyGen';
import { formationSpec } from '../sim/army';
import { COVER, Terrain } from '../sim/terrain';
import type { BattleSetup, Side, UnitSpec } from '../sim/types';
import type { Condition, SunDir } from './conditions';
import { CONDITIONS, DUEL_CONDITION, sunFor } from './conditions';

export { costFormula, costFormulaTable } from './formula';
export type { CostBreakdown } from './formula';

export type SuiteId = 'factions' | 'duels' | 'colossus';
export const SUITE_IDS: readonly SuiteId[] = ['factions', 'duels', 'colossus'];

export interface JobTags {
  /** Seed index within the suite. */
  seed: number;
  /** Condition index (0..14). */
  cond: number;
  sun: SunDir['key'];
  /** What each side fields: faction id (factions), unit id (duels, colossus), or "arms:<faction>". */
  subjects: [string, string];
  factions: [FactionId, FactionId];
  /** Points fielded by each side. */
  costs: [number, number];
  /** Duels: copies of the unit on each side. */
  copies?: [number, number];
  /** Factions suite: whether each army rolled its colossus. */
  colossus?: [boolean, boolean];
  /** Fixture id shared by the two side-swapped battles of a pairing. */
  fixture: string;
}

export interface BalanceJob {
  id: string;
  suite: SuiteId;
  setup: BattleSetup;
  /** Hard cap on simulated seconds (the battle is scored as a timeout after it). */
  maxSeconds: number;
  tags: JobTags;
}

export interface FactionSuiteOptions {
  factions?: readonly FactionId[];
  conditions?: readonly Condition[];
  /** Fixtures per pairing and condition (each is fought twice, sides swapped). */
  seeds?: number;
  budget?: number;
  /** Unit size multiplier. 1 is fair; 0.5 is faster but over-weights units that don't scale. */
  scale?: number;
  /** Simulated seconds before the battle is decided on remaining value. */
  timeLimit?: number;
  colossus?: 'yes' | 'no' | 'maybe';
  /** Salt for every seed, to draw a fresh sample. */
  salt?: string;
}

export interface DuelSuiteOptions {
  factions?: readonly FactionId[];
  seeds?: number;
  scale?: number;
  timeLimit?: number;
  condition?: Condition;
  /** Distance between the two sides at the start, in meters. */
  distance?: number;
  /** Cost match tolerance (0.1 = within 10%). */
  tolerance?: number;
  maxCopies?: number;
  /** Only duels involving these unit ids (both sides still see every opponent). */
  units?: readonly string[];
  salt?: string;
}

export interface ColossusSuiteOptions {
  factions?: readonly FactionId[];
  conditions?: readonly Condition[];
  seeds?: number;
  /** Points of the combined-arms force (the doc: 3,200, the price of a colossus). */
  budget?: number;
  scale?: number;
  timeLimit?: number;
  salt?: string;
}

export const DEFAULTS = {
  budget: 12000,
  factionTimeLimit: 600,
  duelTimeLimit: 300,
  colossusTimeLimit: 600,
  duelDistance: 300,
  duelTolerance: 0.1,
  maxCopies: 10,
  armsBudget: 3200,
} as const;

// ------------------------------------------------------------------ helpers

/** Unordered faction pairs in FACTION_IDS order. */
export function factionPairs(factions: readonly FactionId[] = FACTION_IDS): [FactionId, FactionId][] {
  const list = FACTION_IDS.filter((f) => factions.includes(f));
  const out: [FactionId, FactionId][] = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) out.push([list[i]!, list[j]!]);
  return out;
}

/** Regular units that fight duels: no characters, no colossi, nothing hidden. */
export function duelUnits(faction: FactionId): UnitDef[] {
  return FACTIONS[faction].units.filter((u) => !u.hidden && !u.character && u.category !== 'colossus' && u.category !== 'character');
}

/**
 * Copies of two units that cost the same within `tolerance`, using as few
 * units as possible; falls back to the closest ratio when none is close enough.
 */
export function costMatch(costA: number, costB: number, tolerance: number = DEFAULTS.duelTolerance, maxCopies: number = DEFAULTS.maxCopies): [number, number] {
  let best: [number, number] = [1, 1];
  let bestErr = Infinity;
  for (let total = 2; total <= maxCopies + 1; total++) {
    for (let na = 1; na < total; na++) {
      const nb = total - na;
      if (na > maxCopies || nb > maxCopies) continue;
      const err = Math.abs(Math.log((na * costA) / (nb * costB)));
      if (err < bestErr - 1e-9) {
        bestErr = err;
        best = [na, nb];
      }
    }
    if (bestErr <= Math.log(1 + tolerance)) return best;
  }
  return best;
}

/** Soldiers a unit fields at a unit-size setting (mirrors createUnit). */
export function fieldedSoldiers(def: UnitDef, scale: number): number {
  const c = def.category;
  const scalable = def.soldiers >= 12 && (c === 'infantry' || c === 'cavalry' || c === 'beast' || c === 'flyer' || c === 'character');
  return scalable ? Math.max(4, Math.round(def.soldiers * scale)) : def.soldiers;
}

/** Frontage of a unit in its default block, in meters. */
export function frontage(def: UnitDef, scale: number): number {
  const spec = formationSpec(def);
  const n = fieldedSoldiers(def, scale);
  const files = Math.max(1, Math.ceil(n / spec.ranks));
  return Math.max(files * spec.spacing, spec.radius * 2);
}

const DUEL_W = 1400;
const DUEL_H = 1000;
const duelMaps = new Map<string, string>();

/**
 * Seed of a duel map whose middle is clear, open ground. Duel units are
 * placed by hand in the middle of the field, where the terrain generator may
 * have put a river or rocks (it only clears the deployment zones), and
 * soldiers spawned in deep water can never move. So the i-th duel map of a
 * band is the first seed whose fighting corridor has no water, forest,
 * buildings or cliffs. Cached; about 80 ms per candidate.
 */
export function duelMapSeed(band: BandId, i: number, distance: number = DEFAULTS.duelDistance): string {
  const key = `${band}:${i}:${distance}`;
  const hit = duelMaps.get(key);
  if (hit) return hit;
  let best = `duel:${band}:${i}:0`;
  let bestBad = Infinity;
  for (let tries = 0; tries < 40 && bestBad > 0; tries++) {
    const seed = `duel:${band}:${i}:${tries}`;
    const t = new Terrain({ seed, band, wind: 0, sunBearing: 0, preset: 'open', steppe: true, width: DUEL_W, height: DUEL_H });
    let bad = 0;
    for (let y = DUEL_H / 2 - distance / 2 - 40; y <= DUEL_H / 2 + distance / 2 + 40; y += 4) {
      for (let x = DUEL_W / 2 - 220; x <= DUEL_W / 2 + 220; x += 4) {
        const c = t.coverAt(x, y);
        if (c !== COVER.None && c !== COVER.Field) bad++;
      }
    }
    if (bad < bestBad) {
      bestBad = bad;
      best = seed;
    }
  }
  duelMaps.set(key, best);
  return best;
}

/** Row of `count` copies centered on x, facing `facing`. */
function row(def: UnitDef, count: number, cx: number, y: number, facing: number, scale: number): UnitSpec[] {
  const w = frontage(def, scale);
  const gap = 8;
  const total = count * w + (count - 1) * gap;
  const out: UnitSpec[] = [];
  for (let i = 0; i < count; i++) out.push({ def: def.id, x: cx - total / 2 + w / 2 + i * (w + gap), y, facing });
  return out;
}

function hasColossus(units: UnitSpec[]): boolean {
  return units.some((s) => unitDef(s.def).category === 'colossus');
}

// ----------------------------------------------------------------- factions

export function factionMatchups(opts: FactionSuiteOptions = {}): BalanceJob[] {
  const conditions = opts.conditions ?? CONDITIONS;
  const seeds = Math.max(1, opts.seeds ?? 1);
  const budget = opts.budget ?? DEFAULTS.budget;
  const scale = opts.scale ?? 1;
  const timeLimit = opts.timeLimit ?? DEFAULTS.factionTimeLimit;
  const salt = opts.salt ?? '';
  const jobs: BalanceJob[] = [];
  const pairs = factionPairs(opts.factions);
  pairs.forEach(([a, b], pi) => {
    for (const c of conditions) {
      for (let k = 0; k < seeds; k++) {
        const fixture = `f:${a}-${b}:${c.key}:${k}${salt}`;
        // Both armies come from one rng seeded by the fixture, so they're the same when the sides swap.
        const rng = new Rng(`army:${fixture}`);
        const armyA = generateArmy(a, budget, rng, { colossus: opts.colossus ?? 'maybe' });
        const armyB = generateArmy(b, budget, rng, { colossus: opts.colossus ?? 'maybe' });
        // Spread sun bearings across pairs, conditions and seeds.
        const sun = sunFor(k + c.index + pi);
        for (const swap of [false, true]) {
          const [f0, f1] = swap ? [b, a] : [a, b];
          const [u0, u1] = swap ? [armyB, armyA] : [armyA, armyB];
          jobs.push({
            id: `${fixture}:${swap ? 'ba' : 'ab'}`,
            suite: 'factions',
            maxSeconds: timeLimit + 5,
            tags: {
              seed: k,
              cond: c.index,
              sun: sun.key,
              subjects: [f0, f1],
              factions: [f0, f1],
              costs: [armyCost(u0), armyCost(u1)],
              colossus: [hasColossus(u0), hasColossus(u1)],
              fixture,
            },
            setup: {
              seed: fixture,
              map: { seed: fixture, band: c.band, light: c.light, wind: c.wind, sunBearing: sun.bearing },
              armies: [
                { faction: f0, controller: 'ai', units: u0.map((s) => ({ ...s })) },
                { faction: f1, controller: 'ai', units: u1.map((s) => ({ ...s })) },
              ],
              unitScale: scale,
              timeLimit,
            },
          });
        }
      }
    }
  });
  return jobs;
}

// -------------------------------------------------------------------- duels

export function unitDuels(opts: DuelSuiteOptions = {}): BalanceJob[] {
  const seeds = Math.max(1, opts.seeds ?? 1);
  const scale = opts.scale ?? 1;
  const timeLimit = opts.timeLimit ?? DEFAULTS.duelTimeLimit;
  const c = opts.condition ?? DUEL_CONDITION;
  const distance = opts.distance ?? DEFAULTS.duelDistance;
  const tolerance = opts.tolerance ?? DEFAULTS.duelTolerance;
  const maxCopies = opts.maxCopies ?? DEFAULTS.maxCopies;
  const salt = opts.salt ?? '';
  const W = DUEL_W;
  const H = DUEL_H;
  const jobs: BalanceJob[] = [];
  let pairIndex = 0;
  for (const [fa, fb] of factionPairs(opts.factions)) {
    for (const ua of duelUnits(fa)) {
      for (const ub of duelUnits(fb)) {
        if (opts.units && !opts.units.includes(ua.id) && !opts.units.includes(ub.id)) continue;
        const [na, nb] = costMatch(ua.cost, ub.cost, tolerance, maxCopies);
        for (let k = 0; k < seeds; k++) {
          const fixture = `d:${ua.id}~${ub.id}:${k}${salt}`;
          const sunIndex = k + pairIndex;
          const sun = sunFor(sunIndex);
          const mapSeed = duelMapSeed(c.band, sunIndex % 4, distance);
          for (const swap of [false, true]) {
            const [d0, d1] = swap ? [ub, ua] : [ua, ub];
            const [n0, n1] = swap ? [nb, na] : [na, nb];
            jobs.push({
              id: `${fixture}:${swap ? 'ba' : 'ab'}`,
              suite: 'duels',
              maxSeconds: timeLimit + 5,
              tags: {
                seed: k,
                cond: c.index,
                sun: sun.key,
                subjects: [d0.id, d1.id],
                factions: [d0.faction, d1.faction],
                costs: [n0 * d0.cost, n1 * d1.cost],
                copies: [n0, n1],
                fixture,
              },
              setup: {
                seed: fixture,
                map: { seed: mapSeed, band: c.band, light: c.light, wind: c.wind, sunBearing: sun.bearing, preset: 'open', steppe: true, width: W, height: H },
                armies: [
                  { faction: d0.faction, controller: 'ai', units: row(d0, n0, W / 2, H / 2 + distance / 2, -Math.PI / 2, scale) },
                  { faction: d1.faction, controller: 'ai', units: row(d1, n1, W / 2, H / 2 - distance / 2, Math.PI / 2, scale) },
                ],
                unitScale: scale,
                timeLimit,
              },
            });
          }
        }
        pairIndex++;
      }
    }
  }
  return jobs;
}

// ----------------------------------------------------------------- colossus

/**
 * A combined-arms force of about `budget` points with no lord, heroes or
 * colossus: generateArmy's doctrine with the lord's cost added to the budget
 * and the lord removed, best of a few draws for the closest total.
 */
export function combinedArms(faction: FactionId, budget: number, rng: Rng): UnitSpec[] {
  const f = FACTIONS[faction];
  const exclude = f.heroes.map((h) => h.id);
  let best: UnitSpec[] = [];
  let bestCost = -1;
  for (let i = 0; i < 8; i++) {
    const r = rng.fork(i);
    const units = generateArmy(faction, budget + f.lord.cost, r, { colossus: 'no', exclude }).filter((s) => s.def !== f.lord.id);
    const cost = armyCost(units);
    if (cost <= budget && cost > bestCost) {
      best = units;
      bestCost = cost;
    }
    if (bestCost === budget) break;
  }
  return best;
}

export function colossusVsArms(opts: ColossusSuiteOptions = {}): BalanceJob[] {
  const conditions = opts.conditions ?? CONDITIONS;
  const seeds = Math.max(1, opts.seeds ?? 1);
  const budget = opts.budget ?? DEFAULTS.armsBudget;
  const scale = opts.scale ?? 1;
  const timeLimit = opts.timeLimit ?? DEFAULTS.colossusTimeLimit;
  const salt = opts.salt ?? '';
  const factions = FACTION_IDS.filter((f) => !opts.factions || opts.factions.includes(f));
  const jobs: BalanceJob[] = [];
  let pi = 0;
  for (const cf of factions) {
    const col = FACTIONS[cf].colossus;
    for (const ef of factions) {
      if (ef === cf) continue;
      for (const c of conditions) {
        for (let k = 0; k < seeds; k++) {
          const fixture = `c:${col.id}~${ef}:${c.key}:${k}${salt}`;
          const arms = combinedArms(ef, budget, new Rng(`arms:${fixture}`));
          const sun = sunFor(k + c.index + pi);
          for (const swap of [false, true]) {
            const colSide: Side = swap ? 1 : 0;
            const colArmy = { faction: cf, controller: 'ai' as const, units: [{ def: col.id }] };
            const armsArmy = { faction: ef, controller: 'ai' as const, units: arms.map((s) => ({ ...s })) };
            const armies: BattleSetup['armies'] = colSide === 0 ? [colArmy, armsArmy] : [armsArmy, colArmy];
            const costs: [number, number] = colSide === 0 ? [col.cost, armyCost(arms)] : [armyCost(arms), col.cost];
            jobs.push({
              id: `${fixture}:${swap ? 'ba' : 'ab'}`,
              suite: 'colossus',
              maxSeconds: timeLimit + 5,
              tags: {
                seed: k,
                cond: c.index,
                sun: sun.key,
                subjects: colSide === 0 ? [col.id, `arms:${ef}`] : [`arms:${ef}`, col.id],
                factions: colSide === 0 ? [cf, ef] : [ef, cf],
                costs,
                fixture,
              },
              setup: {
                seed: fixture,
                map: { seed: fixture, band: c.band, light: c.light, wind: c.wind, sunBearing: sun.bearing },
                armies,
                unitScale: scale,
                timeLimit,
              },
            });
          }
        }
      }
      pi++;
    }
  }
  return jobs;
}
