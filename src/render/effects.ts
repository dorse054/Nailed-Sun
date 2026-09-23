/**
 * Visual effects spawned from simulation events: sparks, smoke, fire, frost,
 * shockwaves, beams and floating text. Purely cosmetic and not deterministic.
 */
import type { SimEvent } from '../sim/types';
import { TEAM } from './color';

export interface Particle {
  kind: 'spark' | 'dust' | 'smoke' | 'ember' | 'frost' | 'spore' | 'glass' | 'blood' | 'flame' | 'steam';
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
}

export interface Ring {
  x: number;
  y: number;
  r: number;
  life: number;
  max: number;
  color: string;
  width: number;
  fill?: string;
}

export interface Beam {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  life: number;
  max: number;
  kind: 'beam' | 'heliostat' | 'lance';
  power: number;
  blocked: boolean;
}

export interface FloatText {
  x: number;
  y: number;
  text: string;
  life: number;
  max: number;
  color: string;
  big: boolean;
}

const MAX_PARTICLES = 2400;

export class Effects {
  particles: Particle[] = [];
  rings: Ring[] = [];
  beams: Beam[] = [];
  texts: FloatText[] = [];
  /** Deaths to stamp into the ground decal layer. */
  corpses: { x: number; y: number; big: boolean; unit: number }[] = [];
  private seed = 1;

  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private burst(kind: Particle['kind'], x: number, y: number, n: number, speed: number, life: number, size: number, color: string): void {
    for (let i = 0; i < n; i++) {
      if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
      const a = this.rand() * Math.PI * 2;
      const v = speed * (0.3 + this.rand() * 0.7);
      this.particles.push({ kind, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: life * (0.6 + this.rand() * 0.6), max: life, size: size * (0.6 + this.rand() * 0.8), color });
    }
  }

  text(x: number, y: number, text: string, color: string, big = false): void {
    this.texts.push({ x, y, text, life: big ? 3.2 : 2.2, max: big ? 3.2 : 2.2, color, big });
    if (this.texts.length > 40) this.texts.shift();
  }

  consume(events: SimEvent[], unitName: (id: number) => string, viewer: 0 | 1): void {
    for (const e of events) {
      switch (e.t) {
        case 'impact':
          if (e.kind === 'stone') {
            this.burst('dust', e.x, e.y, 10, 9, 1.1, 2.2, '#8a7a60');
            this.rings.push({ x: e.x, y: e.y, r: e.splash, life: 0.4, max: 0.4, color: 'rgba(200,180,140,0.7)', width: 1 });
          } else if (e.kind === 'firebomb' || e.kind === 'glassPot' || e.kind === 'kite') {
            this.burst('flame', e.x, e.y, 14, 7, 0.8, 2.4, e.kind === 'glassPot' ? '#ffb040' : '#ff7a20');
            this.burst('ember', e.x, e.y, 10, 12, 1.2, 0.6, '#ffd070');
            this.burst('smoke', e.x, e.y, 5, 3, 2.2, 3, 'rgba(60,50,45,0.5)');
          } else if (e.kind === 'frostBall') {
            this.burst('frost', e.x, e.y, 16, 10, 1, 1, '#cfefff');
            this.rings.push({ x: e.x, y: e.y, r: e.splash, life: 0.5, max: 0.5, color: 'rgba(190,230,255,0.8)', width: 1 });
          } else if (e.kind === 'spore') {
            this.burst('spore', e.x, e.y, 18, 5, 2.5, 2.6, 'rgba(60,40,90,0.45)');
          } else if (e.kind === 'ballista' || e.kind === 'harpoon') {
            this.burst('dust', e.x, e.y, 5, 6, 0.6, 1.2, '#9a8a70');
          } else {
            this.burst('dust', e.x, e.y, 4, 4, 0.5, 1, '#9a8a70');
          }
          break;
        case 'hit':
          if (e.type === 'fire') this.burst('ember', e.x, e.y, e.big ? 8 : 3, 6, 0.6, 0.5, '#ffb050');
          else if (e.type === 'cold') this.burst('frost', e.x, e.y, e.big ? 8 : 3, 5, 0.6, 0.5, '#d8f4ff');
          else if (e.type === 'resonance') this.rings.push({ x: e.x, y: e.y, r: e.big ? 6 : 2.5, life: 0.35, max: 0.35, color: 'rgba(233,200,110,0.8)', width: 0.4 });
          else this.burst('spark', e.x, e.y, 2, 5, 0.25, 0.4, '#fff4d0');
          break;
        case 'block':
          this.burst('spark', e.x, e.y, 2, 4, 0.2, 0.35, '#ffffff');
          break;
        case 'death':
          this.corpses.push({ x: e.x, y: e.y, big: e.big, unit: e.unit });
          if (e.big) {
            this.burst('dust', e.x, e.y, 30, 10, 2, 4, '#8a7a60');
            this.burst('glass', e.x, e.y, 16, 12, 1.4, 0.8, '#f4efe0');
          }
          break;
        case 'charge':
          this.burst('dust', e.x, e.y, 14, 8, 1.2, 2, '#a08c6a');
          this.rings.push({ x: e.x, y: e.y, r: 10 + e.power * 0.15, life: 0.5, max: 0.5, color: 'rgba(255,240,200,0.55)', width: 0.8 });
          break;
        case 'toll':
          for (let k = 0; k < (e.big ? 3 : 2); k++) {
            this.rings.push({ x: e.x, y: e.y, r: (e.big ? 260 : 150) * (1 - k * 0.25), life: 1.6 + k * 0.3, max: 1.6 + k * 0.3, color: 'rgba(255,205,110,0.75)', width: e.big ? 3 : 2 });
          }
          this.text(e.x, e.y - 12, e.big ? 'OLD MIDNIGHT TOLLS' : 'The Toll', '#ffd27a', e.big);
          break;
        case 'ability':
          this.text(e.x, e.y - 8, e.name, e.side === viewer ? '#ffe7a8' : '#ffb0a0');
          break;
        case 'rout':
          this.text(0, 0, `${unitName(e.unit)} routs`, TEAM[e.side], false);
          this.texts[this.texts.length - 1]!.x = NaN;
          this.texts[this.texts.length - 1]!.y = e.unit;
          break;
        case 'rally':
          this.text(NaN, e.unit, 'Rallied', '#bfe8a8');
          break;
        case 'shatter':
          this.text(NaN, e.unit, 'Shattered', '#ff8a7a');
          break;
        case 'general':
          this.text(NaN, -1, e.side === viewer ? 'Your general has fallen' : 'The enemy general has fallen', e.side === viewer ? '#ff8a7a' : '#ffe7a8', true);
          break;
        case 'shockwave': {
          const col =
            e.kind === 'bell'
              ? 'rgba(255,210,120,0.95)'
              : e.kind === 'knell'
                ? 'rgba(220,190,120,0.7)'
                : e.kind === 'flash'
                  ? 'rgba(255,255,240,0.95)'
                  : e.kind === 'eyes'
                    ? 'rgba(190,140,255,0.8)'
                    : 'rgba(170,150,120,0.7)';
          this.rings.push({ x: e.x, y: e.y, r: e.r, life: e.kind === 'flash' ? 0.7 : 1.1, max: e.kind === 'flash' ? 0.7 : 1.1, color: col, width: e.kind === 'bell' ? 4 : 2, fill: e.kind === 'flash' ? 'rgba(255,255,235,0.5)' : undefined });
          if (e.kind === 'dust' || e.kind === 'ram') this.burst('dust', e.x, e.y, 24, 12, 1.6, 3.5, '#8a7a60');
          break;
        }
        case 'beam':
          this.beams.push({ x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, life: e.kind === 'beam' ? 0.22 : e.kind === 'lance' ? 0.12 : 0.55, max: e.kind === 'beam' ? 0.22 : e.kind === 'lance' ? 0.12 : 0.55, kind: e.kind, power: e.power, blocked: e.blocked });
          if (e.blocked) this.burst('smoke', e.x2, e.y2, 4, 2, 0.8, 1.5, 'rgba(30,20,40,0.6)');
          if (this.beams.length > 300) this.beams.shift();
          break;
        case 'text':
          this.text(e.x, e.y - 6, e.text, e.side === viewer ? '#ffe7a8' : '#ffb8a8');
          break;
        case 'fire':
          this.burst('flame', e.x, e.y, 4, 3, 0.8, 2, '#ff8a2a');
          break;
        case 'shot':
          break;
      }
    }
  }

  update(dt: number): void {
    let w = 0;
    for (const p of this.particles) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const drag = p.kind === 'smoke' || p.kind === 'spore' || p.kind === 'steam' ? 0.9 : 0.8;
      p.vx *= Math.pow(drag, dt * 10);
      p.vy *= Math.pow(drag, dt * 10);
      if (p.kind === 'smoke' || p.kind === 'steam') p.size += dt * 1.5;
      this.particles[w++] = p;
    }
    this.particles.length = w;
    this.rings = this.rings.filter((r) => (r.life -= dt) > 0);
    this.beams = this.beams.filter((b) => (b.life -= dt) > 0);
    this.texts = this.texts.filter((t) => (t.life -= dt) > 0);
  }

  /** Ambient particles: embers over fires, steam over vents. */
  ambient(kind: Particle['kind'], x: number, y: number, color: string, size: number, life: number): void {
    if (this.particles.length >= MAX_PARTICLES) return;
    this.particles.push({ kind, x, y, vx: (this.rand() - 0.5) * 2, vy: (this.rand() - 0.5) * 2, life, max: life, size, color });
  }
}
