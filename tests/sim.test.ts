import { describe, expect, it } from 'vitest';
import { Battle } from '../src/sim/battle';
import { BattleAI } from '../src/ai/battleAI';
import { DT } from '../src/sim/constants';
import { Terrain, COVER } from '../src/sim/terrain';
import type { MapSetup } from '../src/sim/terrain';
import { tollInterval } from '../src/sim/toll';
import { moraleState } from '../src/sim/morale';
import { killSoldier } from '../src/sim/combat';
import { resolveCollisions } from '../src/sim/movement';
import { castAbility, findAbility } from '../src/sim/abilities';
import { generateArmy, armyCost } from '../src/game/armyGen';
import { Rng } from '../src/core/rng';
import { PI } from '../src/core/dmath';
import { FACTIONS, unitDef } from '../src/data/index';
import { ARMY, MORALE, TOLL } from '../src/data/rules';
import { BAND_IDS, FACTION_IDS } from '../src/data/schema';
import type { BandId, LightLevel } from '../src/data/schema';
import type { BattleSetup, Command, TimedCommand, Unit, UnitSpec } from '../src/sim/types';
import { firstDifference, fingerprint, makeBattle, makeSetup, outcome, stepSeconds, stepUntil, unitOf } from './helpers';

function withAI(setup: BattleSetup, sides: (0 | 1)[] = [0, 1], opts: { events?: boolean; replay?: TimedCommand[] } = {}): Battle {
  const b = new Battle(setup, opts);
  for (const s of sides) b.setController(s, new BattleAI());
  return b;
}

function stepToTime(b: Battle, t: number): void {
  while (!b.result && b.time < t - 1e-9) b.step();
}

function cloneLog(log: TimedCommand[]): TimedCommand[] {
  return JSON.parse(JSON.stringify(log)) as TimedCommand[];
}

// ---------------------------------------------------------------- determinism

describe('determinism', () => {
  const setupFor = (seed: number): BattleSetup =>
    makeSetup({
      seed,
      map: { seed: 11, band: 'gloaming', wind: 1, sunBearing: 0.4, preset: 'default' },
      timeLimit: 900,
      armies: [
        { faction: 'vesperate', controller: 'ai', units: ['vesperate.maren', 'vesperate.lanternGuard', 'vesperate.vesperArbalests', 'vesperate.hourLevy', 'vesperate.bellOutriders'] },
        { faction: 'choir', controller: 'ai', units: ['choir.oriel', 'choir.kilnAcolytes', 'choir.shardbows', 'choir.mirrorWardens', 'choir.heliographerRiders'] },
      ],
    });

  it('two battles from the same setup, AI on both sides, stay bit-identical and end identically', () => {
    const a = withAI(setupFor(3));
    const b = withAI(setupFor(3));
    for (const t of [5, 30, 90]) {
      stepToTime(a, t);
      stepToTime(b, t);
      expect(firstDifference(fingerprint(a), fingerprint(b)), `at ${t} s`).toBeNull();
    }
    a.run();
    b.run();
    expect(a.result).not.toBeNull();
    expect(outcome(a)).toEqual(outcome(b));
    expect(a.result).toEqual(b.result);
    expect(firstDifference(fingerprint(a), fingerprint(b))).toBeNull();
  });

  it('a different battle seed on the same map fights a different battle', () => {
    const a = withAI(setupFor(3));
    const c = withAI(setupFor(4));
    // Same map: the terrain depends only on the map setup.
    expect(Buffer.from(a.terrain.heights.buffer).equals(Buffer.from(c.terrain.heights.buffer))).toBe(true);
    a.run();
    c.run();
    expect(a.result).not.toBeNull();
    expect(c.result).not.toBeNull();
    expect(outcome(a)).not.toEqual(outcome(c));
    expect(a.rng.getState()).not.toEqual(c.rng.getState());
  });

  it('collecting events for the renderer does not change the simulation', () => {
    const quiet = withAI(setupFor(8));
    const loud = withAI(setupFor(8), [0, 1], { events: true });
    let seen = 0;
    for (const t of [20, 60, 120]) {
      stepToTime(quiet, t);
      stepToTime(loud, t);
      seen += loud.takeEvents().length;
      expect(firstDifference(fingerprint(quiet), fingerprint(loud)), `at ${t} s`).toBeNull();
    }
    expect(seen).toBeGreaterThan(0);
    expect(quiet.takeEvents()).toEqual([]);
  });

  it('building and running a battle does not mutate its setup', () => {
    const setup = setupFor(5);
    const before = JSON.stringify(setup);
    const b = withAI(setup);
    stepSeconds(b, 30);
    expect(JSON.stringify(setup)).toBe(before);
  });
});

// --------------------------------------------------------------------- replay

describe('replay', () => {
  const setupR = (): BattleSetup =>
    makeSetup({
      seed: 21,
      map: { seed: 21, band: 'gloaming', wind: 2, sunBearing: -0.3, preset: 'default' },
      timeLimit: 900,
      armies: [
        { faction: 'vesperate', controller: 'player', units: ['vesperate.maren', 'vesperate.lanternGuard', 'vesperate.vesperArbalests', 'vesperate.knellguard', 'vesperate.lamplighterCaptain'] },
        { faction: 'drift', controller: 'ai', units: ['drift.taviLongwind', 'drift.reedspears', 'drift.windbows', 'drift.anchorGuard', 'drift.dustrunners'] },
      ],
    });

  /** Player orders on side 0, by the tick at which they take effect. Built from the battle state at that moment. */
  const script: Record<number, (b: Battle) => Command[]> = {
    1: () => [{ type: 'hour', side: 0, hour: 'iron' }],
    2: () => [{ type: 'run', unit: 1, on: false }],
    40: (b) => [{ type: 'move', unit: 1, x: b.units[1]!.x, y: b.units[1]!.y - 120, facing: -PI / 2, files: 25 }],
    41: (b) => [{ type: 'move', unit: 3, x: b.units[3]!.x + 10, y: b.units[3]!.y - 100 }],
    160: (b) => [{ type: 'move', unit: 2, x: b.units[2]!.x, y: b.units[2]!.y - 60, run: false }],
    400: () => [
      { type: 'attack', unit: 3, target: 6 },
      { type: 'attack', unit: 1, target: 8, run: true },
    ],
    600: (b) => {
      const p = b.units[4]!.soldiers[0]!;
      return [{ type: 'ability', unit: 4, ability: 'kindle', x: p.x, y: p.y - 60 }];
    },
    800: () => [{ type: 'ability', unit: 0, ability: 'callTheHour' }],
    1000: () => [{ type: 'halt', unit: 2 }],
    1200: () => [
      { type: 'meleeMode', unit: 2, on: true },
      { type: 'attack', unit: 2, target: 7 },
    ],
    1500: () => [{ type: 'hour', side: 0, hour: 'charge' }],
  };

  it('replaying the recorded log with the AI on the other side reproduces the battle exactly', () => {
    const orig = withAI(setupR(), [1]);
    const checkpoints = new Map<number, string[]>();
    while (!orig.result && orig.time < orig.timeLimit) {
      const next = orig.tick + 1;
      for (const cmd of script[next]?.(orig) ?? []) orig.issue(0, cmd);
      orig.step();
      if (orig.tick % 200 === 0) checkpoints.set(orig.tick, fingerprint(orig));
    }
    orig.run();
    expect(orig.result).not.toBeNull();
    // Every scripted order was recorded, at the tick it took effect; the AI's orders are not.
    const scripted = Object.entries(script).flatMap(([t, f]) => f(orig).map(() => Number(t)));
    expect(orig.log.map((c) => c.tick)).toEqual(scripted);
    expect(orig.log.every((c) => c.side === 0)).toBe(true);

    const log = cloneLog(orig.log);
    const rep = withAI(setupR(), [1], { replay: log });
    while (!rep.result && rep.tick < orig.tick) {
      rep.step();
      const want = checkpoints.get(rep.tick);
      if (want) expect(firstDifference(want, fingerprint(rep)), `tick ${rep.tick}`).toBeNull();
    }
    rep.run();
    expect(rep.result).toEqual(orig.result);
    expect(outcome(rep)).toEqual(outcome(orig));
    expect(firstDifference(fingerprint(orig), fingerprint(rep))).toBeNull();
    // A replay records nothing and leaves its log untouched.
    expect(rep.log).toEqual([]);
    expect(log).toEqual(cloneLog(orig.log));
  });

  it('a player order given in the same tick as an AI order replays in the original order', () => {
    // On a Dark map the Choir AI casts Verse of the Unshadowed at its first update (tick 5), so it lands on tick 6.
    // The player casts the Listener's Veil for the same tick. In the live battle the AI's order was queued first.
    const setupV = (): BattleSetup =>
      makeSetup({
        seed: 5,
        map: { seed: 5, band: 'evernight', wind: 1 },
        armies: [
          { faction: 'hush', controller: 'player', units: ['hush.queenYsh', 'hush.glowkinLurers', 'hush.listener', 'hush.hushbows'] },
          { faction: 'choir', controller: 'ai', units: ['choir.oriel', 'choir.kilnAcolytes', 'choir.shardbows', 'choir.mirrorWardens'] },
        ],
      });
    const orig = withAI(setupV(), [1], { events: true });
    for (let i = 0; i < 5; i++) orig.step();
    orig.takeEvents();
    const listener = unitOf(orig, 'hush.listener');
    const p = listener.soldiers[0]!;
    orig.issue(0, { type: 'ability', unit: listener.id, ability: 'veil', x: p.x, y: p.y - 100 });
    orig.step();
    // Precondition: both abilities landed on tick 6.
    expect(orig.tick).toBe(6);
    const born = orig.zones.filter((z) => z.born === orig.time).map((z) => `${z.def.id}/${z.side}`);
    expect(born.sort()).toEqual(['listenerVeil/0', 'verse/1']);
    const liveOrder = orig.takeEvents().filter((e) => e.t === 'ability').map((e) => (e.t === 'ability' ? e.name : ''));
    const liveState = fingerprint(orig);
    stepSeconds(orig, 30);
    const later = fingerprint(orig);

    const rep = withAI(setupV(), [1], { events: true, replay: cloneLog(orig.log) });
    for (let i = 0; i < 5; i++) rep.step();
    rep.takeEvents();
    rep.step();
    const replayOrder = rep.takeEvents().filter((e) => e.t === 'ability').map((e) => (e.t === 'ability' ? e.name : ''));
    expect(replayOrder).toEqual(liveOrder);
    expect(firstDifference(liveState, fingerprint(rep))).toBeNull();
    stepSeconds(rep, 30);
    expect(firstDifference(later, fingerprint(rep))).toBeNull();
  });
});

// ------------------------------------------------------------ AI vs AI battles

describe('AI against AI', () => {
  const matchups: [string, BattleSetup][] = [
    [
      'Vesperate vs Choir at Dusk',
      makeSetup({
        seed: 7,
        map: { seed: 7, band: 'gloaming', wind: 1, sunBearing: 0 },
        armies: [
          { faction: 'vesperate', controller: 'ai', units: ['vesperate.maren', 'vesperate.lanternGuard', 'vesperate.vesperArbalests', 'vesperate.hourLevy'] },
          { faction: 'choir', controller: 'ai', units: ['choir.oriel', 'choir.kilnAcolytes', 'choir.shardbows', 'choir.mirrorWardens'] },
        ],
      }),
    ],
    [
      'Hush vs Drift in a Breeze',
      makeSetup({
        seed: 7,
        map: { seed: 7, band: 'gloaming', wind: 1, sunBearing: 0 },
        armies: [
          { faction: 'hush', controller: 'ai', units: ['hush.queenYsh', 'hush.glowkinLurers', 'hush.hushbows', 'hush.rimeguard'] },
          { faction: 'drift', controller: 'ai', units: ['drift.taviLongwind', 'drift.reedspears', 'drift.windbows', 'drift.anchorGuard'] },
        ],
      }),
    ],
    [
      'Choir vs Hush in the Evernight',
      makeSetup({
        seed: 12,
        map: { seed: 12, band: 'evernight', wind: 0, sunBearing: PI / 2 },
        armies: [
          { faction: 'choir', controller: 'ai', units: ['choir.oriel', 'choir.gnomonGuard', 'choir.lenswrights', 'choir.kilnbackLancers'] },
          { faction: 'hush', controller: 'ai', units: ['hush.queenYsh', 'hush.theUnlit', 'hush.rimeguard', 'hush.rimeHounds'] },
        ],
      }),
    ],
  ];

  it.each(matchups)('%s: the battle is decided by a rout within the time limit', (_name, setup) => {
    const b = withAI(setup);
    const r = b.run();
    expect(r).not.toBeNull();
    expect(b.over).toBe(true);
    expect(r.reason).toBe('rout');
    expect(r.time).toBeLessThan(b.timeLimit);
    expect([0, 1]).toContain(r.winner);
    const winner = r.winner as 0 | 1;
    expect(b.army(winner).some((u) => u.state === 'ready' && u.alive > 0)).toBe(true);
    for (const s of r.sides) {
      expect(s.soldiersLost).toBeGreaterThanOrEqual(0);
      expect(s.soldiersLost).toBeLessThanOrEqual(s.soldiersStart);
      expect(s.costLost).toBeLessThanOrEqual(s.costStart + 1e-9);
    }
    // Stepping a finished battle does nothing.
    const t = b.tick;
    b.step();
    expect(b.tick).toBe(t);
  });

  it('a battle nobody fights ends at the time limit as a draw', () => {
    const b = makeBattle({
      timeLimit: 30,
      armies: [
        { faction: 'vesperate', units: ['vesperate.hourLevy'] },
        { faction: 'choir', units: ['choir.kilnAcolytes'] },
      ],
    });
    const r = b.run();
    expect(r.reason).toBe('timeout');
    expect(r.winner).toBe(-1);
    expect(r.time).toBeCloseTo(30, 9);
  });
});

// --------------------------------------------------------------------- morale

describe('morale', () => {
  /** The unit under test is units[0]; a reserve far away keeps side 0 in the fight while it routs. */
  function moraleBattle(units: UnitSpec[] = [{ def: 'vesperate.hourLevy', x: 700, y: 500 }]): Battle {
    const b = makeBattle({
      armies: [
        { faction: 'vesperate', units: [...units, { def: 'vesperate.hourLevy', x: 150, y: 900 }] },
        { faction: 'choir', units: [{ def: 'choir.kilnAcolytes', x: 700, y: 60 }] },
      ],
    });
    b.step();
    return b;
  }

  it('Steady above half, Wavering below 50%, Broken when routing', () => {
    const b = moraleBattle();
    const u = b.units[0]!;
    expect(moraleState(u)).toBe('steady');
    u.morale = u.maxMorale * 0.5;
    expect(moraleState(u)).toBe('steady');
    u.morale = u.maxMorale * 0.49;
    expect(moraleState(u)).toBe('wavering');
    u.morale = -1;
    b.step();
    expect(u.state).toBe('routing');
    expect(moraleState(u)).toBe('broken');
  });

  it('a unit whose morale is forced to 0 routs on the next tick', () => {
    const b = moraleBattle();
    const u = b.units[0]!;
    expect(u.state).toBe('ready');
    u.morale = 0;
    b.step();
    expect(u.state).toBe('routing');
    expect(u.routs).toBe(1);
  });

  it('a routed unit flees toward its own edge, rallies after 12 s unpressed, and its third rout shatters it', () => {
    const b = moraleBattle();
    const u = b.units[0]!;
    for (let n = 1; n <= 3; n++) {
      // Knock the unit's morale below zero, as a shock would.
      u.morale = -0.05 * u.maxMorale;
      const y0 = u.y;
      b.step();
      expect(u.routs).toBe(n);
      if (n === 3) break;
      expect(u.state).toBe('routing');
      const t0 = b.time;
      expect(stepUntil(b, () => u.state === 'ready', 20 * 20)).toBe(true);
      expect(b.time - t0).toBeGreaterThanOrEqual(MORALE.rallyDelay - DT);
      // Side 0 deploys at the bottom of the map, so it flees toward larger y.
      expect(u.y).toBeGreaterThan(y0 + 20);
      expect(u.morale).toBeCloseTo(u.maxMorale * MORALE.rallyMorale, 9);
      b.step();
    }
    expect(u.state).toBe('shattered');
    // Shattered units never rally: they run until they leave the field.
    stepSeconds(b, 30);
    expect(['shattered', 'fled']).toContain(u.state);
  });

  it('a unit below 12% strength shatters on its first rout', () => {
    const b = moraleBattle();
    const u = b.units[0]!;
    const living = u.soldiers.filter((s) => s.alive);
    for (const s of living.slice(0, Math.ceil(living.length * 0.9))) killSoldier(b, s, null, null);
    expect(u.alive / u.initial).toBeLessThan(MORALE.shatterStrength);
    u.morale = -1;
    b.step();
    expect(u.routs).toBe(1);
    expect(u.state).toBe('shattered');
  });

  it('colossi are unbreakable: morale is held at 1 and they never rout', () => {
    const b = moraleBattle([{ def: 'vesperate.oldMidnight', x: 700, y: 600 }]);
    const u = b.units[0]!;
    u.morale = -50;
    b.step();
    expect(u.state).toBe('ready');
    expect(u.morale).toBe(1);
  });
});

// ------------------------------------------------------------------ the Toll

describe('the Vesperate Toll', () => {
  function tollBattle(units: UnitSpec[], hour?: 'charge' | 'iron' | 'rest'): Battle {
    const b = makeBattle({
      armies: [
        { faction: 'vesperate', units, hour },
        { faction: 'choir', units: [{ def: 'choir.kilnAcolytes', x: 1300, y: 60 }] },
      ],
    });
    b.step();
    return b;
  }

  /** Step until side 0's Toll rings again; returns the battle time of the ring. */
  function nextToll(b: Battle): number {
    const last = b.sides[0].lastToll;
    expect(stepUntil(b, () => b.sides[0].lastToll !== last, 20 * 120)).toBe(true);
    return b.sides[0].lastToll;
  }

  const LORD = { def: 'vesperate.maren', x: 700, y: 850 };

  it('rings every 30 s with a Belfry Wagon on the field', () => {
    const b = tollBattle([LORD, { def: 'vesperate.belfryWagon', x: 600, y: 850 }]);
    expect(tollInterval(b, 0)).toBe(30);
    expect(b.sides[0].tollInterval).toBe(30);
    const t1 = nextToll(b);
    const t2 = nextToll(b);
    expect(Math.abs(t1 - 30)).toBeLessThan(DT / 2);
    expect(Math.abs(t2 - t1 - 30)).toBeLessThan(DT / 2);
  });

  it('rings every 45 s when only the lord\'s bell remains', () => {
    const b = tollBattle([LORD, { def: 'vesperate.hourLevy', x: 700, y: 780 }]);
    expect(tollInterval(b, 0)).toBe(TOLL.lordInterval);
    expect(b.sides[0].tollInterval).toBe(45);
    const t1 = nextToll(b);
    const t2 = nextToll(b);
    expect(Math.abs(t1 - 45)).toBeLessThan(DT / 2);
    expect(Math.abs(t2 - t1 - 45)).toBeLessThan(DT / 2);
  });

  it('rings every 20 s with Old Midnight, and its Toll carries across the whole field', () => {
    const b = tollBattle([LORD, { def: 'vesperate.oldMidnight', x: 700, y: 700 }, { def: 'vesperate.hourLevy', x: 100, y: 150 }]);
    expect(b.sides[0].tollInterval).toBe(20);
    const t1 = nextToll(b);
    expect(Math.abs(t1 - 20)).toBeLessThan(DT / 2);
    const far = b.units[2]!;
    expect(far.tollUntil).toBe(t1 + TOLL.window);
    const t2 = nextToll(b);
    expect(Math.abs(t2 - t1 - 20)).toBeLessThan(DT / 2);
  });

  it("Old Midnight's Toll costs wavering enemies 5% leadership and leaves steady ones alone", () => {
    const b = makeBattle({
      armies: [
        { faction: 'vesperate', units: [LORD, { def: 'vesperate.oldMidnight', x: 700, y: 700 }] },
        {
          faction: 'choir',
          units: [
            { def: 'choir.kilnAcolytes', x: 300, y: 60 },
            { def: 'choir.kilnAcolytes', x: 1100, y: 60 },
          ],
        },
      ],
    });
    b.step();
    const [wavering, steady] = [b.units[2]!, b.units[3]!];
    expect(stepUntil(b, () => b.sides[0].tollTimer >= 20 - 1.5 * DT, 20 * 30)).toBe(true);
    wavering.morale = wavering.maxMorale * 0.4;
    steady.morale = steady.maxMorale * 0.8;
    const before = [wavering.morale, steady.morale];
    b.step();
    expect(b.sides[0].lastToll).toBe(b.time);
    // Out of combat both regain 2.5%/s (0.125% this tick); the wavering unit also pays the Toll's 5%.
    expect((wavering.morale - before[0]!) / wavering.maxMorale).toBeCloseTo(-0.05 + 0.025 * DT, 9);
    expect((steady.morale - before[1]!) / steady.maxMorale).toBeCloseTo(0.025 * DT, 9);
  });

  it('losing the Belfry Wagon slows the Toll to the lord\'s 45 s; no bell at all means no Toll', () => {
    const b = tollBattle([LORD, { def: 'vesperate.belfryWagon', x: 600, y: 850 }]);
    expect(b.sides[0].tollInterval).toBe(30);
    for (const s of b.units[1]!.soldiers) killSoldier(b, s, null, null);
    b.step();
    expect(b.sides[0].tollInterval).toBe(45);
    for (const s of b.units[0]!.soldiers) killSoldier(b, s, null, null);
    b.step();
    expect(b.sides[0].tollInterval).toBe(Infinity);
    // Other factions have no Toll.
    expect(b.sides[1].tollInterval).toBe(Infinity);
    expect(b.sides[1].lastToll).toBe(-999);
  });

  it('units within range get the Hour for 6 s (tollUntil = time + 6); units out of range do not', () => {
    const b = tollBattle([
      LORD,
      { def: 'vesperate.belfryWagon', x: 600, y: 850 },
      { def: 'vesperate.hourLevy', x: 700, y: 700 },
      { def: 'vesperate.hourLevy', x: 150, y: 150 },
    ]);
    const t = nextToll(b);
    expect(b.units[0]!.tollUntil).toBe(t + TOLL.window);
    expect(b.units[1]!.tollUntil).toBe(t + TOLL.window);
    expect(b.units[2]!.tollUntil).toBe(t + 6);
    expect(b.units[3]!.tollUntil).toBe(-999);
    // Enemy units never hear our bell.
    expect(b.units[4]!.tollUntil).toBe(-999);
  });

  it('Bell Outriders carry the Toll 100 m beyond its normal range', () => {
    const b = tollBattle([
      LORD,
      { def: 'vesperate.belfryWagon', x: 600, y: 850 },
      { def: 'vesperate.bellOutriders', x: 600, y: 560 },
      { def: 'vesperate.hourLevy', x: 600, y: 470 },
      { def: 'vesperate.hourLevy', x: 600, y: 300 },
    ]);
    const t = nextToll(b);
    const [, wagon, riders, relayed, beyond] = b.units;
    expect(Math.hypot(riders!.x - wagon!.soldiers[0]!.x, riders!.y - wagon!.soldiers[0]!.y)).toBeLessThan(320);
    expect(Math.hypot(relayed!.x - wagon!.soldiers[0]!.x, relayed!.y - wagon!.soldiers[0]!.y)).toBeGreaterThan(320);
    expect(riders!.tollUntil).toBe(t + 6);
    expect(relayed!.tollUntil).toBe(t + 6);
    expect(beyond!.tollUntil).toBe(-999);
  });

  it('the chosen Hour applies only while the Toll lasts (Hour of Iron: +10 melee defense, no knockback)', () => {
    const b = tollBattle([LORD, { def: 'vesperate.hourLevy', x: 700, y: 780 }], 'iron');
    const levy = b.units[1]!;
    expect(levy.stats.md).toBe(0);
    const t = nextToll(b);
    b.step();
    expect(b.time).toBeLessThan(t + TOLL.window);
    expect(levy.stats.md).toBe(10);
    expect(levy.stats.noKnockback).toBe(true);
    stepToTime(b, t + TOLL.window + 0.1);
    expect(levy.stats.md).toBe(0);
    expect(levy.stats.noKnockback).toBe(false);
  });
});

// ------------------------------------------------------------ stealth, spotting

describe('stealth and spotting', () => {
  function stealthBattle(dist: number, band: BandId = 'evernight'): Battle {
    const b = makeBattle({
      map: { band },
      armies: [
        {
          faction: 'hush',
          units: [
            { def: 'hush.theUnlit', x: 500, y: 520 },
            { def: 'hush.glowkinLurers', x: 950, y: 520 },
          ],
        },
        {
          faction: 'drift',
          units: [
            { def: 'drift.reedspears', x: 500, y: 520 - dist, facing: PI / 2 },
            { def: 'drift.reedspears', x: 950, y: 520 - dist, facing: PI / 2 },
          ],
        },
      ],
    });
    stepSeconds(b, 1.5);
    return b;
  }

  it('The Unlit standing in Dark light are concealed and unseen by an enemy 200 m away', () => {
    const b = stealthBattle(200);
    const unlit = unitOf(b, 'hush.theUnlit');
    expect(unlit.light).toBe(0);
    expect(unlit.concealed).toBe(true);
    expect(unlit.visible[1]).toBe(false);
  });

  it('The Unlit are seen by an enemy 20 m away', () => {
    const b = stealthBattle(20);
    const unlit = unitOf(b, 'hush.theUnlit');
    expect(unlit.light).toBe(0);
    expect(unlit.visible[1]).toBe(true);
  });

  it('Glowkin Lurers are never concealed, even standing still in the Dark', () => {
    for (const dist of [200, 20]) {
      const b = stealthBattle(dist);
      const lurers = unitOf(b, 'hush.glowkinLurers');
      expect(lurers.light).toBe(0);
      expect(lurers.moving).toBe(false);
      expect(lurers.concealed).toBe(false);
      const enemy = b.units[3]!;
      if (b.terrain.los(enemy.x, enemy.y, 2, lurers.x, lurers.y, 2)) expect(lurers.visible[1]).toBe(true);
    }
  });

  it('The Unlit have nowhere to hide in Blaze light on open ground', () => {
    const b = stealthBattle(200, 'glare');
    const unlit = unitOf(b, 'hush.theUnlit');
    expect(unlit.light).toBe(4);
    expect(b.terrain.inForest(unlit.x, unlit.y)).toBe(false);
    expect(b.terrain.inShadow(unlit.x, unlit.y)).toBe(false);
    expect(unlit.concealed).toBe(false);
  });
});

// ------------------------------------------------------------------- abilities

describe('big abilities', () => {
  it('Censer Sweep telegraphs for its 2 s windup and only then hits the enemies in its cone', () => {
    const b = makeBattle({
      armies: [
        { faction: 'choir', units: [{ def: 'choir.nailbearer', x: 700, y: 520, facing: -PI / 2 }] },
        // Front rank ~18 m from the colossus: inside the 22 m cone, outside its melee reach.
        { faction: 'vesperate', units: [{ def: 'vesperate.hourLevy', x: 700, y: 498, facing: PI / 2 }] },
      ],
    });
    b.step();
    const nb = b.units[0]!;
    const levy = b.units[1]!;
    const sweep = findAbility(nb, 'censerSweep')!;
    const hp0 = levy.soldiers.reduce((a, s) => a + s.hp, 0);
    expect(castAbility(b, nb, 'censerSweep', levy.x, levy.y)).toBe(true);
    const cast = b.time;
    expect(b.telegraphs).toHaveLength(1);
    expect(b.telegraphs[0]!.shape).toBe('cone');
    expect(b.telegraphs[0]!.end - b.telegraphs[0]!.start).toBeCloseTo(2, 9);
    let landed = -1;
    for (let i = 0; i < 60 && landed < 0; i++) {
      b.step();
      if (sweep.windup === 0) landed = b.time;
      else expect(levy.soldiers.reduce((a, s) => a + s.hp, 0)).toBe(hp0);
    }
    expect(landed - cast).toBeGreaterThanOrEqual(2 - 1e-9);
    expect(levy.soldiers.reduce((a, s) => a + (s.alive ? s.hp : 0), 0)).toBeLessThan(hp0);
  });
});

// ------------------------------------------------------------------- terrain

describe('terrain', () => {
  const maps: MapSetup[] = [
    { seed: 3, band: 'gloaming', wind: 1, sunBearing: 0.3 },
    { seed: 'river', band: 'longAfternoon', wind: 2, sunBearing: -2, preset: 'river' },
    { seed: 99, band: 'gloaming', wind: 0, sunBearing: 1, preset: 'wooded', fort: { defender: 1, radius: 200 } },
  ];

  it('the same MapSetup always yields identical heights, cover, shadows and features', () => {
    for (const m of maps) {
      const a = new Terrain({ ...m });
      const b = new Terrain({ ...m });
      expect(Buffer.from(a.heights.buffer).equals(Buffer.from(b.heights.buffer))).toBe(true);
      expect(Buffer.from(a.cover).equals(Buffer.from(b.cover))).toBe(true);
      expect(Buffer.from(a.shadow).equals(Buffer.from(b.shadow))).toBe(true);
      expect(Buffer.from(a.flammable).equals(Buffer.from(b.flammable))).toBe(true);
      expect(a.trees).toEqual(b.trees);
      expect(a.rects).toEqual(b.rects);
      expect(a.rivers).toEqual(b.rivers);
      expect(a.walls).toEqual(b.walls);
    }
  });

  it('different seeds give different maps', () => {
    const a = new Terrain({ seed: 1, band: 'gloaming', wind: 1, sunBearing: 0 });
    const b = new Terrain({ seed: 2, band: 'gloaming', wind: 1, sunBearing: 0 });
    expect(Buffer.from(a.heights.buffer).equals(Buffer.from(b.heights.buffer))).toBe(false);
  });

  it('shadows exist only in Bright and Dusk light', () => {
    const count = (t: Terrain): number => t.shadow.reduce((a, c) => a + c, 0);
    for (const band of BAND_IDS) {
      const t = new Terrain({ seed: 4, band, wind: 1, sunBearing: 0.5 });
      if (t.light === 2 || t.light === 3) expect(count(t), band).toBeGreaterThan(0);
      else expect(count(t), band).toBe(0);
    }
    for (const light of [0, 1, 2, 3, 4] as LightLevel[]) {
      const t = new Terrain({ seed: 4, band: 'longAfternoon', light, wind: 1, sunBearing: 0.5 });
      expect(t.light).toBe(light);
      if (light === 2 || light === 3) expect(count(t), `light ${light}`).toBeGreaterThan(0);
      else expect(count(t), `light ${light}`).toBe(0);
    }
  });

  it('the deployment zones are kept free of buildings, cliffs and deep water', () => {
    for (const band of BAND_IDS) {
      const t = new Terrain({ seed: 17, band, wind: 1, sunBearing: 0, preset: 'river' });
      for (const side of [0, 1] as const) {
        const z = t.deployZone(side);
        for (let y = z.y + 2; y < z.y + z.h; y += 8) {
          for (let x = z.x + 2; x < z.x + z.w; x += 8) {
            const c = t.coverAt(x, y);
            expect([COVER.Building, COVER.Cliff, COVER.Deep], `${band} side ${side} at ${x},${y}`).not.toContain(c);
          }
        }
      }
    }
  });
});

// ------------------------------------------------------------ army generation

describe('army generation', () => {
  const budgets = [1500, 3000, 6000, 9000, 12000, 20000, 60000];

  it('stays within budget with at most 16 units plus the lord, for every faction and many seeds', () => {
    const bad: string[] = [];
    for (const f of FACTION_IDS) {
      for (const budget of budgets) {
        for (let seed = 0; seed < 40; seed++) {
          const army = generateArmy(f, budget, new Rng(`${f}:${budget}:${seed}`));
          const cost = armyCost(army);
          const defs = army.map((s) => unitDef(s.def));
          const problems: string[] = [];
          if (cost > budget) problems.push(`cost ${cost}`);
          if (army.length > ARMY.maxUnits + 1) problems.push(`${army.length} units`);
          if (army[0]!.def !== FACTIONS[f].lord.id) problems.push('lord not first');
          if (defs.filter((d) => d.role === 'lord').length !== 1) problems.push('lords');
          if (defs.filter((d) => d.role === 'colossus').length > ARMY.maxColossi) problems.push('colossi');
          if (defs.some((d) => d.faction !== f)) problems.push('foreign unit');
          if (problems.length) bad.push(`${f} ${budget} #${seed}: ${problems.join(', ')}`);
        }
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it('fills all 16 slots when the budget allows', () => {
    for (const f of FACTION_IDS) {
      const army = generateArmy(f, 200000, new Rng(1));
      expect(army).toHaveLength(ARMY.maxUnits + 1);
      expect(generateArmy(f, 200000, new Rng(1), { maxUnits: 5 })).toHaveLength(6);
    }
  });

  it('is deterministic for a given seed and honours colossus and exclusion options', () => {
    for (const f of FACTION_IDS) {
      expect(generateArmy(f, 12000, new Rng(9))).toEqual(generateArmy(f, 12000, new Rng(9)));
      const withC = generateArmy(f, 12000, new Rng(9), { colossus: 'yes' });
      expect(withC.map((s) => s.def)).toContain(FACTIONS[f].colossus.id);
      const noC = generateArmy(f, 60000, new Rng(9), { colossus: 'no' });
      expect(noC.map((s) => s.def)).not.toContain(FACTIONS[f].colossus.id);
      const banned = FACTIONS[f].units[0]!.id;
      expect(generateArmy(f, 60000, new Rng(9), { exclude: [banned] }).map((s) => s.def)).not.toContain(banned);
    }
  });

  it('generated armies load into a battle with one general per side', () => {
    const rng = new Rng('load');
    const setup = makeSetup({
      map: { preset: 'default' },
      armies: [
        { faction: 'drift', units: generateArmy('drift', 9000, rng) },
        { faction: 'hush', units: generateArmy('hush', 9000, rng) },
      ],
    });
    const b = new Battle(setup);
    expect(b.units).toHaveLength(setup.armies[0].units.length + setup.armies[1].units.length);
    for (const side of [0, 1] as const) {
      expect(b.sides[side].general?.def.role).toBe('lord');
      expect(b.army(side).filter((u) => u.isGeneral)).toHaveLength(1);
      const z = b.terrain.deployZone(side);
      for (const u of b.army(side)) {
        expect(u.x).toBeGreaterThanOrEqual(z.x);
        expect(u.x).toBeLessThanOrEqual(z.x + z.w);
        expect(u.y).toBeGreaterThanOrEqual(z.y);
        expect(u.y).toBeLessThanOrEqual(z.y + z.h);
      }
    }
  });
});

// ------------------------------------------------------------------ collisions

describe('collisions', () => {
  function bigPairSeparation(angle: number, gap: number): number {
    const b = makeBattle({
      armies: [
        { faction: 'choir', units: [{ def: 'choir.moltenSaints', x: 700, y: 800 }] },
        { faction: 'hush', units: [{ def: 'hush.glowkinLurers', x: 700, y: 100 }] },
      ],
    });
    const [a, c, d, e] = b.units[0]!.soldiers as [Unit['soldiers'][0], Unit['soldiers'][0], Unit['soldiers'][0], Unit['soldiers'][0]];
    a.x = 500;
    a.y = 500;
    c.x = 500 + Math.cos(angle) * gap;
    c.y = 500 + Math.sin(angle) * gap;
    d.x = 600;
    d.y = 300;
    e.x = 650;
    e.y = 300;
    b.rebuildHash();
    const before = Math.hypot(c.x - a.x, c.y - a.y);
    resolveCollisions(b);
    return Math.hypot(c.x - a.x, c.y - a.y) - before;
  }

  it('two overlapping soldiers of the same unit are pushed apart by 30% of their overlap', () => {
    // Small bodies: two Hush Glowkin Lurers.
    const b = makeBattle({
      armies: [
        { faction: 'hush', units: [{ def: 'hush.glowkinLurers', x: 700, y: 800 }] },
        { faction: 'choir', units: [{ def: 'choir.kilnAcolytes', x: 700, y: 100 }] },
      ],
    });
    const ss = b.units[0]!.soldiers;
    for (let i = 2; i < ss.length; i++) {
      ss[i]!.x = 100 + i * 5;
      ss[i]!.y = 600;
    }
    ss[0]!.x = 500;
    ss[0]!.y = 500;
    ss[1]!.x = 500.5;
    ss[1]!.y = 500.2;
    b.rebuildHash();
    const d0 = Math.hypot(0.5, 0.2);
    resolveCollisions(b);
    const d1 = Math.hypot(ss[1]!.x - ss[0]!.x, ss[1]!.y - ss[0]!.y);
    const overlap = ss[0]!.radius + ss[1]!.radius - d0;
    expect(d1 - d0).toBeCloseTo(overlap * 0.3, 9);
  });

  // BUG (src/sim/movement.ts, resolveCollisions): big-big pairs are resolved twice per tick. The spatial-hash
  // pass collides a pair whose centers are within s.radius + 1.3, and the "far" pass collides it again whenever
  // |dx| + |dy| > s.radius + 1.3, a Manhattan test evaluated after the first push has already moved them, so
  // most overlapping monster/colossus pairs get ~1.7 pushes instead of the one the comment promises.
  it.fails('two overlapping big bodies of the same unit are pushed apart once: 30% of their overlap, at any bearing', () => {
    const overlap = 2 * unitDef('choir.moltenSaints').radius! - 3.6;
    for (const angle of [0, 0.3, PI / 4, 1]) {
      expect(bigPairSeparation(angle, 3.6)).toBeCloseTo(overlap * 0.3, 6);
    }
  });
});
