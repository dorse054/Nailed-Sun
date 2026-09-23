/**
 * Turning mouse gestures into formation placements. Deployment applies them
 * directly; in battle they become move orders.
 */
import type { Unit } from '../../sim/types';
import { formationSize, formationSpec } from '../../sim/army';

export interface Placement {
  unit: number;
  x: number;
  y: number;
  facing: number;
  files: number;
  width: number;
  depth: number;
}

function avgFacing(units: Unit[]): number {
  let sx = 0;
  let sy = 0;
  for (const u of units) {
    sx += Math.cos(u.facing);
    sy += Math.sin(u.facing);
  }
  return Math.atan2(sy, sx);
}

/** Move a group to a point, keeping its layout, turning to face the way it goes. */
export function groupMove(units: Unit[], x: number, y: number): Placement[] {
  if (!units.length) return [];
  let cx = 0;
  let cy = 0;
  for (const u of units) {
    cx += u.x;
    cy += u.y;
  }
  cx /= units.length;
  cy /= units.length;
  const dist = Math.hypot(x - cx, y - cy);
  const oldF = avgFacing(units);
  const newF = dist > 25 ? Math.atan2(y - cy, x - cx) : oldF;
  const rot = units.length === 1 ? 0 : newF - oldF;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return units.map((u) => {
    const ox = u.x - cx;
    const oy = u.y - cy;
    const sz = formationSize(u);
    return {
      unit: u.id,
      x: x + ox * c - oy * s,
      y: y + ox * s + oy * c,
      facing: units.length === 1 ? newF : u.facing + rot,
      files: u.files,
      width: sz.width,
      depth: sz.depth,
    };
  });
}

/**
 * Spread a group along a dragged line. Units keep their left-to-right order;
 * the line's length sets how wide (and so how deep) each formation is.
 * Dragging left to right makes the line face up the screen.
 */
export function lineFormation(units: Unit[], ax: number, ay: number, bx: number, by: number): Placement[] {
  if (!units.length) return [];
  const len = Math.hypot(bx - ax, by - ay);
  const dir = Math.atan2(by - ay, bx - ax);
  const facing = dir - Math.PI / 2;
  const ux = Math.cos(dir);
  const uy = Math.sin(dir);
  const sorted = [...units].sort((a, b) => (a.x - ax) * ux + (a.y - ay) * uy - ((b.x - ax) * ux + (b.y - ay) * uy));
  const gap = 4;
  const natural = sorted.map((u) => formationSize(u).width);
  const total = natural.reduce((a, w) => a + w, 0) + gap * (sorted.length - 1);
  const scale = total > 0 ? Math.max(0.35, Math.min(2.5, (len - gap * (sorted.length - 1)) / Math.max(1, total - gap * (sorted.length - 1)))) : 1;
  const out: Placement[] = [];
  let used = 0;
  const widths = sorted.map((u, i) => {
    const spec = formationSpec(u.def);
    const w = natural[i]! * scale;
    const files = Math.max(1, Math.min(u.alive, Math.round(w / spec.spacing)));
    return { u, files, w: files * spec.spacing, spec };
  });
  const realTotal = widths.reduce((a, w) => a + w.w, 0) + gap * (sorted.length - 1);
  const start = (len - realTotal) / 2;
  for (const { u, files, w, spec } of widths) {
    const along = start + used + w / 2;
    used += w + gap;
    const ranks = Math.ceil(u.alive / files);
    out.push({
      unit: u.id,
      x: ax + ux * along,
      y: ay + uy * along,
      facing,
      files,
      width: w,
      depth: ranks * spec.depth,
    });
  }
  return out;
}
