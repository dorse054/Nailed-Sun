/**
 * Small statistics helpers for balance reports: win rates with confidence
 * intervals, medians and a deterministic bootstrap.
 */
import { Rng } from '../core/rng';

/** A win rate: score counts a win as 1 and a draw as 0.5. */
export interface Rate {
  n: number;
  score: number;
  rate: number;
  /** 95% Wilson score interval. */
  lo: number;
  hi: number;
}

const Z = 1.96;

export function rate(score: number, n: number): Rate {
  if (n <= 0) return { n: 0, score: 0, rate: 0.5, lo: 0, hi: 1 };
  const p = score / n;
  const z2 = Z * Z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { n, score, rate: p, lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}

/** Accumulates scores, then turns into a Rate. */
export class Tally {
  n = 0;
  score = 0;
  add(s: number): void {
    this.n++;
    this.score += s;
  }
  get rate(): Rate {
    return rate(this.score, this.n);
  }
}

export function median(xs: readonly number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function percentile(sorted: readonly number[], p: number): number {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i]!;
}

/**
 * Bootstrap interval of a ratio of sums, sum(num) / sum(den), resampling
 * the pairs. Seeded, so reports are reproducible.
 */
export function ratioInterval(num: readonly number[], den: readonly number[], eps: number, seed: string, samples = 300): [number, number] {
  const n = num.length;
  if (!n) return [NaN, NaN];
  const rng = new Rng(`bootstrap:${seed}`);
  const out: number[] = [];
  for (let b = 0; b < samples; b++) {
    let a = 0;
    let d = 0;
    for (let i = 0; i < n; i++) {
      const j = rng.int(n);
      a += num[j]!;
      d += den[j]!;
    }
    out.push((a + eps) / (d + eps));
  }
  out.sort((x, y) => x - y);
  return [percentile(out, 0.025), percentile(out, 0.975)];
}

/** Severity of a value against a target band given its confidence interval. */
export function bandSeverity(value: number, lo: number, hi: number, min: number, max: number): 'ok' | 'warn' | 'fail' {
  if (value >= min && value <= max) return 'ok';
  // The whole interval lies outside the band: the miss is real, not noise.
  if (hi < min || lo > max) return 'fail';
  return 'warn';
}
