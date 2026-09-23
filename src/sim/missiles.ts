/**
 * Missiles, beams and cones.
 *
 * Wind always blows sunward: a shot fired straight downwind gains 10% range
 * in a Breeze and 20% in a Gale, a shot upwind loses as much. Gales cost 5%
 * accuracy. Beams ignore wind, scale with light (130% Blaze ... 20% Dark) and
 * die in Veils and Eclipses. Projectiles are physical: they land where they
 * were aimed plus scatter, so dense blocks take more hits and friendly fire
 * is real.
 */
import type { MissileWeapon } from '../data/schema';
import { beamMult, WIND_RULES } from '../data/rules';
import { angleDiff, clamp, datan2, dcos, dsin } from '../core/dmath';
import { segDist2 } from '../core/vec';
import type { Battle } from './battle';
import { DT } from './constants';
import type { Projectile, Soldier, Unit } from './types';
import { addSplit, applyDamage, applyOnHit, armorRoll, groundFlyer, knockDown, staggerSoldier, typeMult } from './combat';
import { addZone, beamBlockedAt, missileIntoMod } from './zones';
import { hasMechanic, isFlyer, mechanic } from './mechanics';

export function projectileSpeed(w: MissileWeapon): number {
  if (w.speed) return w.speed;
  switch (w.kind) {
    case 'arrow':
    case 'shard':
      return 62;
    case 'bolt':
      return 85;
    case 'javelin':
      return 32;
    case 'harpoon':
      return 55;
    case 'firebomb':
      return 26;
    case 'stone':
      return 48;
    case 'glassPot':
      return 42;
    case 'frostBall':
      return 36;
    case 'kite':
      return 20;
    case 'ballista':
      return 95;
    case 'bolas':
      return 28;
    case 'spore':
      return 24;
    case 'dart':
      return 55;
    default:
      return 60;
  }
}

/** Range for a shot in direction `dir`, with wind, height and modifiers. */
export function effectiveRange(b: Battle, u: Unit, w: MissileWeapon, dir: number): number {
  let r = w.range;
  if (w.windRange) {
    // Firekites ride the wind: 350 m downwind, 150 m upwind.
    if (u.wind === 0) r = w.windRange.calm;
    else {
      const c = dcos(angleDiff(dir, b.terrain.sunBearing));
      r = w.windRange.up + (w.windRange.down - w.windRange.up) * (c + 1) * 0.5;
      if (u.wind === 2) r *= 1.1;
    }
  } else if (!w.windless && w.trajectory !== 'beam' && w.trajectory !== 'lineBeam' && w.trajectory !== 'cone') {
    const pct = WIND_RULES[u.wind].rangePct / 100;
    r *= 1 + pct * dcos(angleDiff(dir, b.terrain.sunBearing));
  }
  return r * u.stats.rangeMult;
}

function heightBonus(b: Battle, s: Soldier, tx: number, ty: number): number {
  const dh = b.terrain.heightAt(s.x, s.y) - b.terrain.heightAt(tx, ty);
  return clamp(1 + dh * 0.006, 0.9, 1.15);
}

export function weaponOf(u: Unit): MissileWeapon | undefined {
  if (u.altAmmo && u.def.altMissile) return u.def.altMissile;
  return u.def.missile;
}

export function validMissileTarget(b: Battle, u: Unit, t: Unit | null): t is Unit {
  if (!t) return false;
  if (t.state === 'dead' || t.state === 'fled' || t.state === 'embarked' || t.alive <= 0) return false;
  if (t.side === u.side) return false;
  return t.visible[u.side] || b.time - t.lastSeen[u.side] < 1.5;
}

function canShoot(b: Battle, u: Unit, w: MissileWeapon): boolean {
  if (u.state !== 'ready' && u.state !== 'embarked') return false;
  if (u.engaged > Math.max(2, u.alive * 0.25)) return false;
  if (u.moving && !w.whileMoving && u.state !== 'embarked') return false;
  if (u.withdrawing) return false;
  if (u.special.channelStill) return false;
  if (hasMechanic(u.def, 'sailing')) return false;
  return b.time >= (u.special.noFireUntil ?? 0);
}

/** Pick a target for fire-at-will: close, exposed, and a good counter. */
export function autoTarget(b: Battle, u: Unit, w: MissileWeapon): Unit | null {
  let best: Unit | null = null;
  let bestScore = -Infinity;
  const splashy = (w.splash ?? 0) > 3 || w.trajectory === 'lineBeam' || w.trajectory === 'cone';
  for (const t of b.units) {
    if (t.side === u.side || !validMissileTarget(b, u, t)) continue;
    const dir = datan2(t.y - u.y, t.x - u.x);
    const d = Math.sqrt((t.x - u.x) * (t.x - u.x) + (t.y - u.y) * (t.y - u.y));
    const range = effectiveRange(b, u, w, dir);
    if (d > range + 10 || d < (w.minRange ?? 0)) continue;
    let score = 100 - (d / range) * 40;
    if (t.engaged > 0) {
      // Don't shoot into melee with friends in it.
      score -= splashy ? 1000 : w.trajectory === 'arc' ? 70 : 45;
    }
    if (t.state === 'routing') score -= 60;
    const big = t.def.size !== 'small';
    if (w.preferLarge) score += big ? 60 : -40;
    if (u.def.role === 'artillery') {
      if (t.def.category === 'infantry' && t.alive > 30) score += 25;
      if (t.def.category === 'monster' || t.def.category === 'colossus') score += 35;
      if (t.def.category === 'cavalry') score -= 15;
    } else {
      if (t.def.category === 'infantry' && t.def.armor < 40) score += 15;
      if (t.def.category === 'monster') score += 10;
      if (t.def.role === 'missile' || t.def.role === 'artillery') score += 12;
      if (t.def.armor > 60 && w.ap < w.damage * 0.3) score -= 20;
    }
    if (t === u.missileTarget) score += 20;
    if (w.needsLOS && !b.terrain.los(u.x, u.y, 3, t.x, t.y, 2)) continue;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return bestScore > -500 ? best : null;
}

/**
 * Siege: an attacking engine that has not been ordered onto a unit batters the
 * nearest standing gate in its range (beams burn it). Returns true if it did.
 */
function siegeShot(b: Battle, u: Unit, w: MissileWeapon): boolean {
  const fort = b.terrain.fort;
  if (!fort || u.side === fort.defender || u.def.role !== 'artillery' || u.order.kind === 'attack') return false;
  if (!canShoot(b, u, w)) return false;
  let gx = 0;
  let gy = 0;
  let best = Infinity;
  for (const wall of b.terrain.walls) {
    if (!wall.gate || wall.broken) continue;
    const mx = (wall.x1 + wall.x2) / 2;
    const my = (wall.y1 + wall.y2) / 2;
    const d = Math.sqrt((mx - u.x) * (mx - u.x) + (my - u.y) * (my - u.y));
    if (d > effectiveRange(b, u, w, datan2(my - u.y, mx - u.x)) || d < (w.minRange ?? 0) || d >= best) continue;
    best = d;
    gx = mx;
    gy = my;
  }
  if (!Number.isFinite(best)) return false;
  const dir = datan2(gy - u.y, gx - u.x);
  if (!u.moving && u.formation === 'block') {
    const off = angleDiff(u.facing, dir);
    if (Math.abs(off) > 0.5) {
      u.facing += clamp(off, -0.9 * DT, 0.9 * DT);
      if (Math.abs(off) > 1.2) return true;
    }
  }
  for (const s of u.soldiers) {
    if (!s.alive || s.target || s.downTimer > 0 || s.staggerTimer > 0 || s.ammo <= 0) continue;
    s.reload -= (DT / u.stats.reloadMult) * u.entityScale;
    if (s.reload > 0) continue;
    s.reload = w.reload * (0.85 + b.rng.next() * 0.3);
    s.ammo--;
    u.lastFireTime = b.time;
    if (w.trajectory === 'beam' || w.trajectory === 'lineBeam' || w.trajectory === 'cone') {
      // Beams burn the gate; the bell's shockwave shakes it.
      const power = w.lightScaled ? beamMult(u.light) : 1;
      b.damageWalls(gx, gy, 5, w.damage * power * (w.trajectory === 'lineBeam' ? 3 : 2) * u.stats.missileDmgMult, u.side, true);
      if ((s.id & 3) === 0) b.events.push({ t: 'beam', kind: w.trajectory === 'cone' ? 'lance' : 'heliostat', x1: s.x, y1: s.y, x2: gx, y2: gy, power, blocked: true, side: u.side });
    } else {
      fireAt(b, s, gx, gy, w);
    }
  }
  return true;
}

export function updateMissileUnits(b: Battle): void {
  for (const u of b.units) {
    const w = weaponOf(u);
    if (!w || u.alive <= 0) continue;
    if (u.state !== 'ready' && u.state !== 'embarked') continue;
    if (u.special.meleeMode) continue;
    if (siegeShot(b, u, w)) continue;
    let t: Unit | null = u.missileTarget;
    if (!validMissileTarget(b, u, t)) {
      t = null;
      u.missileTarget = null;
    }
    const retarget = (u.special.retargetAt ?? 0) <= b.time;
    if ((!t || (retarget && u.order.kind !== 'attack')) && u.fireAtWill && canShoot(b, u, w)) {
      if (retarget) {
        u.special.retargetAt = b.time + 2 + (u.id % 5) * 0.2;
        const auto = autoTarget(b, u, w);
        if (auto && (!t || u.order.kind !== 'attack')) t = auto;
      }
    }
    if (!t) {
      u.focus = 0;
      continue;
    }
    u.missileTarget = t;
    if (!canShoot(b, u, w)) continue;
    const dir = datan2(t.y - u.y, t.x - u.x);
    const d = Math.sqrt((t.x - u.x) * (t.x - u.x) + (t.y - u.y) * (t.y - u.y));
    const range = effectiveRange(b, u, w, dir);
    if (d > range + 8 || d < (w.minRange ?? 0)) continue;
    if (w.needsLOS || w.trajectory === 'beam' || w.trajectory === 'lineBeam') {
      if ((u.special.losAt ?? 0) <= b.time || u.special.losTarget !== t.id) {
        u.special.losAt = b.time + 1.5;
        u.special.losTarget = t.id;
        u.special.losOk = b.terrain.los(u.x, u.y, 3, t.x, t.y, 2) ? 1 : 0;
      }
      if (!u.special.losOk) continue;
    }
    // Face the target when standing (artillery and missile blocks turn slowly).
    if (!u.moving && u.state === 'ready' && u.order.kind === 'hold') {
      const off = angleDiff(u.facing, dir);
      if (Math.abs(off) > 0.5 && u.formation === 'block') {
        u.facing += clamp(off, -0.9 * DT, 0.9 * DT);
        if (Math.abs(off) > 1.2) continue;
      }
    }
    if (w.focus) {
      if (u.focusTarget !== t.id) {
        u.focusTarget = t.id;
        u.focus = 0;
      }
      u.focus += DT;
      if (u.focus < w.focus) continue;
    }
    const reloadMult = u.stats.reloadMult;
    for (const s of u.soldiers) {
      if (!s.alive || s.target || s.downTimer > 0 || s.staggerTimer > 0 || s.ammo <= 0) continue;
      s.reload -= (DT / reloadMult) * u.entityScale;
      if (s.reload > 0) continue;
      s.reload = w.reload * (0.85 + b.rng.next() * 0.3);
      s.ammo--;
      fire(b, s, t, w);
    }
  }
}

function pickVictim(b: Battle, t: Unit): Soldier | null {
  const n = t.soldiers.length;
  for (let k = 0; k < 6; k++) {
    const s = t.soldiers[b.rng.int(n)]!;
    if (s.alive) return s;
  }
  return t.soldiers.find((s) => s.alive) ?? null;
}

function accuracyFor(b: Battle, u: Unit, w: MissileWeapon, ax: number, ay: number): number {
  let pct = u.stats.glareAcc;
  if (!w.windless && w.trajectory !== 'beam' && w.trajectory !== 'lineBeam' && !hasMechanic(u.def, 'windReader')) {
    pct += WIND_RULES[u.wind].accuracyPct;
  }
  pct += missileIntoMod(b, ax, ay);
  if (u.def.role === 'artillery') {
    for (const z of b.zones) {
      if (z.def.id !== 'signal' || z.side !== u.side) continue;
      const dx = ax - z.x;
      const dy = ay - z.y;
      if (dx * dx + dy * dy <= z.radius * z.radius) {
        pct += mechanic(z.source?.def ?? u.def, 'signalMark')?.accuracyPct ?? 25;
        break;
      }
    }
  }
  return clamp(w.accuracy * u.stats.accuracyMult * (1 + pct / 100), 0.05, 0.97);
}

export function fire(b: Battle, s: Soldier, t: Unit, w: MissileWeapon): void {
  const u = s.unit;
  u.lastFireTime = b.time;
  const v = pickVictim(b, t);
  if (!v) return;
  if (w.trajectory === 'beam') return fireBeam(b, s, v, w);
  if (w.trajectory === 'lineBeam') return fireLineBeam(b, s, v, w);
  if (w.trajectory === 'cone') return fireCone(b, s, t, w);
  const dx0 = v.x - s.x;
  const dy0 = v.y - s.y;
  const d0 = Math.sqrt(dx0 * dx0 + dy0 * dy0) || 1;
  const speed = projectileSpeed(w);
  const T = Math.max(0.15, (d0 / speed) * (w.trajectory === 'arc' ? 1.12 : 1));
  // Lead the target.
  const px = v.x + v.vx * T * 0.8;
  const py = v.y + v.vy * T * 0.8;
  const acc = accuracyFor(b, u, w, px, py);
  const sigma = Math.max(0.3, d0 * (1 - acc) * 0.085);
  const along = w.trajectory === 'arc' ? 1.3 : 0.9;
  const lat = w.trajectory === 'arc' ? 0.85 : 0.75;
  const ux = dx0 / d0;
  const uy = dy0 / d0;
  const na = b.rng.normal() * sigma * along;
  const nl = b.rng.normal() * sigma * lat;
  const x1 = px + ux * na - uy * nl;
  const y1 = py + uy * na + ux * nl;
  const hb = heightBonus(b, s, v.x, v.y);
  const p: Projectile = {
    id: b.nextProjectileId++,
    side: u.side,
    weapon: w,
    shooter: u,
    x0: s.x,
    y0: s.y,
    x1,
    y1,
    t: 0,
    T,
    arc: w.trajectory === 'arc' ? 0.28 : 0.04,
    dmgMult: u.stats.missileDmgMult * hb,
    victim: w.trajectory === 'direct' ? v : null,
    alive: true,
  };
  b.projectiles.push(p);
  if ((s.id & 7) === 0 || u.soldiers.length < 8) b.events.push({ t: 'shot', kind: w.kind, x: s.x, y: s.y, side: u.side });
}

/** Loose a projectile at a point on the ground (siege engines at a gate), with the usual scatter. */
function fireAt(b: Battle, s: Soldier, x: number, y: number, w: MissileWeapon): void {
  const u = s.unit;
  const dx0 = x - s.x;
  const dy0 = y - s.y;
  const d0 = Math.sqrt(dx0 * dx0 + dy0 * dy0) || 1;
  const T = Math.max(0.15, (d0 / projectileSpeed(w)) * (w.trajectory === 'arc' ? 1.12 : 1));
  const acc = accuracyFor(b, u, w, x, y);
  const sigma = Math.max(0.3, d0 * (1 - acc) * 0.085);
  const along = w.trajectory === 'arc' ? 1.3 : 0.9;
  const lat = w.trajectory === 'arc' ? 0.85 : 0.75;
  const ux = dx0 / d0;
  const uy = dy0 / d0;
  const na = b.rng.normal() * sigma * along;
  const nl = b.rng.normal() * sigma * lat;
  b.projectiles.push({
    id: b.nextProjectileId++,
    side: u.side,
    weapon: w,
    shooter: u,
    x0: s.x,
    y0: s.y,
    x1: x + ux * na - uy * nl,
    y1: y + uy * na + ux * nl,
    t: 0,
    T,
    arc: w.trajectory === 'arc' ? 0.28 : 0.04,
    dmgMult: u.stats.missileDmgMult,
    victim: null,
    alive: true,
  });
  if ((s.id & 7) === 0 || u.soldiers.length < 8) b.events.push({ t: 'shot', kind: w.kind, x: s.x, y: s.y, side: u.side });
}

function fireBeam(b: Battle, s: Soldier, v: Soldier, w: MissileWeapon): void {
  const u = s.unit;
  const acc = accuracyFor(b, u, w, v.x, v.y);
  const d = Math.sqrt((v.x - s.x) * (v.x - s.x) + (v.y - s.y) * (v.y - s.y));
  const sigma = Math.max(0.2, d * (1 - acc) * 0.06);
  const ax = v.x + b.rng.normal() * sigma;
  const ay = v.y + b.rng.normal() * sigma;
  const bt = beamBlockedAt(b, s.x, s.y, ax, ay);
  const ex = bt >= 0 ? s.x + (ax - s.x) * bt : ax;
  const ey = bt >= 0 ? s.y + (ay - s.y) * bt : ay;
  const power = w.lightScaled ? beamMult(u.light) : 1;
  if ((s.id & 3) === 0) b.events.push({ t: 'beam', kind: 'beam', x1: s.x, y1: s.y, x2: ex, y2: ey, power, blocked: bt >= 0, side: u.side });
  if (bt >= 0) {
    // Choir beams burn the gates that stop them.
    if (b.terrain.fort) b.damageWalls(ex, ey, 4, w.damage * power * 2, u.side, true);
    return;
  }
  const hit = nearestAt(b, ax, ay, 0.6, u.side);
  if (!hit) return;
  missileHit(b, u, w, hit, s.x, s.y, u.stats.missileDmgMult * power);
}

function fireLineBeam(b: Battle, s: Soldier, v: Soldier, w: MissileWeapon): void {
  const u = s.unit;
  const dx = v.x - s.x;
  const dy = v.y - s.y;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  const acc = accuracyFor(b, u, w, v.x, v.y);
  const spread = (1 - acc) * 0.05 * b.rng.normal();
  const dir = datan2(dy, dx) + spread;
  const len = Math.min(w.range * u.stats.rangeMult, d + 45);
  let ex = s.x + dcos(dir) * len;
  let ey = s.y + dsin(dir) * len;
  const bt = beamBlockedAt(b, s.x, s.y, ex, ey);
  if (bt >= 0) {
    ex = s.x + (ex - s.x) * bt;
    ey = s.y + (ey - s.y) * bt;
  }
  const power = w.lightScaled ? beamMult(u.light) : 1;
  b.events.push({ t: 'beam', kind: 'heliostat', x1: s.x, y1: s.y, x2: ex, y2: ey, power, blocked: bt >= 0, side: u.side });
  if (bt >= 0 && b.terrain.fort) b.damageWalls(ex, ey, 5, w.damage * power * 3, u.side, true);
  const width = 1.8;
  forSoldiersNearSegment(b, s.x, s.y, ex, ey, width, (o) => {
    const d2 = (o.x - s.x) * (o.x - s.x) + (o.y - s.y) * (o.y - s.y);
    if (d2 < 14 * 14) return;
    missileHit(b, u, w, o, s.x, s.y, u.stats.missileDmgMult * power * 0.9);
  });
  // The beam burns a line and ignites the ground near its end.
  if (w.ignite && bt < 0) {
    const segs = 3;
    for (let k = 0; k < segs; k++) {
      const t = 1 - k * 0.12;
      const zx = s.x + (ex - s.x) * t;
      const zy = s.y + (ey - s.y) * t;
      if (b.terrain.inBounds(zx, zy)) addZone(b, 'burningLine', u.side, zx, zy, w.ignite.duration, u).dps = w.ignite.dps;
    }
  }
}

function fireCone(b: Battle, s: Soldier, t: Unit, w: MissileWeapon): void {
  const u = s.unit;
  const dir = datan2(t.y - s.y, t.x - s.x);
  const half = ((w.cone?.angle ?? 30) * Math.PI) / 360;
  const R = w.range * u.stats.rangeMult;
  b.events.push({ t: 'shockwave', x: s.x, y: s.y, r: R, kind: 'knell' });
  b.events.push({ t: 'beam', kind: 'lance', x1: s.x, y1: s.y, x2: s.x + dcos(dir) * R, y2: s.y + dsin(dir) * R, power: half, blocked: false, side: u.side });
  const grounded = new Set<Unit>();
  for (const e of b.units) {
    if (e.side === u.side || e.alive <= 0 || e.state === 'fled' || e.state === 'dead' || e.state === 'embarked') continue;
    const ed = Math.sqrt((e.x - s.x) * (e.x - s.x) + (e.y - s.y) * (e.y - s.y));
    if (ed > R + 60) continue;
    for (const o of e.soldiers) {
      if (!o.alive) continue;
      const dx = o.x - s.x;
      const dy = o.y - s.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > R * R) continue;
      if (Math.abs(angleDiff(dir, datan2(dy, dx))) > half) continue;
      const falloff = 1 - Math.sqrt(d2) / R * 0.5;
      missileHit(b, u, w, o, s.x, s.y, u.stats.missileDmgMult * falloff);
      if (!o.alive) continue;
      if (w.knockback && e.def.size !== 'colossal') {
        const a = datan2(dy, dx);
        if (e.def.size === 'small' || b.rng.next() < 0.35) knockDown(b, o, dcos(a), dsin(a), w.knockback * falloff, 1.2);
      }
      staggerSoldier(b, o, 1);
      if (isFlyer(e.def)) grounded.add(e);
    }
  }
  for (const e of grounded) groundFlyer(b, e, 6);
}

export function updateProjectiles(b: Battle): void {
  const ps = b.projectiles;
  let w = 0;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i]!;
    p.t += DT;
    if (p.t >= p.T) {
      resolveImpact(b, p);
      p.alive = false;
      continue;
    }
    ps[w++] = p;
  }
  ps.length = w;
}

function resolveImpact(b: Battle, p: Projectile): void {
  const w = p.weapon;
  const u = p.shooter;
  if (!b.terrain.inBounds(p.x1, p.y1)) return;
  // Engines batter walls and gates where their shot lands.
  if (b.terrain.fort && (u.def.category === 'artillery' || u.def.category === 'colossus')) {
    b.damageWalls(p.x1, p.y1, Math.max(3, w.splash ?? 0), w.damage * 2 * p.dmgMult, u.side);
  }
  if ((w.splash ?? 0) > 0) {
    b.events.push({ t: 'impact', x: p.x1, y: p.y1, kind: w.kind, splash: w.splash ?? 0 });
    const r = w.splash!;
    const hitUnits = new Set<Unit>();
    forSoldiersNear(b, p.x1, p.y1, r, (o, d) => {
      const falloff = 1 - (d / r) * 0.55;
      missileHit(b, u, w, o, p.x0, p.y0, p.dmgMult * falloff);
      hitUnits.add(o.unit);
      if (o.alive && w.knockback && o.unit.def.size === 'small' && b.rng.next() < 0.5) {
        const a = datan2(o.y - p.y1, o.x - p.x1);
        knockDown(b, o, dcos(a), dsin(a), w.knockback * falloff, 1.1);
      }
    });
  } else if (w.pierce) {
    // Ballista bolts punch through the ranks near the end of their flight.
    const dx = p.x1 - p.x0;
    const dy = p.y1 - p.y0;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const sx = p.x1 - (dx / d) * 6;
    const sy = p.y1 - (dy / d) * 6;
    const ex = p.x1 + (dx / d) * 18;
    const ey = p.y1 + (dy / d) * 18;
    let n = 0;
    const hits: Soldier[] = [];
    forSoldiersNearSegment(b, sx, sy, ex, ey, 1.1, (o) => {
      if (n >= (w.pierce ?? 1)) return;
      hits.push(o);
      n++;
    });
    if (hits.length) b.events.push({ t: 'impact', x: hits[0]!.x, y: hits[0]!.y, kind: w.kind, splash: 0 });
    for (const o of hits) missileHit(b, u, w, o, p.x0, p.y0, p.dmgMult);
  } else {
    let hit: Soldier | null = null;
    const v = p.victim;
    if (v && v.alive) {
      const dx = v.x - p.x1;
      const dy = v.y - p.y1;
      const r = v.radius + 0.55;
      if (dx * dx + dy * dy <= r * r) hit = v;
    }
    if (!hit) hit = nearestAt(b, p.x1, p.y1, 0.55, -1);
    if (hit && hit.unit.side === u.side && b.rng.next() < 0.55) hit = null;
    if (hit) missileHit(b, u, w, hit, p.x0, p.y0, p.dmgMult);
    else if (w.kind === 'stone' || w.kind === 'kite') b.events.push({ t: 'impact', x: p.x1, y: p.y1, kind: w.kind, splash: 0 });
  }
  if (w.ignite) {
    const id = w.kind === 'glassPot' ? 'moltenGlass' : 'burning';
    const ig = w.ignite;
    // A bomb that lands in a fire of its own side's making keeps that fire going instead of lighting another.
    const lit = b.zones.find((z) => z.def.id === id && z.side === u.side && z.dps === ig.dps && (z.x - p.x1) * (z.x - p.x1) + (z.y - p.y1) * (z.y - p.y1) < z.radius * z.radius * 0.25);
    if (lit) lit.until = Math.max(lit.until, b.time + ig.duration);
    else {
      const z = addZone(b, id, u.side, p.x1, p.y1, ig.duration, u);
      z.radius = ig.radius;
      z.dps = ig.dps;
    }
  }
  if (w.impactZone) addZone(b, w.impactZone.zone, u.side, p.x1, p.y1, w.impactZone.duration, u);
}

/** Resolve one missile hit on a soldier: shields, armor, type bonuses, on-hit effects. */
export function missileHit(b: Battle, u: Unit, w: MissileWeapon, o: Soldier, fromX: number, fromY: number, mult: number): void {
  if (!o.alive) return;
  const tu = o.unit;
  // Shields block shots from the front, except resonance.
  const block = (tu.def.shield ?? 0) + tu.stats.missileBlock;
  if (block > 0 && !w.ignoresShields && w.type !== 'resonance' && w.trajectory !== 'beam' && w.trajectory !== 'lineBeam') {
    const dir = datan2(fromY - o.y, fromX - o.x);
    if (Math.abs(angleDiff(o.facing, dir)) < 1.1 && b.rng.next() < Math.min(0.9, block)) {
      if ((o.id & 3) === 0) b.events.push({ t: 'block', x: o.x, y: o.y });
      return;
    }
  }
  let base = w.damage;
  let ap = w.ap;
  if (tu.def.size !== 'small' && w.vsLarge) [base, ap] = addSplit(base, ap, w.vsLarge);
  const armor = (o.armor + tu.stats.armorAdd) * (w.armorMult ?? 1);
  let dmg = armorRoll(b.rng, base, ap, armor) * mult * typeMult(w.type, tu);
  const sc = mechanic(tu.def, 'scatter');
  if (sc) dmg *= 1 - sc.missileReduction;
  if (tu.state === 'embarked') dmg *= 0.25;
  if (o.airborne && w.vsFlyerPct) dmg *= 1 + w.vsFlyerPct / 100;
  applyDamage(b, o, dmg, null, w.type, u);
  applyOnHit(b, w.onHit, o, u, o.x, o.y);
  if (w.type === 'fire' || w.type === 'cold' || w.type === 'resonance') {
    if ((o.id & 3) === 0) b.events.push({ t: 'hit', x: o.x, y: o.y, type: w.type, big: o.radius > 1.3 });
  }
}

/** Nearest living soldier within r (plus body radius) of a point. side -1 = any. */
export function nearestAt(b: Battle, x: number, y: number, r: number, excludeSide: number): Soldier | null {
  let best: Soldier | null = null;
  let bd = Infinity;
  b.hash.query(x, y, r + 1.3, (j) => {
    const o = b.soldiers[j]!;
    if (!o.alive || o.unit.side === excludeSide || o.unit.state === 'embarked') return;
    const dx = o.x - x;
    const dy = o.y - y;
    const d2 = dx * dx + dy * dy;
    const lim = r + o.radius;
    if (d2 > lim * lim) return;
    if (d2 < bd) {
      bd = d2;
      best = o;
    }
  });
  for (const o of b.bigSoldiers) {
    if (!o.alive || o.unit.side === excludeSide) continue;
    const dx = o.x - x;
    const dy = o.y - y;
    const d2 = dx * dx + dy * dy;
    const lim = r + o.radius;
    if (d2 <= lim * lim && d2 < bd) {
      bd = d2;
      best = o;
    }
  }
  return best;
}

/** Visit soldiers within r of a point (big bodies by their edge). */
export function forSoldiersNear(b: Battle, x: number, y: number, r: number, visit: (s: Soldier, d: number) => void): void {
  const seen = b.visitStamp();
  const cb = (o: Soldier): void => {
    if (!o.alive || o.unit.state === 'embarked' || b.visited[o.id] === seen) return;
    const dx = o.x - x;
    const dy = o.y - y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > r + (o.radius > 1.3 ? o.radius : 0)) return;
    b.visited[o.id] = seen;
    visit(o, Math.max(0, d - (o.radius > 1.3 ? o.radius : 0)));
  };
  if (r <= 40) {
    b.hash.query(x, y, r + 1.3, (j) => cb(b.soldiers[j]!));
  } else {
    for (const u of b.units) {
      if (u.alive <= 0 || u.state === 'dead' || u.state === 'fled') continue;
      const d = Math.sqrt((u.x - x) * (u.x - x) + (u.y - y) * (u.y - y));
      if (d > r + 80) continue;
      for (const o of u.soldiers) cb(o);
    }
  }
  for (const o of b.bigSoldiers) cb(o);
}

export function forSoldiersNearSegment(
  b: Battle,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  width: number,
  visit: (s: Soldier) => void,
): void {
  const seen = b.visitStamp();
  const minX = Math.min(ax, bx) - width - 10;
  const maxX = Math.max(ax, bx) + width + 10;
  const minY = Math.min(ay, by) - width - 10;
  const maxY = Math.max(ay, by) + width + 10;
  for (const u of b.units) {
    if (u.alive <= 0 || u.state === 'dead' || u.state === 'fled' || u.state === 'embarked') continue;
    if (u.x < minX - 60 || u.x > maxX + 60 || u.y < minY - 60 || u.y > maxY + 60) continue;
    for (const o of u.soldiers) {
      if (!o.alive || b.visited[o.id] === seen) continue;
      if (o.x < minX || o.x > maxX || o.y < minY || o.y > maxY) continue;
      const lim = width + o.radius;
      if (segDist2(o.x, o.y, ax, ay, bx, by) > lim * lim) continue;
      b.visited[o.id] = seen;
      visit(o);
    }
  }
}
