/**
 * Fortified battles beyond walls and gates: towers shoot at attackers in
 * range, and Old Midnight docks against a wall like a siege tower and
 * unloads its garrison onto the rampart. Runs once a second from the
 * battle's siege tick.
 */
import type { MissileWeapon } from '../data/schema';
import { datan2, dcos, dsin } from '../core/dmath';
import type { Battle } from './battle';
import type { Side, Unit } from './types';
import { layoutSlots, placeInFormation } from './army';
import { settleSoldiers } from './movement';
import { hasMechanic } from './mechanics';
import { projectileSpeed } from './missiles';

/** A tower's crossbows. Towers can't be killed, so they sting rather than slaughter. */
export const TOWER_BOLT: MissileWeapon = { kind: 'bolt', trajectory: 'direct', range: 150, ammo: 1, reload: 1, accuracy: 0.75, damage: 20, ap: 12 };
/** Bolts per tower per second. */
const TOWER_SHOTS = 3;
/** How close Old Midnight's hull must come to a wall to dock. */
const DOCK_REACH = 14;

export function fortTick(b: Battle): void {
  const f = b.terrain.fort;
  if (!f) return;
  towerFire(b, f.defender);
  dock(b, (1 - f.defender) as Side);
}

/**
 * Every standing tower shoots at the nearest attacker in range. Towers see
 * over the walls that blind the defenders behind them; only units hiding
 * (stealth, shadow, the dark) escape their notice.
 */
function towerFire(b: Battle, def: Side): void {
  // The garrison's commander takes the credit; with no defender left, the towers fall silent.
  const g = b.sides[def].general;
  const crew = g && g.alive > 0 && g.state !== 'fled' ? g : b.units.find((u) => u.side === def && u.alive > 0 && u.state === 'ready');
  if (!crew) return;
  const w = TOWER_BOLT;
  const speed = projectileSpeed(w);
  for (const t of b.terrain.walls) {
    if (!t.tower || t.broken) continue;
    let best: Unit | null = null;
    let bd = w.range * w.range;
    for (const u of b.units) {
      if (u.side === def || u.alive <= 0 || u.state === 'dead' || u.state === 'fled' || u.state === 'embarked') continue;
      if (u.concealed && !u.visible[def]) continue;
      const d2 = (u.x - t.x1) * (u.x - t.x1) + (u.y - t.y1) * (u.y - t.y1);
      if (d2 < bd) {
        bd = d2;
        best = u;
      }
    }
    if (!best) continue;
    for (let k = 0; k < TOWER_SHOTS; k++) {
      const v = best.soldiers[b.rng.int(best.soldiers.length)]!;
      if (!v.alive) continue;
      const d = Math.sqrt((v.x - t.x1) * (v.x - t.x1) + (v.y - t.y1) * (v.y - t.y1)) || 1;
      const T = Math.max(0.15, d / speed);
      const sigma = Math.max(0.3, d * (1 - w.accuracy) * 0.085);
      b.projectiles.push({
        id: b.nextProjectileId++,
        side: def,
        weapon: w,
        shooter: crew,
        x0: t.x1,
        y0: t.y1,
        // Lead a moving target, as archers do.
        x1: v.x + v.vx * T * 0.8 + b.rng.normal() * sigma,
        y1: v.y + v.vy * T * 0.8 + b.rng.normal() * sigma,
        t: 0,
        T,
        arc: 0.04,
        dmgMult: 1,
        victim: v,
        alive: true,
      });
    }
    b.events.push({ t: 'shot', kind: w.kind, x: t.x1, y: t.y1, side: def });
  }
}

/**
 * Old Midnight docks with the first wall it touches and lets its garrison
 * out onto the rampart, inside the walls, facing the town.
 */
function dock(b: Battle, atk: Side): void {
  const cx = b.terrain.width / 2;
  const cy = b.terrain.height / 2;
  for (const car of b.units) {
    if (car.side !== atk || car.alive <= 0 || car.state !== 'ready' || !car.passengers.length) continue;
    if (car.def.category !== 'colossus' || !hasMechanic(car.def, 'garrison')) continue;
    const hull = car.soldiers.find((s) => s.alive);
    if (!hull) continue;
    for (const w of b.terrain.walls) {
      if (w.broken || w.tower || w.gate) continue;
      const ex = w.x2 - w.x1;
      const ey = w.y2 - w.y1;
      const l2 = ex * ex + ey * ey || 1;
      const k = Math.max(0, Math.min(1, ((hull.x - w.x1) * ex + (hull.y - w.y1) * ey) / l2));
      const px = w.x1 + ex * k;
      const py = w.y1 + ey * k;
      const d = Math.sqrt((hull.x - px) * (hull.x - px) + (hull.y - py) * (hull.y - py));
      if (d > hull.radius + DOCK_REACH) continue;
      const facing = datan2(cy - py, cx - px);
      const nx = dcos(facing);
      const ny = dsin(facing);
      for (const u of [...car.passengers]) unload(b, car, u, px + nx * 9, py + ny * 9, facing);
      b.events.push({ t: 'text', x: px, y: py, text: `${car.def.name} docks!`, side: atk });
      b.events.push({ t: 'shockwave', x: px, y: py, r: 16, kind: 'dust' });
      break;
    }
  }
}

function unload(b: Battle, car: Unit, u: Unit, x: number, y: number, facing: number): void {
  car.passengers = car.passengers.filter((p) => p !== u);
  u.embarkedOn = null;
  u.state = 'ready';
  u.x = x;
  u.y = y;
  u.facing = facing;
  u.order = { kind: 'hold' };
  layoutSlots(u);
  placeInFormation(u);
  settleSoldiers(b, u);
}
