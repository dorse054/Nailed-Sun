/**
 * Draws the campaign map and answers what is under the pointer: regions
 * with their owners, settlements, landmarks, herds, moorings and army
 * banners, plus the selected army's reach and planned march.
 */
import type { Owner, CampaignState, ArmyState } from '../../campaign/types';
import { MAP_H, MAP_W, REGIONS, REGION_BY_ID, regionDef } from '../../campaign/regions';
import { SHAPES, regionAt } from '../../campaign/geometry';
import { bandIndex, wallLevel } from '../../campaign/rules';
import { hostileArmiesIn, hostileSettlement } from '../../campaign/actions';
import { unitDef } from '../../data/index';
import { BASE_SCALE, bakeBase } from './mapArt';

/** Map colors, from each faction's palette: Choir gold, Hush teal, Vesperate violet, Drift sail-orange. */
export const OWNER_COLOR: Record<Owner, string> = {
  choir: '#ffe08a',
  hush: '#4ff0e0',
  vesperate: '#b48be0',
  drift: '#ff9d1c',
  free: '#a39e94',
};

type P = [number, number];

export interface MapView {
  selectedArmy: string | null;
  selectedRegion: string | null;
  hover: string | null;
  hoverArmy: string | null;
  reach: Record<string, number> | null;
  path: string[] | null;
  visibleArmies: Set<string>;
  visibleRegions: Set<string>;
  player: Owner;
}

export class CampaignMap {
  x = MAP_W / 2;
  y = MAP_H / 2;
  zoom = 1;
  W = 800;
  H = 600;
  private dpr = 1;
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement | null = null;
  private baseKey = '';
  private positions = new Map<string, P>();

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  resize(w: number, h: number, dpr: number): void {
    this.W = w;
    this.H = h;
    this.dpr = dpr;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
  }

  fitZoom(): number {
    return Math.min(this.W / MAP_W, this.H / MAP_H) * 0.98;
  }

  fit(): void {
    this.zoom = this.fitZoom();
    this.x = MAP_W / 2;
    this.y = MAP_H / 2;
  }

  centerOn(x: number, y: number, zoom?: number): void {
    this.x = x;
    this.y = y;
    if (zoom) this.zoom = zoom;
    this.clamp();
  }

  clamp(): void {
    const minZ = this.fitZoom() * 0.9;
    this.zoom = Math.max(minZ, Math.min(minZ * 5, this.zoom));
    const hw = this.W / 2 / this.zoom;
    const hh = this.H / 2 / this.zoom;
    this.x = hw * 2 >= MAP_W ? MAP_W / 2 : Math.max(hw, Math.min(MAP_W - hw, this.x));
    this.y = hh * 2 >= MAP_H ? MAP_H / 2 : Math.max(hh, Math.min(MAP_H - hh, this.y));
  }

  toMap(sx: number, sy: number): P {
    return [(sx - this.W / 2) / this.zoom + this.x, (sy - this.H / 2) / this.zoom + this.y];
  }

  toScreen(x: number, y: number): P {
    return [(x - this.x) * this.zoom + this.W / 2, (y - this.y) * this.zoom + this.H / 2];
  }

  /** Banner spots: armies stand beside their region's settlement. */
  layoutArmies(s: CampaignState): void {
    this.positions.clear();
    const by = new Map<string, ArmyState[]>();
    for (const a of s.armies) {
      const l = by.get(a.region) ?? [];
      l.push(a);
      by.set(a.region, l);
    }
    for (const [region, list] of by) {
      const r = REGION_BY_ID[region]!;
      const sh = SHAPES[region]!;
      // Between the settlement and the region's middle, fanned out.
      const bx = r.settlement ? r.x + (sh.cx - r.x) * 0.45 + 22 : sh.cx;
      const byy = r.settlement ? r.y + (sh.cy - r.y) * 0.45 - 6 : sh.cy;
      list.forEach((a, i) => {
        const ang = -0.6 + i * 0.9;
        const d = i === 0 ? 0 : 26;
        this.positions.set(a.id, [bx + Math.cos(ang) * d, byy + Math.sin(ang) * d]);
      });
    }
  }

  armyAt(id: string): P | null {
    return this.positions.get(id) ?? null;
  }

  pick(s: CampaignState, view: MapView, sx: number, sy: number): { army: string | null; region: string | null } {
    const [mx, my] = this.toMap(sx, sy);
    let army: string | null = null;
    let bd = (16 / this.zoom) ** 2 + 60;
    for (const a of s.armies) {
      if (!view.visibleArmies.has(a.id)) continue;
      const p = this.positions.get(a.id);
      if (!p) continue;
      const d = (p[0] - mx) ** 2 + (p[1] - 10 - my) ** 2;
      if (d < bd) {
        bd = d;
        army = a.id;
      }
    }
    const inMap = mx >= 0 && my >= 0 && mx <= MAP_W && my <= MAP_H;
    return { army, region: inMap ? regionAt(mx, my) : null };
  }

  render(s: CampaignState, view: MapView, t: number): void {
    const ctx = this.ctx;
    const key = `${s.tilt}:${REGIONS.map((r) => s.regions[r.id]!.nightfall ?? 0).join('')}`;
    if (!this.base || key !== this.baseKey) {
      this.base = bakeBase(s);
      this.baseKey = key;
    }
    this.layoutArmies(s);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#07060d';
    ctx.fillRect(0, 0, this.W, this.H);
    const z = this.zoom;
    ctx.setTransform(this.dpr * z, 0, 0, this.dpr * z, this.dpr * (this.W / 2 - this.x * z), this.dpr * (this.H / 2 - this.y * z));
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.base, 0, 0, MAP_W * BASE_SCALE, MAP_H * BASE_SCALE, 0, 0, MAP_W, MAP_H);

    // Owners.
    for (const r of REGIONS) {
      const st = s.regions[r.id]!;
      const shape = SHAPES[r.id]!;
      if (st.owner !== 'free' || r.settlement) {
        poly(ctx, shape.poly);
        ctx.fillStyle = hexA(OWNER_COLOR[st.owner], st.owner === 'free' ? 0.07 : 0.26);
        ctx.fill();
      }
    }
    // Reach and targets.
    if (view.reach && view.selectedArmy) {
      const a = s.armies.find((x) => x.id === view.selectedArmy);
      for (const id in view.reach) {
        const shape = SHAPES[id]!;
        const hostile = a && (hostileArmiesIn(s, id, a.faction).length > 0 || hostileSettlement(s, id, a.faction));
        poly(ctx, shape.poly);
        ctx.fillStyle = hostile ? 'rgba(255,80,60,0.22)' : 'rgba(255,255,255,0.14)';
        ctx.fill();
      }
    }
    // Borders: thin between all regions, bright along owned frontiers.
    ctx.lineJoin = 'round';
    for (const r of REGIONS) {
      const shape = SHAPES[r.id]!;
      const st = s.regions[r.id]!;
      for (const e of shape.edges) {
        if (!e.to) continue;
        const other = s.regions[e.to]!;
        const frontier = other.owner !== st.owner;
        if (!frontier) {
          if (r.id > e.to) continue;
          line(ctx, e.pts);
          ctx.strokeStyle = 'rgba(10,8,20,0.35)';
          ctx.lineWidth = 0.9;
          ctx.stroke();
          continue;
        }
        if (st.owner === 'free') continue;
        // Inset colored border on the owner's side.
        line(ctx, e.pts);
        ctx.strokeStyle = 'rgba(10,8,20,0.7)';
        ctx.lineWidth = 2.6;
        ctx.stroke();
        line(ctx, e.pts);
        ctx.strokeStyle = OWNER_COLOR[st.owner];
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    // Hover and selection.
    const outline = (id: string, color: string, w: number) => {
      poly(ctx, SHAPES[id]!.poly);
      ctx.strokeStyle = color;
      ctx.lineWidth = w / z;
      ctx.stroke();
    };
    if (view.hover && view.hover !== view.selectedRegion) outline(view.hover, 'rgba(255,255,255,0.55)', 1.6);
    if (view.selectedRegion) outline(view.selectedRegion, '#ffe9a8', 2.4);

    // Planned march.
    if (view.path && view.path.length > 1) {
      ctx.save();
      ctx.setLineDash([6 / z, 5 / z]);
      ctx.lineDashOffset = -t * 20;
      ctx.strokeStyle = '#ffe9a8';
      ctx.lineWidth = 2.2 / z;
      ctx.beginPath();
      view.path.forEach((id, i) => {
        const p = i === 0 && view.selectedArmy ? this.positions.get(view.selectedArmy) ?? site(id) : site(id);
        if (i === 0) ctx.moveTo(p[0], p[1]);
        else ctx.lineTo(p[0], p[1]);
      });
      ctx.stroke();
      ctx.restore();
      const end = site(view.path[view.path.length - 1]!);
      ctx.fillStyle = '#ffe9a8';
      ctx.beginPath();
      ctx.arc(end[0], end[1], 4 / z, 0, Math.PI * 2);
      ctx.fill();
    }

    // Herds of the Long Hunt.
    for (const h of s.factions.hush.herds) {
      if (!view.visibleRegions.has(h.region) && view.player !== 'hush') continue;
      const sh = SHAPES[h.region]!;
      const x = sh.cx - 30;
      const y = sh.cy + 22;
      for (let k = 0; k < Math.min(6, h.size); k++) {
        const hx = x + (k % 3) * 7;
        const hy = y + Math.floor(k / 3) * 6;
        ctx.fillStyle = 'rgba(235,230,255,0.85)';
        ctx.beginPath();
        ctx.ellipse(hx, hy, 2.6, 1.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(235,230,255,0.85)';
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(hx + 2, hy - 1);
        ctx.lineTo(hx + 3.5, hy - 4);
        ctx.moveTo(hx + 2, hy - 1);
        ctx.lineTo(hx + 1, hy - 4);
        ctx.stroke();
      }
    }

    // Settlements and landmarks.
    for (const r of REGIONS) this.drawSettlement(s, r.id, t);

    // Army banners.
    for (const a of s.armies) {
      if (!view.visibleArmies.has(a.id)) continue;
      const p = this.positions.get(a.id);
      if (!p) continue;
      this.drawBanner(a, p, a.id === view.selectedArmy, a.id === view.hoverArmy, t, view);
    }

    // Labels on top, in screen space so they stay crisp.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const showRegion = z > this.fitZoom() * 1.35;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const r of REGIONS) {
      const st = s.regions[r.id]!;
      if (r.settlement) {
        const [sx, sy] = this.toScreen(r.x, r.y + 14);
        const size = Math.max(10, Math.min(15, 9 + z * 3.5));
        ctx.font = `600 ${size}px "Alegreya Sans SC", "Alegreya Sans", sans-serif`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(8,6,14,0.85)';
        ctx.strokeText(r.settlement, sx, sy + 4);
        ctx.fillStyle = st.owner === 'free' ? '#e8e2d4' : OWNER_COLOR[st.owner];
        ctx.fillText(r.settlement, sx, sy + 4);
      }
      if (showRegion || !r.settlement) {
        const sh = SHAPES[r.id]!;
        const [sx, sy] = this.toScreen(sh.cx, sh.cy - 26);
        ctx.font = `italic ${Math.max(10, Math.min(14, 8 + z * 3))}px "Cormorant SC", Georgia, serif`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(8,6,14,0.6)';
        ctx.strokeText(r.name, sx, sy);
        ctx.fillStyle = 'rgba(245,238,221,0.8)';
        ctx.fillText(r.name, sx, sy);
      }
    }
    void bandIndex;
  }

  private drawSettlement(s: CampaignState, id: string, t: number): void {
    const ctx = this.ctx;
    const r = regionDef(id);
    const st = s.regions[id]!;
    const x = r.x;
    const y = r.y;
    // Landmarks first, behind the town.
    if (r.landmark === 'candle') {
      ctx.fillStyle = '#2b2436';
      ctx.beginPath();
      ctx.moveTo(x - 20, y + 2);
      ctx.lineTo(x - 4, y - 30);
      ctx.lineTo(x + 2, y - 26);
      ctx.lineTo(x + 20, y + 2);
      ctx.closePath();
      ctx.fill();
      if (st.lit) {
        const flick = 1 + Math.sin(t * 5 + x) * 0.08;
        const g = ctx.createRadialGradient(x - 3, y - 30, 0, x - 3, y - 30, 22 * flick);
        g.addColorStop(0, 'rgba(255,240,170,0.95)');
        g.addColorStop(0.3, 'rgba(255,200,90,0.5)');
        g.addColorStop(1, 'rgba(255,200,90,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - 30, y - 56, 54, 52);
        ctx.fillStyle = '#ffe9a0';
        ctx.beginPath();
        ctx.moveTo(x - 6, y - 26);
        ctx.lineTo(x - 3, y - 36 * flick);
        ctx.lineTo(x, y - 26);
        ctx.fill();
      } else {
        ctx.fillStyle = 'rgba(120,110,140,0.5)';
        for (let k = 0; k < 3; k++) {
          ctx.beginPath();
          ctx.arc(x - 3 + Math.sin(t + k) * 2, y - 34 - k * 6, 3 + k, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (r.landmark === 'nailSpire') {
      const g = ctx.createRadialGradient(x, y - 40, 0, x, y - 40, 40);
      g.addColorStop(0, 'rgba(255,255,230,0.95)');
      g.addColorStop(1, 'rgba(255,255,230,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 40, y - 80, 80, 80);
      ctx.fillStyle = '#3a3226';
      ctx.beginPath();
      ctx.moveTo(x - 4, y);
      ctx.lineTo(x, y - 52);
      ctx.lineTo(x + 4, y);
      ctx.closePath();
      ctx.fill();
    } else if (r.landmark === 'pole') {
      ctx.save();
      ctx.translate(x, y - 20);
      ctx.rotate(t * 0.05);
      ctx.fillStyle = 'rgba(146,116,255,0.35)';
      star(ctx, 0, 0, 22, 7, 8);
      ctx.fill();
      ctx.fillStyle = '#05040c';
      star(ctx, 0, 0, 13, 5, 8);
      ctx.fill();
      ctx.restore();
    } else if (r.landmark === 'stoppedDial') {
      ctx.strokeStyle = 'rgba(255,230,170,0.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(x, y - 22, 16, 7, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y - 22);
      ctx.lineTo(x - 7, y - 36);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(40,20,10,0.6)';
      ctx.beginPath();
      ctx.moveTo(x, y - 22);
      ctx.lineTo(x - 2, y - 13);
      ctx.stroke();
    } else if (r.landmark === 'kiteFields') {
      for (let k = 0; k < 5; k++) {
        const kx = x - 30 + k * 15 + Math.sin(t * 1.3 + k) * 3;
        const ky = y - 20 - (k % 2) * 12 + Math.cos(t * 1.1 + k) * 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(kx, ky);
        ctx.lineTo(kx - 6, ky + 26);
        ctx.stroke();
        ctx.fillStyle = ['#3cc8d2', '#f4c44e', '#e0503f', '#ffffff', '#9fd8a0'][k]!;
        ctx.beginPath();
        ctx.moveTo(kx, ky - 6);
        ctx.lineTo(kx + 4, ky);
        ctx.lineTo(kx, ky + 5);
        ctx.lineTo(kx - 4, ky);
        ctx.closePath();
        ctx.fill();
      }
    } else if (r.landmark === 'mistfalls') {
      ctx.lineWidth = 2;
      ['rgba(255,80,80,0.5)', 'rgba(255,200,80,0.5)', 'rgba(120,220,120,0.5)', 'rgba(90,150,255,0.5)'].forEach((c, k) => {
        ctx.strokeStyle = c;
        ctx.beginPath();
        ctx.arc(x + 10, y + 8, 26 - k * 2.5, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
      });
    }
    if (!r.settlement) return;
    const owner = st.owner;
    const col = OWNER_COLOR[owner];
    const size = (r.major ? 7 : 5) + st.level * 1.4;
    const walls = wallLevel(s, id);
    // Walls ring.
    if (walls > 0) {
      ctx.strokeStyle = 'rgba(20,16,26,0.9)';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.arc(x, y, size + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = walls >= 2 ? '#e8dcc0' : '#b8ad98';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    // The town: a disc with towers.
    ctx.fillStyle = 'rgba(12,10,18,0.9)';
    ctx.beginPath();
    ctx.arc(x, y, size + 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(20,14,24,0.85)';
    const towers = r.major ? 3 : 2;
    for (let k = 0; k < towers; k++) {
      const tx = x - size * 0.45 + (k * size * 0.9) / Math.max(1, towers - 1);
      const th = size * (0.8 + (k === 1 ? 0.35 : 0));
      ctx.fillRect(tx - size * 0.13, y - th * 0.5, size * 0.26, th);
      ctx.beginPath();
      ctx.moveTo(tx - size * 0.2, y - th * 0.5);
      ctx.lineTo(tx, y - th * 0.5 - size * 0.3);
      ctx.lineTo(tx + size * 0.2, y - th * 0.5);
      ctx.fill();
    }
    // Mooring anchor for the Drift.
    if (st.mooring) {
      ctx.strokeStyle = OWNER_COLOR.drift;
      ctx.lineWidth = 1.4;
      const ax = x + size + 6;
      const ay = y - 2;
      ctx.beginPath();
      ctx.moveTo(ax, ay - 5);
      ctx.lineTo(ax, ay + 4);
      ctx.moveTo(ax - 4, ay + 1);
      ctx.quadraticCurveTo(ax, ay + 7, ax + 4, ay + 1);
      ctx.moveTo(ax - 2.5, ay - 3);
      ctx.lineTo(ax + 2.5, ay - 3);
      ctx.stroke();
    }
    if (st.raidedBy) {
      ctx.fillStyle = 'rgba(255,120,40,0.8)';
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.arc(x - size + k * size, y - size - 3 - Math.abs(Math.sin(t * 3 + k)) * 3, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawBanner(a: ArmyState, p: P, selected: boolean, hover: boolean, t: number, view: MapView): void {
    const ctx = this.ctx;
    const col = OWNER_COLOR[a.faction];
    const [x, y] = p;
    const faded = a.shadowed ? 0.55 : 1;
    ctx.globalAlpha = faded;
    // Shadow and pole.
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(x + 3, y + 1, 7, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1a1420';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - 26);
    ctx.stroke();
    // Flag, waving.
    const wave = Math.sin(t * 3 + x * 0.1) * 1.5;
    ctx.fillStyle = col;
    ctx.strokeStyle = '#1a1420';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y - 26);
    ctx.quadraticCurveTo(x + 9, y - 27 + wave, x + 18, y - 25);
    ctx.lineTo(x + 18, y - 13);
    ctx.quadraticCurveTo(x + 9, y - 15 + wave, x, y - 13);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Strength pips: units in the army.
    ctx.fillStyle = '#1a1420';
    ctx.font = '700 8px "Alegreya Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(a.units.length), x + 9, y - 19.5 + wave * 0.5);
    if (a.lord.legendary) {
      ctx.fillStyle = '#fff4c4';
      star(ctx, x, y - 29, 3.2, 1.4, 5);
      ctx.fill();
    }
    if (a.units.some((u) => unitDef(u.def).category === 'colossus')) {
      ctx.strokeStyle = '#fff4c4';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x + 9, y - 19.5, 8, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (a.stance === 'raid') {
      ctx.fillStyle = 'rgba(255,120,40,0.9)';
      ctx.beginPath();
      ctx.arc(x - 5, y - 4, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    if (selected || hover) {
      ctx.strokeStyle = selected ? '#ffe9a8' : 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(x + 3, y, 12 + (selected ? Math.sin(t * 4) : 0), 5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Moves left, for the player's own armies.
    if (a.faction === view.player && a.moves > 0) {
      ctx.fillStyle = 'rgba(12,10,18,0.8)';
      ctx.fillRect(x - 2, y + 4, 22, 3);
      ctx.fillStyle = '#9fe0a0';
      ctx.fillRect(x - 2, y + 4, (22 * Math.min(1, a.moves / 100)) | 0, 3);
    }
    ctx.globalAlpha = 1;
  }
}

function site(id: string): P {
  const r = REGION_BY_ID[id]!;
  if (r.settlement) return [r.x, r.y];
  const sh = SHAPES[id]!;
  return [sh.cx, sh.cy];
}

function poly(ctx: CanvasRenderingContext2D, pts: P[]): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.closePath();
}

function line(ctx: CanvasRenderingContext2D, pts: P[]): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, R: number, r: number, n: number): void {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
    const rad = i % 2 ? r : R;
    const px = x + Math.cos(a) * rad;
    const py = y + Math.sin(a) * rad;
    if (i) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  }
  ctx.closePath();
}

function hexA(c: string, a: number): string {
  const h = c.replace('#', '');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
