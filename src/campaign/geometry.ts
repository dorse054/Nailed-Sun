/**
 * Region shapes and adjacency, computed once from the region sites: a
 * Voronoi diagram clipped to the map, with shared borders roughened by
 * deterministic midpoint displacement so both neighbors agree on the line.
 */
import { MAP_H, MAP_W, REGIONS, REGION_BY_ID } from './regions';
import { Rng, hashString } from '../core/rng';

type P = [number, number];

interface Edge {
  /** Neighbor region id, or null for the map edge. */
  to: string | null;
  pts: P[];
}

export interface RegionShape {
  id: string;
  /** Closed outline, roughened. */
  poly: P[];
  edges: Edge[];
  neighbors: string[];
  /** Visual center for labels (area centroid). */
  cx: number;
  cy: number;
  area: number;
}

/** Borders that the terrain closes: mountain walls and cliffs. */
const BLOCKED: [string, string][] = [];

interface LabeledVertex {
  p: P;
  /** Label of the edge that starts at this vertex. */
  e: number;
}

function clip(poly: LabeledVertex[], a: P, b: P, label: number): LabeledVertex[] {
  // Keep points closer to a than to b.
  const nx = b[0] - a[0];
  const ny = b[1] - a[1];
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const side = (p: P) => (p[0] - mx) * nx + (p[1] - my) * ny;
  const out: LabeledVertex[] = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i]!;
    const nxt = poly[(i + 1) % poly.length]!;
    const sc = side(cur.p);
    const sn = side(nxt.p);
    if (sc <= 0) out.push(cur);
    if ((sc <= 0) !== (sn <= 0)) {
      const t = sc / (sc - sn);
      const ip: P = [cur.p[0] + (nxt.p[0] - cur.p[0]) * t, cur.p[1] + (nxt.p[1] - cur.p[1]) * t];
      // Entering the kept side: the new edge continues the old one. Leaving:
      // the new edge runs along the bisector.
      out.push({ p: ip, e: sc <= 0 ? label : cur.e });
    }
  }
  return out;
}

function roughen(a: P, b: P, seed: string, depth: number): P[] {
  const rng = new Rng(hashString(seed));
  const pts: P[] = [a, b];
  for (let d = 0; d < depth; d++) {
    const next: P[] = [pts[0]!];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i]!;
      const q = pts[i + 1]!;
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const off = (rng.next() - 0.5) * len * 0.32;
      const nx = -(q[1] - p[1]) / (len || 1);
      const ny = (q[0] - p[0]) / (len || 1);
      next.push([(p[0] + q[0]) / 2 + nx * off, (p[1] + q[1]) / 2 + ny * off]);
      next.push(q);
    }
    pts.splice(0, pts.length, ...next);
  }
  return pts;
}

function computeShapes(): Record<string, RegionShape> {
  const sites = REGIONS.map((r) => [r.x, r.y] as P);
  const out: Record<string, RegionShape> = {};
  const blocked = new Set(BLOCKED.map(([a, b]) => [a, b].sort().join('|')));
  for (let i = 0; i < REGIONS.length; i++) {
    let poly: LabeledVertex[] = [
      { p: [0, 0], e: -1 },
      { p: [MAP_W, 0], e: -1 },
      { p: [MAP_W, MAP_H], e: -1 },
      { p: [0, MAP_H], e: -1 },
    ];
    for (let j = 0; j < REGIONS.length; j++) {
      if (j === i) continue;
      poly = clip(poly, sites[i]!, sites[j]!, j);
    }
    const edges: Edge[] = [];
    const neighbors: string[] = [];
    for (let k = 0; k < poly.length; k++) {
      const v = poly[k]!;
      const w = poly[(k + 1) % poly.length]!;
      const len = Math.hypot(w.p[0] - v.p[0], w.p[1] - v.p[1]);
      if (len < 0.5) continue;
      if (v.e < 0) {
        edges.push({ to: null, pts: [v.p, w.p] });
        continue;
      }
      const a = REGIONS[i]!.id;
      const b = REGIONS[v.e]!.id;
      // Both sides roughen the same segment in a canonical direction.
      const key = [a, b].sort().join('|');
      const fwd = a < b;
      const p0 = fwd ? v.p : w.p;
      const p1 = fwd ? w.p : v.p;
      const depth = len > 120 ? 4 : len > 50 ? 3 : 2;
      let pts = roughen(roundP(p0), roundP(p1), key, depth);
      if (!fwd) pts = pts.slice().reverse();
      edges.push({ to: b, pts });
      if (len > 12 && !blocked.has(key) && !neighbors.includes(b)) neighbors.push(b);
    }
    const poly2: P[] = [];
    for (const e of edges) for (let k = 0; k < e.pts.length - 1; k++) poly2.push(e.pts[k]!);
    const { cx, cy, area } = centroid(poly.map((v) => v.p));
    out[REGIONS[i]!.id] = { id: REGIONS[i]!.id, poly: poly2, edges, neighbors, cx, cy, area };
  }
  // Symmetrize adjacency (tiny shared edges can be one-sided).
  for (const s of Object.values(out)) {
    for (const n of s.neighbors) {
      const o = out[n]!;
      if (!o.neighbors.includes(s.id)) o.neighbors.push(s.id);
    }
  }
  return out;
}

function roundP(p: P): P {
  // Vertices from both cells differ by float noise; round so seeds agree.
  return [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100];
}

function centroid(pts: P[]): { cx: number; cy: number; area: number } {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    const c = p[0] * q[1] - q[0] * p[1];
    a += c;
    cx += (p[0] + q[0]) * c;
    cy += (p[1] + q[1]) * c;
  }
  a /= 2;
  return { cx: cx / (6 * a), cy: cy / (6 * a), area: Math.abs(a) };
}

export const SHAPES: Record<string, RegionShape> = computeShapes();

export function neighbors(id: string): string[] {
  return SHAPES[id]!.neighbors;
}

export function areNeighbors(a: string, b: string): boolean {
  return SHAPES[a]!.neighbors.includes(b);
}

/** Breadth-first distances in region steps from a start region. */
export function stepsFrom(start: string, passable: (id: string) => boolean = () => true): Record<string, number> {
  const dist: Record<string, number> = { [start]: 0 };
  const q = [start];
  while (q.length) {
    const c = q.shift()!;
    for (const n of neighbors(c)) {
      if (dist[n] !== undefined || !passable(n)) continue;
      dist[n] = dist[c]! + 1;
      q.push(n);
    }
  }
  return dist;
}

/** Point-in-polygon for map picking. */
export function regionAt(x: number, y: number): string | null {
  for (const s of Object.values(SHAPES)) {
    if (inside(s.poly, x, y)) return s.id;
  }
  // Fall back to the nearest site (borders are roughened).
  let best: string | null = null;
  let bd = Infinity;
  for (const id in SHAPES) {
    const r = REGION_BY_ID[id]!;
    const d = (r.x - x) ** 2 + (r.y - y) ** 2;
    if (d < bd) {
      bd = d;
      best = id;
    }
  }
  return best;
}

function inside(poly: P[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
