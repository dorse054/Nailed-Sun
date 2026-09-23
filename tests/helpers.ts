/**
 * Shared helpers for the simulation tests: compact battle setups, stepping by
 * seconds, and a bit-exact fingerprint of the simulation state.
 */
import { Battle } from '../src/sim/battle';
import { DT } from '../src/sim/constants';
import type { MapSetup } from '../src/sim/terrain';
import type { ArmySetup, BattleSetup, Side, Unit, UnitSpec } from '../src/sim/types';
import type { FactionId } from '../src/data/schema';

export interface ArmyOpts {
  faction: FactionId;
  units: (string | UnitSpec)[];
  controller?: ArmySetup['controller'];
  hour?: ArmySetup['hour'];
}

export interface SetupOpts {
  seed?: number | string;
  map?: Partial<MapSetup>;
  armies: [ArmyOpts, ArmyOpts];
  unitScale?: number;
  timeLimit?: number;
}

/** A small battle setup; the map defaults to an open Gloaming field in Calm, sun to the east. */
export function makeSetup(o: SetupOpts): BattleSetup {
  const seed = o.seed ?? 1;
  const map: MapSetup = { seed, band: 'gloaming', wind: 0, sunBearing: 0, preset: 'open', ...o.map };
  const army = (a: ArmyOpts): ArmySetup => ({
    faction: a.faction,
    controller: a.controller ?? 'player',
    hour: a.hour,
    units: a.units.map((u) => (typeof u === 'string' ? { def: u } : { ...u })),
  });
  return {
    seed,
    map,
    armies: [army(o.armies[0]), army(o.armies[1])],
    unitScale: o.unitScale ?? 0.5,
    timeLimit: o.timeLimit,
  };
}

export function makeBattle(o: SetupOpts, opts: { events?: boolean } = {}): Battle {
  return new Battle(makeSetup(o), opts);
}

/** Step whole ticks until `seconds` more seconds have passed (or the battle ends). */
export function stepSeconds(b: Battle, seconds: number): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n && !b.result; i++) b.step();
}

/** Step until a predicate holds; returns false if it never did within the tick budget. */
export function stepUntil(b: Battle, pred: () => boolean, maxTicks = 20 * 600): boolean {
  for (let i = 0; i < maxTicks; i++) {
    if (pred()) return true;
    if (b.result) return pred();
    b.step();
  }
  return pred();
}

export function unitOf(b: Battle, defId: string, side?: Side, nth = 0): Unit {
  const list = b.units.filter((u) => u.def.id === defId && (side === undefined || u.side === side));
  const u = list[nth];
  if (!u) throw new Error(`No unit ${defId}${side === undefined ? '' : ` on side ${side}`} #${nth}`);
  return u;
}

/**
 * Every value that drives the simulation, printed exactly (String(n) round-trips
 * doubles), so two fingerprints are equal only if the states are bit-identical.
 */
export function fingerprint(b: Battle): string[] {
  const out: string[] = [];
  out.push(`tick=${b.tick} time=${b.time} rng=${b.rng.getState().join(',')} over=${b.result ? `${b.result.winner}/${b.result.reason}/${b.result.time}` : '-'}`);
  out.push(`ids zone=${b.nextZoneId} proj=${b.nextProjectileId} tele=${b.nextTelegraphId}`);
  for (const s of b.sides) out.push(`side hour=${s.hour} toll=${s.tollTimer}/${s.tollInterval}/${s.lastToll} gdead=${s.generalDead} cap=${s.capture}`);
  for (const z of b.zones) out.push(`zone ${z.id} ${z.def.id} s${z.side} ${z.x},${z.y} r${z.radius} until=${z.until} on=${z.enabled} gen=${z.generation}`);
  for (const p of b.projectiles) out.push(`proj ${p.id} ${p.weapon.kind} s${p.side} ${p.x1},${p.y1} t=${p.t}/${p.T}`);
  for (const u of b.units) {
    out.push(
      `unit ${u.id} ${u.def.id} ${u.state} alive=${u.alive} morale=${u.morale} fat=${u.fatigue} at=${u.x},${u.y},${u.facing} ` +
        `order=${u.order.kind} routs=${u.routs} kills=${u.kills} dmg=${u.damageDealt} toll=${u.tollUntil} vis=${u.visible.join('/')}`,
    );
    for (const s of u.soldiers) out.push(`  sol ${s.id} ${s.alive ? 1 : 0} ${s.x},${s.y} hp=${s.hp} f=${s.facing} ammo=${s.ammo}`);
  }
  return out;
}

/** First line where two fingerprints differ, for readable assertion messages. */
export function firstDifference(a: string[], b: string[]): string | null {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return `line ${i}:\n  ${a[i] ?? '<missing>'}\n  ${b[i] ?? '<missing>'}`;
  }
  return null;
}

/** Outcome summary the task cares about: winner, time and per-unit alive counts. */
export function outcome(b: Battle): { winner: number | null; reason: string | null; time: number; alive: number[]; states: string[] } {
  return {
    winner: b.result ? b.result.winner : null,
    reason: b.result ? b.result.reason : null,
    time: b.result ? b.result.time : b.time,
    alive: b.units.map((u) => u.alive),
    states: b.units.map((u) => u.state),
  };
}
