/**
 * Light and dark zones, auras and burning ground.
 *
 * Doc rule: "Where zones overlap, the higher intensity wins; equal intensities
 * cancel and the map's natural light returns."
 */
import type { LightLevel, WindLevel, ZoneDef } from '../data/schema';
import { zoneDef } from '../data/zones';
import { WIND_RULES } from '../data/rules';
import { dcos, dsin } from '../core/dmath';
import type { Battle } from './battle';
import type { Side, Unit, Zone } from './types';
import { applyDamage, typeMult } from './combat';

export function addZone(
  b: Battle,
  def: ZoneDef | string,
  side: Side,
  x: number,
  y: number,
  duration: number,
  source: Unit | null = null,
  attached = false,
): Zone {
  const d = typeof def === 'string' ? zoneDef(def) : def;
  const z: Zone = {
    id: b.nextZoneId++,
    def: d,
    side,
    x,
    y,
    radius: d.radius,
    until: duration === Infinity ? Infinity : b.time + duration,
    source,
    attached,
    enabled: true,
    spreadAt: b.time + (WIND_RULES[b.terrain.wind].fireSpreadSeconds || 1e9),
    generation: 0,
    born: b.time,
  };
  b.zones.push(z);
  return z;
}

/** Natural light at a point, then zones by intensity. */
export function lightAt(b: Battle, x: number, y: number): LightLevel {
  const base = b.terrain.light;
  let floorI = 0;
  let floorL = 0;
  let ceilI = 0;
  let ceilL = 4;
  for (const z of b.zones) {
    const l = z.def.light;
    if (!l || !z.enabled) continue;
    const dx = x - z.x;
    const dy = y - z.y;
    if (dx * dx + dy * dy > z.radius * z.radius) continue;
    if (l.mode === 'floor') {
      if (l.intensity > floorI || (l.intensity === floorI && l.level > floorL)) {
        floorI = l.intensity;
        floorL = l.level;
      }
    } else if (l.intensity > ceilI || (l.intensity === ceilI && l.level < ceilL)) {
      ceilI = l.intensity;
      ceilL = l.level;
    }
  }
  if (floorI === 0 && ceilI === 0) return base;
  if (floorI > ceilI) return Math.max(base, floorL) as LightLevel;
  if (ceilI > floorI) return Math.min(base, ceilL) as LightLevel;
  return base;
}

/** True when a dark zone wins at this point (the sun is hidden). */
export function darkWinsAt(b: Battle, x: number, y: number): boolean {
  let floorI = 0;
  let ceilI = 0;
  for (const z of b.zones) {
    const l = z.def.light;
    if (!l || !z.enabled) continue;
    const dx = x - z.x;
    const dy = y - z.y;
    if (dx * dx + dy * dy > z.radius * z.radius) continue;
    if (l.mode === 'floor') floorI = Math.max(floorI, l.intensity);
    else ceilI = Math.max(ceilI, l.intensity);
  }
  return ceilI > floorI;
}

/** Map wind plus local gusts. Direction is fixed: always sunward. */
export function windAt(b: Battle, x: number, y: number): WindLevel {
  let w = b.terrain.wind + b.windBonus;
  for (const z of b.zones) {
    if (!z.def.windDelta || !z.enabled) continue;
    const dx = x - z.x;
    const dy = y - z.y;
    if (dx * dx + dy * dy <= z.radius * z.radius) w += z.def.windDelta;
  }
  return Math.max(0, Math.min(2, w)) as WindLevel;
}

/** Does a straight beam from a to b pass through a beam-blocking zone? Returns t in [0,1] where blocked, or -1. */
export function beamBlockedAt(b: Battle, ax: number, ay: number, bx: number, by: number): number {
  let best = -1;
  for (const z of b.zones) {
    if (!z.def.blocksBeams || !z.enabled) continue;
    // A zone only blocks where darkness actually wins over light zones there.
    const t = segCircle(ax, ay, bx, by, z.x, z.y, z.radius);
    if (t < 0) continue;
    const px = ax + (bx - ax) * Math.min(1, t + 0.02);
    const py = ay + (by - ay) * Math.min(1, t + 0.02);
    if (!darkWinsAt(b, px, py)) continue;
    if (best < 0 || t < best) best = t;
  }
  return best;
}

function segCircle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, r: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const fx = ax - cx;
  const fy = ay - cy;
  const a = dx * dx + dy * dy;
  const bq = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0;
  if (a === 0) return -1;
  const disc = bq * bq - 4 * a * c;
  if (disc < 0) return -1;
  const t = (-bq - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}

/** Accuracy change for a missile landing at (x, y), from zones like the Veil. */
export function missileIntoMod(b: Battle, x: number, y: number): number {
  let m = 0;
  for (const z of b.zones) {
    if (!z.def.missileAccuracyInto || !z.enabled) continue;
    const dx = x - z.x;
    const dy = y - z.y;
    if (dx * dx + dy * dy <= z.radius * z.radius) m = Math.min(m, z.def.missileAccuracyInto);
  }
  return m;
}

export function zonesAt(b: Battle, x: number, y: number, out: Zone[]): Zone[] {
  out.length = 0;
  for (const z of b.zones) {
    if (!z.enabled) continue;
    const dx = x - z.x;
    const dy = y - z.y;
    if (dx * dx + dy * dy <= z.radius * z.radius) out.push(z);
  }
  return out;
}

/** Per-tick zone upkeep: follow sources, expire, burn, spread fire. */
export function updateZones(b: Battle): void {
  const zones = b.zones;
  let fires = 0;
  for (let i = zones.length - 1; i >= 0; i--) {
    const z = zones[i]!;
    if (z.attached && z.source) {
      const u = z.source;
      if (u.state === 'dead' || u.state === 'fled' || u.alive <= 0) {
        zones.splice(i, 1);
        continue;
      }
      const lead = u.soldiers.find((s) => s.alive);
      if (lead && (u.def.category === 'colossus' || u.soldiers.length <= 4)) {
        z.x = lead.x;
        z.y = lead.y;
      } else {
        z.x = u.x;
        z.y = u.y;
      }
    }
    if (b.time >= z.until) {
      zones.splice(i, 1);
      continue;
    }
    if (z.def.dps) fires++;
  }
  // Burning ground ticks twice a second. Armor turns part of the heat (as for any hit with
  // half its damage armor-piercing, at the mean armor roll), and fire vulnerability applies.
  if (b.tick % 10 === 0) {
    for (const z of zones) {
      if (!z.def.dps || !z.enabled) continue;
      const dps = z.def.dps;
      b.hash.query(z.x, z.y, z.radius, (i) => {
        const s = b.soldiers[i]!;
        if (!s.alive || s.airborne) return;
        if (!dps.friendly && s.unit.side === z.side) return;
        if (s.unit.def.mechanics?.some((m) => m.kind === 'heatImmune')) return;
        const armor = Math.max(0, Math.min(100, s.armor + s.unit.stats.armorAdd));
        const dmg = (z.dps ?? dps.damage) * 0.5 * (1 - (0.5 * 0.75 * armor) / 100) * typeMult(dps.type, s.unit);
        // Anyone not locked in a fight steps out of the flames (see moveSoldiers).
        s.hotUntil = z.until;
        s.hotX = z.x;
        s.hotY = z.y;
        s.hotR = z.radius;
        applyDamage(b, s, dmg, null, dps.type, z.source);
      });
    }
  }
  // Fire spreads sunward in Breeze and Gale, on flammable ground.
  const spreadEvery = WIND_RULES[b.terrain.wind].fireSpreadSeconds;
  if (spreadEvery > 0 && fires < 90) {
    const sx = dcos(b.terrain.sunBearing);
    const sy = dsin(b.terrain.sunBearing);
    const n = zones.length;
    for (let i = 0; i < n; i++) {
      const z = zones[i]!;
      if (!z.def.spreads || b.time < z.spreadAt) continue;
      z.spreadAt = b.time + spreadEvery;
      if (z.generation >= 5) continue;
      const nx = z.x + sx * z.radius * 1.6;
      const ny = z.y + sy * z.radius * 1.6;
      if (!b.terrain.inBounds(nx, ny) || !b.terrain.isFlammable(nx, ny)) continue;
      // Don't stack fires on top of each other.
      let crowded = false;
      for (const o of zones) {
        if (o.def.dps && (o.x - nx) * (o.x - nx) + (o.y - ny) * (o.y - ny) < z.radius * z.radius) {
          crowded = true;
          break;
        }
      }
      if (crowded) continue;
      const remaining = Math.max(6, (z.until - b.time) * 0.8);
      const child = addZone(b, z.def, z.side, nx, ny, remaining, z.source, false);
      child.generation = z.generation + 1;
      child.dps = z.dps;
      b.events.push({ t: 'fire', x: nx, y: ny });
    }
  }
}

/** Zone that belongs to a unit's own mechanic (lanterns, Veil, Eclipse). */
export function ownZone(b: Battle, u: Unit): Zone | undefined {
  return b.zones.find((z) => z.source === u && z.attached);
}
