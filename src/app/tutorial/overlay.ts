/**
 * Tutorial pointers drawn over the battle: rings and circles on the field
 * (an SVG layer just above the battle canvas, under the HUD) and outlines
 * around HUD elements (above the HUD). Both are redrawn every frame and let
 * every click through.
 */
import type { BattleRenderer } from '../../render/battleRenderer';
import { formationSize } from '../../sim/army';
import { isFlyer } from '../../sim/mechanics';
import type { Side } from '../../sim/types';
import type { Mark } from './types';

const NS = 'http://www.w3.org/2000/svg';

/** The part of the screen not covered by the HUD, in CSS pixels. */
export interface FreeRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const TONES = {
  gold: { stroke: '#ffd27a', fill: 'rgba(255,210,122,0.10)' },
  foe: { stroke: '#ff7a66', fill: 'rgba(255,107,90,0.10)' },
  good: { stroke: '#8fe09a', fill: 'rgba(127,209,139,0.14)' },
} as const;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function label(x: number, y: number, text: string, color: string, anchor = 'middle'): string {
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" fill="${color}" class="tut-mark-label">${esc(text)}</text>`;
}

/** Labels already drawn this frame, so the next ones can dodge them. */
class LabelBoxes {
  private boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];

  /** The first of the candidate baselines where the label overlaps nothing, or null. */
  place(x: number, ys: number[], text: string, anchor = 'middle'): number | null {
    const w = text.length * 7.4 + 8;
    const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
    for (const y of ys) {
      const b = { x0, y0: y - 13, x1: x0 + w, y1: y + 4 };
      if (this.boxes.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0)) continue;
      this.boxes.push(b);
      return y;
    }
    return null;
  }
}

type Put = (x: number, ys: number[], text: string, color: string, anchor?: string) => string;

/** An arrow at the edge of the free area pointing at something off screen. */
function edgeArrow(x: number, y: number, free: FreeRect, color: string, put: Put, text?: string): string {
  const m = 26;
  const cx = (free.left + free.right) / 2;
  const cy = (free.top + free.bottom) / 2;
  const dx = x - cx;
  const dy = y - cy;
  const hw = Math.max(1, (free.right - free.left) / 2 - m);
  const hh = Math.max(1, (free.bottom - free.top) / 2 - m);
  const k = Math.min(hw / Math.max(1e-6, Math.abs(dx)), hh / Math.max(1e-6, Math.abs(dy)));
  const ax = cx + dx * k;
  const ay = cy + dy * k;
  const a = Math.atan2(dy, dx);
  const p = (r: number, t: number) => `${(ax + Math.cos(a + t) * r).toFixed(1)},${(ay + Math.sin(a + t) * r).toFixed(1)}`;
  let out = `<polygon points="${p(14, 0)} ${p(10, 2.5)} ${p(10, -2.5)}" fill="${color}" stroke="rgba(10,6,20,0.8)" stroke-width="1.5"/>`;
  if (text) {
    const lx = ax - Math.cos(a) * 16;
    const ly = ay - Math.sin(a) * 16 + (Math.sin(a) > 0.5 ? -8 : 14);
    const anchor = Math.cos(a) > 0.5 ? 'end' : Math.cos(a) < -0.5 ? 'start' : 'middle';
    out += put(lx, [ly, ly + (Math.sin(a) > 0.5 ? -16 : 16)], text, color, anchor);
  }
  return out;
}

function inside(x: number, y: number, free: FreeRect, pad = 8): boolean {
  return x >= free.left + pad && x <= free.right - pad && y >= free.top + pad && y <= free.bottom - pad;
}

export class FieldMarks {
  private readonly svg: SVGSVGElement;
  private last = '';
  private readonly calm: boolean;

  constructor(parent: HTMLElement) {
    this.svg = document.createElementNS(NS, 'svg') as SVGSVGElement;
    this.svg.setAttribute('class', 'tut-marks');
    this.svg.setAttribute('aria-hidden', 'true');
    parent.appendChild(this.svg);
    this.calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  dispose(): void {
    this.svg.remove();
  }

  draw(marks: Mark[], r: BattleRenderer, viewer: Side, free: FreeRect, now: number): void {
    const cam = r.camera;
    const pulse = this.calm ? 0.5 : 0.5 + 0.5 * Math.sin(now / 260);
    const boxes = new LabelBoxes();
    const put: Put = (x, ys, text, color, anchor = 'middle') => {
      const y = boxes.place(x, ys, text, anchor);
      return y === null ? '' : label(x, y, text, color, anchor);
    };
    let html = '';
    for (const m of marks) {
      if (m.kind === 'area') {
        const tone = m.done ? TONES.good : TONES.gold;
        const c = cam.toScreen(m.x, m.y);
        const rr = Math.max(12, m.r * cam.zoom);
        if (!inside(c.x, c.y, free, -rr * 0.5)) {
          html += edgeArrow(c.x, c.y, free, tone.stroke, put, m.label);
          continue;
        }
        html += `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${rr.toFixed(1)}" fill="${tone.fill}" stroke="${tone.stroke}" stroke-width="2" stroke-dasharray="7 5"/>`;
        if (!m.done) {
          const pr = rr + 4 + pulse * 8;
          html += `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${pr.toFixed(1)}" fill="none" stroke="${tone.stroke}" stroke-opacity="${(0.65 - pulse * 0.5).toFixed(2)}" stroke-width="1.5"/>`;
        }
        if (m.label) html += put(c.x, [c.y - rr - 8, c.y + rr + 18], m.label, tone.stroke);
      } else if (m.kind === 'unit') {
        const u = m.unit;
        if (!u || u.alive <= 0 || u.state === 'dead' || u.state === 'fled' || u.state === 'embarked') continue;
        if (u.side !== viewer && !u.visible[viewer]) continue;
        const tone = TONES[m.tone ?? 'gold'];
        const w = r.unitCenter(u, 1);
        const c = cam.toScreen(w.x, w.y);
        if (!inside(c.x, c.y, free, -10)) {
          html += edgeArrow(c.x, c.y, free, tone.stroke, put, m.label);
          continue;
        }
        const sz = formationSize(u);
        const rr = Math.max(16, (Math.max(sz.width, sz.depth) / 2 + (u.def.radius ?? 0)) * cam.zoom + 8);
        html += `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${(rr + pulse * 4).toFixed(1)}" fill="none" stroke="${tone.stroke}" stroke-width="2.5" stroke-opacity="${(0.55 + pulse * 0.45).toFixed(2)}"/>`;
        if (m.label) html += put(c.x, [c.y + rr + 18, c.y + rr + 34], m.label, tone.stroke);
      } else if (m.kind === 'line') {
        const a = cam.toScreen(m.x1, m.y1);
        const b = cam.toScreen(m.x2, m.y2);
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const head = (t: number) => `${(b.x - Math.cos(ang + t) * 14).toFixed(1)},${(b.y - Math.sin(ang + t) * 14).toFixed(1)}`;
        html += `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="#ffd27a" stroke-width="3" stroke-dasharray="10 7" stroke-dashoffset="${(-now / 40).toFixed(1)}" stroke-linecap="round"/>`;
        html += `<polygon points="${b.x.toFixed(1)},${b.y.toFixed(1)} ${head(0.45)} ${head(-0.45)}" fill="#ffd27a"/>`;
        html += `<circle cx="${a.x.toFixed(1)}" cy="${a.y.toFixed(1)}" r="${(5 + pulse * 3).toFixed(1)}" fill="#ffd27a"/>`;
        if (m.label) html += put((a.x + b.x) / 2, [(a.y + b.y) / 2 - 12, (a.y + b.y) / 2 + 24], m.label, '#ffd27a');
      } else if (m.kind === 'shape') {
        if (m.pts.length < 3) continue;
        const pts = m.pts.map((p) => cam.toScreen(p.x, p.y));
        html += `<polygon points="${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}" fill="rgba(255,210,122,0.06)" stroke="#ffd27a" stroke-opacity="0.85" stroke-width="1.8" stroke-dasharray="8 6"/>`;
        if (m.label && m.at) {
          const p = cam.toScreen(m.at.x, m.at.y);
          if (inside(p.x, p.y, free)) html += put(p.x - 6, [p.y - 8, p.y + 16], m.label, '#ffd27a', 'end');
        }
      } else if (m.kind === 'badge') {
        const u = m.unit;
        if (!u || u.alive <= 0 || (u.side !== viewer && !u.visible[viewer])) continue;
        const w = r.unitCenter(u, 1);
        const c = cam.toScreen(w.x, w.y);
        const sz = formationSize(u);
        const lift = Math.max(sz.depth, u.def.radius ?? 0) * cam.zoom * 0.5 + 16 + (isFlyer(u.def) ? 10 : 0);
        const bx = c.x + 21;
        const by = c.y - lift + 5;
        if (!inside(bx, by, free, 0)) continue;
        html += `<text x="${bx.toFixed(1)}" y="${by.toFixed(1)}" class="tut-mark-badge">${esc(m.text)}</text>`;
      }
    }
    if (html !== this.last) {
      this.svg.innerHTML = html;
      this.last = html;
    }
  }
}

/** The world area the step's pointers cover: units, circles and lines (not outlines or badges). */
export function marksBox(marks: Mark[], r: BattleRenderer, viewer: Side): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number, pad: number) => {
    x0 = Math.min(x0, x - pad);
    y0 = Math.min(y0, y - pad);
    x1 = Math.max(x1, x + pad);
    y1 = Math.max(y1, y + pad);
  };
  for (const m of marks) {
    if (m.kind === 'area') add(m.x, m.y, m.r + 12);
    else if (m.kind === 'line') {
      add(m.x1, m.y1, 20);
      add(m.x2, m.y2, 20);
    } else if (m.kind === 'unit') {
      const u = m.unit;
      if (!u || u.alive <= 0 || u.state === 'dead' || u.state === 'fled' || u.state === 'embarked') continue;
      if (u.side !== viewer && !u.visible[viewer]) continue;
      const c = r.unitCenter(u, 1);
      const sz = formationSize(u);
      add(c.x, c.y, Math.max(sz.width, sz.depth) / 2 + (u.def.radius ?? 0) + 14);
    }
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

/** Pulsing outlines around HUD elements, above the HUD. */
export class HudRings {
  private readonly els: HTMLDivElement[] = [];
  private scrolled = new WeakSet<Element>();

  constructor(private readonly parent: HTMLElement) {}

  dispose(): void {
    for (const e of this.els) e.remove();
    this.els.length = 0;
  }

  draw(selectors: string[]): void {
    const rects: DOMRect[] = [];
    for (const sel of selectors) {
      if (!sel) continue;
      let el: Element | null = null;
      try {
        el = document.querySelector(sel);
      } catch {
        el = null;
      }
      if (!el) continue;
      this.reveal(el);
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) rects.push(r);
    }
    while (this.els.length < rects.length) {
      const d = document.createElement('div');
      d.className = 'tut-ring';
      d.setAttribute('aria-hidden', 'true');
      this.parent.appendChild(d);
      this.els.push(d);
    }
    while (this.els.length > rects.length) this.els.pop()!.remove();
    rects.forEach((r, i) => {
      const s = this.els[i]!.style;
      s.left = `${r.left - 4}px`;
      s.top = `${r.top - 4}px`;
      s.width = `${r.width + 8}px`;
      s.height = `${r.height + 8}px`;
    });
  }

  /** Scroll a unit card into its row once, if it is hidden off the side. */
  private reveal(el: Element): void {
    if (this.scrolled.has(el)) return;
    this.scrolled.add(el);
    const row = el.closest('.cards');
    if (!(row instanceof HTMLElement) || !(el instanceof HTMLElement)) return;
    const l = el.offsetLeft - row.scrollLeft;
    if (l < 0 || l + el.offsetWidth > row.clientWidth) row.scrollLeft = Math.max(0, el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2);
  }
}
