/**
 * Battle terrain: a seeded heightmap plus cover, water and obstacles.
 *
 * The sun never moves, so shadows are baked once per map: every cell marches
 * toward the sun and checks whether anything rises above the sun's elevation.
 * Shadows only exist in Bright and Dusk light, as the doc requires.
 */
import { Rng } from '../core/rng';
import { dcos, dsin, clamp, DEG } from '../core/dmath';
import type { BandId, LightLevel, WindLevel, Category } from '../data/schema';
import { BANDS, LIGHT_RULES } from '../data/rules';

export const COVER = {
  None: 0,
  Forest: 1,
  Building: 2,
  Shallow: 3,
  Deep: 4,
  Cliff: 5,
  Wall: 6,
  Field: 7,
  Gate: 8,
} as const;
export type Cover = (typeof COVER)[keyof typeof COVER];

export interface Tree {
  x: number;
  y: number;
  r: number;
  kind: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
  kind: 'house' | 'ruin' | 'mesa' | 'rock' | 'furnace' | 'vent' | 'ice' | 'tower' | 'gatehouse' | 'spire' | 'shard';
  height: number;
}

export interface FortSetup {
  /** Which side defends the walls. */
  defender: 0 | 1;
  /** Radius of the walled town. */
  radius: number;
}

export interface MapSetup {
  seed: number | string;
  band: BandId;
  /** Override the band's natural light. */
  light?: LightLevel;
  wind: WindLevel;
  /** Direction toward the sun, radians (0 = east, PI/2 = south on screen). */
  sunBearing: number;
  width?: number;
  height?: number;
  /** Open steppe variant (the Gale Roads). */
  steppe?: boolean;
  /** Terrain density preset. */
  preset?: 'default' | 'open' | 'wooded' | 'hilly' | 'river';
  fort?: FortSetup;
}

export interface WallSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  hp: number;
  maxHp: number;
  gate: boolean;
  tower: boolean;
  broken: boolean;
}

export class Terrain {
  readonly width: number;
  readonly height: number;
  readonly cell = 4;
  readonly cols: number;
  readonly rows: number;
  readonly heights: Float32Array;
  readonly cover: Uint8Array;
  readonly shadow: Uint8Array;
  readonly flammable: Uint8Array;
  readonly trees: Tree[] = [];
  readonly rects: Rect[] = [];
  readonly rivers: { pts: { x: number; y: number }[]; width: number; fords: { x: number; y: number; r: number }[] }[] = [];
  readonly fields: { x: number; y: number; w: number; h: number; angle: number }[] = [];
  readonly decor: { x: number; y: number; kind: string; s: number; a: number }[] = [];
  readonly walls: WallSegment[] = [];
  readonly light: LightLevel;
  readonly wind: WindLevel;
  readonly sunBearing: number;
  readonly band: BandId;
  readonly steppe: boolean;
  capturePoint: { x: number; y: number; r: number } | null = null;
  readonly fort: FortSetup | null;
  private readonly rng: Rng;

  constructor(readonly setup: MapSetup) {
    this.width = setup.width ?? 1400;
    this.height = setup.height ?? 1000;
    this.cols = Math.ceil(this.width / this.cell);
    this.rows = Math.ceil(this.height / this.cell);
    const n = this.cols * this.rows;
    this.heights = new Float32Array(n);
    this.cover = new Uint8Array(n);
    this.shadow = new Uint8Array(n);
    this.flammable = new Uint8Array(n);
    this.band = setup.band;
    this.light = setup.light ?? BANDS[setup.band].light;
    this.wind = setup.wind;
    this.sunBearing = setup.sunBearing;
    this.steppe = !!setup.steppe;
    this.fort = setup.fort ?? null;
    this.rng = new Rng(`terrain:${setup.seed}:${setup.band}:${setup.preset ?? 'default'}`);
    this.generate();
    this.bakeShadows();
  }

  // ---------------------------------------------------------------- queries

  idx(x: number, y: number): number {
    let cx = Math.floor(x / this.cell);
    let cy = Math.floor(y / this.cell);
    if (cx < 0) cx = 0;
    else if (cx >= this.cols) cx = this.cols - 1;
    if (cy < 0) cy = 0;
    else if (cy >= this.rows) cy = this.rows - 1;
    return cy * this.cols + cx;
  }

  heightAt(x: number, y: number): number {
    const fx = clamp(x / this.cell - 0.5, 0, this.cols - 1.001);
    const fy = clamp(y / this.cell - 0.5, 0, this.rows - 1.001);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const i = y0 * this.cols + x0;
    const h00 = this.heights[i]!;
    const h10 = this.heights[i + 1]!;
    const h01 = this.heights[i + this.cols]!;
    const h11 = this.heights[i + this.cols + 1]!;
    return (h00 * (1 - tx) + h10 * tx) * (1 - ty) + (h01 * (1 - tx) + h11 * tx) * ty;
  }

  coverAt(x: number, y: number): Cover {
    return this.cover[this.idx(x, y)] as Cover;
  }

  inShadow(x: number, y: number): boolean {
    return this.shadow[this.idx(x, y)] === 1;
  }

  inForest(x: number, y: number): boolean {
    return this.cover[this.idx(x, y)] === COVER.Forest;
  }

  isFlammable(x: number, y: number): boolean {
    return this.flammable[this.idx(x, y)] === 1;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  passable(x: number, y: number, cat: Category, flying = false): boolean {
    if (!this.inBounds(x, y)) return false;
    if (flying) return true;
    const c = this.cover[this.idx(x, y)]!;
    if (c === COVER.Building || c === COVER.Deep || c === COVER.Cliff || c === COVER.Wall) return false;
    if (c === COVER.Gate) return false;
    if (cat === 'colossus' && c === COVER.Shallow) return true;
    return true;
  }

  /** Movement speed multiplier for a category at a point. */
  speedMult(x: number, y: number, cat: Category, flying = false): number {
    if (flying) return 1;
    const c = this.cover[this.idx(x, y)]!;
    if (c === COVER.Forest) {
      if (cat === 'cavalry' || cat === 'beast') return 0.62;
      if (cat === 'artillery') return 0.5;
      if (cat === 'colossus') return 0.9;
      return 0.8;
    }
    if (c === COVER.Shallow) return cat === 'colossus' ? 0.85 : 0.55;
    if (c === COVER.Field) return 0.95;
    return 1;
  }

  /** Obstacle height above ground at a point, for line of sight and shadows. */
  obstacleHeight(i: number): number {
    const c = this.cover[i]!;
    if (c === COVER.Forest) return 14;
    if (c === COVER.Building) return 8;
    if (c === COVER.Cliff) return 30;
    if (c === COVER.Wall || c === COVER.Gate) return 9;
    return 0;
  }

  /**
   * Line of sight between two points with eye heights. Hills and obstacles
   * block; the endpoints' own cells are ignored so units in woods can see out.
   */
  los(x1: number, y1: number, e1: number, x2: number, y2: number, e2: number): boolean {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 12) return true;
    const h1 = this.heightAt(x1, y1) + e1;
    const h2 = this.heightAt(x2, y2) + e2;
    const steps = Math.ceil(d / 8);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      if (t * d < 10 || (1 - t) * d < 10) continue;
      const x = x1 + dx * t;
      const y = y1 + dy * t;
      const i = this.idx(x, y);
      const ground = this.heights[i]! + this.obstacleHeight(i) * (this.cover[i] === COVER.Forest ? 0.6 : 1);
      const lineH = h1 + (h2 - h1) * t;
      if (ground > lineH) return false;
    }
    return true;
  }

  /** Sun direction unit vector (toward the sun). */
  sunDir(): { x: number; y: number } {
    return { x: dcos(this.sunBearing), y: dsin(this.sunBearing) };
  }

  // ------------------------------------------------------------- generation

  private generate(): void {
    const band = BANDS[this.band];
    const preset = this.setup.preset ?? 'default';
    const r = this.rng;
    let hills = band.terrain.hills;
    let forest = this.steppe ? 0.08 : band.terrain.forest;
    let water = this.steppe ? 0.05 : band.terrain.water;
    const rocks = band.terrain.rocks;
    if (preset === 'open') {
      hills *= 0.4;
      forest *= 0.3;
      water *= 0.3;
    } else if (preset === 'wooded') {
      forest = Math.min(1, forest * 1.8 + 0.2);
    } else if (preset === 'hilly') {
      hills = Math.min(1, hills * 1.6 + 0.2);
    } else if (preset === 'river') {
      water = 1;
    }
    if (this.steppe) hills *= 0.6;

    this.genHeights(hills);
    if (this.fort) this.genFort();
    if (r.next() < water) this.genRiver();
    this.genForests(forest);
    this.genObstacles(rocks);
    this.genFields();
    this.genDecor();
    this.clearDeployZones();
  }

  /** Deployment zones: side 0 along the bottom edge, side 1 along the top. */
  deployZone(side: 0 | 1): { x: number; y: number; w: number; h: number } {
    const depth = 190;
    const margin = 120;
    if (this.fort && side === this.fort.defender) {
      const cx = this.width / 2;
      const cy = this.height / 2;
      const rr = this.fort.radius - 20;
      return { x: cx - rr, y: cy - rr, w: rr * 2, h: rr * 2 };
    }
    if (side === 0) return { x: margin, y: this.height - depth - 20, w: this.width - margin * 2, h: depth };
    return { x: margin, y: 20, w: this.width - margin * 2, h: depth };
  }

  private genHeights(hills: number): void {
    const r = this.rng;
    const count = Math.round(4 + hills * 14);
    const bumps: { x: number; y: number; h: number; rx: number; ry: number; a: number }[] = [];
    for (let i = 0; i < count; i++) {
      bumps.push({
        x: r.range(0, this.width),
        y: r.range(this.height * 0.15, this.height * 0.85),
        h: r.range(6, 14 + hills * 26) * (r.chance(0.15) ? -0.5 : 1),
        rx: r.range(60, 190),
        ry: r.range(50, 160),
        a: r.range(0, Math.PI),
      });
    }
    // Low-frequency ripples from a few seeded waves.
    const waves: { kx: number; ky: number; p: number; amp: number }[] = [];
    for (let i = 0; i < 5; i++) {
      const ang = r.range(0, Math.PI * 2);
      const f = r.range(0.004, 0.012);
      waves.push({ kx: dcos(ang) * f, ky: dsin(ang) * f, p: r.range(0, 6.28), amp: r.range(0.6, 2.2) });
    }
    for (let cy = 0; cy < this.rows; cy++) {
      for (let cx = 0; cx < this.cols; cx++) {
        const x = (cx + 0.5) * this.cell;
        const y = (cy + 0.5) * this.cell;
        let h = 0;
        for (const b of bumps) {
          const dx = x - b.x;
          const dy = y - b.y;
          const ca = dcos(b.a);
          const sa = dsin(b.a);
          const u = (dx * ca + dy * sa) / b.rx;
          const w = (-dx * sa + dy * ca) / b.ry;
          const q = u * u + w * w;
          if (q < 9) h += b.h * gauss(q);
        }
        for (const wv of waves) h += wv.amp * dsin(x * wv.kx + y * wv.ky + wv.p);
        this.heights[cy * this.cols + cx] = h;
      }
    }
  }

  private genRiver(): void {
    const r = this.rng;
    // Rivers flow from the night's ice toward the day: along the sun bearing.
    // They cross the battlefield perpendicular to the deployment edges when the
    // sun is east/west, or diagonally otherwise.
    const horizontal = r.chance(0.5);
    const pts: { x: number; y: number }[] = [];
    const n = 24;
    if (horizontal) {
      const y0 = this.height * r.range(0.4, 0.6);
      let y = y0;
      for (let i = 0; i <= n; i++) {
        pts.push({ x: (this.width * i) / n, y });
        y += r.range(-26, 26);
        y = clamp(y, this.height * 0.33, this.height * 0.67);
      }
    } else {
      let x = this.width * r.range(0.3, 0.7);
      for (let i = 0; i <= n; i++) {
        pts.push({ x, y: (this.height * i) / n });
        x += r.range(-30, 30);
        x = clamp(x, this.width * 0.2, this.width * 0.8);
      }
    }
    const width = r.range(14, 24);
    const fords: { x: number; y: number; r: number }[] = [];
    const fordCount = 2 + r.int(2);
    for (let f = 0; f < fordCount; f++) {
      const p = pts[Math.floor(((f + 0.5) / fordCount) * n)]!;
      fords.push({ x: p.x, y: p.y, r: r.range(26, 40) });
    }
    this.rivers.push({ pts, width, fords });
    for (let cy = 0; cy < this.rows; cy++) {
      for (let cx = 0; cx < this.cols; cx++) {
        const x = (cx + 0.5) * this.cell;
        const y = (cy + 0.5) * this.cell;
        let best = Infinity;
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i]!;
          const b = pts[i + 1]!;
          const d = segDist(x, y, a.x, a.y, b.x, b.y);
          if (d < best) best = d;
        }
        const i = cy * this.cols + cx;
        if (best < width * 0.5 + 6) this.heights[i] = this.heights[i]! - (1 - best / (width * 0.5 + 6)) * 3;
        if (best < width * 0.5) {
          let ford = false;
          for (const f of fords) if ((x - f.x) * (x - f.x) + (y - f.y) * (y - f.y) < f.r * f.r) ford = true;
          this.cover[i] = ford || best > width * 0.32 ? COVER.Shallow : COVER.Deep;
        }
      }
    }
  }

  private genForests(density: number): void {
    const r = this.rng;
    const clumps = Math.round(density * 11);
    for (let c = 0; c < clumps; c++) {
      const cx = r.range(80, this.width - 80);
      const cy = r.range(this.height * 0.22, this.height * 0.78);
      const rx = r.range(40, 110);
      const ry = r.range(35, 90);
      const ang = r.range(0, Math.PI);
      const count = Math.round((rx * ry) / 55);
      for (let t = 0; t < count; t++) {
        const u = r.range(-1, 1);
        const w = r.range(-1, 1);
        if (u * u + w * w > 1) continue;
        const x = cx + dcos(ang) * u * rx - dsin(ang) * w * ry;
        const y = cy + dsin(ang) * u * rx + dcos(ang) * w * ry;
        if (!this.inBounds(x, y)) continue;
        const i = this.idx(x, y);
        if (this.cover[i] === COVER.Deep || this.cover[i] === COVER.Shallow) continue;
        this.trees.push({ x, y, r: r.range(2.4, 4.6), kind: r.int(3) });
      }
    }
    // Mark forest cover in a small radius around each tree.
    for (const t of this.trees) {
      const rr = t.r + 3;
      for (let y = t.y - rr; y <= t.y + rr; y += this.cell) {
        for (let x = t.x - rr; x <= t.x + rr; x += this.cell) {
          if (!this.inBounds(x, y)) continue;
          if ((x - t.x) * (x - t.x) + (y - t.y) * (y - t.y) > rr * rr) continue;
          const i = this.idx(x, y);
          if (this.cover[i] === COVER.None || this.cover[i] === COVER.Field) {
            this.cover[i] = COVER.Forest;
            this.flammable[i] = 1;
          }
        }
      }
    }
  }

  private genObstacles(rocks: number): void {
    const r = this.rng;
    const band = this.band;
    const count = Math.round(rocks * 10);
    for (let k = 0; k < count; k++) {
      const x = r.range(60, this.width - 60);
      const y = r.range(this.height * 0.24, this.height * 0.76);
      let kind: Rect['kind'] = 'rock';
      let w = r.range(6, 16);
      let h = r.range(6, 14);
      let height = 4;
      if (band === 'gloaming' && !this.steppe) {
        kind = r.chance(0.6) ? 'house' : 'ruin';
        w = r.range(10, 18);
        h = r.range(8, 14);
        height = 8;
      } else if (band === 'longAfternoon') {
        if (r.chance(0.35)) {
          kind = 'mesa';
          w = r.range(40, 90);
          h = r.range(30, 70);
          height = 30;
        } else if (r.chance(0.4)) {
          kind = 'furnace';
          w = r.range(8, 12);
          h = w;
          height = 10;
        }
      } else if (band === 'evernight') {
        kind = r.chance(0.5) ? 'ice' : 'vent';
        w = r.range(8, 22);
        h = r.range(8, 18);
        height = kind === 'ice' ? 8 : 2;
      } else if (band === 'glare') {
        kind = 'shard';
        w = r.range(4, 10);
        h = r.range(4, 10);
        height = 6;
      } else if (band === 'dimmark') {
        kind = r.chance(0.5) ? 'rock' : 'ruin';
      }
      const rect: Rect = { x, y, w, h, angle: r.range(0, Math.PI), kind, height };
      if (kind === 'vent') {
        this.decor.push({ x, y, kind: 'vent', s: w, a: 0 });
        continue;
      }
      this.rects.push(rect);
      this.stampRect(rect, kind === 'mesa' ? COVER.Cliff : COVER.Building);
      if (kind === 'mesa') this.raise(rect, 18);
    }
  }

  private genFields(): void {
    if (this.band !== 'gloaming' || this.steppe) return;
    const r = this.rng;
    const count = 3 + r.int(4);
    for (let k = 0; k < count; k++) {
      const f = {
        x: r.range(100, this.width - 200),
        y: r.range(this.height * 0.25, this.height * 0.7),
        w: r.range(80, 180),
        h: r.range(60, 140),
        angle: r.range(-0.3, 0.3),
      };
      this.fields.push(f);
      for (let y = f.y; y < f.y + f.h; y += this.cell) {
        for (let x = f.x; x < f.x + f.w; x += this.cell) {
          if (!this.inBounds(x, y)) continue;
          const i = this.idx(x, y);
          if (this.cover[i] === COVER.None) {
            this.cover[i] = COVER.Field;
            this.flammable[i] = 1;
          }
        }
      }
    }
  }

  private genDecor(): void {
    const r = this.rng;
    const band = this.band;
    const n = 260;
    for (let k = 0; k < n; k++) {
      const x = r.range(0, this.width);
      const y = r.range(0, this.height);
      let kind = 'tuft';
      if (band === 'evernight') kind = r.chance(0.35) ? 'fungus' : r.chance(0.5) ? 'snow' : 'crystal';
      else if (band === 'dimmark') kind = r.chance(0.5) ? 'fungus' : 'tuft';
      else if (band === 'glare') kind = r.chance(0.6) ? 'glass' : 'ripple';
      else if (band === 'longAfternoon') kind = r.chance(0.5) ? 'salt' : 'scrub';
      else if (this.steppe) kind = r.chance(0.5) ? 'grass' : 'stone';
      this.decor.push({ x, y, kind, s: r.range(0.6, 1.6), a: r.range(0, 6.28) });
    }
    // Grass and scrub burn on bright and dusk maps.
    if (band === 'gloaming' || band === 'longAfternoon' || this.steppe) {
      for (let i = 0; i < this.cover.length; i++) {
        if (this.cover[i] === COVER.None && (i * 2654435761) % 7 < 2) this.flammable[i] = 1;
      }
    }
  }

  private genFort(): void {
    const f = this.fort!;
    const cx = this.width / 2;
    const cy = this.height / 2;
    const sides = 10;
    const pts: { x: number; y: number }[] = [];
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2 + Math.PI / sides;
      pts.push({ x: cx + dcos(a) * f.radius, y: cy + dsin(a) * f.radius });
    }
    for (let k = 0; k < sides; k++) {
      const a = pts[k]!;
      const b = pts[(k + 1) % sides]!;
      const gate = k === 2 || k === 7 || k === 4 || k === 9;
      this.walls.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, hp: gate ? 2600 : 6000, maxHp: gate ? 2600 : 6000, gate, tower: false, broken: false });
    }
    for (const p of pts) {
      this.walls.push({ x1: p.x, y1: p.y, x2: p.x, y2: p.y, hp: 5000, maxHp: 5000, gate: false, tower: true, broken: false });
    }
    this.capturePoint = { x: cx, y: cy, r: 28 };
    this.stampWalls();
    // Flatten the town and add houses.
    for (let cy2 = 0; cy2 < this.rows; cy2++) {
      for (let cx2 = 0; cx2 < this.cols; cx2++) {
        const x = (cx2 + 0.5) * this.cell;
        const y = (cy2 + 0.5) * this.cell;
        const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
        if (d < f.radius + 30) {
          const i = cy2 * this.cols + cx2;
          const t = clamp((d - f.radius) / 30, 0, 1);
          this.heights[i] = this.heights[i]! * t + 4 * (1 - t);
        }
      }
    }
    const r = this.rng;
    for (let k = 0; k < 14; k++) {
      const a = r.range(0, Math.PI * 2);
      const d = r.range(60, f.radius - 40);
      const rect: Rect = { x: cx + dcos(a) * d, y: cy + dsin(a) * d, w: r.range(10, 16), h: r.range(8, 12), angle: a, kind: 'house', height: 8 };
      this.rects.push(rect);
      this.stampRect(rect, COVER.Building);
    }
  }

  /** Re-stamp wall cells from wall segment state (broken walls open up). */
  stampWalls(): void {
    for (let i = 0; i < this.cover.length; i++) {
      if (this.cover[i] === COVER.Wall || this.cover[i] === COVER.Gate) this.cover[i] = COVER.None;
    }
    for (const w of this.walls) {
      if (w.broken || w.tower) continue;
      const len = Math.sqrt((w.x2 - w.x1) * (w.x2 - w.x1) + (w.y2 - w.y1) * (w.y2 - w.y1));
      const steps = Math.ceil(len / 2);
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = w.x1 + (w.x2 - w.x1) * t;
        const y = w.y1 + (w.y2 - w.y1) * t;
        for (let oy = -3; oy <= 3; oy += 2) {
          for (let ox = -3; ox <= 3; ox += 2) {
            if (!this.inBounds(x + ox, y + oy)) continue;
            this.cover[this.idx(x + ox, y + oy)] = w.gate ? COVER.Gate : COVER.Wall;
          }
        }
      }
    }
  }

  private stampRect(rect: Rect, cover: Cover): void {
    const ca = dcos(rect.angle);
    const sa = dsin(rect.angle);
    const ext = Math.max(rect.w, rect.h);
    for (let y = rect.y - ext; y <= rect.y + ext; y += this.cell / 2) {
      for (let x = rect.x - ext; x <= rect.x + ext; x += this.cell / 2) {
        const dx = x - rect.x;
        const dy = y - rect.y;
        const u = dx * ca + dy * sa;
        const w = -dx * sa + dy * ca;
        if (Math.abs(u) <= rect.w / 2 && Math.abs(w) <= rect.h / 2 && this.inBounds(x, y)) {
          this.cover[this.idx(x, y)] = cover;
        }
      }
    }
  }

  private raise(rect: Rect, amount: number): void {
    const ca = dcos(rect.angle);
    const sa = dsin(rect.angle);
    const ext = Math.max(rect.w, rect.h);
    for (let y = rect.y - ext; y <= rect.y + ext; y += this.cell) {
      for (let x = rect.x - ext; x <= rect.x + ext; x += this.cell) {
        const dx = x - rect.x;
        const dy = y - rect.y;
        const u = dx * ca + dy * sa;
        const w = -dx * sa + dy * ca;
        if (Math.abs(u) <= rect.w / 2 && Math.abs(w) <= rect.h / 2 && this.inBounds(x, y)) {
          const i = this.idx(x, y);
          this.heights[i] = this.heights[i]! + amount;
        }
      }
    }
  }

  private clearDeployZones(): void {
    // Keep deployment zones passable and free of deep water or buildings.
    for (const side of [0, 1] as const) {
      if (this.fort && side === this.fort.defender) continue;
      const z = this.deployZone(side);
      for (let y = z.y; y < z.y + z.h; y += this.cell) {
        for (let x = z.x - 60; x < z.x + z.w + 60; x += this.cell) {
          if (!this.inBounds(x, y)) continue;
          const i = this.idx(x, y);
          const c = this.cover[i];
          if (c === COVER.Building || c === COVER.Cliff) this.cover[i] = COVER.None;
          else if (c === COVER.Deep) this.cover[i] = COVER.Shallow;
        }
      }
    }
    // Remove rect records that were fully inside a deployment zone.
    for (let k = this.rects.length - 1; k >= 0; k--) {
      const rc = this.rects[k]!;
      for (const side of [0, 1] as const) {
        if (this.fort && side === this.fort.defender) continue;
        const z = this.deployZone(side);
        if (rc.x > z.x - 60 && rc.x < z.x + z.w + 60 && rc.y > z.y && rc.y < z.y + z.h) {
          this.rects.splice(k, 1);
          break;
        }
      }
    }
  }

  private bakeShadows(): void {
    const elev = LIGHT_RULES[this.light].sunElevation;
    // Shadows exist only in Bright and Dusk light.
    if (elev === null || this.light === 4) return;
    const tanE = dsin(elev * DEG) / dcos(elev * DEG);
    const sx = dcos(this.sunBearing);
    const sy = dsin(this.sunBearing);
    const maxLen = Math.min(220, 45 / tanE);
    const step = this.cell;
    for (let cy = 0; cy < this.rows; cy++) {
      for (let cx = 0; cx < this.cols; cx++) {
        const i = cy * this.cols + cx;
        const x = (cx + 0.5) * this.cell;
        const y = (cy + 0.5) * this.cell;
        const h0 = this.heights[i]! + (this.cover[i] === COVER.Forest ? 1 : 0);
        for (let d = step; d <= maxLen; d += step) {
          const px = x + sx * d;
          const py = y + sy * d;
          if (!this.inBounds(px, py)) break;
          const j = this.idx(px, py);
          const top = this.heights[j]! + this.obstacleHeight(j);
          if (top - h0 > d * tanE) {
            this.shadow[i] = 1;
            break;
          }
        }
      }
    }
  }
}

function gauss(q: number): number {
  // exp(-q) via a rational approximation; deterministic and smooth.
  const t = 1 + q / 8;
  const t2 = t * t;
  const t4 = t2 * t2;
  return 1 / (t4 * t4);
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const l2 = abx * abx + aby * aby;
  let t = l2 > 0 ? ((px - ax) * abx + (py - ay) * aby) / l2 : 0;
  t = clamp(t, 0, 1);
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  return Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
}
