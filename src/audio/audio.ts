/**
 * Procedural audio with WebAudio: no samples, everything synthesized.
 * Bells for the Vesperate Toll, glass for the Choir, near-silence and clicks
 * for the Hush, wind chimes for the Drift. Sound only starts after the
 * player's first click.
 */
import type { FactionId } from '../data/schema';
import type { SimEvent, Side } from '../sim/types';
import type { Camera } from '../render/camera';
import { settings } from '../app/store';

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private ambience: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private ambientNodes: AudioNode[] = [];
  private ambientTimer = 0;
  private last = new Map<string, number>();

  /** Call from a click handler. */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = settings.value.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);
    this.ambience = ctx.createGain();
    this.ambience.gain.value = settings.value.music ? 0.35 : 0;
    this.ambience.connect(this.master);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolume(v: number): void {
    if (this.master) this.master.gain.value = v;
  }

  setMusic(on: boolean): void {
    if (this.ambience) this.ambience.gain.value = on ? 0.35 : 0;
  }

  private ok(key: string, gap: number): boolean {
    if (!this.ctx) return false;
    const now = this.ctx.currentTime;
    if ((this.last.get(key) ?? -1) + gap > now) return false;
    this.last.set(key, now);
    return true;
  }

  /** A bell: inharmonic partials with long decays. */
  bell(freq: number, gain: number, decay: number, when = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return;
    const t0 = ctx.currentTime + when;
    const partials = [0.5, 1, 1.19, 1.56, 2, 2.51, 2.66, 3.01, 4.1];
    const amps = [0.6, 1, 0.4, 0.5, 0.35, 0.25, 0.2, 0.15, 0.1];
    partials.forEach((p, i) => {
      const o = ctx.createOscillator();
      o.frequency.value = freq * p;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain * amps[i]!, t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay * (1.2 - i * 0.08));
      o.connect(g).connect(this.sfx!);
      o.start(t0);
      o.stop(t0 + decay * 1.3);
    });
  }

  /** Glass harmonica: pure tones, slow swell. */
  glass(freqs: number[], gain: number, dur: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return;
    const t0 = ctx.currentTime;
    for (const f of freqs) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const vib = ctx.createOscillator();
      vib.frequency.value = 5.5;
      const vg = ctx.createGain();
      vg.gain.value = f * 0.004;
      vib.connect(vg).connect(o.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain / freqs.length, t0 + dur * 0.25);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(this.sfx);
      o.start(t0);
      vib.start(t0);
      o.stop(t0 + dur);
      vib.stop(t0 + dur);
    }
  }

  /** Filtered noise burst: clashes, volleys, fire, dust. */
  burst(freq: number, q: number, gain: number, dur: number, sweepTo?: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx || !this.noise) return;
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(freq, t0);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + dur);
  }

  thud(gain: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return;
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(120, t0);
    o.frequency.exponentialRampToValueAtTime(40, t0 + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
    o.connect(g).connect(this.sfx);
    o.start(t0);
    o.stop(t0 + 0.4);
  }

  ui(kind: 'select' | 'move' | 'attack' | 'ability' | 'click'): void {
    if (!this.ok(`ui-${kind}`, 0.06)) return;
    const f = kind === 'attack' ? 330 : kind === 'ability' ? 880 : kind === 'move' ? 520 : 660;
    this.glass([f], kind === 'ability' ? 0.08 : 0.04, kind === 'ability' ? 0.5 : 0.15);
  }

  /** React to simulation events near the camera. */
  events(ev: SimEvent[], cam: Camera, viewer: Side): void {
    if (!this.ctx) return;
    let clashes = 0;
    let shots = 0;
    let fire = 0;
    const near = (x: number, y: number): number => {
      const dx = (x - cam.x) * cam.zoom;
      const dy = (y - cam.y) * cam.zoom;
      const d = Math.sqrt(dx * dx + dy * dy) / Math.max(cam.width, cam.height);
      return Math.max(0, 1 - d) * Math.min(1, 0.4 + cam.zoom * 0.2);
    };
    for (const e of ev) {
      switch (e.t) {
        case 'hit':
          clashes += near(e.x, e.y);
          break;
        case 'death':
          clashes += near(e.x, e.y) * 0.5;
          break;
        case 'shot':
          shots += near(e.x, e.y);
          break;
        case 'impact':
          if (e.splash > 3 && this.ok('impact', 0.08)) {
            const n = near(e.x, e.y);
            if (e.kind === 'firebomb' || e.kind === 'glassPot' || e.kind === 'kite') this.burst(300, 0.8, 0.35 * n, 0.6, 120);
            else this.thud(0.4 * n);
          }
          break;
        case 'fire':
          fire++;
          break;
        case 'charge':
          if (this.ok('charge', 0.25)) {
            const n = near(e.x, e.y);
            this.thud(0.6 * n);
            this.burst(1800, 2, 0.25 * n, 0.3);
          }
          break;
        case 'toll':
          if (this.ok('toll', 0.5)) {
            const mine = e.side === viewer;
            this.bell(e.big ? 55 : 110, e.big ? 0.5 : mine ? 0.35 : 0.22, e.big ? 7 : 4.5);
            if (e.big) this.bell(82.5, 0.25, 6, 0.02);
          }
          break;
        case 'beam':
          if (this.ok(`beam-${e.kind}`, e.kind === 'beam' ? 0.3 : 0.4)) {
            const n = near(e.x1, e.y1);
            this.glass(e.kind === 'beam' ? [1760, 2217] : [880, 1320, 1760], 0.08 * n * Math.max(0.3, e.power), e.kind === 'beam' ? 0.35 : 0.9);
            this.burst(5000, 1, 0.05 * n, 0.3);
          }
          break;
        case 'shockwave':
          if (this.ok(`sw-${e.kind}`, 0.3)) {
            const n = near(e.x, e.y);
            if (e.kind === 'knell') this.bell(98, 0.4 * n, 2.5);
            else if (e.kind === 'flash') this.glass([1318, 1760, 2637], 0.25, 1.4);
            else if (e.kind === 'bell') this.bell(49, 0.6, 8);
            else if (e.kind === 'eyes') this.burst(600, 6, 0.2, 1.2, 180);
            else {
              this.thud(0.7 * n);
              this.burst(200, 0.6, 0.4 * n, 1.2, 80);
            }
          }
          break;
        case 'ability':
          if (this.ok('ability', 0.2)) this.glass([660, 990], e.side === viewer ? 0.1 : 0.06, 0.8);
          break;
        case 'rout':
          if (e.side === viewer && this.ok('rout', 1)) this.burst(400, 3, 0.08, 0.8, 200);
          break;
        case 'general':
          this.bell(73, 0.4, 5);
          break;
      }
    }
    if (clashes > 0.2 && this.ok('clash', 0.07)) this.burst(2600 + Math.random() * 1400, 6, Math.min(0.18, 0.02 + clashes * 0.012), 0.12);
    if (shots > 0.3 && this.ok('volley', 0.35)) this.burst(3000, 0.7, Math.min(0.12, 0.02 + shots * 0.01), 0.5, 900);
    if (fire > 0 && this.ok('fire', 0.8)) this.burst(250, 0.5, 0.05, 1.2);
  }

  battleStart(f: FactionId): void {
    if (!this.ctx) return;
    if (f === 'vesperate') this.bell(110, 0.35, 4);
    else if (f === 'choir') this.glass([523, 659, 784], 0.25, 2.5);
    else if (f === 'hush') this.burst(900, 12, 0.15, 0.8, 3000);
    else this.glass([587, 880, 1175, 1318], 0.15, 1.8);
  }

  battleEnd(won: boolean): void {
    if (!this.ctx) return;
    if (won) {
      this.glass([523, 659, 784, 1046], 0.3, 3);
      this.bell(131, 0.3, 5, 0.3);
    } else {
      this.bell(82, 0.35, 6);
      this.glass([311, 370, 466], 0.15, 3);
    }
  }

  /** Faction ambience: glass drones, cave drones and clicks, distant bells, chimes. */
  ambient(f: FactionId | null, wind: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.ambience) return;
    for (const n of this.ambientNodes) {
      try {
        (n as OscillatorNode).stop?.();
      } catch {
        // Already stopped.
      }
      n.disconnect();
    }
    this.ambientNodes = [];
    clearInterval(this.ambientTimer);
    if (!f) return;
    // Wind bed.
    if (this.noise) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const flt = ctx.createBiquadFilter();
      flt.type = 'lowpass';
      flt.frequency.value = 300 + wind * 350;
      const g = ctx.createGain();
      g.gain.value = 0.03 + wind * 0.04;
      src.connect(flt).connect(g).connect(this.ambience);
      src.start();
      this.ambientNodes.push(src, flt, g);
    }
    const drone = (freq: number, gain: number, type: OscillatorType = 'sine') => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = gain;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + Math.random() * 0.08;
      const lg = ctx.createGain();
      lg.gain.value = gain * 0.6;
      lfo.connect(lg).connect(g.gain);
      o.connect(g).connect(this.ambience!);
      o.start();
      lfo.start();
      this.ambientNodes.push(o, g, lfo, lg);
    };
    if (f === 'choir') {
      drone(261.6, 0.05);
      drone(392, 0.035);
      drone(523.3, 0.02);
    } else if (f === 'hush') {
      drone(55, 0.08, 'triangle');
      drone(82.4, 0.04);
    } else if (f === 'vesperate') {
      drone(98, 0.04);
      drone(146.8, 0.03);
    } else {
      drone(146.8, 0.03, 'triangle');
    }
    const pent = [587, 659, 784, 880, 988, 1175, 1318];
    this.ambientTimer = window.setInterval(() => {
      if (!settings.value.music) return;
      if (f === 'drift') this.glass([pent[Math.floor(Math.random() * pent.length)]!], 0.05, 1.6);
      else if (f === 'hush' && Math.random() < 0.5) this.burst(2500 + Math.random() * 2000, 20, 0.03, 0.05);
      else if (f === 'vesperate' && Math.random() < 0.25) this.bell(220 + Math.floor(Math.random() * 3) * 55, 0.05, 3);
      else if (f === 'choir' && Math.random() < 0.3) this.glass([784 + Math.floor(Math.random() * 3) * 131], 0.04, 2);
    }, 2200);
  }
}

export const audio = new AudioEngine();
