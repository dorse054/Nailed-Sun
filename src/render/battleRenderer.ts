/**
 * Draws a battle. Reads simulation state only; interpolates soldier positions
 * between the 20 Hz ticks for smooth motion at any frame rate.
 */
import type { Battle } from '../sim/battle';
import type { Side, Soldier, Unit, Zone } from '../sim/types';
import { formationSize } from '../sim/army';
import { hasMechanic, isFlyer } from '../sim/mechanics';
import { moraleState } from '../sim/morale';
import { factionDef } from '../data/index';
import { Camera } from './camera';
import { Effects } from './effects';
import { bakeTerrain, type TerrainArt } from './terrainArt';
import { drawRoleIcon, spriteFor, SPRITE_PX } from './sprites';
import { drawColossus } from './colossusArt';
import { TEAM } from './color';

export interface Overlay {
  selected: Set<number>;
  hover: number;
  dragBox: { x0: number; y0: number; x1: number; y1: number } | null;
  preview: { x: number; y: number; facing: number; width: number; depth: number; unit: number; files: number }[];
  abilityPreview: { shape: 'circle' | 'cone' | 'line'; x: number; y: number; ox: number; oy: number; radius: number; angle: number; width: number; ok: boolean } | null;
  pings: { x: number; y: number; t: number; color: string }[];
  deployZone: { x: number; y: number; w: number; h: number } | null;
}

export function emptyOverlay(): Overlay {
  return { selected: new Set(), hover: -1, dragBox: null, preview: [], abilityPreview: null, pings: [], deployZone: null };
}

interface WindStreak {
  x: number;
  y: number;
  life: number;
}

export class BattleRenderer {
  readonly camera = new Camera();
  readonly effects = new Effects();
  art: TerrainArt;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private lightCanvas: HTMLCanvasElement;
  private lightCtx: CanvasRenderingContext2D;
  private streaks: WindStreak[] = [];
  private time = 0;
  showAll = false;
  /** Draw hidden enemies faintly (replays, spectating). */
  constructor(
    readonly canvas: HTMLCanvasElement,
    public battle: Battle,
    public viewer: Side,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.art = bakeTerrain(battle.terrain);
    this.lightCanvas = document.createElement('canvas');
    this.lightCtx = this.lightCanvas.getContext('2d')!;
    for (let i = 0; i < 90; i++) this.streaks.push({ x: Math.random() * battle.terrain.width, y: Math.random() * battle.terrain.height, life: Math.random() * 3 });
  }

  resize(w: number, h: number, dpr: number): void {
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.floor(w * dpr));
    this.canvas.height = Math.max(1, Math.floor(h * dpr));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.camera.width = w;
    this.camera.height = h;
    this.lightCanvas.width = Math.max(1, Math.floor(w / 2));
    this.lightCanvas.height = Math.max(1, Math.floor(h / 2));
  }

  /** Draw one frame. alpha interpolates between the previous and current tick. */
  frame(alpha: number, dt: number, ov: Overlay): void {
    this.time += dt;
    const b = this.battle;
    const ctx = this.ctx;
    const cam = this.camera;
    const dpr = this.dpr;
    this.stampCorpses();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = voidColor(b.terrain.light);
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // World transform: meters -> device pixels.
    const k = cam.zoom * dpr;
    const tx = (cam.width / 2 - cam.x * cam.zoom) * dpr;
    const ty = (cam.height / 2 - cam.y * cam.zoom) * dpr;
    ctx.setTransform(k, 0, 0, k, tx, ty);
    ctx.imageSmoothingEnabled = true;
    const S = this.art.scale;
    ctx.drawImage(this.art.canvas, 0, 0, this.art.canvas.width / S, this.art.canvas.height / S);
    ctx.drawImage(this.art.decals, 0, 0, this.art.decals.width / S, this.art.decals.height / S);
    this.drawGroundZones(ctx);
    if (ov.deployZone) this.drawDeployZone(ctx, ov.deployZone);
    this.drawTelegraphs(ctx);
    this.drawOrders(ctx, ov);
    this.drawSelection(ctx, ov, alpha);
    // Ground units, then colossi, then flyers above everything.
    const flyers: Unit[] = [];
    for (const u of b.units) {
      if (!this.shouldDraw(u)) continue;
      if (u.def.category === 'colossus') continue;
      if (isFlyer(u.def)) {
        flyers.push(u);
        continue;
      }
      this.drawUnit(ctx, u, alpha, k, tx, ty);
    }
    ctx.setTransform(k, 0, 0, k, tx, ty);
    for (const u of b.units) {
      if (!this.shouldDraw(u) || u.def.category !== 'colossus' || isFlyer(u.def)) continue;
      this.drawColossusUnit(ctx, u, alpha);
    }
    this.drawProjectiles(ctx, alpha);
    for (const u of flyers) this.drawUnit(ctx, u, alpha, k, tx, ty);
    ctx.setTransform(k, 0, 0, k, tx, ty);
    for (const u of b.units) {
      if (!this.shouldDraw(u) || u.def.category !== 'colossus' || !isFlyer(u.def)) continue;
      this.drawColossusUnit(ctx, u, alpha);
    }
    this.drawDarkZones(ctx);
    this.drawBeams(ctx);
    this.drawLighting(ctx, k, tx, ty);
    ctx.setTransform(k, 0, 0, k, tx, ty);
    this.drawParticles(ctx);
    this.drawWind(ctx, dt);
    if (ov.abilityPreview) this.drawAbilityPreview(ctx, ov.abilityPreview);
    this.drawPings(ctx, ov);
    // Screen space.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawSunGlow(ctx);
    this.drawBanners(ctx, ov, alpha);
    this.drawTexts(ctx, alpha);
    if (ov.dragBox) {
      const d = ov.dragBox;
      ctx.strokeStyle = 'rgba(255,230,160,0.9)';
      ctx.fillStyle = 'rgba(255,230,160,0.08)';
      ctx.lineWidth = 1;
      ctx.fillRect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      ctx.strokeRect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
    }
    this.effects.update(dt);
  }

  private shouldDraw(u: Unit): boolean {
    if (u.alive <= 0 || u.state === 'dead' || u.state === 'fled') return false;
    if (u.state === 'embarked') return false;
    if (u.side === this.viewer || this.showAll) return true;
    return u.visible[this.viewer];
  }

  unitCenter(u: Unit, alpha: number): { x: number; y: number } {
    if (u.def.category === 'colossus' || u.soldiers.length <= 4 || u.state === 'routing' || u.state === 'shattered') {
      let x = 0;
      let y = 0;
      let n = 0;
      for (const s of u.soldiers) {
        if (!s.alive) continue;
        x += s.px + (s.x - s.px) * alpha;
        y += s.py + (s.y - s.py) * alpha;
        n++;
      }
      if (n) return { x: x / n, y: y / n };
    }
    let x = 0;
    let y = 0;
    let n = 0;
    const step = Math.max(1, Math.floor(u.soldiers.length / 24));
    for (let i = 0; i < u.soldiers.length; i += step) {
      const s = u.soldiers[i]!;
      if (!s.alive) continue;
      x += s.px + (s.x - s.px) * alpha;
      y += s.py + (s.y - s.py) * alpha;
      n++;
    }
    return n ? { x: x / n, y: y / n } : { x: u.x, y: u.y };
  }

  // ----------------------------------------------------------------- units

  private drawUnit(ctx: CanvasRenderingContext2D, u: Unit, alpha: number, k: number, tx: number, ty: number): void {
    const cam = this.camera;
    const zoom = cam.zoom;
    const def = u.def;
    const pal = factionDef(u.faction).palette;
    const hiddenOwn = u.concealed && u.side === this.viewer;
    const ghost = u.side !== this.viewer && !u.visible[this.viewer];
    const fade = ghost ? 0.35 : hiddenOwn ? 0.6 : 1;
    const flyer = isFlyer(def);
    const alt = 10;
    if (zoom < 1.25) {
      // Far view: dots in faction colors, team-tinted.
      ctx.setTransform(k, 0, 0, k, tx, ty);
      ctx.globalAlpha = fade;
      const r = Math.max(def.radius ?? 0.5, 0.9 / zoom);
      if (flyer) {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        for (const s of u.soldiers) {
          if (!s.alive || !s.airborne) continue;
          ctx.fillRect(s.px + (s.x - s.px) * alpha + alt * 0.4 - r, s.py + (s.y - s.py) * alpha + alt * 0.7 - r, r * 2, r * 2);
        }
      }
      ctx.fillStyle = mixTeam(pal.primary, TEAM[u.side]);
      for (const s of u.soldiers) {
        if (!s.alive) continue;
        const x = s.px + (s.x - s.px) * alpha;
        const y = s.py + (s.y - s.py) * alpha - (s.airborne ? alt * 0.3 : 0);
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      this.drawSignature(ctx, u, alpha, zoom);
      ctx.globalAlpha = 1;
      return;
    }
    const dpr = this.dpr;
    const scale = (zoom * dpr) / SPRITE_PX;
    const now = this.time;
    for (const s of u.soldiers) {
      if (!s.alive) continue;
      const wx = s.px + (s.x - s.px) * alpha;
      const wy = s.py + (s.y - s.py) * alpha;
      if (!cam.visible(wx, wy, 6)) continue;
      const sp = spriteFor(def, u.side, s.leader);
      let sx = (wx - cam.x) * zoom * dpr + (cam.width / 2) * dpr;
      let sy = (wy - cam.y) * zoom * dpr + (cam.height / 2) * dpr;
      let sc = scale;
      if (s.airborne) {
        // Shadow on the ground, sprite lifted and slightly larger.
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 0.25 * fade;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.ellipse(sx + alt * 0.4 * zoom * dpr, sy + alt * 0.7 * zoom * dpr, (def.radius ?? 1.5) * zoom * dpr * 1.4, (def.radius ?? 1.5) * zoom * dpr * 0.8, 0, 0, Math.PI * 2);
        ctx.fill();
        sy -= alt * 0.3 * zoom * dpr;
        sc *= 1.15;
        // Wing flutter.
        sc *= 1 + Math.sin(now * 12 + s.id) * 0.05;
      }
      const f = s.facing;
      const c = Math.cos(f) * sc;
      const sn = Math.sin(f) * sc;
      ctx.globalAlpha = s.downTimer > 0 ? 0.55 * fade : fade;
      ctx.setTransform(c, sn, -sn, c, sx, sy);
      ctx.drawImage(sp.canvas, -sp.ox, -sp.oy);
      if (s.chargeTimer > 3.5 && zoom > 2.5) {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = '#fff4d0';
        ctx.fillRect(-sp.ox - 6, -2, 5, 4);
      }
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Light signatures seen from afar: the Choir flash and glint, the Hush
   * show only glowing dots, the Vesperate carry amber lanterns, the Drift
   * fly bright colors.
   */
  private drawSignature(ctx: CanvasRenderingContext2D, u: Unit, alpha: number, zoom: number): void {
    const f = u.faction;
    const t = this.time;
    const every = f === 'choir' ? 6 : f === 'hush' ? 4 : f === 'vesperate' ? 9 : 5;
    const size = 1.5 / zoom;
    const prev = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = u.id % every; i < u.soldiers.length; i += every) {
      const s = u.soldiers[i]!;
      if (!s.alive) continue;
      const x = s.px + (s.x - s.px) * alpha;
      const y = s.py + (s.y - s.py) * alpha - (s.airborne ? 3 : 0);
      if (f === 'choir') {
        const tw = Math.sin(t * 4.3 + s.id * 1.7);
        if (tw < 0.55) continue;
        ctx.fillStyle = `rgba(255,248,220,${(tw - 0.55) * 1.8})`;
        ctx.fillRect(x - size, y - size * 0.25, size * 2, size * 0.5);
        ctx.fillRect(x - size * 0.25, y - size, size * 0.5, size * 2);
      } else if (f === 'hush') {
        ctx.fillStyle = `rgba(79,240,224,${0.35 + 0.2 * Math.sin(t * 1.3 + s.id)})`;
        ctx.fillRect(x - size * 0.5, y - size * 0.5, size, size);
      } else if (f === 'vesperate') {
        ctx.fillStyle = 'rgba(255,192,77,0.7)';
        ctx.fillRect(x - size * 0.6, y - size * 0.6, size * 1.2, size * 1.2);
      } else {
        ctx.fillStyle = ['rgba(244,163,0,0.8)', 'rgba(31,163,163,0.8)', 'rgba(230,40,70,0.8)', 'rgba(255,210,74,0.8)'][s.id & 3]!;
        const wave = Math.sin(t * 6 + s.id) * size * 0.4;
        ctx.fillRect(x, y - size * 0.3 + wave, size * 2.2, size * 0.6);
      }
    }
    ctx.globalCompositeOperation = prev;
  }

  private drawColossusUnit(ctx: CanvasRenderingContext2D, u: Unit, alpha: number): void {
    const s = u.soldiers.find((x) => x.alive);
    if (!s) return;
    const x = s.px + (s.x - s.px) * alpha;
    const y = s.py + (s.y - s.py) * alpha;
    const flying = isFlyer(u.def) && s.airborne;
    ctx.globalAlpha = u.side !== this.viewer && !u.visible[this.viewer] ? 0.35 : 1;
    drawColossus(ctx, u, x, y - (flying ? 8 : 0), s.facing, this.time, flying ? 14 : 0);
    ctx.globalAlpha = 1;
    // Health ring, a constant thickness on screen at any zoom.
    const frac = s.hp / s.maxHp;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = Math.max(0.25, 2.4 / this.camera.zoom);
    ctx.beginPath();
    ctx.arc(x, y, (u.def.radius ?? 8) + 5, -Math.PI / 2, Math.PI * 1.5);
    ctx.stroke();
    ctx.strokeStyle = frac > 0.5 ? 'rgba(160,230,140,0.9)' : frac > 0.25 ? 'rgba(250,200,90,0.9)' : 'rgba(240,90,70,0.9)';
    ctx.beginPath();
    ctx.arc(x, y, (u.def.radius ?? 8) + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    ctx.stroke();
  }

  // ----------------------------------------------------------- ground & air

  private drawGroundZones(ctx: CanvasRenderingContext2D): void {
    const t = this.time;
    for (const z of this.battle.zones) {
      if (!z.enabled) continue;
      if (!this.camera.visible(z.x, z.y, z.radius)) continue;
      const v = z.def.visual;
      if (v === 'fire') {
        const g = ctx.createRadialGradient(z.x, z.y, 0, z.x, z.y, z.radius);
        g.addColorStop(0, 'rgba(60,20,10,0.55)');
        g.addColorStop(1, 'rgba(40,20,10,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(z.x, z.y, z.radius, 0, Math.PI * 2);
        ctx.fill();
        const n = Math.min(10, Math.ceil(z.radius));
        for (let i = 0; i < n; i++) {
          const a = i * 2.4 + z.id;
          const rr = z.radius * 0.7 * ((i * 37) % 10) / 10;
          const fl = 0.55 + 0.45 * Math.sin(t * 11 + i * 1.7 + z.id);
          const fx = z.x + Math.cos(a) * rr;
          const fy = z.y + Math.sin(a) * rr;
          ctx.fillStyle = `rgba(255,${110 + ((i * 29) % 100)},30,${0.75 * fl})`;
          ctx.beginPath();
          ctx.ellipse(fx, fy, 1.2 + fl, 0.9 + fl * 0.6, a, 0, Math.PI * 2);
          ctx.fill();
          if (i % 3 === 0 && Math.random() < 0.05) this.effects.ambient('ember', fx, fy, '#ffcf70', 0.4, 1.2);
        }
      } else if (v === 'dust') {
        const g = ctx.createRadialGradient(z.x, z.y, 0, z.x, z.y, z.radius);
        const blue = z.def.id === 'frostField';
        g.addColorStop(0, blue ? 'rgba(200,235,255,0.35)' : 'rgba(210,200,180,0.35)');
        g.addColorStop(1, 'rgba(200,200,200,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(z.x, z.y, z.radius, 0, Math.PI * 2);
        ctx.fill();
        if (Math.random() < 0.3) this.effects.ambient(blue ? 'frost' : 'dust', z.x + (Math.random() - 0.5) * z.radius, z.y + (Math.random() - 0.5) * z.radius, blue ? '#e0f6ff' : '#c8b8a0', blue ? 0.4 : 1.2, 1.4);
      } else if (v === 'spores') {
        const g = ctx.createRadialGradient(z.x, z.y, 0, z.x, z.y, z.radius);
        g.addColorStop(0, 'rgba(70,40,100,0.35)');
        g.addColorStop(1, 'rgba(70,40,100,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(z.x, z.y, z.radius, 0, Math.PI * 2);
        ctx.fill();
      } else if (v === 'signal') {
        ctx.strokeStyle = `rgba(255,255,255,${0.35 + 0.35 * Math.sin(t * 8)})`;
        ctx.lineWidth = 0.6;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(z.x, z.y, z.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (v === 'verse') {
        ctx.strokeStyle = `rgba(255,215,120,${0.25 + 0.15 * Math.sin(t * 3)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(z.x, z.y, z.radius, 0, Math.PI * 2);
        ctx.stroke();
      } else if (v === 'lure') {
        const g = ctx.createRadialGradient(z.x, z.y, 0, z.x, z.y, z.radius);
        g.addColorStop(0, 'rgba(120,255,220,0.10)');
        g.addColorStop(1, 'rgba(120,255,220,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(z.x, z.y, z.radius, 0, Math.PI * 2);
        ctx.fill();
      } else if (v === 'gust') {
        ctx.strokeStyle = 'rgba(230,245,255,0.18)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(z.x, z.y, z.radius, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  private drawDarkZones(ctx: CanvasRenderingContext2D): void {
    const t = this.time;
    for (const z of this.battle.zones) {
      if (!z.enabled || !z.def.light || z.def.light.mode !== 'ceiling') continue;
      if (!this.camera.visible(z.x, z.y, z.radius)) continue;
      const eclipse = z.def.visual === 'eclipse';
      const g = ctx.createRadialGradient(z.x, z.y, z.radius * 0.1, z.x, z.y, z.radius);
      g.addColorStop(0, eclipse ? 'rgba(6,2,14,0.72)' : 'rgba(12,6,24,0.62)');
      g.addColorStop(0.7, eclipse ? 'rgba(10,4,22,0.5)' : 'rgba(16,8,30,0.4)');
      g.addColorStop(1, 'rgba(16,8,30,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.radius, 0, Math.PI * 2);
      ctx.fill();
      // Drifting light-drinking spores.
      ctx.fillStyle = 'rgba(110,80,170,0.35)';
      const n = eclipse ? 18 : 10;
      for (let i = 0; i < n; i++) {
        const a = i * 2.39 + t * (0.2 + (i % 3) * 0.1) + z.id;
        const rr = z.radius * (0.2 + ((i * 53) % 80) / 100);
        ctx.beginPath();
        ctx.arc(z.x + Math.cos(a) * rr, z.y + Math.sin(a) * rr, 0.8 + (i % 3) * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawTelegraphs(ctx: CanvasRenderingContext2D): void {
    const b = this.battle;
    for (const tg of b.telegraphs) {
      const p = Math.max(0, Math.min(1, (b.time - tg.start) / Math.max(0.01, tg.end - tg.start)));
      const mine = tg.side === this.viewer;
      const col = mine ? '255,210,120' : '255,90,70';
      const flash = 0.5 + 0.5 * Math.sin(this.time * 14);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = `rgba(${col},${0.6 + 0.4 * flash})`;
      ctx.fillStyle = `rgba(${col},${0.08 + p * 0.22})`;
      ctx.beginPath();
      if (tg.shape === 'circle' || tg.shape === 'ring') {
        ctx.arc(tg.x, tg.y, tg.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(tg.x, tg.y, tg.radius * p, 0, Math.PI * 2);
        ctx.stroke();
      } else if (tg.shape === 'cone' || tg.shape === 'arc') {
        ctx.moveTo(tg.x, tg.y);
        ctx.arc(tg.x, tg.y, tg.radius, tg.dir - tg.angle / 2, tg.dir + tg.angle / 2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (tg.shape === 'line') {
        const ex = tg.x + Math.cos(tg.dir) * tg.radius;
        const ey = tg.y + Math.sin(tg.dir) * tg.radius;
        const nx = -Math.sin(tg.dir) * tg.width * 0.5;
        const ny = Math.cos(tg.dir) * tg.width * 0.5;
        ctx.moveTo(tg.x + nx, tg.y + ny);
        ctx.lineTo(ex + nx, ey + ny);
        ctx.lineTo(ex - nx, ey - ny);
        ctx.lineTo(tg.x - nx, tg.y - ny);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  private drawProjectiles(ctx: CanvasRenderingContext2D, alpha: number): void {
    const dt = 1 / 20;
    for (const p of this.battle.projectiles) {
      const f = Math.min(1, (p.t + alpha * dt) / p.T);
      const x = p.x0 + (p.x1 - p.x0) * f;
      const y = p.y0 + (p.y1 - p.y0) * f;
      if (!this.camera.visible(x, y, 5)) continue;
      const d = Math.sqrt((p.x1 - p.x0) * (p.x1 - p.x0) + (p.y1 - p.y0) * (p.y1 - p.y0));
      const h = p.arc * d * 4 * f * (1 - f);
      const w = p.weapon;
      // Shadow.
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(x - 0.3, y - 0.3, 0.6, 0.6);
      const px = x;
      const py = y - h;
      const ang = Math.atan2(p.y1 - p.y0 - (p.arc * d * 4 * (1 - 2 * f)), p.x1 - p.x0);
      switch (w.kind) {
        case 'arrow':
        case 'shard':
        case 'bolt':
        case 'javelin':
        case 'harpoon':
        case 'dart':
        case 'ballista': {
          const len = w.kind === 'ballista' ? 3.2 : w.kind === 'javelin' || w.kind === 'harpoon' ? 1.8 : 1.1;
          ctx.strokeStyle = w.kind === 'shard' ? '#eaffff' : w.kind === 'harpoon' ? '#efe6d6' : w.type === 'cold' ? '#bfe8ff' : '#2a2018';
          ctx.lineWidth = w.kind === 'ballista' ? 0.35 : 0.18;
          ctx.beginPath();
          ctx.moveTo(px - Math.cos(ang) * len, py - Math.sin(ang) * len);
          ctx.lineTo(px, py);
          ctx.stroke();
          break;
        }
        case 'firebomb':
        case 'glassPot':
        case 'kite': {
          const g = ctx.createRadialGradient(px, py, 0, px, py, w.kind === 'kite' ? 3 : 2);
          g.addColorStop(0, 'rgba(255,230,160,1)');
          g.addColorStop(0.4, 'rgba(255,140,40,0.8)');
          g.addColorStop(1, 'rgba(255,90,20,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(px, py, w.kind === 'kite' ? 3 : 2, 0, Math.PI * 2);
          ctx.fill();
          if (Math.random() < 0.3) this.effects.ambient('smoke', px, py, 'rgba(60,50,45,0.35)', 1, 1);
          break;
        }
        case 'frostBall':
          ctx.fillStyle = '#d8f4ff';
          ctx.beginPath();
          ctx.arc(px, py, 1, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'stone':
          ctx.fillStyle = '#6a6258';
          ctx.beginPath();
          ctx.arc(px, py, 1.1, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'spore':
          ctx.fillStyle = 'rgba(80,50,110,0.8)';
          ctx.beginPath();
          ctx.arc(px, py, 0.9, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'bolas':
          ctx.fillStyle = '#3a2a1a';
          ctx.beginPath();
          ctx.arc(px + Math.cos(this.time * 20) * 0.5, py + Math.sin(this.time * 20) * 0.5, 0.3, 0, Math.PI * 2);
          ctx.arc(px - Math.cos(this.time * 20) * 0.5, py - Math.sin(this.time * 20) * 0.5, 0.3, 0, Math.PI * 2);
          ctx.fill();
          break;
        default:
          ctx.fillStyle = '#fff';
          ctx.fillRect(px - 0.3, py - 0.3, 0.6, 0.6);
      }
    }
  }

  private drawBeams(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const bm of this.effects.beams) {
      const f = bm.life / bm.max;
      const pw = Math.max(0.25, bm.power);
      const wide = bm.kind === 'heliostat' ? 4 : bm.kind === 'lance' ? 6 : 1.2;
      ctx.strokeStyle = `rgba(255,220,140,${0.25 * f * pw})`;
      ctx.lineWidth = wide * 2.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(bm.x1, bm.y1);
      ctx.lineTo(bm.x2, bm.y2);
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,240,${0.9 * f * Math.min(1, pw)})`;
      ctx.lineWidth = wide * 0.4;
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawParticles(ctx: CanvasRenderingContext2D): void {
    for (const p of this.effects.particles) {
      const f = p.life / p.max;
      ctx.globalAlpha = Math.max(0, Math.min(1, f * (p.kind === 'smoke' ? 0.6 : 1)));
      ctx.fillStyle = p.color;
      if (p.kind === 'spark' || p.kind === 'ember' || p.kind === 'frost' || p.kind === 'glass') {
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    for (const r of this.effects.rings) {
      const f = 1 - r.life / r.max;
      ctx.globalAlpha = Math.max(0, 1 - f);
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width;
      ctx.beginPath();
      ctx.arc(r.x, r.y, Math.max(0.1, r.r * (0.15 + 0.85 * f)), 0, Math.PI * 2);
      ctx.stroke();
      if (r.fill) {
        ctx.fillStyle = r.fill;
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Darkness for Dim and Dark maps, with holes where light zones, fires,
   * beams and the Nailbearer burn; then colored glows added on top.
   */
  private drawLighting(ctx: CanvasRenderingContext2D, k: number, tx: number, ty: number): void {
    const b = this.battle;
    const light = b.terrain.light;
    const cam = this.camera;
    const lc = this.lightCanvas;
    const l = this.lightCtx;
    const lights: { x: number; y: number; r: number; color: string; strength: number }[] = [];
    for (const z of b.zones) {
      if (!z.enabled) continue;
      const lz = z.def.light;
      if (z.def.dps) lights.push({ x: z.x, y: z.y, r: z.radius * 2.2, color: 'rgba(255,140,50,', strength: 0.9 });
      if (!lz || lz.mode !== 'floor') continue;
      const color = z.def.visual === 'lantern' ? 'rgba(255,190,90,' : 'rgba(255,245,210,';
      lights.push({ x: z.x, y: z.y, r: z.radius * 1.25, color, strength: lz.intensity >= 2 ? 1 : 0.8 });
    }
    for (const bm of this.effects.beams) {
      const f = bm.life / bm.max;
      lights.push({ x: bm.x2, y: bm.y2, r: bm.kind === 'beam' ? 6 : 18, color: 'rgba(255,245,210,', strength: f });
    }
    const dark = light === 0 ? 0.42 : light === 1 ? 0.24 : 0;
    if (dark > 0) {
      l.setTransform(1, 0, 0, 1, 0, 0);
      l.globalCompositeOperation = 'source-over';
      l.clearRect(0, 0, lc.width, lc.height);
      l.fillStyle = light === 0 ? `rgba(4,6,22,${dark})` : `rgba(20,12,30,${dark})`;
      l.fillRect(0, 0, lc.width, lc.height);
      l.globalCompositeOperation = 'destination-out';
      const hk = k / this.dpr / 2;
      const htx = tx / this.dpr / 2;
      const hty = ty / this.dpr / 2;
      for (const s of lights) {
        const x = s.x * hk + htx;
        const y = s.y * hk + hty;
        const r = s.r * hk;
        if (x < -r || y < -r || x > lc.width + r || y > lc.height + r) continue;
        const g = l.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(0,0,0,${s.strength})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        l.fillStyle = g;
        l.beginPath();
        l.arc(x, y, r, 0, Math.PI * 2);
        l.fill();
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(lc, 0, 0, this.canvas.width, this.canvas.height);
    }
    // Colored glows.
    ctx.setTransform(k, 0, 0, k, tx, ty);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of lights) {
      if (!cam.visible(s.x, s.y, s.r)) continue;
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
      g.addColorStop(0, `${s.color}${0.22 * s.strength})`);
      g.addColorStop(1, `${s.color}0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Light signatures at a distance: Hush glowing dots, Vesperate lanterns, Choir molten glass.
    if (light <= 2) {
      for (const u of b.units) {
        if (!this.shouldDraw(u)) continue;
        const glow = u.def.silhouette.glow;
        if (!glow) continue;
        const bright = hasMechanic(u.def, 'glows') ? 1 : u.faction === 'hush' ? 0.55 : u.faction === 'vesperate' ? 0.6 : 0.4;
        if (u.faction === 'drift') continue;
        ctx.fillStyle = glow;
        ctx.globalAlpha = bright * (light === 2 ? 0.5 : 1);
        const step = u.soldiers.length > 40 ? 3 : 1;
        for (let i = 0; i < u.soldiers.length; i += step) {
          const s = u.soldiers[i]!;
          if (!s.alive) continue;
          ctx.fillRect(s.x - 0.35, s.y - 0.35, 0.7, 0.7);
        }
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    // Aurora over the Evernight.
    if (b.terrain.band === 'evernight') {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const W = this.canvas.width;
      const H = this.canvas.height;
      for (let band = 0; band < 3; band++) {
        const y0 = H * (0.2 + band * 0.25) + Math.sin(this.time * 0.15 + band) * H * 0.08;
        const g = ctx.createLinearGradient(0, y0 - H * 0.12, 0, y0 + H * 0.12);
        const c = band === 1 ? '140,90,255' : '60,255,170';
        g.addColorStop(0, `rgba(${c},0)`);
        g.addColorStop(0.5, `rgba(${c},0.07)`);
        g.addColorStop(1, `rgba(${c},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0, y0);
        for (let x = 0; x <= W; x += W / 12) ctx.lineTo(x, y0 + Math.sin(x / W * 6 + this.time * 0.3 + band) * H * 0.05 - H * 0.12);
        ctx.lineTo(W, y0 + H * 0.12);
        ctx.lineTo(0, y0 + H * 0.12);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  /** Wind: drifting motes and short streaks, always sunward; speed shows the strength. */
  private drawWind(ctx: CanvasRenderingContext2D, dt: number): void {
    const b = this.battle;
    const w = b.terrain.wind + b.windBonus;
    const dir = b.terrain.sunBearing;
    const cx = Math.cos(dir);
    const cy = Math.sin(dir);
    const speed = w === 0 ? 2 : w === 1 ? 10 : 22;
    const n = w === 0 ? 14 : w === 1 ? 36 : 64;
    const cam = this.camera;
    const hw = cam.width / 2 / cam.zoom;
    const hh = cam.height / 2 / cam.zoom;
    const night = b.terrain.light <= 1;
    ctx.lineCap = 'round';
    for (let i = 0; i < n && i < this.streaks.length; i++) {
      const s = this.streaks[i]!;
      s.life -= dt;
      s.x += cx * speed * dt;
      s.y += cy * speed * dt;
      if (s.life <= 0 || Math.abs(s.x - cam.x) > hw || Math.abs(s.y - cam.y) > hh) {
        s.x = cam.x + (Math.random() - 0.5) * 2 * hw;
        s.y = cam.y + (Math.random() - 0.5) * 2 * hh;
        s.life = 2 + Math.random() * 3;
      }
      // Fade in and out over each mote's life.
      const a = Math.min(1, s.life, 1.2) * (night ? 0.18 : 0.22);
      const len = (w === 0 ? 2 : w === 1 ? 6 : 11) / cam.zoom;
      const wob = Math.sin(s.life * 3 + i) * 1.5 / cam.zoom;
      ctx.strokeStyle = night ? `rgba(190,205,255,${a})` : `rgba(255,248,230,${a})`;
      ctx.lineWidth = 1.2 / cam.zoom;
      ctx.beginPath();
      ctx.moveTo(s.x - cy * wob, s.y + cx * wob);
      ctx.lineTo(s.x - cx * len, s.y - cy * len);
      ctx.stroke();
    }
  }

  /** The sun's position shown as a glow at the screen edge (it never moves). */
  private drawSunGlow(ctx: CanvasRenderingContext2D): void {
    const b = this.battle;
    const light = b.terrain.light;
    const cam = this.camera;
    const dir = b.terrain.sunBearing;
    const cx = cam.width / 2 + Math.cos(dir) * cam.width * 0.62;
    const cy = cam.height / 2 + Math.sin(dir) * cam.height * 0.62;
    const R = Math.max(cam.width, cam.height) * 0.42;
    let col = '';
    let a = 0;
    if (light === 2) {
      col = '255,150,60';
      a = 0.16;
    } else if (light === 3) {
      col = '255,245,210';
      a = 0.1;
    } else if (light === 1) {
      col = '200,60,50';
      a = 0.14;
    } else if (light === 4) {
      ctx.fillStyle = 'rgba(255,255,240,0.1)';
      ctx.fillRect(0, 0, cam.width, cam.height);
      return;
    }
    if (!col) return;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    g.addColorStop(0, `rgba(${col},${a})`);
    g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cam.width, cam.height);
  }

  // ----------------------------------------------------------- UI in world

  private drawDeployZone(ctx: CanvasRenderingContext2D, z: { x: number; y: number; w: number; h: number }): void {
    ctx.fillStyle = 'rgba(90,169,255,0.08)';
    ctx.fillRect(z.x, z.y, z.w, z.h);
    ctx.strokeStyle = 'rgba(140,200,255,0.7)';
    ctx.lineWidth = 1.2 / this.camera.zoom;
    ctx.setLineDash([8 / this.camera.zoom, 6 / this.camera.zoom]);
    ctx.strokeRect(z.x, z.y, z.w, z.h);
    ctx.setLineDash([]);
  }

  private drawSelection(ctx: CanvasRenderingContext2D, ov: Overlay, alpha: number): void {
    const zoom = this.camera.zoom;
    for (const id of ov.selected) {
      const u = this.battle.units[id];
      if (!u || !this.shouldDraw(u)) continue;
      ctx.fillStyle = 'rgba(255,225,140,0.55)';
      if (zoom < 1.25 || u.def.category === 'colossus') {
        const c = this.unitCenter(u, alpha);
        const sz = formationSize(u);
        ctx.strokeStyle = 'rgba(255,225,140,0.9)';
        ctx.lineWidth = 1.5 / zoom;
        ctx.beginPath();
        ctx.arc(c.x, c.y, Math.max(sz.width, sz.depth) * 0.6 + 4 + (u.def.radius ?? 0), 0, Math.PI * 2);
        ctx.stroke();
        continue;
      }
      for (const s of u.soldiers) {
        if (!s.alive) continue;
        const x = s.px + (s.x - s.px) * alpha;
        const y = s.py + (s.y - s.py) * alpha;
        ctx.beginPath();
        ctx.arc(x, y, s.radius + 0.35, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (ov.hover >= 0 && !ov.selected.has(ov.hover)) {
      const u = this.battle.units[ov.hover];
      if (u && this.shouldDraw(u)) {
        ctx.fillStyle = u.side === this.viewer ? 'rgba(255,255,255,0.3)' : 'rgba(255,110,90,0.35)';
        for (const s of u.soldiers) {
          if (!s.alive) continue;
          ctx.beginPath();
          ctx.arc(s.px + (s.x - s.px) * alpha, s.py + (s.y - s.py) * alpha, s.radius + 0.3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  private drawOrders(ctx: CanvasRenderingContext2D, ov: Overlay): void {
    const zoom = this.camera.zoom;
    ctx.lineWidth = 1.4 / zoom;
    for (const id of ov.selected) {
      const u = this.battle.units[id];
      if (!u || u.state !== 'ready') continue;
      const o = u.order;
      if (o.kind === 'move') {
        ctx.strokeStyle = 'rgba(160,220,140,0.75)';
        ctx.setLineDash([6 / zoom, 5 / zoom]);
        ctx.beginPath();
        ctx.moveTo(u.x, u.y);
        for (const p of u.path) ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.setLineDash([]);
        const sz = formationSize(u);
        this.ghost(ctx, o.x, o.y, o.facing, sz.width, sz.depth, 'rgba(160,220,140,0.25)', 'rgba(160,220,140,0.8)');
      } else if (o.kind === 'attack') {
        const t = this.battle.units[o.target];
        if (!t || !this.shouldDraw(t)) continue;
        ctx.strokeStyle = 'rgba(255,110,90,0.85)';
        ctx.beginPath();
        ctx.moveTo(u.x, u.y);
        ctx.lineTo(t.x, t.y);
        ctx.stroke();
        const a = Math.atan2(t.y - u.y, t.x - u.x);
        ctx.fillStyle = 'rgba(255,110,90,0.85)';
        ctx.beginPath();
        ctx.moveTo(t.x, t.y);
        ctx.lineTo(t.x - Math.cos(a - 0.4) * 10 / zoom * 2, t.y - Math.sin(a - 0.4) * 10 / zoom * 2);
        ctx.lineTo(t.x - Math.cos(a + 0.4) * 10 / zoom * 2, t.y - Math.sin(a + 0.4) * 10 / zoom * 2);
        ctx.fill();
      }
    }
    for (const p of ov.preview) this.ghost(ctx, p.x, p.y, p.facing, p.width, p.depth, 'rgba(255,225,140,0.22)', 'rgba(255,225,140,0.9)');
  }

  private ghost(ctx: CanvasRenderingContext2D, x: number, y: number, f: number, w: number, d: number, fill: string, stroke: string): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(f);
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1 / this.camera.zoom;
    ctx.fillRect(-d / 2, -w / 2, d, w);
    ctx.strokeRect(-d / 2, -w / 2, d, w);
    ctx.beginPath();
    ctx.moveTo(d / 2, -w / 2);
    ctx.lineTo(d / 2 + Math.min(6, w * 0.2), 0);
    ctx.lineTo(d / 2, w / 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawAbilityPreview(ctx: CanvasRenderingContext2D, a: NonNullable<Overlay['abilityPreview']>): void {
    ctx.strokeStyle = a.ok ? 'rgba(255,225,140,0.9)' : 'rgba(255,110,90,0.9)';
    ctx.fillStyle = a.ok ? 'rgba(255,225,140,0.14)' : 'rgba(255,110,90,0.1)';
    ctx.lineWidth = 1.2 / this.camera.zoom;
    ctx.beginPath();
    if (a.shape === 'circle') ctx.arc(a.x, a.y, a.radius, 0, Math.PI * 2);
    else if (a.shape === 'cone') {
      const dir = Math.atan2(a.y - a.oy, a.x - a.ox);
      ctx.moveTo(a.ox, a.oy);
      ctx.arc(a.ox, a.oy, a.radius, dir - a.angle / 2, dir + a.angle / 2);
      ctx.closePath();
    } else {
      const dir = Math.atan2(a.y - a.oy, a.x - a.ox);
      const ex = a.ox + Math.cos(dir) * a.radius;
      const ey = a.oy + Math.sin(dir) * a.radius;
      const nx = -Math.sin(dir) * a.width * 0.5;
      const ny = Math.cos(dir) * a.width * 0.5;
      ctx.moveTo(a.ox + nx, a.oy + ny);
      ctx.lineTo(ex + nx, ey + ny);
      ctx.lineTo(ex - nx, ey - ny);
      ctx.lineTo(a.ox - nx, a.oy - ny);
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();
  }

  private drawPings(ctx: CanvasRenderingContext2D, ov: Overlay): void {
    for (const p of ov.pings) {
      const age = this.time - p.t;
      if (age > 0.8) continue;
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = 1 - age / 0.8;
      ctx.lineWidth = 2 / this.camera.zoom;
      ctx.beginPath();
      ctx.arc(p.x, p.y, (4 + age * 20) / Math.max(0.5, this.camera.zoom * 0.6), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ov.pings = ov.pings.filter((p) => this.time - p.t < 0.8);
  }

  now(): number {
    return this.time;
  }

  /** Unit flags above each formation: team color, role icon, strength and morale. */
  private drawBanners(ctx: CanvasRenderingContext2D, ov: Overlay, alpha: number): void {
    const cam = this.camera;
    for (const u of this.battle.units) {
      if (!this.shouldDraw(u)) continue;
      const c = this.unitCenter(u, alpha);
      const s = cam.toScreen(c.x, c.y);
      const sz = formationSize(u);
      const lift = Math.max(sz.depth, u.def.radius ?? 0) * cam.zoom * 0.5 + 16 + (isFlyer(u.def) ? 10 : 0);
      const x = s.x;
      const y = s.y - lift;
      if (x < -30 || y < -30 || x > cam.width + 30 || y > cam.height + 30) continue;
      const sel = ov.selected.has(u.id);
      const ms = moraleState(u);
      const team = TEAM[u.side];
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y + 9);
      ctx.lineTo(x, y + 18);
      ctx.stroke();
      const w = 22;
      const h = 16;
      ctx.fillStyle = sel ? '#ffe6a0' : team;
      ctx.fillRect(x - w / 2 - 1, y - h / 2 - 1, w + 2, h + 2);
      // Banner cloth in the side's color, so friend and foe read at a glance.
      ctx.fillStyle = ms === 'broken' ? (Math.floor(this.time * 4) % 2 ? '#7a1a14' : '#2a0a08') : u.side === 0 ? '#1b3a68' : '#6a1f1a';
      ctx.fillRect(x - w / 2, y - h / 2, w, h);
      drawRoleIcon(ctx, u.def, x, y, 13, sel ? '#ffe6a0' : '#f0e8d8');
      // Strength and morale bars.
      const frac = u.alive / u.initial;
      const mfrac = Math.max(0, u.morale / Math.max(1, u.maxMorale));
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(x - w / 2 - 1, y + h / 2 + 1, w + 2, 6);
      ctx.fillStyle = '#e8dcc0';
      ctx.fillRect(x - w / 2, y + h / 2 + 2, w * frac, 2);
      ctx.fillStyle = ms === 'steady' ? '#7fd18b' : ms === 'wavering' ? '#f2c14e' : '#e0574b';
      ctx.fillRect(x - w / 2, y + h / 2 + 4, w * mfrac, 2);
      // Status marks: hidden, glare, the Toll.
      let mx = x + w / 2 + 4;
      if (u.concealed && u.side === this.viewer) {
        ctx.fillStyle = '#b8a8ff';
        ctx.font = '600 10px "Alegreya Sans", sans-serif';
        ctx.fillText('◐', mx, y + 4);
        mx += 10;
      }
      if (u.stats.glareAcc < 0 && u.side === this.viewer) {
        ctx.fillStyle = '#ffd27a';
        ctx.font = '600 10px "Alegreya Sans", sans-serif';
        ctx.fillText('☀', mx, y + 4);
        mx += 10;
      }
      if (this.battle.time < u.tollUntil) {
        ctx.strokeStyle = '#ffd27a';
        ctx.beginPath();
        ctx.arc(x, y, 13, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  private drawTexts(ctx: CanvasRenderingContext2D, alpha: number): void {
    const cam = this.camera;
    let bannerY = 70;
    for (const t of this.effects.texts) {
      const f = t.life / t.max;
      let x: number;
      let y: number;
      if (Number.isNaN(t.x)) {
        if (t.y < 0) {
          x = cam.width / 2;
          y = bannerY;
          bannerY += 30;
        } else {
          const u = this.battle.units[t.y];
          if (!u) continue;
          const c = this.unitCenter(u, alpha);
          const s = cam.toScreen(c.x, c.y);
          x = s.x;
          y = s.y - 40 - (1 - f) * 20;
        }
      } else {
        const s = cam.toScreen(t.x, t.y);
        x = s.x;
        y = s.y - (1 - f) * 24;
      }
      ctx.globalAlpha = Math.min(1, f * 2);
      ctx.font = t.big ? '600 22px "Cormorant SC", Georgia, serif' : '600 13px "Alegreya Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(10,6,20,0.85)';
      ctx.strokeText(t.text, x, y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, x, y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'start';
  }

  /** Stamp new deaths into the decal layer. */
  private stampCorpses(): void {
    const list = this.effects.corpses;
    if (!list.length) return;
    const ctx = this.art.decals.getContext('2d')!;
    const S = this.art.scale;
    for (const c of list) {
      const u = this.battle.units[c.unit];
      const glassy = u && (u.faction === 'choir' && (u.def.category === 'monster' || u.def.category === 'colossus'));
      ctx.fillStyle = glassy ? 'rgba(240,235,220,0.7)' : u?.faction === 'hush' ? 'rgba(40,60,90,0.55)' : 'rgba(70,25,20,0.5)';
      const r = (c.big ? 3.5 : 0.7) * S;
      ctx.beginPath();
      ctx.ellipse(c.x * S, c.y * S, r, r * 0.7, (c.x * 7) % 3, 0, Math.PI * 2);
      ctx.fill();
    }
    list.length = 0;
  }

  /** Nearest unit under a screen point (for picking). */
  pick(sx: number, sy: number, filter?: (u: Unit) => boolean): Unit | null {
    const w = this.camera.toWorld(sx, sy);
    let best: Unit | null = null;
    let bd = Infinity;
    const tol = Math.max(3, 10 / this.camera.zoom);
    for (const u of this.battle.units) {
      if (!this.shouldDraw(u)) continue;
      if (filter && !filter(u)) continue;
      for (const s of u.soldiers) {
        if (!s.alive) continue;
        const d = Math.sqrt((s.x - w.x) * (s.x - w.x) + (s.y - w.y) * (s.y - w.y)) - s.radius;
        if (d < bd && d < tol) {
          bd = d;
          best = u;
        }
      }
    }
    // Clicking a banner selects its unit.
    for (const u of this.battle.units) {
      if (!this.shouldDraw(u) || (filter && !filter(u))) continue;
      const c = this.unitCenter(u, 1);
      const s = this.camera.toScreen(c.x, c.y);
      const sz = formationSize(u);
      const lift = Math.max(sz.depth, u.def.radius ?? 0) * this.camera.zoom * 0.5 + 16 + (isFlyer(u.def) ? 10 : 0);
      if (Math.abs(sx - s.x) < 13 && Math.abs(sy - (s.y - lift)) < 10) return u;
    }
    return best;
  }

  soldierAt(s: Soldier): { x: number; y: number } {
    return this.camera.toScreen(s.x, s.y);
  }

  zonesVisible(): Zone[] {
    return this.battle.zones;
  }
}

function voidColor(light: number): string {
  return light === 0 ? '#05060f' : light === 1 ? '#15101c' : light === 2 ? '#1c1424' : light === 3 ? '#2a2218' : '#3a3428';
}

const teamMixCache = new Map<string, string>();
function mixTeam(primary: string, team: string): string {
  const key = primary + team;
  let v = teamMixCache.get(key);
  if (!v) {
    const a = parseInt(primary.slice(1), 16);
    const b = parseInt(team.slice(1), 16);
    const r = Math.round(((a >> 16) & 255) * 0.55 + ((b >> 16) & 255) * 0.45);
    const g = Math.round(((a >> 8) & 255) * 0.55 + ((b >> 8) & 255) * 0.45);
    const bl = Math.round((a & 255) * 0.55 + (b & 255) * 0.45);
    v = `rgb(${r},${g},${bl})`;
    teamMixCache.set(key, v);
  }
  return v;
}
