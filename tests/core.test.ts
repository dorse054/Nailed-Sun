import { describe, expect, it } from 'vitest';
import { hashString, Rng } from '../src/core/rng';
import { angleDiff, clamp, datan, datan2, dcos, dsin, HALF_PI, lerp, PI, TAU, turnToward, wrapAngle } from '../src/core/dmath';
import { SpatialHash } from '../src/core/spatial';

function draws(r: Rng, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(r.nextU32());
  return out;
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i]!;
    mb += b[i]!;
  }
  ma /= n;
  mb /= n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i]! - ma;
    const db = b[i]! - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  return cov / Math.sqrt(va * vb);
}

/** Angular distance between two angles, computed with Math so it doesn't depend on the code under test. */
function angDist(a: number, b: number): number {
  const e = Math.abs(a - b) % (2 * Math.PI);
  return Math.min(e, 2 * Math.PI - e);
}

describe('Rng (seeded sfc32)', () => {
  it('produces the same sequence for the same seed', () => {
    for (const seed of [1, 42, 123456789, 'battle:7', '', 'ai:seed with spaces']) {
      expect(draws(new Rng(seed), 1000)).toEqual(draws(new Rng(seed), 1000));
    }
  });

  it('treats a numeric seed and its decimal string alike (the seed is hashed as text)', () => {
    expect(draws(new Rng(77), 50)).toEqual(draws(new Rng('77'), 50));
    expect(draws(new Rng(), 50)).toEqual(draws(new Rng(1), 50));
  });

  it('produces different sequences for different seeds, even adjacent ones', () => {
    const firsts = new Set<number>();
    const streams = new Set<string>();
    for (let seed = 0; seed < 1000; seed++) {
      const d = draws(new Rng(seed), 4);
      firsts.add(d[0]!);
      streams.add(d.join(','));
    }
    expect(streams.size).toBe(1000);
    // A u32 collision among 1000 good first draws is ~1e-4 likely; a weak seed hash would collide a lot.
    expect(firsts.size).toBeGreaterThanOrEqual(999);
    expect(draws(new Rng('a'), 8)).not.toEqual(draws(new Rng('b'), 8));
    expect(draws(new Rng('battle:1'), 8)).not.toEqual(draws(new Rng('ai:1'), 8));
  });

  it('reseed restarts the sequence of the new seed', () => {
    const r = new Rng(5);
    draws(r, 37);
    r.reseed(9);
    expect(draws(r, 100)).toEqual(draws(new Rng(9), 100));
  });

  it('keeps next(), range(), int(), chance() and pick() inside their bounds', () => {
    const r = new Rng('bounds');
    const items = ['a', 'b', 'c', 'd', 'e'] as const;
    const picked = new Set<string>();
    const ints = new Set<number>();
    let lo = Infinity;
    let hi = -Infinity;
    let rlo = Infinity;
    let rhi = -Infinity;
    for (let i = 0; i < 20000; i++) {
      const x = r.next();
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
      const y = r.range(-3, 7);
      rlo = Math.min(rlo, y);
      rhi = Math.max(rhi, y);
      ints.add(r.int(6));
      picked.add(r.pick(items));
    }
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThan(1);
    expect(rlo).toBeGreaterThanOrEqual(-3);
    expect(rhi).toBeLessThan(7);
    expect([...ints].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(picked.size).toBe(items.length);
    const c = new Rng('chance');
    let wrong = 0;
    for (let i = 0; i < 1000; i++) if (c.chance(0) || !c.chance(1)) wrong++;
    expect(wrong).toBe(0);
  });

  it('is uniform: next() has mean 0.5 and fills 20 buckets evenly', () => {
    const r = new Rng('uniform');
    const n = 200_000;
    const buckets = new Array<number>(20).fill(0);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const x = r.next();
      sum += x;
      buckets[Math.floor(x * 20)]!++;
    }
    expect(Math.abs(sum / n - 0.5)).toBeLessThan(0.005);
    // Chi-square with 19 degrees of freedom: the 99.9% quantile is 43.8.
    const e = n / 20;
    const chi2 = buckets.reduce((a, c) => a + ((c - e) * (c - e)) / e, 0);
    expect(chi2).toBeLessThan(43.8);
  });

  it('normal() has mean ≈ 0 and standard deviation ≈ 1 over many samples, within the Irwin-Hall bounds', () => {
    const r = new Rng('normal');
    const n = 200_000;
    let s1 = 0;
    let s2 = 0;
    let within1 = 0;
    const bound = 3 * Math.SQRT2 + 1e-12;
    let widest = 0;
    for (let i = 0; i < n; i++) {
      const x = r.normal();
      widest = Math.max(widest, Math.abs(x));
      s1 += x;
      s2 += x * x;
      if (Math.abs(x) < 1) within1++;
    }
    expect(widest).toBeLessThanOrEqual(bound);
    const mean = s1 / n;
    const sd = Math.sqrt(s2 / n - mean * mean);
    expect(Math.abs(mean)).toBeLessThan(0.01);
    expect(Math.abs(sd - 1)).toBeLessThan(0.01);
    // About 68% of a normal distribution lies within one standard deviation.
    expect(within1 / n).toBeGreaterThan(0.66);
    expect(within1 / n).toBeLessThan(0.7);
  });

  it('fork() does not advance the parent and is reproducible from the same parent state', () => {
    const parent = new Rng('parent');
    draws(parent, 10);
    const before = parent.getState();
    const f1 = parent.fork('combat');
    expect(parent.getState()).toEqual(before);
    const f2 = parent.fork('combat');
    expect(draws(f1, 200)).toEqual(draws(f2, 200));
  });

  it('forks with different salts, and the parent itself, produce unrelated streams', () => {
    const parent = new Rng(2024);
    const a = parent.fork('ai');
    const b = parent.fork('combat');
    const c = parent.fork(7);
    const pa = draws(a, 5000);
    const pb = draws(b, 5000);
    const pc = draws(c, 5000);
    const pp = draws(new Rng(2024), 5000);
    expect(pa).not.toEqual(pb);
    expect(pa).not.toEqual(pc);
    expect(pa).not.toEqual(pp);
    for (const [x, y] of [
      [pa, pb],
      [pa, pp],
      [pb, pc],
    ] as const) {
      expect(Math.abs(pearson(x, y))).toBeLessThan(0.05);
    }
  });

  it('drawing from a fork leaves the parent untouched, and a fork is unaffected by later parent draws', () => {
    const parent = new Rng('independent');
    const twin = new Rng('independent');
    const fork = parent.fork('x');
    const forkTwin = twin.fork('x');
    const fromFork = draws(fork, 500);
    // Drawing 500 values from the fork did not move the parent.
    expect(draws(parent, 100)).toEqual(draws(twin, 100));
    // Both parents have moved on; the fork taken earlier still yields the original stream.
    expect(draws(forkTwin, 500)).toEqual(fromFork);
    // A fork taken from the advanced parent is a new stream.
    expect(draws(parent.fork('x'), 20)).not.toEqual(fromFork.slice(0, 20));
  });

  it('getState/setState round-trips mid-stream, including into another instance', () => {
    const r = new Rng('state');
    draws(r, 123);
    for (let i = 0; i < 17; i++) r.normal();
    const s = r.getState();
    const expected = draws(r, 300);
    r.setState(s);
    expect(draws(r, 300)).toEqual(expected);
    const other = new Rng('something else');
    other.setState(s);
    r.setState(s);
    expect(draws(other, 300)).toEqual(draws(r, 300));
    // The state is a snapshot: mutating the returned tuple does not change the generator.
    const snap = r.getState();
    snap[0] = 0;
    expect(r.getState()).not.toEqual(snap);
  });

  it('shuffle() returns a deterministic permutation of the same items', () => {
    const base = Array.from({ length: 50 }, (_, i) => i);
    const a = new Rng('shuffle').shuffle([...base]);
    const b = new Rng('shuffle').shuffle([...base]);
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual(base);
    expect(a).not.toEqual(base);
  });
});

describe('hashString', () => {
  it('is the stable 32-bit FNV-1a hash', () => {
    // Published FNV-1a test vectors.
    expect(hashString('')).toBe(0x811c9dc5);
    expect(hashString('a')).toBe(0xe40c292c);
    expect(hashString('foobar')).toBe(0xbf9cf968);
    expect(hashString('map:1')).toBe(hashString('map:1'));
    expect(hashString('map:1')).not.toBe(hashString('map:2'));
  });
});

describe('dmath (deterministic trigonometry)', () => {
  const edge = [0, -0, 1e-12, -1e-12, 1e-6, HALF_PI, -HALF_PI, PI, -PI, TAU, -TAU, 1.5 * PI, -1.5 * PI, 1000 * PI + 0.25, -777.7, 1e4, 3e4];

  it('dsin and dcos match Math.sin and Math.cos within 1e-6 over a sweep and at the edge cases', () => {
    let worst = 0;
    const check = (x: number): void => {
      worst = Math.max(worst, Math.abs(dsin(x) - Math.sin(x)), Math.abs(dcos(x) - Math.cos(x)));
    };
    for (let i = -200_000; i <= 200_000; i++) check(i * 0.0005);
    for (let k = -64; k <= 64; k++) {
      check((k * PI) / 4);
      check((k * PI) / 4 + 1e-9);
      check((k * PI) / 4 - 1e-9);
    }
    for (const x of edge) check(x);
    expect(worst).toBeLessThan(1e-6);
    // Exact where it matters for formations and facings.
    expect(dsin(0)).toBe(0);
    expect(Math.abs(dcos(0) - 1)).toBeLessThan(1e-7);
  });

  it('datan matches Math.atan within 1e-6, including the range-reduction seams and infinities', () => {
    let worst = 0;
    const check = (x: number): void => {
      worst = Math.max(worst, Math.abs(datan(x) - Math.atan(x)));
    };
    for (let i = -100_000; i <= 100_000; i++) check(i * 0.0007);
    for (const x of [0, -0, 1, -1, 0.2679491924311227, 0.26794919243112, 0.2679491924312, 1 + 1e-12, 1 - 1e-12, 1e-300, 1e10, -1e10, 1e300]) check(x);
    expect(worst).toBeLessThan(1e-6);
    expect(datan(Infinity)).toBe(HALF_PI);
    expect(datan(-Infinity)).toBe(-HALF_PI);
  });

  it('datan2 matches Math.atan2 within 1e-6 in every quadrant, on the axes and at extreme ratios', () => {
    const vals = [-1e9, -1e3, -10, -1, -0.5, -1e-3, -1e-9, 0, 1e-9, 1e-3, 0.5, 1, 10, 1e3, 1e9];
    let worst = 0;
    let lowest = Infinity;
    let highest = -Infinity;
    const check = (y: number, x: number): void => {
      const d = datan2(y, x);
      lowest = Math.min(lowest, d);
      highest = Math.max(highest, d);
      worst = Math.max(worst, angDist(d, Math.atan2(y, x)));
    };
    for (const y of vals) for (const x of vals) check(y, x);
    for (const r of [1e-6, 1, 1e6]) {
      for (let i = 0; i < 4000; i++) {
        const a = -Math.PI + (i + 0.5) * ((2 * Math.PI) / 4000);
        check(r * Math.sin(a), r * Math.cos(a));
      }
    }
    expect(worst).toBeLessThan(1e-6);
    expect(lowest).toBeGreaterThanOrEqual(-PI);
    expect(highest).toBeLessThanOrEqual(PI);
    // On the axes the result is exact.
    expect(datan2(1, 0)).toBe(HALF_PI);
    expect(datan2(-1, 0)).toBe(-HALF_PI);
    expect(datan2(0, 1)).toBe(0);
    expect(datan2(0, -1)).toBe(PI);
  });

  it('datan2 uses the (-π, π] convention at the signed-zero seams', () => {
    // Math.atan2 returns -π here; datan2 returns the same direction as +π, matching wrapAngle.
    expect(datan2(-0, -1)).toBe(PI);
    expect(Math.atan2(-0, -1)).toBe(-Math.PI);
    // A zero vector has no direction; datan2 reports 0 for every signed zero combination.
    expect(datan2(0, 0)).toBe(0);
    expect(datan2(0, -0)).toBe(0);
    expect(datan2(-0, -0)).toBe(0);
  });

  it('wrapAngle maps every angle into (-π, π] and keeps its direction', () => {
    const r = new Rng('wrap');
    const inputs: number[] = [...edge];
    for (let k = -401; k <= 401; k++) {
      inputs.push(k * PI, k * PI + 1e-12, k * PI - 1e-12, k * HALF_PI);
    }
    for (let i = 0; i < 20000; i++) inputs.push(r.range(-2000, 2000));
    const bad: string[] = [];
    for (const a of inputs) {
      const w = wrapAngle(a);
      const ok = w > -PI && w <= PI && angDist(w, a) < 1e-9 * Math.max(1, Math.abs(a)) && wrapAngle(w) === w;
      if (!ok && bad.length < 5) bad.push(`wrapAngle(${a}) = ${w}`);
    }
    expect(bad).toEqual([]);
    expect(wrapAngle(PI)).toBe(PI);
    expect(wrapAngle(-PI)).toBe(PI);
    expect(wrapAngle(3 * PI)).toBe(PI);
    expect(wrapAngle(-3 * PI)).toBe(PI);
  });

  it('angleDiff is the signed smallest turn from a to b, in (-π, π]', () => {
    const r = new Rng('diff');
    const bad: string[] = [];
    for (let i = 0; i < 20000; i++) {
      const a = r.range(-50, 50);
      const b = r.range(-50, 50);
      const d = angleDiff(a, b);
      let ok = d > -PI && d <= PI && angDist(a + d, b) < 1e-9;
      if (Math.abs(d) < PI - 1e-9) ok = ok && Math.abs(angleDiff(b, a) + d) < 1e-9;
      if (!ok && bad.length < 5) bad.push(`angleDiff(${a}, ${b}) = ${d}`);
    }
    expect(bad).toEqual([]);
    expect(angleDiff(0.1, -0.1)).toBeCloseTo(-0.2, 12);
    expect(angleDiff(PI - 0.1, -PI + 0.1)).toBeCloseTo(0.2, 12);
  });

  it('turnToward never overshoots and arrives exactly', () => {
    const r = new Rng('turn');
    const bad: string[] = [];
    for (let i = 0; i < 2000; i++) {
      let from = r.range(-PI, PI);
      const to = r.range(-PI, PI);
      const step = r.range(0.01, 0.5);
      let steps = 0;
      while (from !== to && steps < 1000) {
        const next = turnToward(from, to, step);
        if (angDist(next, from) > step + 1e-12 || angDist(next, to) > angDist(from, to) + 1e-12) bad.push(`${from}->${to} by ${step}: ${next}`);
        from = next;
        steps++;
      }
      if (from !== to || steps > Math.ceil(PI / step) + 1) bad.push(`did not arrive at ${to} in ${steps} steps of ${step}`);
      if (bad.length > 5) break;
    }
    expect(bad).toEqual([]);
  });

  it('clamp and lerp behave as documented', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.25, 0, 1)).toBe(0.25);
    expect(lerp(2, 6, 0)).toBe(2);
    expect(lerp(2, 6, 1)).toBe(6);
    expect(lerp(2, 6, 0.25)).toBe(3);
  });
});

describe('SpatialHash', () => {
  interface Pts {
    xs: number[];
    ys: number[];
    live: boolean[];
  }

  function randomPoints(r: Rng, n: number, x0: number, x1: number, y0: number, y1: number): Pts {
    const xs: number[] = [];
    const ys: number[] = [];
    const live: boolean[] = [];
    for (let i = 0; i < n; i++) {
      xs.push(r.range(x0, x1));
      ys.push(r.range(y0, y1));
      live.push(true);
    }
    return { xs, ys, live };
  }

  function build(h: SpatialHash, p: Pts): void {
    h.clear();
    for (let i = 0; i < p.xs.length; i++) if (p.live[i]) h.insert(i, p.xs[i]!, p.ys[i]!);
  }

  function brute(p: Pts, x: number, y: number, r: number): string[] {
    const out: string[] = [];
    for (let i = 0; i < p.xs.length; i++) {
      if (!p.live[i]) continue;
      const dx = p.xs[i]! - x;
      const dy = p.ys[i]! - y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= r * r) out.push(`${i}:${d2}`);
    }
    return out.sort();
  }

  function viaHash(h: SpatialHash, x: number, y: number, r: number): string[] {
    const out: string[] = [];
    h.query(x, y, r, (i, d2) => {
      out.push(`${i}:${d2}`);
    });
    const sorted = [...out].sort();
    // Every item is visited at most once.
    expect(new Set(sorted).size).toBe(sorted.length);
    return sorted;
  }

  it('query() returns exactly the items a brute-force scan finds, with their squared distances', () => {
    const r = new Rng('hash');
    for (const cell of [2, 4, 7.5, 32]) {
      const h = new SpatialHash(300, 200, cell, 1500);
      const p = randomPoints(r, 1500, 0, 300, 0, 200);
      build(h, p);
      for (let q = 0; q < 400; q++) {
        const x = r.range(-10, 310);
        const y = r.range(-10, 210);
        const rad = r.pick([0, 0.5, 1.3, 3, 4, 9.9, 25, 80]);
        expect(viaHash(h, x, y, rad)).toEqual(brute(p, x, y, rad));
      }
    }
  });

  it('stays correct after clear() and re-inserting moved points, with no stale items', () => {
    const r = new Rng('rehash');
    const h = new SpatialHash(400, 300, 4, 800);
    const p = randomPoints(r, 800, 0, 400, 0, 300);
    for (let round = 0; round < 12; round++) {
      // Move every point a little and drop some, as soldiers move and die between ticks.
      for (let i = 0; i < p.xs.length; i++) {
        p.xs[i] = clamp(p.xs[i]! + r.range(-6, 6), 0, 399.999);
        p.ys[i] = clamp(p.ys[i]! + r.range(-6, 6), 0, 299.999);
        if (r.chance(0.05)) p.live[i] = false;
      }
      build(h, p);
      for (let i = 0; i < p.xs.length; i++) if (!p.live[i]) expect(h.cellOfItem[i]).toBe(-1);
      for (let q = 0; q < 150; q++) {
        const x = r.range(0, 400);
        const y = r.range(0, 300);
        const rad = r.range(0, 30);
        expect(viaHash(h, x, y, rad)).toEqual(brute(p, x, y, rad));
      }
    }
  });

  it('visits items in the same order when rebuilt from the same insertions', () => {
    const r = new Rng('order');
    const p = randomPoints(r, 500, 0, 100, 0, 100);
    const a = new SpatialHash(100, 100, 4, 500);
    const b = new SpatialHash(100, 100, 4, 500);
    build(a, p);
    build(b, p);
    build(b, p);
    for (let q = 0; q < 50; q++) {
      const x = r.range(0, 100);
      const y = r.range(0, 100);
      const la: number[] = [];
      const lb: number[] = [];
      a.query(x, y, 15, (i) => {
        la.push(i);
      });
      b.query(x, y, 15, (i) => {
        lb.push(i);
      });
      expect(la).toEqual(lb);
    }
  });

  it('stops visiting as soon as the visitor returns true', () => {
    const h = new SpatialHash(50, 50, 4, 100);
    const p = randomPoints(new Rng('stop'), 100, 20, 30, 20, 30);
    build(h, p);
    let visits = 0;
    h.query(25, 25, 20, () => {
      visits++;
      return visits === 3;
    });
    expect(visits).toBe(3);
  });

  it('finds items that lie just outside the grid, as routing soldiers do before they leave the map', () => {
    // Soldiers are clamped into the edge cells on insert; queries around them must look there too.
    const r = new Rng('outside');
    const h = new SpatialHash(100, 80, 4, 600);
    const p = randomPoints(r, 600, -3, 103, -3, 83);
    build(h, p);
    for (let q = 0; q < 2000; q++) {
      const x = r.range(-12, 112);
      const y = r.range(-12, 92);
      const rad = r.range(0.5, 10);
      expect(viaHash(h, x, y, rad)).toEqual(brute(p, x, y, rad));
    }
    // The simplest case: a point 2 m west of the map, queried from 5 m further west.
    h.clear();
    h.insert(0, -2, 40);
    const found: number[] = [];
    h.query(-7, 40, 6, (i) => {
      found.push(i);
    });
    expect(found).toEqual([0]);
  });

  it('ensureCapacity() grows the item arrays and queries still match after the next rebuild', () => {
    const r = new Rng('grow');
    const h = new SpatialHash(120, 120, 4, 10);
    const p = randomPoints(r, 1000, 0, 120, 0, 120);
    h.ensureCapacity(p.xs.length);
    expect(h.next.length).toBeGreaterThanOrEqual(1000);
    build(h, p);
    for (let q = 0; q < 200; q++) {
      const x = r.range(0, 120);
      const y = r.range(0, 120);
      const rad = r.range(0, 20);
      expect(viaHash(h, x, y, rad)).toEqual(brute(p, x, y, rad));
    }
  });
});
