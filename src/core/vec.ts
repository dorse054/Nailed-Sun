import { datan2, dcos, dsin } from './dmath';

export interface Vec {
  x: number;
  y: number;
}

export function v(x: number, y: number): Vec {
  return { x, y };
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt(dist2(ax, ay, bx, by));
}

export function angleTo(ax: number, ay: number, bx: number, by: number): number {
  return datan2(by - ay, bx - ax);
}

export function fromAngle(a: number, len = 1): Vec {
  return { x: dcos(a) * len, y: dsin(a) * len };
}

/** Distance from point p to segment ab, squared. */
export function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  let t = len2 > 0 ? ((px - ax) * abx + (py - ay) * aby) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  return dist2(px, py, cx, cy);
}

/** Parameter t in [0,1] where the segment ab first enters the circle, or -1. */
export function segCircleEntry(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, r: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const fx = ax - cx;
  const fy = ay - cy;
  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0; // starts inside
  if (a === 0) return -1;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}
