/**
 * The Vesperate Toll. Every 30 s the army's battle bell rings; for 6 s after
 * each Toll every Vesperate unit in range gains the bonus of the chosen Hour.
 * The Belfry Wagon rings every 30 s, Old Midnight every 20 s across the whole
 * field; if only the lord's bell remains it rings every 45 s. Bell Outriders
 * carry the Toll 100 m beyond its normal range.
 */
import { TOLL } from '../data/rules';
import type { Battle } from './battle';
import { DT } from './constants';
import type { Side, Unit } from './types';
import { mechanic } from './mechanics';
import { moraleState } from './morale';
import { casterPos } from './abilities';

interface BellSource {
  unit: Unit;
  interval: number;
  range: number;
  drainWavering: number;
}

export function bellSources(b: Battle, side: Side): BellSource[] {
  const out: BellSource[] = [];
  for (const u of b.units) {
    if (u.side !== side || u.state !== 'ready' || u.alive <= 0) continue;
    const bell = mechanic(u.def, 'bell');
    if (bell) {
      out.push({ unit: u, interval: bell.interval, range: bell.range === 'field' ? Infinity : bell.range, drainWavering: bell.drainWavering ?? 0 });
    }
  }
  const g = b.sides[side].general;
  if (g && g.state === 'ready' && g.faction === 'vesperate') {
    out.push({ unit: g, interval: TOLL.lordInterval, range: TOLL.lordRange, drainWavering: 0 });
  }
  return out;
}

export function tollInterval(b: Battle, side: Side): number {
  const src = bellSources(b, side);
  if (!src.length) return Infinity;
  const hasWagonOrTower = src.some((s) => s.unit !== b.sides[side].general);
  let iv = Infinity;
  for (const s of src) iv = Math.min(iv, s.interval);
  // With a Belfry Wagon or Old Midnight on the field the army keeps its 30 s (or faster) rhythm.
  if (hasWagonOrTower) iv = Math.min(iv, 30);
  return iv;
}

export function updateToll(b: Battle): void {
  for (const side of [0, 1] as const) {
    const st = b.sides[side];
    if (st.faction !== 'vesperate') continue;
    const iv = tollInterval(b, side);
    st.tollInterval = iv;
    if (!Number.isFinite(iv)) continue;
    st.tollTimer += DT;
    // The timer sums DT (1/20 s is not exact in binary): 900 steps add up to 44.99999999999..., so
    // compare with a tolerance or a 45 s bell rings a tick late, at 45.05 s.
    if (st.tollTimer >= iv - 1e-6) ringToll(b, side, false);
  }
}

export function ringToll(b: Battle, side: Side, forced: boolean): void {
  const st = b.sides[side];
  st.tollTimer = 0;
  st.lastToll = b.time;
  const src = bellSources(b, side);
  if (!src.length && !forced) return;
  const relays = b.units.filter((u) => u.side === side && u.state === 'ready' && mechanic(u.def, 'tollRelay'));
  const covered = (x: number, y: number): boolean => {
    for (const s of src) {
      if (s.range === Infinity) return true;
      const p = casterPos(s.unit);
      if ((x - p.x) * (x - p.x) + (y - p.y) * (y - p.y) <= s.range * s.range) return true;
    }
    return false;
  };
  const relayed = relays.filter((r) => covered(r.x, r.y));
  for (const u of b.units) {
    if (u.side !== side || u.faction !== 'vesperate' || (u.state !== 'ready' && u.state !== 'embarked')) continue;
    let ok = covered(u.x, u.y);
    if (!ok) {
      for (const r of relayed) {
        const extra = mechanic(r.def, 'tollRelay')!.extra;
        if ((u.x - r.x) * (u.x - r.x) + (u.y - r.y) * (u.y - r.y) <= extra * extra) {
          ok = true;
          break;
        }
      }
    }
    if (ok || forced) u.tollUntil = b.time + TOLL.window;
  }
  // Old Midnight: each Toll costs wavering enemies 5% leadership.
  const drain = src.reduce((m, s) => Math.max(m, s.drainWavering), 0);
  if (drain > 0) {
    for (const e of b.units) {
      if (e.side === side || e.state !== 'ready' || e.stats.fearImmune) continue;
      if (moraleState(e) === 'wavering') e.morale -= (drain / 100) * e.maxMorale;
    }
  }
  const loud = src.find((s) => s.range === Infinity) ?? src[0];
  const p = loud ? casterPos(loud.unit) : { x: b.terrain.width / 2, y: side === 0 ? b.terrain.height - 100 : 100 };
  b.events.push({ t: 'toll', side, x: p.x, y: p.y, hour: st.hour, big: !!src.find((s) => s.range === Infinity) });
}
