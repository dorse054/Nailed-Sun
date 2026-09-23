/**
 * Per-tick behavior of colossi and vehicles that doesn't fit the generic
 * systems: the Dreadsail's broadside, ramming run and burning sails, carriers
 * and garrisons, glider refits, and the Umbral Mother being drawn to light.
 */
import type { MissileWeapon } from '../data/schema';
import { angleDiff, datan2, dcos, dsin } from '../core/dmath';
import type { Battle } from './battle';
import type { Unit } from './types';
import { applyDamage, armorRoll, knockDown } from './combat';
import { hasMechanic, mechanic } from './mechanics';
import { fire, validMissileTarget } from './missiles';

const BROADSIDE_BOLT: MissileWeapon = {
  kind: 'ballista',
  trajectory: 'direct',
  range: 220,
  ammo: 999,
  reload: 2.4,
  accuracy: 0.7,
  damage: 60,
  ap: 34,
  vsLarge: 30,
  pierce: 4,
};

const BROADSIDE_KITE: MissileWeapon = {
  kind: 'kite',
  trajectory: 'arc',
  range: 300,
  ammo: 999,
  reload: 7,
  accuracy: 0.55,
  damage: 20,
  ap: 8,
  type: 'fire',
  splash: 8,
  ignite: { radius: 10, duration: 14, dps: 6 },
};

export function updateSpecials(b: Battle): void {
  for (const u of b.units) {
    if (u.alive <= 0 || u.state === 'dead' || u.state === 'fled') continue;
    // Passengers ride their carrier.
    if (u.state === 'embarked' && u.embarkedOn) {
      const car = u.embarkedOn;
      const hull = car.soldiers.find((s) => s.alive);
      if (hull) {
        let k = 0;
        for (const s of u.soldiers) {
          if (!s.alive) continue;
          const a = (k / Math.max(1, u.alive)) * 6.283 + car.facing;
          const r = hull.radius * 0.55;
          s.px = s.x;
          s.py = s.y;
          s.x = hull.x + dcos(a) * r;
          s.y = hull.y + dsin(a) * r;
          s.facing = car.facing;
          k++;
        }
        u.x = hull.x;
        u.y = hull.y;
        u.facing = car.facing;
      }
      continue;
    }
    if (u.state !== 'ready') continue;
    // Gust Leap landing.
    if (u.special.leapUntil && b.time >= u.special.leapUntil) {
      u.special.leapUntil = 0;
      if (!hasMechanic(u.def, 'flyer')) for (const s of u.soldiers) s.airborne = false;
    }
    if (hasMechanic(u.def, 'sailing')) sailing(b, u);
    if (hasMechanic(u.def, 'refitsOnCarrier')) refit(b, u);
    const dtf = mechanic(u.def, 'drawnToFlame');
    if (dtf) {
      u.special.flameSlow = 0;
      for (const z of b.zones) {
        if (z.side === u.side || !z.enabled || !z.def.light || z.def.light.mode !== 'floor' || z.def.light.intensity < 2) continue;
        const dx = z.x - u.x;
        const dy = z.y - u.y;
        if (dx * dx + dy * dy < 120 * 120) {
          u.special.flameSlow = 1;
          u.special.flameX = z.x;
          u.special.flameY = z.y;
          break;
        }
      }
    }
  }
}

function sailing(b: Battle, u: Unit): void {
  const hull = u.soldiers.find((s) => s.alive);
  if (!hull) return;
  if (u.special.sailsBurning && b.time >= (u.special.sailsUntil ?? 0)) {
    u.special.sailsBurning = 0;
    b.events.push({ t: 'text', x: hull.x, y: hull.y, text: 'Sails doused', side: u.side });
  }
  // Broadside: deck ballistae fire at targets on either side; hardest across the enemy line.
  if ((u.special.broadsideAt ?? 0) <= b.time) {
    u.special.broadsideAt = b.time + BROADSIDE_BOLT.reload * u.stats.reloadMult;
    const range = BROADSIDE_BOLT.range * u.stats.rangeMult;
    for (const sideSign of [1, -1]) {
      const beam = u.facing + (sideSign * Math.PI) / 2;
      let best: Unit | null = null;
      let bd = Infinity;
      for (const e of b.units) {
        if (e.side === u.side || !validMissileTarget(b, u, e)) continue;
        const dx = e.x - hull.x;
        const dy = e.y - hull.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > range * range) continue;
        if (Math.abs(angleDiff(beam, datan2(dy, dx))) > 1.15) continue;
        if (d2 < bd) {
          bd = d2;
          best = e;
        }
      }
      if (best) {
        const saved = hull.x;
        const savedY = hull.y;
        // Fire from the rail on that side.
        hull.x += dcos(beam) * 8;
        hull.y += dsin(beam) * 8;
        const mult = u.moving ? 1.25 : 1;
        const w: MissileWeapon = { ...BROADSIDE_BOLT, damage: BROADSIDE_BOLT.damage * mult };
        fire(b, hull, best, w);
        hull.x = saved;
        hull.y = savedY;
      }
    }
  }
  if ((u.special.kiteAt ?? 0) <= b.time) {
    u.special.kiteAt = b.time + BROADSIDE_KITE.reload * u.stats.reloadMult;
    let best: Unit | null = null;
    let bd = Infinity;
    for (const e of b.units) {
      if (e.side === u.side || !validMissileTarget(b, u, e)) continue;
      const d2 = (e.x - hull.x) * (e.x - hull.x) + (e.y - hull.y) * (e.y - hull.y);
      if (d2 > BROADSIDE_KITE.range * BROADSIDE_KITE.range * u.stats.rangeMult * u.stats.rangeMult) continue;
      if (e.engaged > 0) continue;
      if (d2 < bd) {
        bd = d2;
        best = e;
      }
    }
    if (best) fire(b, hull, best, BROADSIDE_KITE);
  }
  // Ramming Run: at full downwind speed it plows through anything in its path.
  if (u.special.ramUntil && b.time < u.special.ramUntil) {
    const sp = Math.sqrt(hull.vx * hull.vx + hull.vy * hull.vy);
    if (sp > 2) {
      const fx = dcos(u.facing);
      const fy = dsin(u.facing);
      const cx = hull.x + fx * hull.radius;
      const cy = hull.y + fy * hull.radius;
      const reach = 14;
      let hitSet = b.ramHits.get(u.id);
      if (!hitSet) {
        hitSet = new Set();
        b.ramHits.set(u.id, hitSet);
      }
      const hits = hitSet;
      b.hash.query(cx, cy, reach, (i) => {
        const s = b.soldiers[i]!;
        if (!s.alive || s.unit === u || s.airborne || s.unit.side === u.side || hits.has(s.id)) return;
        hits.add(s.id);
        const dmg = armorRoll(b.rng, 70 * (sp / 8), 50, s.armor) * (s.unit.def.size === 'colossal' ? 0.6 : 1);
        applyDamage(b, s, dmg, hull, 'normal', u);
        if (s.alive) {
          const side = (s.x - hull.x) * -fy + (s.y - hull.y) * fx >= 0 ? 1 : -1;
          knockDown(b, s, fx * 0.7 - fy * side * 0.7, fy * 0.7 + fx * side * 0.7, 4, 2);
        }
      });
      if ((u.special.ramFx ?? 0) <= b.time) {
        u.special.ramFx = b.time + 0.5;
        b.events.push({ t: 'shockwave', x: cx, y: cy, r: 18, kind: 'ram' });
      }
      b.ramWalls(u, cx, cy, reach, sp);
    }
  } else if (b.ramHits.has(u.id)) {
    b.ramHits.delete(u.id);
  }
}

function refit(b: Battle, u: Unit): void {
  for (const c of b.units) {
    if (c.side !== u.side || c.state !== 'ready' || !hasMechanic(c.def, 'carrier')) continue;
    const dx = c.x - u.x;
    const dy = c.y - u.y;
    if (dx * dx + dy * dy > 45 * 45) continue;
    const glider = mechanic(u.def, 'flyer')?.glider;
    if (glider) u.special.glide = Math.min(glider.seconds, (u.special.glide ?? 0) + 12 * 0.05);
    if (b.tick % 20 === 0) {
      for (const s of u.soldiers) if (s.alive && u.def.missile) s.ammo = Math.min(u.def.missile.ammo, s.ammo + 1);
    }
    return;
  }
}
