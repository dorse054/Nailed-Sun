/**
 * Morale and fatigue.
 *
 * Leadership drains from casualties, flank and rear attacks, fear, nearby
 * routing allies and a dead general; it recovers near the general and out of
 * combat. Steady, then Wavering below 50%, then Broken at 0, when the unit
 * routs. A unit that routs three times is Shattered and leaves the field.
 */
import { FATIGUE, MORALE } from '../data/rules';
import type { Battle } from './battle';
import { DT } from './constants';
import type { Unit } from './types';
import { hasMechanic, mechanic } from './mechanics';
import { angleDiff, datan2 } from '../core/dmath';
import { unitHpShare } from './army';

export function moraleState(u: Unit): 'steady' | 'wavering' | 'broken' {
  if (u.state === 'routing' || u.state === 'shattered') return 'broken';
  return u.morale < u.maxMorale * MORALE.waveringAt ? 'wavering' : 'steady';
}

export function updateMorale(b: Battle): void {
  const tick = b.tick;
  // Snapshot of routing units for the "nearby routing allies" drain.
  const routing = b.units.filter((u) => u.state === 'routing' || u.state === 'shattered');
  for (const u of b.units) {
    if (u.state === 'dead' || u.state === 'fled') continue;
    // Loss ring buffer: clear the slot for the new second.
    if (tick % 20 === 0) u.losses[(Math.floor(b.time) + 1) % u.losses.length] = 0;
    if (tick % 20 === 0) {
      u.meleeDealt *= 0.6;
      u.meleeTaken *= 0.6;
    }
    updateFatigue(u);
    if (u.state === 'embarked') continue;
    if (u.state === 'routing' || u.state === 'shattered') {
      updateRouting(b, u);
      continue;
    }
    // Broken at 0: a shock that left morale at or below zero breaks the unit before this tick's
    // regeneration can lift it back above zero. (Unbreakable units are held at 1 below.)
    if (u.morale <= 0 && !u.stats.unbreakable) {
      rout(b, u);
      continue;
    }
    const max = u.maxMorale;
    let drain = u.stats.moraleDrain;
    let regen = u.stats.moraleRegen;
    const recentLoss = u.losses.reduce((a, c) => a + c, 0) / Math.max(1, u.initial);
    if (recentLoss > 0.08) drain += MORALE.heavyLossDrain * Math.min(3, recentLoss / 0.08);
    drain += MORALE.flankDrain * (u.special.flankP ?? 0) * 2 + MORALE.rearDrain * (u.special.rearP ?? 0) * 2;
    if (!u.stats.fearImmune) {
      let near = 0;
      for (const r of routing) {
        if (r.side !== u.side) continue;
        const dx = r.x - u.x;
        const dy = r.y - u.y;
        if (dx * dx + dy * dy < MORALE.routingAllyRadius * MORALE.routingAllyRadius) near++;
      }
      drain += MORALE.routingAllyDrain * Math.min(3, near);
      // Fear from monsters and colossi.
      for (const e of b.units) {
        if (e.side === u.side || e.state !== 'ready') continue;
        const fa = mechanic(e.def, 'fearAura');
        if (fa) {
          const dx = e.x - u.x;
          const dy = e.y - u.y;
          if (dx * dx + dy * dy < fa.radius * fa.radius) drain += fa.drain;
        }
        const howl = mechanic(e.def, 'howl');
        if (howl) {
          // Howling Kites: enemies within 120 m downwind steadily lose leadership.
          const dx = u.x - e.x;
          const dy = u.y - e.y;
          if (dx * dx + dy * dy < howl.radius * howl.radius && Math.abs(angleDiff(b.terrain.sunBearing, datan2(dy, dx))) < 1.0) {
            drain += howl.drain;
          }
        }
      }
    }
    const side = b.sides[u.side];
    if (side.generalDead) drain += MORALE.generalDeadDrain;
    if (u.engaged > 0) {
      const total = u.meleeDealt + u.meleeTaken;
      if (total > 1) {
        const bal = (u.meleeTaken - u.meleeDealt) / total;
        if (bal > 0) drain += MORALE.losingMeleeDrain * bal;
        else regen += MORALE.winningMeleeRegen * -bal;
      }
    }
    const quiet = b.time - u.lastMeleeTime > 4 && b.time - u.lastLossTime > 4;
    if (quiet) regen += MORALE.outOfCombatRegen;
    const g = side.general;
    if (g && g !== u && g.state === 'ready') {
      const dx = g.x - u.x;
      const dy = g.y - u.y;
      if (dx * dx + dy * dy < MORALE.generalAuraRadius * MORALE.generalAuraRadius) regen += MORALE.generalAuraRegen;
    }
    u.morale += ((regen - drain) / 100) * max * DT;
    if (u.morale > max) u.morale = max;
    if (u.stats.unbreakable && u.morale < 1) u.morale = 1;
    if (u.morale <= 0) rout(b, u);
  }
}

export function rout(b: Battle, u: Unit): void {
  if (u.state !== 'ready') return;
  u.routs++;
  u.morale = 0;
  u.order = { kind: 'hold' };
  u.meleeTarget = null;
  u.missileTarget = null;
  u.rallyTimer = 0;
  for (const a of u.abilities) {
    if (a.def.kind === 'toggle' && a.on) a.on = false;
    a.windup = 0;
    a.channel = 0;
  }
  u.formation = 'block';
  u.slotsDirty = true;
  // A unit that has lost most of its strength (wounds included) breaks for good.
  const shatter = u.routs >= MORALE.shatterRouts || unitHpShare(u) < MORALE.shatterStrength;
  u.state = shatter ? 'shattered' : 'routing';
  for (const s of u.soldiers) {
    s.target = null;
    s.approach = null;
    s.charging = false;
  }
  b.events.push({ t: shatter ? 'shatter' : 'rout', unit: u.id, side: u.side });
  fleeVector(b, u);
}

function fleeVector(b: Battle, u: Unit): void {
  // Toward our own map edge, away from nearby enemies.
  let fx = 0;
  let fy = u.side === 0 ? 1 : -1;
  if (b.terrain.fort && b.terrain.fort.defender === u.side) fy = 0;
  // A unit routing inside the walls runs for a way out first.
  const exit = b.terrain.fort && b.terrain.insideFort(u.x, u.y) ? fortExit(b, u) : null;
  if (exit) {
    const dx = exit.x - u.x;
    const dy = exit.y - u.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    u.special.fleeX = dx / d;
    u.special.fleeY = dy / d;
    return;
  }
  let ex = 0;
  let ey = 0;
  let n = 0;
  for (const e of b.units) {
    if (e.side === u.side || e.state !== 'ready') continue;
    const dx = u.x - e.x;
    const dy = u.y - e.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > 150 * 150 || d2 < 1) continue;
    const d = Math.sqrt(d2);
    ex += dx / d;
    ey += dy / d;
    n++;
  }
  if (n) {
    fx += (ex / n) * 0.8;
    fy += (ey / n) * 0.8;
  }
  if (fx === 0 && fy === 0) fy = u.side === 0 ? 1 : -1;
  // Outside a fort, run around its walls rather than into them.
  const fort = b.terrain.fort;
  if (fort) {
    const cx = b.terrain.width / 2;
    const cy = b.terrain.height / 2;
    const dx = cx - u.x;
    const dy = cy - u.y;
    const r = Math.sqrt(dx * dx + dy * dy) || 1;
    const inward = (fx * dx + fy * dy) / r;
    if (r < fort.radius + 60 && inward > 0 && !b.terrain.insideFort(u.x, u.y)) {
      fx -= (inward + 0.25) * (dx / r);
      fy -= (inward + 0.25) * (dy / r);
      if (Math.abs(fx) + Math.abs(fy) < 1e-6) {
        fx = -dy / r;
        fy = dx / r;
      }
    }
  }
  const l = Math.sqrt(fx * fx + fy * fy);
  u.special.fleeX = fx / l;
  u.special.fleeY = fy / l;
}

/**
 * For a unit inside a fort's walls: a point just outside the way out it should take.
 * Anyone can run through a breach or a broken gate, the defenders also through their
 * own gates (they open a postern), and foot soldiers can climb a stretch of wall.
 * Openings count as nearer than a climb; defenders avoid ways out near the enemy.
 */
function fortExit(b: Battle, u: Unit): { x: number; y: number } | null {
  const fort = b.terrain.fort!;
  const cx = b.terrain.width / 2;
  const cy = b.terrain.height / 2;
  const own = fort.defender === u.side;
  const climbs = u.def.category === 'infantry' || u.def.category === 'character';
  let best: { x: number; y: number } | null = null;
  let bd = Infinity;
  for (const w of b.terrain.walls) {
    if (w.tower) continue;
    const open = w.broken || (own && w.gate);
    if (!open && (w.gate || !climbs)) continue;
    const mx = (w.x1 + w.x2) / 2;
    const my = (w.y1 + w.y2) / 2;
    let d = Math.sqrt((mx - u.x) * (mx - u.x) + (my - u.y) * (my - u.y)) * (open ? 0.5 : 1);
    if (own) {
      let near = Infinity;
      for (const e of b.units) {
        if (e.side === u.side || e.state !== 'ready' || e.alive <= 0) continue;
        near = Math.min(near, Math.sqrt((e.x - mx) * (e.x - mx) + (e.y - my) * (e.y - my)));
      }
      if (near < 150) d += (150 - near) * 2;
    }
    if (d >= bd) continue;
    bd = d;
    const out = Math.sqrt((mx - cx) * (mx - cx) + (my - cy) * (my - cy)) || 1;
    best = { x: mx + ((mx - cx) / out) * 25, y: my + ((my - cy) / out) * 25 };
  }
  return best;
}

function updateRouting(b: Battle, u: Unit): void {
  if (b.tick % 10 === 0) fleeVector(b, u);
  if (u.state === 'shattered') return;
  // Rally once no enemy is close and nothing has hurt us for a while.
  let pressed = b.time - u.lastLossTime < 3;
  if (!pressed) {
    for (const e of b.units) {
      if (e.side === u.side || e.state !== 'ready') continue;
      const dx = e.x - u.x;
      const dy = e.y - u.y;
      if (dx * dx + dy * dy < 55 * 55) {
        pressed = true;
        break;
      }
    }
  }
  u.rallyTimer = pressed ? 0 : u.rallyTimer + DT;
  if (u.rallyTimer >= MORALE.rallyDelay) {
    u.state = 'ready';
    u.morale = u.maxMorale * MORALE.rallyMorale;
    u.order = { kind: 'hold' };
    u.slotsDirty = true;
    let x = 0;
    let y = 0;
    let n = 0;
    for (const s of u.soldiers) {
      if (!s.alive) continue;
      x += s.x;
      y += s.y;
      n++;
    }
    if (n) {
      u.x = x / n;
      u.y = y / n;
    }
    u.facing = u.side === 0 ? -Math.PI / 2 : Math.PI / 2;
    b.events.push({ t: 'rally', unit: u.id, side: u.side });
  }
}

function updateFatigue(u: Unit): void {
  if (u.stats.noFatigue || u.def.category === 'colossus' || u.def.category === 'artillery') {
    u.fatigue = Math.max(0, u.fatigue - FATIGUE.recover * DT);
    return;
  }
  let rate: number;
  if (u.engaged > 0) rate = FATIGUE.fight;
  else if (u.moving && u.running) rate = FATIGUE.run;
  else if (u.moving) rate = FATIGUE.walk;
  else rate = -FATIGUE.recover * u.stats.fatigueRecoveryMult;
  if (rate > 0) rate *= u.stats.fatigueRateMult;
  if (hasMechanic(u.def, 'flyer') && u.soldiers.some((s) => s.airborne)) rate *= 0.5;
  u.fatigue = Math.max(0, Math.min(1, u.fatigue + rate * DT));
}
