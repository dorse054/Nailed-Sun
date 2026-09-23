/**
 * Unit-level pathfinding on a coarse grid. Most orders are straight lines;
 * A* only runs when the straight path crosses water, cliffs or walls.
 */
import type { Category } from '../data/schema';
import type { Terrain } from './terrain';

const NAV = 8;

export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  /** Foot soldiers: walls are climbable. */
  private blocked: Uint8Array;
  /** Cavalry, beasts, monsters and engines: walls stop them. */
  private blockedMounted: Uint8Array;
  private blockedHeavy: Uint8Array;
  /** Wall cells cost extra: climbing is slow. */
  private wall: Uint8Array;
  private gScore: Float64Array;
  private came: Int32Array;
  private closed: Uint8Array;
  private stamp = 1;
  private stampArr: Uint32Array;

  constructor(private terrain: Terrain) {
    this.cols = Math.ceil(terrain.width / NAV);
    this.rows = Math.ceil(terrain.height / NAV);
    const n = this.cols * this.rows;
    this.blocked = new Uint8Array(n);
    this.blockedMounted = new Uint8Array(n);
    this.blockedHeavy = new Uint8Array(n);
    this.wall = new Uint8Array(n);
    this.gScore = new Float64Array(n);
    this.came = new Int32Array(n);
    this.closed = new Uint8Array(n);
    this.stampArr = new Uint32Array(n);
    this.rebuild();
  }

  /** Recompute blocked cells (walls can break during a battle). */
  rebuild(): void {
    const t = this.terrain;
    for (let cy = 0; cy < this.rows; cy++) {
      for (let cx = 0; cx < this.cols; cx++) {
        let bad = 0;
        let badMounted = 0;
        let badHeavy = 0;
        let walls = 0;
        for (let oy = 1; oy < NAV; oy += 3) {
          for (let ox = 1; ox < NAV; ox += 3) {
            const x = cx * NAV + ox;
            const y = cy * NAV + oy;
            if (!t.passable(x, y, 'infantry')) bad++;
            if (!t.passable(x, y, 'cavalry')) badMounted++;
            if (!t.passable(x, y, 'colossus')) badHeavy++;
            if (t.isWall(x, y)) walls++;
          }
        }
        const i = cy * this.cols + cx;
        this.blocked[i] = bad >= 3 ? 1 : 0;
        this.blockedMounted[i] = badMounted >= 3 ? 1 : 0;
        this.blockedHeavy[i] = badHeavy >= 3 ? 1 : 0;
        this.wall[i] = walls > 0 ? 1 : 0;
      }
    }
  }

  isBlocked(x: number, y: number, cat: Category): boolean {
    const cx = Math.floor(x / NAV);
    const cy = Math.floor(y / NAV);
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return true;
    return this.blockedAt(cy * this.cols + cx, cat);
  }

  /** True when the straight segment is clear on the nav grid. */
  clear(x1: number, y1: number, x2: number, y2: number, cat: Category): boolean {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const d = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(d / (NAV * 0.5));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      if (this.isBlocked(x1 + dx * t, y1 + dy * t, cat)) return false;
    }
    return true;
  }

  /** A* from a to b. Returns waypoints (excluding the start), or null. */
  find(ax: number, ay: number, bx: number, by: number, cat: Category): { x: number; y: number }[] | null {
    if (this.clear(ax, ay, bx, by, cat)) return [{ x: bx, y: by }];
    const cols = this.cols;
    const start = this.cellIndex(ax, ay);
    let goal = this.cellIndex(bx, by);
    if (this.blockedAt(goal, cat)) {
      goal = this.nearestOpen(goal, cat);
      if (goal < 0) return null;
    }
    this.stamp++;
    if (this.stamp > 4e9) {
      this.stamp = 1;
      this.stampArr.fill(0);
    }
    const heap = new MinHeap();
    const gx = goal % cols;
    const gy = Math.floor(goal / cols);
    const h = (i: number): number => {
      const x = i % cols;
      const y = Math.floor(i / cols);
      const dx = Math.abs(x - gx);
      const dy = Math.abs(y - gy);
      return (dx + dy + (1.4142 - 2) * Math.min(dx, dy)) * NAV;
    };
    this.touch(start);
    this.gScore[start] = 0;
    this.came[start] = -1;
    heap.push(start, h(start));
    let expanded = 0;
    let found = false;
    while (heap.size > 0 && expanded < 12000) {
      const cur = heap.pop();
      if (cur === goal) {
        found = true;
        break;
      }
      if (this.closed[cur] === 1 && this.stampArr[cur] === this.stamp) continue;
      this.closed[cur] = 1;
      expanded++;
      const cx = cur % cols;
      const cy = Math.floor(cur / cols);
      for (let k = 0; k < 8; k++) {
        const nx = cx + DX[k]!;
        const ny = cy + DY[k]!;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= this.rows) continue;
        const ni = ny * cols + nx;
        if (this.blockedAt(ni, cat)) continue;
        if (k >= 4 && (this.blockedAt(cy * cols + nx, cat) || this.blockedAt(ny * cols + cx, cat))) continue;
        this.touch(ni);
        if (this.closed[ni] === 1) continue;
        const g = this.gScore[cur]! + (k >= 4 ? 1.4142 : 1) * NAV * (this.wall[ni] === 1 ? 5 : 1);
        if (g < this.gScore[ni]!) {
          this.gScore[ni] = g;
          this.came[ni] = cur;
          heap.push(ni, g + h(ni));
        }
      }
    }
    if (!found) return null;
    const cells: number[] = [];
    let c = goal;
    while (c !== -1 && c !== start) {
      cells.push(c);
      c = this.came[c]!;
    }
    cells.reverse();
    const pts = cells.map((i) => ({ x: (i % cols) * NAV + NAV / 2, y: Math.floor(i / cols) * NAV + NAV / 2 }));
    pts.push({ x: bx, y: by });
    // String-pull: drop waypoints we can see past.
    const out: { x: number; y: number }[] = [];
    let fromX = ax;
    let fromY = ay;
    let i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !this.clear(fromX, fromY, pts[j]!.x, pts[j]!.y, cat)) j--;
      out.push(pts[j]!);
      fromX = pts[j]!.x;
      fromY = pts[j]!.y;
      i = j + 1;
    }
    return out;
  }

  private cellIndex(x: number, y: number): number {
    const cx = Math.max(0, Math.min(this.cols - 1, Math.floor(x / NAV)));
    const cy = Math.max(0, Math.min(this.rows - 1, Math.floor(y / NAV)));
    return cy * this.cols + cx;
  }

  private blockedAt(i: number, cat: Category): boolean {
    if (cat === 'colossus') return this.blockedHeavy[i] === 1;
    if (cat === 'infantry' || cat === 'character') return this.blocked[i] === 1;
    return this.blockedMounted[i] === 1;
  }

  private touch(i: number): void {
    if (this.stampArr[i] !== this.stamp) {
      this.stampArr[i] = this.stamp;
      this.gScore[i] = Infinity;
      this.closed[i] = 0;
    }
  }

  private nearestOpen(i: number, cat: Category): number {
    const cols = this.cols;
    const cx = i % cols;
    const cy = Math.floor(i / cols);
    for (let r = 1; r < 12; r++) {
      for (let oy = -r; oy <= r; oy++) {
        for (let ox = -r; ox <= r; ox++) {
          if (Math.abs(ox) !== r && Math.abs(oy) !== r) continue;
          const x = cx + ox;
          const y = cy + oy;
          if (x < 0 || y < 0 || x >= cols || y >= this.rows) continue;
          const j = y * cols + x;
          if (!this.blockedAt(j, cat)) return j;
        }
      }
    }
    return -1;
  }
}

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

class MinHeap {
  private items: number[] = [];
  private prio: number[] = [];
  get size(): number {
    return this.items.length;
  }
  push(item: number, p: number): void {
    const a = this.items;
    const q = this.prio;
    a.push(item);
    q.push(p);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (q[parent]! <= q[i]!) break;
      [a[parent], a[i]] = [a[i]!, a[parent]!];
      [q[parent], q[i]] = [q[i]!, q[parent]!];
      i = parent;
    }
  }
  pop(): number {
    const a = this.items;
    const q = this.prio;
    const top = a[0]!;
    const lastI = a.pop()!;
    const lastP = q.pop()!;
    if (a.length > 0) {
      a[0] = lastI;
      q[0] = lastP;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && q[l]! < q[m]!) m = l;
        if (r < a.length && q[r]! < q[m]!) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        [q[m], q[i]] = [q[i]!, q[m]!];
        i = m;
      }
    }
    return top;
  }
}
