/**
 * Bakes a battle map into a canvas once. The sun never moves, so hillshade
 * and shadows are painted in at bake time ("baked lighting per map").
 */
import type { BandId } from '../data/schema';
import { LIGHT_RULES } from '../data/rules';
import { COVER, type Terrain } from '../sim/terrain';
import { css, fbm, hash2, hex, mix, type RGB, vnoise } from './color';

interface BandArt {
  ground: string;
  ground2: string;
  high: string;
  low: string;
  shadow: string;
  shadowAmt: number;
  water: string;
  shallow: string;
  glint: string;
  canopy: string[];
  trunk: string;
  field: string[];
  rock: string;
  roof: string[];
  ambient: number;
}

export const BAND_ART: Record<BandId | 'steppe', BandArt> = {
  gloaming: {
    ground: '#8f6b3a',
    ground2: '#b78c48',
    high: '#dcae62',
    low: '#5e4a36',
    shadow: '#3a3a78',
    shadowAmt: 0.5,
    water: '#314466',
    shallow: '#58677c',
    glint: '#ffb070',
    canopy: ['#4b4a23', '#5b5528', '#433f20', '#62602e'],
    trunk: '#2a2014',
    field: ['#c9973c', '#b88632', '#d6a84a'],
    rock: '#7c6a55',
    roof: ['#5a2a4a', '#6e1e1e', '#4a2e3e', '#3a2230'],
    ambient: 0.55,
  },
  longAfternoon: {
    ground: '#c7a468',
    ground2: '#d6bb83',
    high: '#e7d3a2',
    low: '#a8844f',
    shadow: '#6a5140',
    shadowAmt: 0.42,
    water: '#2f6f80',
    shallow: '#79aea9',
    glint: '#ffffff',
    canopy: ['#6d7a3a', '#5e6b30', '#7c8744'],
    trunk: '#4a3a22',
    field: ['#d8c48c'],
    rock: '#bf9d6e',
    roof: ['#efe7d4', '#e1d6bd'],
    ambient: 0.62,
  },
  glare: {
    ground: '#e8d9ae',
    ground2: '#f2e6c2',
    high: '#fbf1d8',
    low: '#dac79a',
    shadow: '#c9b68a',
    shadowAmt: 0.25,
    water: '#9fd6d6',
    shallow: '#c8ecec',
    glint: '#ffffff',
    canopy: ['#b9b27a'],
    trunk: '#8a7a50',
    field: ['#f0e2b8'],
    rock: '#e9d9b0',
    roof: ['#fff6e0'],
    ambient: 0.8,
  },
  dimmark: {
    ground: '#4b4553',
    ground2: '#5a5263',
    high: '#6d6376',
    low: '#3a3544',
    shadow: '#2a2436',
    shadowAmt: 0.35,
    water: '#2a3046',
    shallow: '#434b62',
    glint: '#d77a6a',
    canopy: ['#c9b9d9', '#b3a3c6', '#d9c9e3', '#a898bb'],
    trunk: '#6a5d78',
    field: ['#5d5466'],
    rock: '#645b6d',
    roof: ['#3d3446'],
    ambient: 0.5,
  },
  evernight: {
    ground: '#1b2141',
    ground2: '#232a52',
    high: '#3a4674',
    low: '#141933',
    shadow: '#0a0d20',
    shadowAmt: 0.35,
    water: '#8fa8cc',
    shallow: '#6f88ad',
    glint: '#d8f4ff',
    canopy: ['#1f2a4a', '#243258', '#2a2750'],
    trunk: '#141a33',
    field: ['#232a52'],
    rock: '#56668f',
    roof: ['#2a3158'],
    ambient: 0.45,
  },
  steppe: {
    ground: '#86854f',
    ground2: '#9a975c',
    high: '#aca867',
    low: '#6f6e42',
    shadow: '#3f3c5c',
    shadowAmt: 0.45,
    water: '#3a5a6a',
    shallow: '#6c8480',
    glint: '#ffd9a0',
    canopy: ['#5d6030', '#6a6c36'],
    trunk: '#3a3220',
    field: ['#a39d5c'],
    rock: '#8a8060',
    roof: ['#c4153a', '#1fa3a3', '#f4a300'],
    ambient: 0.58,
  },
};

export interface TerrainArt {
  canvas: HTMLCanvasElement;
  decals: HTMLCanvasElement;
  scale: number;
  art: BandArt;
}

export function artFor(t: Terrain): BandArt {
  if (t.steppe) {
    // The Gale Roads cross every band: steppe grass tinted by the band's light.
    const base = BAND_ART.steppe;
    const band = BAND_ART[t.band];
    const k = t.band === 'evernight' ? 0.7 : t.band === 'dimmark' ? 0.5 : t.band === 'glare' ? 0.35 : 0.15;
    const m = (a: string, b: string) => css(mix(hex(a), hex(b), k));
    return { ...base, ground: m(base.ground, band.ground), ground2: m(base.ground2, band.ground2), high: m(base.high, band.high), low: m(base.low, band.low), shadow: band.shadow, ambient: band.ambient };
  }
  return BAND_ART[t.band];
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function bakeTerrain(t: Terrain, pxPerM = 2): TerrainArt {
  const S = Math.min(pxPerM, 4096 / Math.max(t.width, t.height));
  const W = Math.ceil(t.width * S);
  const H = Math.ceil(t.height * S);
  const canvas = makeCanvas(W, H);
  const decals = makeCanvas(W, H);
  const ctx = canvas.getContext('2d')!;
  const art = artFor(t);
  paintGround(t, ctx, W, H, S, art);
  ctx.save();
  ctx.scale(S, S);
  paintRivers(t, ctx, art);
  paintFields(t, ctx, art);
  paintDecor(t, ctx, art);
  paintRects(t, ctx, art);
  paintTrees(t, ctx, art);
  paintWalls(t, ctx);
  ctx.restore();
  return { canvas, decals, scale: S, art };
}

/**
 * Render-only shadow strength: fades where the occluder barely clears the
 * sun line (a natural penumbra toward the shadow's tip), then blurred.
 * Gameplay uses the crisp in-or-out map in Terrain.
 */
function softShadows(t: Terrain): Float32Array {
  const cols = t.cols;
  const rows = t.rows;
  const out = new Float32Array(cols * rows);
  const elev = LIGHT_RULES[t.light].sunElevation;
  if (elev === null || t.light === 4) return out;
  const tanE = Math.tan((elev * Math.PI) / 180);
  const sx = Math.cos(t.sunBearing);
  const sy = Math.sin(t.sunBearing);
  const maxLen = Math.min(220, 45 / tanE);
  const cell = t.cell;
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const i = cy * cols + cx;
      if (!t.shadow[i]) continue;
      const x = (cx + 0.5) * cell;
      const y = (cy + 0.5) * cell;
      const h0 = t.heights[i]!;
      let best = 0;
      for (let d = cell; d <= maxLen; d += cell) {
        const px = x + sx * d;
        const py = y + sy * d;
        if (!t.inBounds(px, py)) break;
        const j = t.idx(px, py);
        const excess = t.heights[j]! + t.obstacleHeight(j) - h0 - d * tanE;
        if (excess > best) best = excess;
      }
      out[i] = Math.min(1, best / 5);
    }
  }
  // Two box-blur passes soften the cell edges.
  const tmp = new Float32Array(cols * rows);
  for (let pass = 0; pass < 2; pass++) {
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        let sum = 0;
        let n = 0;
        for (let oy = -1; oy <= 1; oy++) {
          const yy = cy + oy;
          if (yy < 0 || yy >= rows) continue;
          for (let ox = -1; ox <= 1; ox++) {
            const xx = cx + ox;
            if (xx < 0 || xx >= cols) continue;
            sum += out[yy * cols + xx]!;
            n++;
          }
        }
        tmp[cy * cols + cx] = sum / n;
      }
    }
    out.set(tmp);
  }
  return out;
}

/** Per-pixel ground: noise, height tint, hillshade and baked shadows. */
function paintGround(t: Terrain, ctx: CanvasRenderingContext2D, W: number, H: number, S: number, art: BandArt): void {
  const img = ctx.createImageData(W, H);
  const d = img.data;
  const g1 = hex(art.ground);
  const g2 = hex(art.ground2);
  const hi = hex(art.high);
  const lo = hex(art.low);
  const sh = hex(art.shadow);
  const water = hex(art.water);
  const shallow = hex(art.shallow);
  const rock = hex(art.rock);
  const fieldC = hex(art.field[0]!);
  const cols = t.cols;
  const rows = t.rows;
  const cell = t.cell;
  // Hillshade per cell.
  const elevDeg = LIGHT_RULES[t.light].sunElevation ?? 14;
  const el = (elevDeg * Math.PI) / 180;
  const sx = Math.cos(t.sunBearing);
  const sy = Math.sin(t.sunBearing);
  const lx = Math.cos(el) * sx;
  const ly = Math.cos(el) * sy;
  const lz = Math.sin(el);
  const shadeArr = new Float32Array(cols * rows);
  let hmin = Infinity;
  let hmax = -Infinity;
  for (let i = 0; i < t.heights.length; i++) {
    const h = t.heights[i]!;
    if (h < hmin) hmin = h;
    if (h > hmax) hmax = h;
  }
  const hr = Math.max(1, hmax - hmin);
  const relief = t.light <= 1 ? 0.5 : 1;
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const i = cy * cols + cx;
      const hL = t.heights[cy * cols + Math.max(0, cx - 1)]!;
      const hR = t.heights[cy * cols + Math.min(cols - 1, cx + 1)]!;
      const hU = t.heights[Math.max(0, cy - 1) * cols + cx]!;
      const hD = t.heights[Math.min(rows - 1, cy + 1) * cols + cx]!;
      const dx = (hR - hL) / (2 * cell);
      const dy = (hD - hU) / (2 * cell);
      const nx = -dx * 2.6;
      const ny = -dy * 2.6;
      const nz = 1;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const lam = Math.max(0, (nx * lx + ny * ly + nz * lz) / nl);
      // Relief is exaggerated at low sun so every hill reads: lit slopes glow, far slopes fall into shade.
      const raw = lam / Math.max(0.12, lz);
      const shaped = lz < 0.3 ? 1 + (raw - 1) * 0.7 : raw;
      shadeArr[i] = Math.max(0.3, Math.min(1.7, shaped)) * relief + (1 - relief);
    }
  }
  const soft = (arr: Float32Array | Uint8Array, fx: number, fy: number): number => {
    const x0 = Math.max(0, Math.min(cols - 2, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(rows - 2, Math.floor(fy)));
    const tx = Math.max(0, Math.min(1, fx - x0));
    const ty = Math.max(0, Math.min(1, fy - y0));
    const i = y0 * cols + x0;
    return (arr[i]! * (1 - tx) + arr[i + 1]! * tx) * (1 - ty) + (arr[i + cols]! * (1 - tx) + arr[i + cols + 1]! * tx) * ty;
  };
  const shadowSoft = softShadows(t);
  const noiseScale = 0.045;
  for (let py = 0; py < H; py++) {
    const wy = py / S;
    const fy = wy / cell - 0.5;
    for (let px = 0; px < W; px++) {
      const wx = px / S;
      const fx = wx / cell - 0.5;
      const ci = Math.min(rows - 1, Math.floor(wy / cell)) * cols + Math.min(cols - 1, Math.floor(wx / cell));
      const cov = t.cover[ci]!;
      const h = t.heights[ci]!;
      const n = fbm(wx * noiseScale, wy * noiseScale, 3);
      const grain = hash2(px, py) * 0.06 - 0.03;
      let c: RGB = mix(g1, g2, n);
      const hn = (h - hmin) / hr;
      c = hn > 0.55 ? mix(c, hi, (hn - 0.55) * 1.2) : mix(c, lo, (0.55 - hn) * 0.6);
      if (cov === COVER.Shallow) c = mix(shallow, c, 0.15);
      else if (cov === COVER.Deep) c = water;
      else if (cov === COVER.Cliff) c = mix(rock, hi, 0.3);
      else if (cov === COVER.Forest) c = mix(c, lo, 0.35);
      else if (cov === COVER.Field) c = mix(c, fieldC, 0.55);
      let shade = soft(shadeArr, fx, fy);
      if (cov === COVER.Deep || cov === COVER.Shallow) shade = 1 + (shade - 1) * 0.3;
      const k = art.ambient + (1 - art.ambient) * shade + grain;
      let r = c[0] * k;
      let g = c[1] * k;
      let b = c[2] * k;
      const s = soft(shadowSoft, fx, fy);
      if (s > 0.01) {
        const a = art.shadowAmt * s;
        r = r * (1 - a) + sh[0] * a * 0.9;
        g = g * (1 - a) + sh[1] * a * 0.9;
        b = b * (1 - a) + sh[2] * a * 0.95;
      }
      const o = (py * W + px) * 4;
      d[o] = r;
      d[o + 1] = g;
      d[o + 2] = b;
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Dimmark: a red rim of hidden sun along the sunward edge; Evernight: a cold vignette.
  if (t.light === 1) {
    const g = ctx.createLinearGradient(W / 2 + Math.cos(t.sunBearing) * W * 0.6, H / 2 + Math.sin(t.sunBearing) * H * 0.6, W / 2, H / 2);
    g.addColorStop(0, 'rgba(190,70,60,0.28)');
    g.addColorStop(1, 'rgba(190,70,60,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  } else if (t.light === 2) {
    const g = ctx.createLinearGradient(W / 2 + Math.cos(t.sunBearing) * W * 0.6, H / 2 + Math.sin(t.sunBearing) * H * 0.6, W / 2 - Math.cos(t.sunBearing) * W * 0.6, H / 2 - Math.sin(t.sunBearing) * H * 0.6);
    g.addColorStop(0, 'rgba(255,170,90,0.20)');
    g.addColorStop(1, 'rgba(70,50,120,0.18)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
}

function paintRivers(t: Terrain, ctx: CanvasRenderingContext2D, art: BandArt): void {
  for (const r of t.rivers) {
    // Glints on the water, catching the light.
    ctx.save();
    ctx.globalAlpha = t.light >= 2 ? 0.45 : 0.25;
    ctx.strokeStyle = art.glint;
    ctx.lineWidth = 0.6;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i]!;
      const b = r.pts[i + 1]!;
      for (let k = 0; k < 6; k++) {
        const f = hash2(i * 7 + k, 91);
        const off = (hash2(i * 13 + k, 17) - 0.5) * r.width * 0.6;
        const x = a.x + (b.x - a.x) * f;
        const y = a.y + (b.y - a.y) * f;
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const nx = -Math.sin(ang) * off;
        const ny = Math.cos(ang) * off;
        ctx.beginPath();
        ctx.moveTo(x + nx - Math.cos(ang) * 2.5, y + ny - Math.sin(ang) * 2.5);
        ctx.lineTo(x + nx + Math.cos(ang) * 2.5, y + ny + Math.sin(ang) * 2.5);
        ctx.stroke();
      }
    }
    ctx.restore();
    // Fords: pale gravel bars.
    for (const f of r.fords) {
      ctx.fillStyle = 'rgba(220,200,160,0.18)';
      ctx.beginPath();
      ctx.ellipse(f.x, f.y, f.r * 0.8, f.r * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function paintFields(t: Terrain, ctx: CanvasRenderingContext2D, art: BandArt): void {
  for (const f of t.fields) {
    ctx.save();
    ctx.translate(f.x + f.w / 2, f.y + f.h / 2);
    ctx.rotate(f.angle);
    const color = art.field[Math.floor(hash2(f.x, f.y) * art.field.length)]!;
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.1;
    for (let y = -f.h / 2; y < f.h / 2; y += 2.4) {
      ctx.beginPath();
      ctx.moveTo(-f.w / 2, y);
      ctx.lineTo(f.w / 2, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = '#3a2a14';
    ctx.lineWidth = 0.5;
    for (let y = -f.h / 2 + 1.2; y < f.h / 2; y += 2.4) {
      ctx.beginPath();
      ctx.moveTo(-f.w / 2, y);
      ctx.lineTo(f.w / 2, y);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function paintDecor(t: Terrain, ctx: CanvasRenderingContext2D, art: BandArt): void {
  const sx = Math.cos(t.sunBearing);
  const sy = Math.sin(t.sunBearing);
  for (const d of t.decor) {
    const c = t.coverAt(d.x, d.y);
    if (c === COVER.Deep || c === COVER.Building || c === COVER.Cliff) continue;
    switch (d.kind) {
      case 'tuft':
      case 'grass': {
        // Every plant leans toward the sun.
        ctx.strokeStyle = css(mix(hex(art.ground2), hex('#4a5a20'), 0.35), 0.7);
        ctx.lineWidth = 0.35;
        for (let k = 0; k < 5; k++) {
          const ox = (hash2(d.x * 3 + k, d.y) - 0.5) * 3 * d.s;
          const oy = (hash2(d.x, d.y * 3 + k) - 0.5) * 3 * d.s;
          ctx.beginPath();
          ctx.moveTo(d.x + ox, d.y + oy);
          ctx.lineTo(d.x + ox + sx * 1.6 * d.s, d.y + oy + sy * 1.6 * d.s);
          ctx.stroke();
        }
        break;
      }
      case 'fungus': {
        const glow = t.band === 'evernight' ? ['#4ff0d0', '#8cff9c', '#b58cff'][Math.floor(hash2(d.x, d.y) * 3)]! : '#e0d0ee';
        ctx.fillStyle = glow;
        ctx.globalAlpha = t.band === 'evernight' ? 0.85 : 0.6;
        for (let k = 0; k < 6; k++) {
          const ox = (hash2(d.x + k, d.y * 2) - 0.5) * 5 * d.s;
          const oy = (hash2(d.x * 2, d.y + k) - 0.5) * 5 * d.s;
          ctx.beginPath();
          ctx.arc(d.x + ox, d.y + oy, 0.35 + hash2(k, d.x) * 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'snow':
        ctx.fillStyle = 'rgba(200,220,255,0.18)';
        ctx.beginPath();
        ctx.ellipse(d.x, d.y, 6 * d.s, 3 * d.s, d.a, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'crystal':
        ctx.fillStyle = 'rgba(170,220,255,0.55)';
        ctx.beginPath();
        ctx.moveTo(d.x, d.y - 1.2 * d.s);
        ctx.lineTo(d.x + 0.6 * d.s, d.y);
        ctx.lineTo(d.x, d.y + 1.2 * d.s);
        ctx.lineTo(d.x - 0.6 * d.s, d.y);
        ctx.fill();
        break;
      case 'glass': {
        ctx.fillStyle = 'rgba(210,245,245,0.55)';
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 0.25;
        ctx.beginPath();
        const r = 1.6 * d.s;
        for (let k = 0; k < 5; k++) {
          const a = d.a + (k / 5) * Math.PI * 2;
          const rr = r * (0.6 + hash2(d.x + k, d.y) * 0.6);
          if (k === 0) ctx.moveTo(d.x + Math.cos(a) * rr, d.y + Math.sin(a) * rr);
          else ctx.lineTo(d.x + Math.cos(a) * rr, d.y + Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'ripple':
        ctx.strokeStyle = 'rgba(255,250,230,0.35)';
        ctx.lineWidth = 0.4;
        ctx.beginPath();
        ctx.arc(d.x, d.y, 5 * d.s, d.a, d.a + 1.2);
        ctx.stroke();
        break;
      case 'salt':
        ctx.fillStyle = 'rgba(245,240,228,0.35)';
        ctx.beginPath();
        ctx.ellipse(d.x, d.y, 9 * d.s, 5 * d.s, d.a, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'scrub':
        ctx.fillStyle = 'rgba(100,110,60,0.6)';
        ctx.beginPath();
        ctx.arc(d.x, d.y, 0.9 * d.s, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'stone':
        ctx.fillStyle = 'rgba(90,85,70,0.5)';
        ctx.beginPath();
        ctx.arc(d.x, d.y, 0.8 * d.s, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'vent': {
        const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.s);
        g.addColorStop(0, 'rgba(255,170,120,0.55)');
        g.addColorStop(0.4, 'rgba(60,40,50,0.8)');
        g.addColorStop(1, 'rgba(20,20,40,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.s, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
    }
  }
}

function paintRects(t: Terrain, ctx: CanvasRenderingContext2D, art: BandArt): void {
  const sx = Math.cos(t.sunBearing);
  const sy = Math.sin(t.sunBearing);
  for (const r of t.rects) {
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.rotate(r.angle);
    const w = r.w;
    const h = r.h;
    switch (r.kind) {
      case 'house': {
        const roof = art.roof[Math.floor(hash2(r.x, r.y) * art.roof.length)]!;
        ctx.fillStyle = '#2a1f1a';
        ctx.fillRect(-w / 2 - 0.5, -h / 2 - 0.5, w + 1, h + 1);
        // Two roof halves: the sunward one catches the light.
        const lit = Math.cos(t.sunBearing - r.angle - Math.PI / 2) > 0;
        ctx.fillStyle = lit ? css(mix(hex(roof), hex('#ffcf80'), 0.25)) : roof;
        ctx.fillRect(-w / 2, -h / 2, w, h / 2);
        ctx.fillStyle = lit ? roof : css(mix(hex(roof), hex('#ffcf80'), 0.25));
        ctx.fillRect(-w / 2, 0, w, h / 2);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 0.4;
        ctx.beginPath();
        ctx.moveTo(-w / 2, 0);
        ctx.lineTo(w / 2, 0);
        ctx.stroke();
        // A lantern at the door.
        ctx.fillStyle = 'rgba(255,190,90,0.9)';
        ctx.beginPath();
        ctx.arc(w / 2 - 1.2, h / 2 + 0.6, 0.45, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'ruin': {
        ctx.strokeStyle = css(mix(hex(art.rock), hex('#000000'), 0.2));
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 1.5, 1, 2]);
        ctx.strokeRect(-w / 2, -h / 2, w, h);
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.fillRect(-w / 2, -h / 2, w, h);
        break;
      }
      case 'mesa': {
        ctx.fillStyle = css(mix(hex(art.rock), hex('#000000'), 0.25));
        roundRect(ctx, -w / 2 - 2, -h / 2 - 2, w + 4, h + 4, 6);
        ctx.fill();
        ctx.fillStyle = css(mix(hex(art.high), hex(art.rock), 0.35));
        roundRect(ctx, -w / 2, -h / 2, w, h, 5);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,245,220,0.35)';
        ctx.lineWidth = 0.6;
        for (let k = 0; k < 4; k++) {
          ctx.beginPath();
          ctx.ellipse(0, 0, (w / 2) * (0.85 - k * 0.2), (h / 2) * (0.85 - k * 0.2), 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        break;
      }
      case 'furnace': {
        ctx.fillStyle = '#efe6d2';
        ctx.beginPath();
        ctx.arc(0, 0, w / 2, 0, Math.PI * 2);
        ctx.fill();
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, w / 2);
        g.addColorStop(0, 'rgba(255,160,60,0.95)');
        g.addColorStop(0.5, 'rgba(255,110,30,0.4)');
        g.addColorStop(1, 'rgba(255,110,30,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, w / 3, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'ice': {
        ctx.fillStyle = 'rgba(180,210,240,0.75)';
        ctx.strokeStyle = 'rgba(230,245,255,0.8)';
        ctx.lineWidth = 0.4;
        ctx.beginPath();
        ctx.moveTo(-w / 2, -h / 3);
        ctx.lineTo(-w / 4, -h / 2);
        ctx.lineTo(w / 2, -h / 4);
        ctx.lineTo(w / 3, h / 2);
        ctx.lineTo(-w / 3, h / 3);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'shard': {
        ctx.fillStyle = 'rgba(220,250,250,0.7)';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 0.3;
        ctx.beginPath();
        ctx.moveTo(0, -h / 2);
        ctx.lineTo(w / 2, h / 3);
        ctx.lineTo(-w / 3, h / 2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      }
      default: {
        ctx.fillStyle = art.rock;
        roundRect(ctx, -w / 2, -h / 2, w, h, 2);
        ctx.fill();
      }
    }
    ctx.restore();
    void sx;
    void sy;
  }
}

function paintTrees(t: Terrain, ctx: CanvasRenderingContext2D, art: BandArt): void {
  const sx = Math.cos(t.sunBearing);
  const sy = Math.sin(t.sunBearing);
  const lean = t.light >= 2 && t.light <= 3 ? 1.4 : t.light === 4 ? 0.2 : 0.7;
  const fungal = t.band === 'dimmark' || t.band === 'evernight';
  // Trunks first so canopies overlap them.
  for (const tr of t.trees) {
    ctx.fillStyle = art.trunk;
    ctx.beginPath();
    ctx.arc(tr.x - sx * tr.r * 0.3, tr.y - sy * tr.r * 0.3, tr.r * 0.28, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const tr of t.trees) {
    const cx = tr.x + sx * lean * tr.r * 0.35;
    const cy = tr.y + sy * lean * tr.r * 0.35;
    const col = art.canopy[tr.kind % art.canopy.length]!;
    if (fungal) {
      // Pale fungal caps (Dimmark) or glowing night stalks (Evernight).
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(cx, cy, tr.r * 0.85, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = t.band === 'evernight' ? 'rgba(80,240,210,0.55)' : 'rgba(90,70,110,0.45)';
      ctx.lineWidth = 0.25;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * tr.r * 0.8, cy + Math.sin(a) * tr.r * 0.8);
        ctx.stroke();
      }
      if (t.band === 'evernight') {
        ctx.fillStyle = ['#4ff0d0', '#8cff9c', '#b58cff'][tr.kind % 3]!;
        for (let k = 0; k < 3; k++) {
          ctx.beginPath();
          ctx.arc(cx + (hash2(tr.x + k, tr.y) - 0.5) * tr.r, cy + (hash2(tr.x, tr.y + k) - 0.5) * tr.r, 0.35, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      continue;
    }
    // Canopy bowed sunward: an ellipse stretched toward the sun.
    const ang = Math.atan2(sy, sx);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.ellipse(0, 0, tr.r * (1 + 0.25 * lean), tr.r * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
    // Sunward highlight.
    ctx.fillStyle = css(mix(hex(col), hex('#ffd890'), t.light >= 2 ? 0.35 : 0.1), 0.8);
    ctx.beginPath();
    ctx.ellipse(tr.r * 0.35, 0, tr.r * 0.55, tr.r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function paintWalls(t: Terrain, ctx: CanvasRenderingContext2D): void {
  if (!t.walls.length) return;
  for (const w of t.walls) {
    if (w.tower) {
      ctx.fillStyle = '#5e5448';
      ctx.beginPath();
      ctx.arc(w.x1, w.y1, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#7a6e5e';
      ctx.beginPath();
      ctx.arc(w.x1, w.y1, 5, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.strokeStyle = w.gate ? '#6b4a2a' : '#6a6052';
    ctx.lineWidth = w.gate ? 5 : 6;
    ctx.beginPath();
    ctx.moveTo(w.x1, w.y1);
    ctx.lineTo(w.x2, w.y2);
    ctx.stroke();
    ctx.strokeStyle = w.gate ? '#8a6a3a' : '#8a7e6c';
    ctx.lineWidth = w.gate ? 2 : 3;
    ctx.stroke();
  }
  if (t.capturePoint) {
    const c = t.capturePoint;
    ctx.strokeStyle = 'rgba(255,220,140,0.6)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Re-stamp walls after a breach. */
export function repaintWalls(t: Terrain, art: TerrainArt): void {
  const ctx = art.canvas.getContext('2d')!;
  ctx.save();
  ctx.scale(art.scale, art.scale);
  for (const w of t.walls) {
    if (!w.broken || w.tower) continue;
    ctx.strokeStyle = css(mix(hex(art.art.ground), hex('#5a5048'), 0.5));
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(w.x1, w.y1);
    ctx.lineTo(w.x2, w.y2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(120,110,95,0.8)';
    for (let k = 0; k < 10; k++) {
      const f = hash2(k, w.x1) ;
      ctx.beginPath();
      ctx.arc(w.x1 + (w.x2 - w.x1) * f + (hash2(k, 3) - 0.5) * 6, w.y1 + (w.y2 - w.y1) * f + (hash2(3, k) - 0.5) * 6, 1 + hash2(k, k) * 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

export { vnoise };
