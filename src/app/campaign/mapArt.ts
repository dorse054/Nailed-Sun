/**
 * The campaign map's painted base: every region filled with its band's
 * ground, textured, with the Gale Roads' wind streaks, rivers flowing from
 * the night's ice toward the day, the frozen Rime Sea and the sun's glare
 * along the southern edge. Baked once per Tilt.
 */
import { BANDS } from '../../data/rules';
import { BAND_IDS } from '../../data/schema';
import { hex, css, mix, hash2, vnoise } from '../../render/color';
import type { CampaignState } from '../../campaign/types';
import { MAP_H, MAP_W, REGIONS, regionDef } from '../../campaign/regions';
import { SHAPES } from '../../campaign/geometry';
import { bandIndex } from '../../campaign/rules';

export const BASE_SCALE = 1.25;

type P = [number, number];

/** Rivers from the ice to the boiling south. */
export const RIVERS: P[][] = [
  [
    [880, 40],
    [870, 170],
    [845, 300],
    [835, 420],
    [860, 520],
    [960, 560],
    [1060, 590],
    [1120, 680],
    [1150, 790],
  ],
  [
    [1560, 250],
    [1530, 380],
    [1500, 480],
    [1495, 590],
    [1470, 660],
  ],
  [
    [620, 250],
    [600, 380],
    [560, 470],
    [585, 560],
    [640, 690],
  ],
];

function bandColors(i: number): { a: string; b: string; shadow: string; accent: string } {
  const c = BANDS[BAND_IDS[i]!].colors;
  return { a: c.ground, b: c.ground2, shadow: c.shadow, accent: c.accent };
}

function path(ctx: CanvasRenderingContext2D, poly: P[]): void {
  ctx.beginPath();
  poly.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.closePath();
}

export function smoothPath(ctx: CanvasRenderingContext2D, pts: P[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]!;
    const q = pts[i + 1]!;
    ctx.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
  }
  const last = pts[pts.length - 1]!;
  ctx.lineTo(last[0], last[1]);
}

let noiseTile: HTMLCanvasElement | null = null;

function noise(): HTMLCanvasElement {
  if (noiseTile) return noiseTile;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(256, 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const n = vnoise(x / 18, y / 18) * 0.6 + vnoise(x / 5, y / 5) * 0.3 + hash2(x, y) * 0.1;
      const v = Math.round(n * 255);
      const i = (y * 256 + x) * 4;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  noiseTile = c;
  return c;
}

/** Bakes the base map for the current Tilt and Nightfalls. */
export function bakeBase(s: CampaignState): HTMLCanvasElement {
  const W = Math.round(MAP_W * BASE_SCALE);
  const H = Math.round(MAP_H * BASE_SCALE);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.scale(BASE_SCALE, BASE_SCALE);

  // Region grounds: each region wears its band, shaded toward its neighbors'.
  for (const r of REGIONS) {
    const shape = SHAPES[r.id]!;
    const bi = bandIndex(s, r.id);
    const col = bandColors(bi);
    const minY = Math.min(...shape.poly.map((p) => p[1]));
    const maxY = Math.max(...shape.poly.map((p) => p[1]));
    const g = ctx.createLinearGradient(0, minY, 0, maxY);
    g.addColorStop(0, css(mix(hex(col.a), hex('#000000'), 0.08)));
    g.addColorStop(1, col.b);
    path(ctx, shape.poly);
    ctx.fillStyle = g;
    ctx.fill();
  }

  // Texture.
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.globalCompositeOperation = 'overlay';
  const pat = ctx.createPattern(noise(), 'repeat');
  if (pat) {
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, MAP_W, MAP_H);
  }
  ctx.restore();

  // Per-band decoration.
  for (const r of REGIONS) {
    const shape = SHAPES[r.id]!;
    const bi = bandIndex(s, r.id);
    ctx.save();
    path(ctx, shape.poly);
    ctx.clip();
    decorate(ctx, r.id, bi, shape.cx, shape.cy);
    ctx.restore();
  }

  // The frozen Rime Sea along the northern shore.
  ctx.save();
  const ice = ctx.createLinearGradient(0, 0, 0, 60);
  ice.addColorStop(0, 'rgba(200,235,255,0.55)');
  ice.addColorStop(1, 'rgba(200,235,255,0)');
  ctx.fillStyle = ice;
  ctx.beginPath();
  ctx.moveTo(660, 0);
  ctx.bezierCurveTo(720, 40, 1000, 55, 1150, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(230,248,255,0.35)';
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 14; i++) {
    const x = 700 + hash2(i, 3) * 420;
    const y = 4 + hash2(i, 7) * 26;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 12 + hash2(i, 9) * 20, y + (hash2(i, 11) - 0.5) * 8);
    ctx.stroke();
  }
  ctx.restore();

  // Rivers: blue in the dark, white steam where the day boils them away.
  for (const rv of RIVERS) {
    const top = rv[0]![1];
    const bottom = rv[rv.length - 1]![1];
    const g = ctx.createLinearGradient(0, top, 0, bottom);
    g.addColorStop(0, 'rgba(150,200,240,0.9)');
    g.addColorStop(0.7, 'rgba(90,150,200,0.85)');
    g.addColorStop(1, 'rgba(255,255,255,0.2)');
    ctx.strokeStyle = 'rgba(20,20,40,0.35)';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    smoothPath(ctx, rv);
    ctx.stroke();
    ctx.strokeStyle = g;
    ctx.lineWidth = 3.4;
    smoothPath(ctx, rv);
    ctx.stroke();
    // Steam.
    const end = rv[rv.length - 1]!;
    for (let k = 0; k < 6; k++) {
      ctx.fillStyle = `rgba(255,255,255,${0.12 - k * 0.015})`;
      ctx.beginPath();
      ctx.arc(end[0] + (hash2(k, 2) - 0.5) * 16, end[1] + k * 5, 6 + k * 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Gale Roads: long wind streaks running down the west.
  ctx.save();
  for (const r of REGIONS) {
    if (!r.galeRoad) continue;
    const shape = SHAPES[r.id]!;
    ctx.save();
    path(ctx, shape.poly);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1.1;
    for (let i = 0; i < 26; i++) {
      const x = shape.cx - 120 + hash2(i, r.x) * 240;
      const y = shape.cy - 110 + hash2(r.y, i) * 220;
      ctx.beginPath();
      ctx.moveTo(x, y);
      // The wind always blows sunward: south.
      ctx.quadraticCurveTo(x + 6, y + 14, x + 2, y + 30 + hash2(i, 5) * 20);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();

  // Night at the top, the stopped sun's glare along the bottom.
  const night = ctx.createLinearGradient(0, 0, 0, 180);
  night.addColorStop(0, 'rgba(5,6,20,0.55)');
  night.addColorStop(1, 'rgba(5,6,20,0)');
  ctx.fillStyle = night;
  ctx.fillRect(0, 0, MAP_W, 180);
  const day = ctx.createLinearGradient(0, MAP_H - 170, 0, MAP_H);
  day.addColorStop(0, 'rgba(255,255,240,0)');
  day.addColorStop(1, 'rgba(255,255,235,0.55)');
  ctx.fillStyle = day;
  ctx.fillRect(0, MAP_H - 170, MAP_W, 170);
  // Stars over the Evernight.
  for (let i = 0; i < 160; i++) {
    const x = hash2(i, 1) * MAP_W;
    const y = hash2(i, 2) * 170;
    const b = bandIndex(s, nearestRegion(x, y));
    if (b > 0) continue;
    ctx.fillStyle = `rgba(255,255,255,${0.25 + hash2(i, 4) * 0.5})`;
    ctx.fillRect(x, y, 1.1, 1.1);
  }
  // Aurora over the Pole.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 3; k++) {
    const g = ctx.createLinearGradient(0, 0, 0, 120);
    g.addColorStop(0, 'rgba(80,255,200,0)');
    g.addColorStop(0.5, `rgba(80,255,200,${0.06 + k * 0.02})`);
    g.addColorStop(1, 'rgba(120,120,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(900 + k * 120, 0);
    ctx.bezierCurveTo(1000 + k * 100, 60, 1250 + k * 60, 20, 1600, 70 + k * 20);
    ctx.lineTo(1600, 0);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  return c;
}

function nearestRegion(x: number, y: number): string {
  let best = REGIONS[0]!.id;
  let bd = Infinity;
  for (const r of REGIONS) {
    const d = (r.x - x) * (r.x - x) + (r.y - y) * (r.y - y);
    if (d < bd) {
      bd = d;
      best = r.id;
    }
  }
  return best;
}

function decorate(ctx: CanvasRenderingContext2D, id: string, band: number, cx: number, cy: number): void {
  const r = regionDef(id);
  const seed = r.x * 7 + r.y * 13;
  const rnd = (i: number, k: number) => hash2(seed + i * 31, k * 17 + 3);
  const col = bandColors(band);
  const dark = css(mix(hex(col.a), hex('#000000'), 0.35), 0.5);
  const light = css(mix(hex(col.b), hex('#ffffff'), 0.25), 0.45);
  const wooded = r.preset === 'wooded' || r.landmark === 'leaningWood';
  const hilly = r.preset === 'hilly';
  // Hills: soft lumps with a lit sunward (south) face.
  if (hilly || band >= 3) {
    for (let i = 0; i < (hilly ? 14 : 6); i++) {
      const x = cx + (rnd(i, 1) - 0.5) * 220;
      const y = cy + (rnd(i, 2) - 0.5) * 180;
      const w = 14 + rnd(i, 3) * 22;
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.ellipse(x, y - 2, w, w * 0.45, 0, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = light;
      ctx.beginPath();
      ctx.ellipse(x, y, w * 0.9, w * 0.35, 0, 0, Math.PI);
      ctx.fill();
    }
  }
  // Forests: trees bow sunward everywhere, and the Leaning Wood like a wave.
  if (wooded || band === 1 || band === 2) {
    const n = wooded ? 70 : band === 2 ? 18 : 22;
    for (let i = 0; i < n; i++) {
      const x = cx + (rnd(i, 4) - 0.5) * 240;
      const y = cy + (rnd(i, 5) - 0.5) * 200;
      const s = (wooded ? 5 : 3.5) + rnd(i, 6) * 3;
      const lean = r.landmark === 'leaningWood' ? 0.9 : 0.35;
      ctx.strokeStyle = band === 1 ? 'rgba(220,210,235,0.5)' : 'rgba(40,40,20,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + lean * 2, y + s * 0.3 - s);
      ctx.stroke();
      ctx.fillStyle = band === 1 ? 'rgba(210,200,230,0.55)' : band === 0 ? 'rgba(90,230,210,0.35)' : 'rgba(60,70,30,0.6)';
      ctx.beginPath();
      ctx.ellipse(x + lean * 3, y - s + lean * 2, s * 0.7, s * 0.55, lean, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Gloaming grain: long amber stripes.
  if (band === 2 && !wooded && r.resource === 'grain') {
    ctx.strokeStyle = 'rgba(255,220,140,0.25)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 40; i++) {
      const x = cx - 130 + rnd(i, 7) * 260;
      const y = cy - 100 + rnd(i, 8) * 200;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 26, y + 3);
      ctx.stroke();
    }
  }
  // Evernight: ice cracks and glowing vents.
  if (band === 0) {
    ctx.strokeStyle = 'rgba(160,220,255,0.18)';
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 18; i++) {
      let x = cx + (rnd(i, 9) - 0.5) * 220;
      let y = cy + (rnd(i, 10) - 0.5) * 180;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 3; k++) {
        x += (rnd(i, 11 + k) - 0.5) * 24;
        y += (rnd(i, 14 + k) - 0.5) * 24;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    if (r.landmark === 'vents') {
      for (let i = 0; i < 9; i++) {
        const x = cx + (rnd(i, 20) - 0.5) * 160;
        const y = cy + (rnd(i, 21) - 0.5) * 120;
        const g = ctx.createRadialGradient(x, y, 0, x, y, 14);
        g.addColorStop(0, 'rgba(255,170,80,0.45)');
        g.addColorStop(1, 'rgba(255,170,80,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - 14, y - 14, 28, 28);
      }
    }
  }
  // Long Afternoon: salt pans. Glare: fused glass that glints.
  if (band === 3 && r.resource === 'salt') {
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.ellipse(cx + (rnd(i, 22) - 0.5) * 180, cy + (rnd(i, 23) - 0.5) * 140, 22 + rnd(i, 24) * 18, 9 + rnd(i, 25) * 8, rnd(i, 26), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (band === 4) {
    for (let i = 0; i < 26; i++) {
      const x = cx + (rnd(i, 27) - 0.5) * 240;
      const y = cy + (rnd(i, 28) - 0.5) * 180;
      ctx.fillStyle = `rgba(255,255,255,${0.2 + rnd(i, 29) * 0.3})`;
      ctx.beginPath();
      ctx.moveTo(x, y - 4);
      ctx.lineTo(x + 2, y);
      ctx.lineTo(x, y + 4);
      ctx.lineTo(x - 2, y);
      ctx.closePath();
      ctx.fill();
    }
  }
  // Umbral Vales: shadowed canyons cut into the day.
  if (r.vale) {
    ctx.strokeStyle = 'rgba(20,10,40,0.55)';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    for (let k = 0; k < 2; k++) {
      ctx.beginPath();
      const x0 = cx - 90 + k * 50;
      const y0 = cy - 50 + k * 30;
      ctx.moveTo(x0, y0);
      ctx.bezierCurveTo(x0 + 40, y0 + 30, x0 + 60, y0 - 10, x0 + 120, y0 + 25);
      ctx.stroke();
    }
    ctx.lineWidth = 1;
  }
}
