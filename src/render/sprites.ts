/**
 * Soldier sprites, drawn top-down facing +x and cached per unit type and side.
 * Silhouette languages from the doc: the Choir vertical and glinting, the Hush
 * low with glowing dots, the Vesperate rectangular with amber lanterns, the
 * Drift horizontal and bright. Team color lives on shields and cloth accents.
 */
import type { UnitDef } from '../data/schema';
import { factionDef } from '../data/index';
import { css, hex, mix, TEAM } from './color';

export const SPRITE_PX = 20;

export interface Sprite {
  canvas: HTMLCanvasElement;
  /** Anchor offset in sprite pixels. */
  ox: number;
  oy: number;
}

const cache = new Map<string, Sprite>();

export function spriteFor(def: UnitDef, side: 0 | 1, leader = false): Sprite {
  const key = `${def.id}:${side}:${leader ? 1 : 0}`;
  let s = cache.get(key);
  if (!s) {
    s = build(def, side, leader);
    cache.set(key, s);
  }
  return s;
}

function build(def: UnitDef, side: 0 | 1, leader: boolean): Sprite {
  const ext = extent(def, leader);
  const W = Math.ceil(ext.w * SPRITE_PX);
  const H = Math.ceil(ext.h * SPRITE_PX);
  const c = document.createElement('canvas');
  c.width = Math.max(4, W);
  c.height = Math.max(4, H);
  const ctx = c.getContext('2d')!;
  ctx.translate(ext.ax * SPRITE_PX, ext.ay * SPRITE_PX);
  ctx.scale(SPRITE_PX, SPRITE_PX);
  drawSoldier(ctx, def, side, leader);
  return { canvas: c, ox: ext.ax * SPRITE_PX, oy: ext.ay * SPRITE_PX };
}

function extent(def: UnitDef, leader: boolean): { w: number; h: number; ax: number; ay: number } {
  const s = def.silhouette;
  const r = def.radius ?? 0.5;
  const len = s.length ?? 0;
  const wid = s.width ?? 0;
  switch (s.shape) {
    case 'pike': {
      const reach = def.weapon.reach ?? 2;
      return { w: reach + 2.4, h: 2.2, ax: 1.1, ay: 1.1 };
    }
    case 'rider':
      return { w: 4, h: 2.4, ax: 2, ay: 1.2 };
    case 'heavyRider':
      return { w: Math.max(len, 3.2) + 2.8, h: 2.8, ax: 2, ay: 1.4 };
    case 'giant':
      return { w: r * 3.2, h: r * 3.2, ax: r * 1.6, ay: r * 1.6 };
    case 'beast':
      return { w: Math.max(len, r * 2.4) + 1.6, h: Math.max(wid, r * 2) + 1.6, ax: (Math.max(len, r * 2.4) + 1.6) / 2, ay: (Math.max(wid, r * 2) + 1.6) / 2 };
    case 'hound':
      return { w: 2.4, h: 1.4, ax: 1.2, ay: 0.7 };
    case 'engine':
      return { w: 6, h: 5, ax: 3, ay: 2.5 };
    case 'moth':
      return { w: Math.max(len, 3.2) + 1, h: Math.max(wid, 4.4) + 1, ax: (Math.max(len, 3.2) + 1) / 2, ay: (Math.max(wid, 4.4) + 1) / 2 };
    case 'glider':
      return { w: Math.max(len, 2.6) + 1, h: Math.max(wid, 4) + 1, ax: (Math.max(len, 2.6) + 1) / 2, ay: (Math.max(wid, 4) + 1) / 2 };
    case 'kite':
      return { w: 6, h: 3, ax: 1.5, ay: 1.5 };
    case 'wagon':
      return { w: Math.max(len, 5) + 1.5, h: Math.max(wid, 3) + 1.5, ax: (Math.max(len, 5) + 1.5) / 2, ay: (Math.max(wid, 3) + 1.5) / 2 };
    case 'character':
      return { w: 3.4, h: 3.4, ax: 1.7, ay: 1.7 };
    default:
      if (leader) return { w: 3.4, h: 3.4, ax: 1.7, ay: 1.7 };
      return { w: 3, h: 2.4, ax: 1.3, ay: 1.2 };
  }
}

function drawSoldier(ctx: CanvasRenderingContext2D, def: UnitDef, side: 0 | 1, leader: boolean): void {
  const f = factionDef(def.faction);
  const p = f.palette;
  const team = TEAM[side];
  const cloth = def.silhouette.accent ?? p.primary;
  const glow = def.silhouette.glow ?? p.glow;
  const metal = p.metal;
  const shape = leader ? 'character' : def.silhouette.shape;
  const body = (r: number, color: string) => {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(-0.08, 0.08, r, r, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    // A dark rim keeps pale bodies readable on bright ground.
    ctx.strokeStyle = 'rgba(20,12,24,0.55)';
    ctx.lineWidth = 0.07;
    ctx.stroke();
  };
  const line = (x1: number, y1: number, x2: number, y2: number, w: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };
  const dot = (x: number, y: number, r: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  const faction = def.faction;
  switch (shape) {
    case 'tall':
      body(0.42, cloth);
      dot(0.05, 0, 0.2, metal);
      line(0.2, 0.25, 0.75, 0.45, 0.1, '#dff4ff');
      dot(-0.25, -0.35, 0.1, glow);
      dot(-0.3, 0.3, 0.07, team);
      break;
    case 'shieldWall': {
      body(0.42, cloth);
      dot(0, 0, 0.18, metal);
      const shieldColor = faction === 'choir' ? '#f7f5ec' : css(mix(hex(cloth), hex(team), 0.35));
      ctx.fillStyle = shieldColor;
      ctx.fillRect(0.32, -0.5, 0.2, 1.0);
      if (faction === 'choir') {
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillRect(0.46, -0.35, 0.06, 0.4);
      }
      if (faction === 'vesperate') dot(0.42, -0.35, 0.1, glow);
      line(0.1, -0.35, 0.6, -0.6, 0.08, metal);
      dot(-0.3, 0, 0.08, team);
      break;
    }
    case 'pike': {
      const reach = def.weapon.reach ?? 2;
      body(0.4, cloth);
      dot(0, 0, 0.17, metal);
      line(-0.4, 0.15, reach + 0.3, 0.15, 0.08, faction === 'drift' ? '#e8d27a' : '#8a6a3a');
      dot(reach + 0.3, 0.15, 0.12, faction === 'choir' ? '#c8f4ff' : faction === 'hush' ? '#7cd8ff' : metal);
      if (faction === 'vesperate') dot(reach * 0.5, 0.15, 0.1, glow);
      dot(-0.3, -0.25, 0.08, team);
      break;
    }
    case 'blade':
      body(0.42, cloth);
      dot(0.02, 0, 0.18, metal);
      line(0.2, -0.25, 0.8, -0.5, 0.1, faction === 'choir' ? '#ff9a4a' : faction === 'hush' ? '#a09cff' : faction === 'vesperate' ? '#c9a227' : '#e0e0e0');
      line(0.2, 0.25, 0.8, 0.5, 0.1, faction === 'choir' ? '#ff9a4a' : faction === 'hush' ? '#a09cff' : faction === 'vesperate' ? '#c9a227' : '#e0e0e0');
      if (faction === 'hush') {
        dot(0.2, -0.08, 0.05, glow);
        dot(0.2, 0.08, 0.05, glow);
      }
      dot(-0.3, 0, 0.08, team);
      break;
    case 'bow':
      body(0.4, cloth);
      dot(0, 0, 0.16, metal);
      ctx.strokeStyle = faction === 'choir' ? '#f5f1e6' : faction === 'drift' ? '#f4a300' : '#9a7a4a';
      ctx.lineWidth = 0.09;
      ctx.beginPath();
      ctx.arc(0.1, 0, 0.55, -1.1, 1.1);
      ctx.stroke();
      dot(-0.3, 0, 0.08, team);
      break;
    case 'staff':
      body(0.4, cloth);
      dot(0, 0, 0.16, metal);
      line(0, 0.25, 0.9, 0.25, 0.08, '#7a6a4a');
      dot(0.95, 0.25, 0.16, glow);
      dot(-0.3, -0.2, 0.08, team);
      break;
    case 'rider':
    case 'heavyRider': {
      const heavy = shape === 'heavyRider';
      const L = def.silhouette.length ?? (heavy ? 3 : 2.4);
      const Wd = def.silhouette.width ?? (heavy ? 1.3 : 0.95);
      const mount = mountColor(def);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(-0.1, 0.12, L / 2, Wd / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = mount;
      ctx.beginPath();
      ctx.ellipse(0, 0, L / 2, Wd / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      // Head.
      ctx.beginPath();
      ctx.ellipse(L / 2 - 0.05, 0, 0.35, 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
      if (faction === 'vesperate' || def.id.includes('heliographer')) {
        // Antlers or spiral horns.
        line(L / 2, -0.1, L / 2 + 0.4, -0.45, 0.07, '#d8c8a0');
        line(L / 2, 0.1, L / 2 + 0.4, 0.45, 0.07, '#d8c8a0');
      }
      if (def.id.includes('kilnback')) {
        ctx.strokeStyle = '#ff7a2a';
        ctx.lineWidth = 0.06;
        for (let k = -2; k <= 2; k++) line(-L / 3, k * 0.12, L / 3, k * 0.1, 0.05, '#ff7a2a');
      }
      body(0.34, cloth);
      dot(0, 0, 0.15, metal);
      if (heavy) line(0.1, 0.25, L / 2 + 1.6, 0.25, 0.1, faction === 'choir' ? '#dff4ff' : '#c8b890');
      else line(0.1, 0.3, 0.9, 0.3, 0.08, '#c8b890');
      if (faction === 'drift') line(-0.3, 0, -1.2, 0.35, 0.12, team);
      else dot(-0.35, 0, 0.1, team);
      break;
    }
    case 'giant': {
      const r = def.radius ?? 2.6;
      // Sun-disc halo behind.
      ctx.strokeStyle = 'rgba(255,215,120,0.8)';
      ctx.lineWidth = 0.35;
      ctx.beginPath();
      ctx.arc(-0.3, 0, r * 1.2, 0, Math.PI * 2);
      ctx.stroke();
      body(r, '#f1ece0');
      ctx.strokeStyle = '#ff8a2a';
      ctx.lineWidth = 0.18;
      for (let k = 0; k < 5; k++) {
        const a = k * 1.3;
        line(Math.cos(a) * r * 0.2, Math.sin(a) * r * 0.2, Math.cos(a + 0.4) * r * 0.85, Math.sin(a + 0.4) * r * 0.85, 0.16, '#ff8a2a');
      }
      dot(r * 0.35, 0, r * 0.28, '#e9e2d0');
      dot(-r * 0.6, 0, 0.3, team);
      break;
    }
    case 'beast': {
      const L = def.silhouette.length ?? 5;
      const Wd = def.silhouette.width ?? 4;
      const dark = def.id.includes('lanternmaw');
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(-0.2, 0.25, L / 2, Wd / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = dark ? '#121126' : '#e4ecef';
      ctx.beginPath();
      ctx.ellipse(0, 0, L / 2, Wd / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      if (dark) {
        // Anglerfish lure swinging ahead, teeth like glass.
        line(L * 0.3, 0, L / 2 + 0.8, -0.6, 0.12, '#2a2848');
        const g = ctx.createRadialGradient(L / 2 + 0.8, -0.6, 0, L / 2 + 0.8, -0.6, 0.8);
        g.addColorStop(0, '#d8fff4');
        g.addColorStop(0.4, glow);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(L / 2 + 0.8, -0.6, 0.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(220,250,255,0.8)';
        ctx.lineWidth = 0.08;
        ctx.beginPath();
        ctx.arc(L * 0.25, 0, Wd * 0.3, -0.9, 0.9);
        ctx.stroke();
      } else {
        ctx.strokeStyle = '#a8c8d8';
        ctx.lineWidth = 0.12;
        for (let k = 0; k < 3; k++) line(-L * 0.1 + k * 0.4, -Wd * 0.35, -L * 0.1 + k * 0.4, Wd * 0.35, 0.1, '#a8c8d8');
        dot(L * 0.35, 0, 0.35, '#bfe6ff');
      }
      dot(-L * 0.3, 0, 0.3, team);
      break;
    }
    case 'hound':
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(-0.05, 0.08, 0.7, 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = cloth;
      ctx.beginPath();
      ctx.ellipse(0, 0, 0.7, 0.26, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0.7, 0, 0.25, 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
      dot(-0.4, 0, 0.07, team);
      break;
    case 'engine': {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(-1.3, -1.0, 2.8, 2.2);
      ctx.fillStyle = faction === 'choir' ? '#e9e2d0' : faction === 'hush' ? '#d8d0c0' : faction === 'vesperate' ? '#5a3a24' : '#8a5a2a';
      ctx.fillRect(-1.4, -1.1, 2.8, 2.2);
      if (def.id.includes('heliostat')) {
        for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(-1.2 + k * 0.62, -0.95 + r * 0.66, 0.5, 0.5);
        }
      } else if (def.id.includes('knell')) {
        dot(0, 0, 1.1, '#6a8a5a');
        dot(0, 0, 0.7, '#8aa878');
      } else {
        line(-1.2, 0, 1.8, 0, 0.22, '#6a4a2a');
        dot(1.8, 0, 0.35, def.missile?.type === 'fire' ? '#ff8a2a' : '#8a8a8a');
      }
      for (let k = 0; k < 3; k++) dot(-1.8 + k * 0.5, 1.5, 0.28, cloth);
      dot(-1.6, -1.4, 0.2, team);
      break;
    }
    case 'moth': {
      const Wd = def.silhouette.width ?? 4.4;
      const L = def.silhouette.length ?? 3.2;
      for (const sgn of [-1, 1]) {
        ctx.fillStyle = '#ece3d2';
        ctx.beginPath();
        ctx.ellipse(-0.1, (sgn * Wd) / 4, L * 0.38, Wd / 4, sgn * 0.3, 0, Math.PI * 2);
        ctx.fill();
        dot(-0.1, (sgn * Wd) / 4, 0.35, '#3a2a4a');
        dot(-0.1, (sgn * Wd) / 4, 0.18, glow);
      }
      ctx.fillStyle = '#d8ccb8';
      ctx.beginPath();
      ctx.ellipse(0, 0, L / 2, 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
      line(L / 2, -0.1, L / 2 + 0.6, -0.5, 0.06, glow);
      line(L / 2, 0.1, L / 2 + 0.6, 0.5, 0.06, glow);
      dot(0, 0, 0.18, team);
      break;
    }
    case 'glider': {
      const Wd = def.silhouette.width ?? 4;
      const L = def.silhouette.length ?? 2.6;
      ctx.fillStyle = cloth;
      ctx.beginPath();
      ctx.moveTo(L / 2, 0);
      ctx.lineTo(-L / 2, -Wd / 2);
      ctx.lineTo(-L / 3, 0);
      ctx.lineTo(-L / 2, Wd / 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.moveTo(L / 2, 0);
      ctx.lineTo(-L / 2, -Wd / 2);
      ctx.lineTo(-L / 2 + 0.3, -Wd / 2 + 0.3);
      ctx.closePath();
      ctx.fill();
      dot(0, 0, 0.22, '#3a2a2a');
      dot(-L / 4, -Wd / 5, 0.16, '#ffffff');
      dot(-L / 4, Wd / 5, 0.16, team);
      break;
    }
    case 'kite':
      body(0.38, cloth);
      line(0, 0, 3.6, 0, 0.03, 'rgba(255,255,255,0.6)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.moveTo(4.4, 0);
      ctx.lineTo(3.6, -0.7);
      ctx.lineTo(2.8, 0);
      ctx.lineTo(3.6, 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = team;
      ctx.fillRect(3.4, -0.1, 0.4, 0.2);
      break;
    case 'wagon': {
      const L = def.silhouette.length ?? 5;
      const Wd = def.silhouette.width ?? 3;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(-L / 2 - 0.1, -Wd / 2 + 0.15, L, Wd);
      for (const sx of [-L / 3, L / 3]) {
        ctx.fillStyle = '#2a1a10';
        ctx.fillRect(sx - 0.35, -Wd / 2 - 0.25, 0.7, 0.3);
        ctx.fillRect(sx - 0.35, Wd / 2 - 0.05, 0.7, 0.3);
      }
      ctx.fillStyle = faction === 'vesperate' ? '#4a2a3a' : '#9a6a3a';
      ctx.fillRect(-L / 2, -Wd / 2, L, Wd);
      if (def.id.includes('belfry')) {
        dot(0, 0, Wd * 0.35, '#c9a227');
        dot(0, 0, Wd * 0.2, '#8a6a1a');
        dot(L / 2 - 0.5, 0, 0.3, glow);
      } else {
        // A small sail and a ballista.
        ctx.fillStyle = 'rgba(244,163,0,0.85)';
        ctx.fillRect(-0.4, -Wd / 2 + 0.2, 0.8, Wd - 0.4);
        line(0, 0, L / 2 + 0.8, 0, 0.15, '#5a3a1a');
      }
      dot(-L / 2 + 0.4, 0, 0.25, team);
      break;
    }
    case 'character':
    default: {
      // Heroes and lords: a cape behind, a ring of their light around them.
      ctx.fillStyle = css(mix(hex(cloth), hex(team), 0.3));
      ctx.beginPath();
      ctx.arc(-0.25, 0, 0.7, Math.PI * 0.5, Math.PI * 1.5);
      ctx.fill();
      body(0.55, cloth);
      dot(0.05, 0, 0.26, metal);
      ctx.strokeStyle = glow;
      ctx.lineWidth = 0.1;
      ctx.beginPath();
      ctx.arc(0, 0, 0.85, 0, Math.PI * 2);
      ctx.stroke();
      line(0.3, 0.3, 1.2, 0.5, 0.12, def.weapon.type === 'fire' ? '#ff8a2a' : def.weapon.type === 'cold' ? '#9fe0ff' : '#e0e0e0');
      dot(-0.1, 0, 0.1, team);
    }
  }
}

function mountColor(def: UnitDef): string {
  switch (def.faction) {
    case 'choir':
      return def.id.includes('kilnback') ? '#7a4a2a' : '#e8e0cc';
    case 'hush':
      return '#d8d0cc';
    case 'vesperate':
      return '#6a4a30';
    case 'drift':
      return def.id.includes('Lancers') ? '#c4153a' : def.id.includes('dustrunner') ? '#f4a300' : '#1fa3a3';
  }
}

/** A small icon for unit cards and banners: the role read from shape first. */
export function drawRoleIcon(ctx: CanvasRenderingContext2D, def: UnitDef, x: number, y: number, size: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 20, size / 20);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  const r = def.role;
  const c = def.category;
  ctx.beginPath();
  if (r === 'colossus') {
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.moveTo(-9, 0);
    ctx.lineTo(9, 0);
    ctx.moveTo(0, -9);
    ctx.lineTo(0, 9);
  } else if (r === 'lord' || r === 'hero') {
    ctx.moveTo(-7, 5);
    ctx.lineTo(-7, -3);
    ctx.lineTo(-3, 1);
    ctx.lineTo(0, -6);
    ctx.lineTo(3, 1);
    ctx.lineTo(7, -3);
    ctx.lineTo(7, 5);
    ctx.closePath();
  } else if (r === 'artillery') {
    ctx.rect(-7, -4, 14, 8);
    ctx.moveTo(-7, 4);
    ctx.lineTo(7, -7);
  } else if (c === 'flyer') {
    ctx.moveTo(-8, 4);
    ctx.lineTo(0, -4);
    ctx.lineTo(8, 4);
  } else if (c === 'cavalry' || c === 'beast') {
    ctx.moveTo(-8, 3);
    ctx.lineTo(8, 3);
    ctx.moveTo(-5, 3);
    ctx.lineTo(-2, -4);
    ctx.lineTo(6, -4);
    if (r === 'missileCav') {
      ctx.moveTo(4, -8);
      ctx.arc(4, -8, 3, 0, Math.PI, true);
    }
  } else if (c === 'monster') {
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.moveTo(-4, -4);
    ctx.lineTo(-7, -8);
    ctx.moveTo(4, -4);
    ctx.lineTo(7, -8);
  } else if (r === 'antiLarge') {
    ctx.moveTo(-6, 8);
    ctx.lineTo(0, -9);
    ctx.lineTo(6, 8);
  } else if (r === 'missile') {
    if (def.missile?.trajectory === 'beam') {
      ctx.moveTo(-8, 0);
      ctx.lineTo(8, 0);
      ctx.moveTo(4, -4);
      ctx.lineTo(8, 0);
      ctx.lineTo(4, 4);
    } else {
      ctx.arc(-2, 0, 7, -1.2, 1.2);
      ctx.moveTo(-2, -6.5);
      ctx.lineTo(-2, 6.5);
    }
  } else if (r === 'shock') {
    ctx.moveTo(-7, 7);
    ctx.lineTo(7, -7);
    ctx.moveTo(-7, -7);
    ctx.lineTo(7, 7);
  } else if (r === 'support') {
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.moveTo(0, -3);
    ctx.lineTo(0, 3);
    ctx.moveTo(-3, 0);
    ctx.lineTo(3, 0);
  } else {
    ctx.rect(-7, -6, 14, 12);
  }
  ctx.stroke();
  ctx.restore();
}
