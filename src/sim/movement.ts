/**
 * Movement: each unit's formation anchor follows its order, soldiers steer to
 * their slots (or to their melee opponents), then overlapping bodies push
 * apart, heavier bodies moving less.
 */
import { angleDiff, clamp, datan2, dcos, dsin, turnToward } from '../core/dmath';
import type { Category } from '../data/schema';
import { WIND_RULES } from '../data/rules';
import type { Battle } from './battle';
import { DT } from './constants';
import type { Soldier, Unit } from './types';
import { formationSize, layoutSlots, slotFacing, slotPos } from './army';
import { hasMechanic, isFlyer, mechanic } from './mechanics';
import { tollActive } from './stats';

const tmp = { x: 0, y: 0 };
const SIDESTEPS = [0.8, -0.8, 1.6, -1.6, 2.4, -2.4];

export function turnRate(u: Unit): number {
  if (hasMechanic(u.def, 'sailing')) return 0.16;
  switch (u.def.category) {
    case 'infantry':
      return 1.3;
    case 'cavalry':
      return 1.5;
    case 'beast':
      return 2;
    case 'monster':
      return 1.1;
    case 'artillery':
      return 0.6;
    case 'flyer':
      return 2.2;
    case 'colossus':
      return 0.4;
    case 'character':
      return 1.6;
  }
}

function accel(cat: Category): number {
  switch (cat) {
    case 'infantry':
      return 10;
    case 'cavalry':
      return 5.5;
    case 'beast':
      return 9;
    case 'monster':
      return 5;
    case 'artillery':
      return 3;
    case 'flyer':
      return 7;
    case 'colossus':
      return 1.4;
    case 'character':
      return 8;
  }
}

/** Distance at which a running unit commits to a charge. */
export function chargeRange(u: Unit): number {
  switch (u.def.category) {
    case 'cavalry':
      return 75;
    case 'beast':
      return 45;
    case 'monster':
      return 40;
    case 'flyer':
      return 55;
    case 'colossus':
      return 30;
    default:
      return 32;
  }
}

export function isImmobile(u: Unit): boolean {
  for (const a of u.abilities) {
    if (a.def.kind === 'toggle' && (a.on || a.exit > 0) && a.def.stance?.immobile) return true;
    if (a.channel > 0 && a.def.channel) return true;
  }
  if (u.special.elkHp !== undefined && u.special.elkHp <= 0) return true;
  if (u.special.channelStill) return true;
  return false;
}

/** The formation's top speed in m/s right now. */
export function unitSpeed(b: Battle, u: Unit): number {
  if (isImmobile(u)) return 0;
  let v = u.def.speed * u.stats.speedMult;
  if (!u.running) v *= 0.5;
  if (hasMechanic(u.def, 'sailing')) v = sailingSpeed(b, u);
  if (isFlyer(u.def) && u.grounded <= 0 && u.soldiers.some((s) => s.airborne)) {
    // Gale: flyers +25% speed downwind.
    const down = Math.abs(angleDiff(u.facing, b.terrain.sunBearing)) < 0.9;
    if (down) v *= 1 + WIND_RULES[u.wind].flyerDownwindSpeedPct / 100;
  }
  if (isFlyer(u.def) && u.grounded > 0) v *= 0.4;
  return v;
}

/**
 * The Dreadsail's speed depends on the wind: fastest running downwind in a
 * Gale, average crosswind, slow tacking upwind, crawling in Calm.
 */
export function sailingSpeed(b: Battle, u: Unit): number {
  const w = u.wind;
  const rel = Math.abs(angleDiff(u.facing, b.terrain.sunBearing));
  const downwind = dcos(rel); // 1 downwind, -1 upwind
  const windFactor = w === 0 ? 0.25 : w === 1 ? 0.8 : 1.15;
  let pointOfSail = 0.55 + 0.45 * downwind;
  if (downwind < -0.3) pointOfSail = 0.28;
  let v = u.def.speed * windFactor * pointOfSail * u.stats.speedMult;
  if (u.special.sailsBurning) v *= 0.5;
  if (!u.running) v *= 0.6;
  return Math.max(0.6, v);
}

export function setMoveOrder(b: Battle, u: Unit, x: number, y: number, facing: number, files: number, run: boolean): void {
  x = clamp(x, 4, b.terrain.width - 4);
  y = clamp(y, 4, b.terrain.height - 4);
  if (u.engaged > 0 && u.state === 'ready') beginWithdraw(b, u);
  u.order = { kind: 'move', x, y, facing, files, run };
  u.running = run;
  u.meleeTarget = null;
  const flying = isFlyer(u.def) && u.grounded <= 0;
  if (flying) {
    u.path = [{ x, y }];
    for (const s of u.soldiers) if (s.alive) s.airborne = true;
  } else {
    u.path = b.nav.find(u.x, u.y, x, y, u.def.category) ?? siegeDetour(b, u, x, y);
  }
  if (files > 0 && files !== u.files) {
    u.files = files;
    u.slotsDirty = true;
  }
}

/**
 * Leaving a melee: normal units lose 10% leadership and need 3 s to turn and
 * fight again. The Drift's Feigned Flight costs nothing.
 */
function beginWithdraw(b: Battle, u: Unit): void {
  u.withdrawing = true;
  for (const s of u.soldiers) {
    s.target = null;
    s.approach = null;
  }
  if (hasMechanic(u.def, 'feignedFlight')) return;
  u.morale -= 0.1 * u.maxMorale;
  u.special.disorderUntil = b.time + 3;
}

export function startCharge(b: Battle, u: Unit): void {
  if (b.time - u.chargeStart < 6) return;
  u.chargeStart = b.time;
  let value = u.def.charge + u.stats.chargeBonus;
  // Antlered Lancers: a charge launched on the Toll gets double charge bonus.
  if (hasMechanic(u.def, 'tollCharge') && tollActive(b, u)) {
    value *= 2;
    b.events.push({ t: 'text', x: u.x, y: u.y, text: 'Charge on the bell!', side: u.side });
  }
  u.chargeValue = Math.max(0, value);
  for (const s of u.soldiers) if (s.alive) s.charging = true;
}

/** Update every unit's anchor from its order. */
export function updateAnchors(b: Battle): void {
  for (const u of b.units) {
    if (u.state === 'dead' || u.state === 'fled') continue;
    if (u.slotsDirty) layoutSlots(u);
    if (u.state === 'routing' || u.state === 'shattered') {
      centroid(u);
      u.moving = true;
      continue;
    }
    if (u.state === 'embarked') continue;
    const o = u.order;
    const speed = unitSpeed(b, u);
    const turn = turnRate(u) * DT;
    if (o.kind === 'hold') {
      u.moving = false;
      if (u.withdrawing && u.engaged === 0) u.withdrawing = false;
      continue;
    }
    if (o.kind === 'move' || o.kind === 'embark') {
      let tx: number;
      let ty: number;
      if (o.kind === 'embark') {
        const car = b.units[o.target];
        if (!car || car.state !== 'ready') {
          u.order = { kind: 'hold' };
          continue;
        }
        tx = car.x;
        ty = car.y;
        u.path = [{ x: tx, y: ty }];
        if ((u.x - tx) * (u.x - tx) + (u.y - ty) * (u.y - ty) < 30 * 30) {
          b.embark(u, car);
          continue;
        }
      }
      const wp = u.path[0];
      if (!wp) {
        // Arrived: wheel to the ordered facing.
        const f = o.kind === 'move' ? o.facing : u.facing;
        const d = angleDiff(u.facing, f);
        if (Math.abs(d) > 0.02 && speed > 0) {
          u.facing = turnToward(u.facing, f, turn);
          u.moving = true;
        } else {
          u.facing = f;
          u.order = { kind: 'hold' };
          u.moving = false;
          u.withdrawing = false;
        }
        continue;
      }
      const dx = wp.x - u.x;
      const dy = wp.y - u.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const step = speed * DT * cohesion(u);
      u.moving = speed > 0;
      if (d <= Math.max(step, 0.4)) {
        u.x = wp.x;
        u.y = wp.y;
        u.path.shift();
      } else if (speed > 0) {
        const dir = datan2(dy, dx);
        // Short shuffles keep their facing; marches face the way they go.
        if (d > 18 || u.path.length > 1) {
          u.facing = turnToward(u.facing, dir, turn);
          const off = Math.abs(angleDiff(u.facing, dir));
          const mult = off > 1.2 ? 0.2 : off > 0.6 ? 0.6 : 1;
          u.x += (dx / d) * step * mult;
          u.y += (dy / d) * step * mult;
        } else {
          u.x += (dx / d) * step;
          u.y += (dy / d) * step;
        }
      }
      continue;
    }
    // Attack order.
    const t = b.units[o.target];
    if (!t || t.state === 'dead' || t.state === 'fled' || t.state === 'embarked' || t.alive <= 0) {
      u.order = { kind: 'hold' };
      u.meleeTarget = null;
      u.moving = false;
      continue;
    }
    if (!t.visible[u.side] && u.engaged === 0 && b.time - t.lastSeen[u.side] > 10) {
      u.order = { kind: 'hold' };
      u.meleeTarget = null;
      continue;
    }
    const w = b.weaponOf(u);
    const lead = nearestSoldier(t, u.x, u.y);
    const tx = lead ? lead.x : t.x;
    const ty = lead ? lead.y : t.y;
    const dx = tx - u.x;
    const dy = ty - u.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const dir = datan2(dy, dx);
    if (w && u.soldiers.some((s) => s.alive && s.ammo > 0) && !u.special.meleeMode) {
      // Missile attack: close to range, then hold and shoot.
      u.missileTarget = t;
      u.meleeTarget = null;
      const range = b.effectiveRange(u, w, dir) * 0.9;
      if (d > range) {
        const step = speed * DT;
        u.facing = turnToward(u.facing, dir, turn);
        u.x += (dx / d) * step;
        u.y += (dy / d) * step;
        u.moving = true;
      } else {
        u.moving = false;
        if (!w.whileMoving || u.def.category !== 'colossus') u.facing = turnToward(u.facing, dir, turn * 0.8);
      }
      continue;
    }
    u.meleeTarget = t;
    const su = formationSize(u);
    const st = formationSize(t);
    const stop = Math.max(1.5, su.depth * 0.35 + (t.def.category === 'colossus' ? t.def.radius ?? 8 : st.depth * 0.2));
    // Route around obstacles when the straight line to the target is blocked.
    const flying = isFlyer(u.def) && u.grounded <= 0;
    if (!flying && d > 12 && ((u.special.pathAt ?? 0) <= b.time || u.path.length === 0)) {
      u.special.pathAt = b.time + 2;
      const cat = u.def.category;
      u.path = b.nav.clear(u.x, u.y, tx, ty, cat) ? [] : (b.nav.find(u.x, u.y, tx, ty, cat) ?? siegeDetour(b, u, tx, ty));
    }
    const wp = u.path.length > 1 ? u.path[0]! : null;
    if (wp) {
      const wx = wp.x - u.x;
      const wy = wp.y - u.y;
      const wd = Math.sqrt(wx * wx + wy * wy);
      if (wd < 3) u.path.shift();
      else if (speed > 0) {
        u.facing = turnToward(u.facing, datan2(wy, wx), turn);
        const step = speed * DT * cohesion(u);
        u.x += (wx / wd) * Math.min(step, wd);
        u.y += (wy / wd) * Math.min(step, wd);
        u.moving = true;
      }
      continue;
    }
    u.facing = turnToward(u.facing, dir, turn);
    if (u.running && d < chargeRange(u) && d > 4) startCharge(b, u);
    if (d > stop && speed > 0) {
      const step = Math.min(d - stop, speed * DT * (u.engaged > u.alive * 0.4 ? 0.3 : cohesion(u)));
      u.x += (dx / d) * step;
      u.y += (dy / d) * step;
      u.moving = true;
    } else {
      u.moving = false;
    }
  }
}

function cohesion(u: Unit): number {
  let err = 0;
  let n = 0;
  const step = Math.max(1, Math.floor(u.soldiers.length / 8));
  for (let i = 0; i < u.soldiers.length; i += step) {
    const s = u.soldiers[i]!;
    if (!s.alive) continue;
    slotPos(u, s.slot, tmp);
    err += Math.sqrt((s.x - tmp.x) * (s.x - tmp.x) + (s.y - tmp.y) * (s.y - tmp.y));
    n++;
  }
  if (!n) return 1;
  err /= n;
  return err > 30 ? 0 : err > 12 ? 0.35 : err > 6 ? 0.7 : 1;
}

export function centroid(u: Unit): void {
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
}

export function nearestSoldier(t: Unit, x: number, y: number): Soldier | null {
  let best: Soldier | null = null;
  let bd = Infinity;
  const step = t.soldiers.length > 60 ? 3 : 1;
  for (let i = 0; i < t.soldiers.length; i += step) {
    const s = t.soldiers[i]!;
    if (!s.alive) continue;
    const d = (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

/** Steer and move every soldier one tick. */
export function moveSoldiers(b: Battle): void {
  const W = b.terrain.width;
  const H = b.terrain.height;
  for (const u of b.units) {
    if (u.state === 'dead' || u.state === 'fled') continue;
    const cat = u.def.category;
    const routing = u.state === 'routing' || u.state === 'shattered';
    const flyer = isFlyer(u.def);
    const baseSpeed = u.def.speed * u.stats.speedMult;
    const a = accel(cat) * DT;
    const fleeX = u.special.fleeX ?? 0;
    const fleeY = u.special.fleeY ?? 0;
    const sailing = hasMechanic(u.def, 'sailing');
    const unitV = unitSpeed(b, u);
    const immobile = isImmobile(u);
    // Gust Leap: the Gale Dancers glide over the front rank.
    const leaping = (u.special.leapUntil ?? 0) > b.time;
    for (const s of u.soldiers) {
      if (!s.alive) continue;
      s.px = s.x;
      s.py = s.y;
      if (u.state === 'embarked') continue;
      if (s.chargeTimer > 0) s.chargeTimer -= DT;
      if (s.staggerTimer > 0) s.staggerTimer -= DT;
      if (s.burn > 0) {
        s.burn -= DT;
      }
      if (s.downTimer > 0) {
        s.downTimer -= DT;
        s.x += s.vx * DT;
        s.y += s.vy * DT;
        s.vx *= 0.8;
        s.vy *= 0.8;
        keepInside(b, s, W, H, routing);
        continue;
      }
      let gx: number;
      let gy: number;
      let maxV: number;
      let arrive = true;
      if (routing) {
        gx = s.x + fleeX * 30 + dsin(s.id * 1.7) * 4;
        gy = s.y + fleeY * 30 + dcos(s.id * 1.3) * 4;
        maxV = u.def.speed * Math.max(0.6, u.stats.speedMult) * 1.05;
        arrive = false;
      } else if (s.target) {
        const t = s.target;
        const contact = s.radius + t.radius + reachOf(b, s) * 0.8;
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.001;
        if (d > contact) {
          gx = t.x - (dx / d) * contact;
          gy = t.y - (dy / d) * contact;
        } else {
          gx = s.x;
          gy = s.y;
        }
        maxV = baseSpeed * 0.6;
      } else if (s.approach && s.approach.alive) {
        gx = s.approach.x;
        gy = s.approach.y;
        maxV = baseSpeed * (u.running || s.charging ? 1 : 0.6);
        arrive = false;
      } else if (sailing || u.def.category === 'colossus' && u.soldiers.length === 1) {
        // A colossus is its own formation: it moves with the anchor.
        gx = u.x;
        gy = u.y;
        maxV = Math.max(unitV, 0.5) * 1.2;
      } else {
        slotPos(u, s.slot, tmp);
        gx = tmp.x;
        gy = tmp.y;
        const dx = gx - s.x;
        const dy = gy - s.y;
        const far = dx * dx + dy * dy > 16;
        maxV = u.moving ? unitV * (far ? 1.35 : 1.08) : baseSpeed * (far ? 0.9 : 0.45);
        if (!u.running && !far) maxV = Math.min(maxV, baseSpeed * 0.5);
        if (immobile) maxV = Math.min(maxV, 1.2);
        if (leaping) {
          maxV = 26;
          arrive = false;
        }
      }
      if (s.staggerTimer > 0) maxV *= 0.2;
      maxV *= b.terrain.speedMult(s.x, s.y, cat, s.airborne);
      const dx = gx - s.x;
      const dy = gy - s.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      let tvx = 0;
      let tvy = 0;
      if (d > 0.05) {
        const v = arrive ? Math.min(maxV, d * 3) : maxV;
        tvx = (dx / d) * v;
        tvy = (dy / d) * v;
      }
      let ax = tvx - s.vx;
      let ay = tvy - s.vy;
      const al = Math.sqrt(ax * ax + ay * ay);
      if (al > a) {
        ax = (ax / al) * a;
        ay = (ay / al) * a;
      }
      s.vx += ax;
      s.vy += ay;
      const nx = s.x + s.vx * DT;
      const ny = s.y + s.vy * DT;
      if (s.airborne || b.terrain.passable(nx, ny, cat) || (routing && !b.terrain.inBounds(nx, ny))) {
        s.x = nx;
        s.y = ny;
      } else if (b.terrain.passable(nx, s.y, cat)) {
        s.x = nx;
        s.vy *= 0.3;
      } else if (b.terrain.passable(s.x, ny, cat)) {
        s.y = ny;
        s.vx *= 0.3;
      } else {
        // Blocked head-on: sidestep around the obstacle, alternating sides by soldier.
        const sp = Math.sqrt(s.vx * s.vx + s.vy * s.vy) || maxV;
        const base = datan2(s.vy, s.vx);
        const sign = (s.id & 1) === 0 ? 1 : -1;
        let moved = false;
        for (const off of SIDESTEPS) {
          const a = base + off * sign;
          const tx2 = s.x + dcos(a) * sp * DT;
          const ty2 = s.y + dsin(a) * sp * DT;
          if (b.terrain.passable(tx2, ty2, cat)) {
            s.x = tx2;
            s.y = ty2;
            s.vx = dcos(a) * sp * 0.7;
            s.vy = dsin(a) * sp * 0.7;
            moved = true;
            break;
          }
        }
        if (!moved) {
          s.vx *= -0.2;
          s.vy *= -0.2;
        }
      }
      // Facing: toward the opponent, else the way we move, else the slot.
      const sp2 = s.vx * s.vx + s.vy * s.vy;
      if (s.target) s.facing = datan2(s.target.y - s.y, s.target.x - s.x);
      else if (sp2 > 0.8) s.facing = datan2(s.vy, s.vx);
      else if (!routing) s.facing = turnToward(s.facing, slotFacing(u, s.slot), 0.25);
      keepInside(b, s, W, H, routing);
    }
    if (flyer) updateFlyerAltitude(b, u);
  }
}

function keepInside(b: Battle, s: Soldier, W: number, H: number, routing: boolean): void {
  if (routing) {
    if (s.x < -2 || s.y < -2 || s.x > W + 2 || s.y > H + 2) b.soldierFled(s);
    return;
  }
  if (s.x < 1) s.x = 1;
  else if (s.x > W - 1) s.x = W - 1;
  if (s.y < 1) s.y = 1;
  else if (s.y > H - 1) s.y = H - 1;
}

export function reachOf(b: Battle, s: Soldier): number {
  const def = s.unit.def;
  const w = s.leader && def.leader ? def.leader.weapon : def.weapon;
  if (w.reach !== undefined) return w.reach;
  return b.defaultReach(s.unit);
}

/**
 * Flyers stay airborne while moving or holding; they land to fight when
 * their unit attacks in melee, and gliders come down when their glide time
 * runs out (it drains fastest in Calm).
 */
function updateFlyerAltitude(b: Battle, u: Unit): void {
  const glider = mechanic(u.def, 'flyer')?.glider;
  if (u.grounded > 0) {
    for (const s of u.soldiers) s.airborne = false;
    return;
  }
  if (glider) {
    const drain = u.wind === 0 ? 2.2 : u.wind === 1 ? 1 : 0.6;
    if (u.soldiers.some((s) => s.alive && s.airborne)) u.special.glide = (u.special.glide ?? 0) - drain * DT;
    else u.special.glide = Math.min(glider.seconds, (u.special.glide ?? 0) + (u.wind === 0 ? 0.2 : 0.8) * DT);
    if ((u.special.glide ?? 0) <= 0) {
      u.special.glide = 0;
      if (u.soldiers.some((s) => s.airborne)) b.events.push({ t: 'text', x: u.x, y: u.y, text: 'Out of glide', side: u.side });
      for (const s of u.soldiers) s.airborne = false;
      return;
    }
  }
  const fighting = u.order.kind === 'attack' && u.meleeTarget !== null;
  for (const s of u.soldiers) {
    if (!s.alive) continue;
    if (s.target && !s.target.airborne) s.airborne = false;
    else if (!fighting && !s.target) s.airborne = true;
  }
}

/** Push two overlapping bodies apart; heavier bodies move less. */
function collide(s: Soldier, o: Soldier, salt: number): void {
  if (o.airborne !== s.airborne) return;
  const min = s.radius + o.radius;
  let dx = o.x - s.x;
  let dy = o.y - s.y;
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min) return;
  let d = Math.sqrt(d2);
  if (d < 1e-4) {
    dx = dcos(salt * 2.399);
    dy = dsin(salt * 2.399);
    d = 1;
  }
  const overlap = min - Math.min(d, min);
  const su = s.unit;
  const ou = o.unit;
  const mi = s.mass * (s.downTimer > 0 ? 0.3 : 1) * (su.special.anchored ? 50 : 1);
  const mj = o.mass * (o.downTimer > 0 ? 0.3 : 1) * (ou.special.anchored ? 50 : 1);
  const k = su === ou ? 0.3 : su.side === ou.side ? 0.4 : 0.5;
  const push = overlap * k;
  const inv = 1 / (mi + mj);
  const nx = dx / d;
  const ny = dy / d;
  const pi = push * mj * inv;
  const pj = push * mi * inv;
  s.x -= nx * pi;
  s.y -= ny * pi;
  o.x += nx * pj;
  o.y += ny * pj;
}

/**
 * Resolve body overlaps. Small bodies are swept cell by cell against their
 * own and the forward neighbor cells, so each pair is checked once; big
 * bodies (monsters, colossi) query around themselves.
 */
export function resolveCollisions(b: Battle): void {
  const soldiers = b.soldiers;
  const h = b.hash;
  const head = h.head;
  const next = h.next;
  const cellOf = h.cellOfItem;
  const cols = h.cols;
  const rows = h.rows;
  for (let i = 0; i < soldiers.length; i++) {
    const c = cellOf[i]!;
    if (c < 0) continue;
    const s = soldiers[i]!;
    if (s.radius > 1.3) continue;
    // Later items in the same cell, then the forward neighbor cells: E, SW, S, SE.
    let j = next[i]!;
    while (j !== -1) {
      const o = soldiers[j]!;
      if (o.radius <= 1.3) collide(s, o, i);
      j = next[j]!;
    }
    const cx = c % cols;
    const cy = (c - cx) / cols;
    if (cx + 1 < cols) {
      j = head[c + 1]!;
      while (j !== -1) {
        const o = soldiers[j]!;
        if (o.radius <= 1.3) collide(s, o, i);
        j = next[j]!;
      }
    }
    if (cy + 1 < rows) {
      const row = c + cols;
      const x0 = cx > 0 ? -1 : 0;
      const x1 = cx + 1 < cols ? 1 : 0;
      for (let ox = x0; ox <= x1; ox++) {
        j = head[row + ox]!;
        while (j !== -1) {
          const o = soldiers[j]!;
          if (o.radius <= 1.3) collide(s, o, i);
          j = next[j]!;
        }
      }
    }
  }
  const bigs = b.bigSoldiers;
  for (let k = 0; k < bigs.length; k++) {
    const s = bigs[k]!;
    if (!s.alive || s.unit.state === 'embarked') continue;
    h.query(s.x, s.y, s.radius + 1.3, (j) => {
      const o = soldiers[j]!;
      if (o === s || !o.alive || o.unit.state === 'embarked') return;
      // Big-big pairs are handled once, by the lower id.
      if (o.radius > 1.3 && o.id < s.id) return;
      collide(s, o, s.id);
    });
    // Big bodies whose centers are farther than a cell away.
    for (let q = k + 1; q < bigs.length; q++) {
      const o = bigs[q]!;
      if (!o.alive || o.unit.state === 'embarked') continue;
      const dx = o.x - s.x;
      const dy = o.y - s.y;
      const min = s.radius + o.radius;
      if (dx * dx + dy * dy < min * min && Math.abs(dx) + Math.abs(dy) > s.radius + 1.3) collide(s, o, s.id);
    }
  }
  // Never leave a soldier inside a wall or building (routers may leave the map).
  for (const s of soldiers) {
    if (!s.alive || s.airborne || s.unit.state === 'embarked') continue;
    if (!b.terrain.inBounds(s.x, s.y)) continue;
    if (!b.terrain.passable(s.x, s.y, s.unit.def.category)) {
      if (b.terrain.passable(s.px, s.py, s.unit.def.category)) {
        s.x = s.px;
        s.y = s.py;
      }
    }
  }
}

/**
 * No way through the walls for horses and engines: go and stand at the
 * nearest gate, where they batter it down.
 */
function siegeDetour(b: Battle, u: Unit, x: number, y: number): { x: number; y: number }[] {
  if (!b.terrain.fort) return [{ x, y }];
  const cx = b.terrain.width / 2;
  const cy = b.terrain.height / 2;
  let best: { x: number; y: number } | null = null;
  let bd = Infinity;
  for (const w of b.terrain.walls) {
    if (!w.gate || w.broken) continue;
    const mx = (w.x1 + w.x2) / 2;
    const my = (w.y1 + w.y2) / 2;
    const dx = mx - cx;
    const dy = my - cy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    // Just outside the gate.
    const gx = mx + (dx / len) * 12;
    const gy = my + (dy / len) * 12;
    const d = (gx - u.x) * (gx - u.x) + (gy - u.y) * (gy - u.y);
    if (d < bd) {
      bd = d;
      best = { x: gx, y: gy };
    }
  }
  if (!best) return [{ x, y }];
  return b.nav.find(u.x, u.y, best.x, best.y, u.def.category) ?? [best];
}
