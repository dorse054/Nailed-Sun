/**
 * Procedural audio with WebAudio: no samples, everything synthesized.
 * Glass and sung charges for the Choir; near-silence, clicks, bone flutes and
 * one shriek at the charge for the Hush; bells, brass and drums for the
 * Vesperate; chimes, throat singing, whistling arrows and howling kites for
 * the Drift. Units the listener can't see make no sound. Sound only starts
 * after the player's first click.
 */
import type { FactionId } from '../data/schema';
import type { SimEvent, Side, Unit } from '../sim/types';
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
  /** The two armies' factions in the current battle. */
  private factions: [FactionId, FactionId] | null = null;

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

  /** Massed voices: detuned saws through two vowel formants. Choir charges are sung. */
  voices(freqs: number[], gain: number, dur: number, formants: [number, number] = [800, 1150], out?: AudioNode): void {
    const ctx = this.ctx;
    const dest = out ?? this.sfx;
    if (!ctx || !dest) return;
    const t0 = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + dur * 0.3);
    g.gain.setValueAtTime(gain, t0 + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    g.connect(dest);
    for (const [fq, q] of [[formants[0], 5], [formants[1], 7]] as const) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = fq;
      bp.Q.value = q;
      bp.connect(g);
      for (const f of freqs) {
        for (const det of [-9, 0, 8]) {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = f;
          o.detune.value = det + (Math.random() * 6 - 3);
          const vib = ctx.createOscillator();
          vib.frequency.value = 4.5 + Math.random() * 1.5;
          const vg = ctx.createGain();
          vg.gain.value = f * 0.006;
          vib.connect(vg).connect(o.frequency);
          o.connect(bp);
          o.start(t0);
          vib.start(t0);
          o.stop(t0 + dur);
          vib.stop(t0 + dur);
        }
      }
    }
  }

  /** The Hush charge: one shriek, then nothing. */
  shriek(gain: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return;
    const t0 = ctx.currentTime;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 3;
    bp.frequency.setValueAtTime(1600, t0);
    bp.frequency.exponentialRampToValueAtTime(3400, t0 + 0.14);
    bp.frequency.exponentialRampToValueAtTime(1300, t0 + 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
    bp.connect(g).connect(this.sfx);
    for (const det of [0, 27, -33]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.detune.value = det;
      o.frequency.setValueAtTime(820, t0);
      o.frequency.exponentialRampToValueAtTime(1650, t0 + 0.12);
      o.frequency.exponentialRampToValueAtTime(620, t0 + 0.9);
      o.connect(bp);
      o.start(t0);
      o.stop(t0 + 0.95);
    }
    this.burst(3200, 2, gain * 0.6, 0.5, 1400);
  }

  /** Vesperate brass: a saw whose filter opens on the attack. */
  brass(freq: number, gain: number, dur: number, when = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return;
    const t0 = ctx.currentTime + when;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 2;
    lp.frequency.setValueAtTime(freq * 1.5, t0);
    lp.frequency.linearRampToValueAtTime(freq * 7, t0 + 0.07);
    lp.frequency.exponentialRampToValueAtTime(freq * 3, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.04);
    g.gain.setValueAtTime(gain * 0.85, t0 + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    lp.connect(g).connect(this.sfx);
    for (const det of [-6, 5]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(lp);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    }
  }

  /** Drift throat singing: a low drone with one whistling overtone that wanders. */
  throat(freq: number, gain: number, dur: number, out?: AudioNode): void {
    const ctx = this.ctx;
    const dest = out ?? this.sfx;
    if (!ctx || !dest) return;
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + dur * 0.2);
    g.gain.setValueAtTime(gain, t0 + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    g.connect(dest);
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = freq * 4;
    const over = ctx.createBiquadFilter();
    over.type = 'bandpass';
    over.Q.value = 30;
    over.frequency.setValueAtTime(freq * 6, t0);
    over.frequency.linearRampToValueAtTime(freq * 9, t0 + dur * 0.45);
    over.frequency.linearRampToValueAtTime(freq * 8, t0 + dur);
    const og = ctx.createGain();
    og.gain.value = 4;
    o.connect(low).connect(g);
    o.connect(over).connect(og).connect(g);
    o.start(t0);
    o.stop(t0 + dur);
  }

  /** A whistling arrow falls in pitch as it flies. */
  whistle(gain: number, from: number, to: number, dur: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return;
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(from, t0);
    o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.sfx);
    o.start(t0);
    o.stop(t0 + dur);
  }

  /** Howling kites: breathy noise whose pitch rises and sags with the gusts. */
  howl(gain: number, dur: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx || !this.noise) return;
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 14;
    bp.frequency.setValueAtTime(500, t0);
    bp.frequency.exponentialRampToValueAtTime(900, t0 + dur * 0.4);
    bp.frequency.exponentialRampToValueAtTime(420, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp).connect(g).connect(this.sfx);
    src.start(t0, Math.random());
    src.stop(t0 + dur);
  }

  /** A breathy bone flute: a sine with a little noise in it. */
  flute(freqs: number[], gain: number, step: number, out?: AudioNode): void {
    const ctx = this.ctx;
    const dest = out ?? this.sfx;
    if (!ctx || !dest || !this.noise) return;
    freqs.forEach((f, i) => {
      const t0 = ctx.currentTime + i * step;
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(f * 0.98, t0);
      o.frequency.linearRampToValueAtTime(f, t0 + 0.08);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + 0.12);
      g.gain.setValueAtTime(gain * 0.8, t0 + step * 0.8);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + step * 1.3);
      o.connect(g).connect(dest);
      o.start(t0);
      o.stop(t0 + step * 1.35);
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f * 2;
      bp.Q.value = 2;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0, t0);
      ng.gain.linearRampToValueAtTime(gain * 0.35, t0 + 0.06);
      ng.gain.exponentialRampToValueAtTime(0.0001, t0 + step);
      src.connect(bp).connect(ng).connect(dest);
      src.start(t0, Math.random());
      src.stop(t0 + step);
    });
  }

  /** Each faction's charge cry. */
  private chargeCry(f: FactionId, n: number): void {
    if (f === 'choir') {
      this.voices([220, 277.2, 329.6, 440], 0.2 * n, 1.5);
      this.glass([1760, 2217], 0.05 * n, 0.8);
    } else if (f === 'hush') {
      this.shriek(0.85 * n);
    } else if (f === 'vesperate') {
      this.brass(196, 0.1 * n, 0.3);
      this.brass(293.7, 0.12 * n, 0.9, 0.28);
      this.thud(0.5 * n);
    } else {
      this.throat(98, 0.22 * n, 1.4);
      this.whistle(0.12 * n, 2900, 1500, 0.7);
    }
  }

  ui(kind: 'select' | 'move' | 'attack' | 'ability' | 'click'): void {
    if (!this.ok(`ui-${kind}`, 0.06)) return;
    const f = kind === 'attack' ? 330 : kind === 'ability' ? 880 : kind === 'move' ? 520 : 660;
    this.glass([f], kind === 'ability' ? 0.08 : 0.04, kind === 'ability' ? 0.5 : 0.15);
  }

  /**
   * React to simulation events near the camera. `unitOf` lets each faction
   * sound like itself, and keeps units the viewer can't see silent.
   */
  events(ev: SimEvent[], cam: Camera, viewer: Side, unitOf?: (id: number) => Unit | undefined): void {
    if (!this.ctx) return;
    const heard = (id: number): Unit | undefined => {
      const u = unitOf?.(id);
      return u && (u.side === viewer || u.visible[viewer]) ? u : undefined;
    };
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
          if (e.kind === 'kite' && this.ok('howl', 1.2)) this.howl(0.9 * near(e.x, e.y), 1.6);
          else if (e.kind === 'arrow' && this.factions?.[e.side] === 'drift' && this.ok('whistle', 0.45)) {
            const p = 2400 + Math.random() * 900;
            this.whistle(0.1 * near(e.x, e.y), p, p * 0.5, 0.6);
          }
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
            const u = heard(e.unit);
            if (u && this.ok(`cry-${u.def.faction}`, 1.6)) this.chargeCry(u.def.faction, Math.max(0.35, n));
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
        case 'ability': {
          const u = heard(e.unit);
          if (!u || !this.ok('ability', 0.2)) break;
          const g = e.side === viewer ? 1 : 0.6;
          const f = u.def.faction;
          if (f === 'choir') this.glass([660, 990], 0.1 * g, 0.8);
          else if (f === 'hush') {
            this.glass([110, 164.8], 0.12 * g, 1.2);
            this.burst(3000, 18, 0.03 * g, 0.05);
          } else if (f === 'vesperate') this.bell(165, 0.2 * g, 2.5);
          else this.glass([880, 1175], 0.08 * g, 1.2);
          break;
        }
        case 'rout':
          if (e.side === viewer && this.ok('rout', 1)) this.burst(400, 3, 0.08, 0.8, 200);
          break;
        case 'rally':
          if (e.side === viewer && this.ok('rally', 1.5)) {
            const f = this.factions?.[viewer];
            if (f === 'vesperate') this.brass(261.6, 0.08, 0.5);
            else if (f === 'hush') this.flute([392], 0.05, 0.4);
            else if (f === 'drift') this.glass([1175, 1568], 0.05, 0.9);
            else this.glass([523, 784], 0.06, 0.9);
          }
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

  battleStart(f: FactionId, factions?: [FactionId, FactionId]): void {
    this.factions = factions ?? null;
    if (!this.ctx) return;
    if (f === 'vesperate') this.bell(110, 0.35, 4);
    else if (f === 'choir') this.glass([523, 659, 784], 0.25, 2.5);
    else if (f === 'hush') this.burst(900, 12, 0.15, 0.8, 3000);
    else this.glass([587, 880, 1175, 1318], 0.15, 1.8);
  }

  /** The end of a campaign Toll: one deep bell over the world. */
  toll(): void {
    if (!this.ctx) return;
    this.bell(73.4, 0.32, 6);
    this.bell(110, 0.14, 4, 0.04);
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
      const r = Math.random();
      const amb = this.ambience ?? undefined;
      if (f === 'drift') {
        if (r < 0.07) this.throat(87.3, 0.1, 5, amb);
        else this.glass([pent[Math.floor(Math.random() * pent.length)]!], 0.05, 1.6);
      } else if (f === 'hush') {
        if (r < 0.06) this.flute([293.7, 349.2, 261.6].slice(0, 2 + Math.floor(Math.random() * 2)), 0.08, 0.9, amb);
        else if (r < 0.5) this.burst(2500 + Math.random() * 2000, 20, 0.03, 0.05);
      } else if (f === 'vesperate') {
        if (r < 0.05) [0, 0.45, 0.9].forEach((w) => setTimeout(() => this.thud(0.08), w * 1000));
        else if (r < 0.3) this.bell(220 + Math.floor(Math.random() * 3) * 55, 0.05, 3);
      } else if (f === 'choir') {
        if (r < 0.06) this.voices([261.6, 329.6, 392], 0.06, 6, [400, 800], amb);
        else if (r < 0.36) this.glass([784 + Math.floor(Math.random() * 3) * 131], 0.04, 2);
      }
    }, 2200);
  }
}

export const audio = new AudioEngine();
(globalThis as unknown as { __audio?: AudioEngine }).__audio = audio;
