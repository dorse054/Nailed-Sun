/**
 * Seeded pseudo-random numbers for the deterministic simulation.
 *
 * sfc32 (Small Fast Counting) keeps 128 bits of state and only uses integer
 * operations, so the same seed produces the same sequence in every engine.
 * Nothing inside the simulation may call Math.random().
 */
export class Rng {
  private a = 0;
  private b = 0;
  private c = 0;
  private d = 0;

  constructor(seed: number | string = 1) {
    this.reseed(seed);
  }

  reseed(seed: number | string): void {
    // cyrb128-style hash of the seed text into four 32-bit words.
    const str = String(seed);
    let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
    for (let i = 0; i < str.length; i++) {
      const k = str.charCodeAt(i);
      h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
      h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
      h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
      h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
    h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    this.a = (h1 ^ h2 ^ h3 ^ h4) >>> 0;
    this.b = (h2 ^ h1) >>> 0;
    this.c = (h3 ^ h1) >>> 0;
    this.d = (h4 ^ h1) >>> 0;
    for (let i = 0; i < 12; i++) this.nextU32();
  }

  nextU32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)]!;
  }

  /**
   * Approximately standard-normal value (Irwin-Hall with six samples).
   * Avoids Math.log/Math.cos, whose last bits differ between engines.
   */
  normal(): number {
    let s = 0;
    for (let i = 0; i < 6; i++) s += this.next();
    return (s - 3) * 1.4142135623730951;
  }

  /** Derive an independent stream, e.g. one for AI and one for combat. */
  fork(salt: string | number): Rng {
    return new Rng(`${this.a}:${this.b}:${this.c}:${this.d}:${salt}`);
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const t = items[i]!;
      items[i] = items[j]!;
      items[j] = t;
    }
    return items;
  }

  getState(): [number, number, number, number] {
    return [this.a, this.b, this.c, this.d];
  }

  setState(s: readonly [number, number, number, number]): void {
    [this.a, this.b, this.c, this.d] = s;
  }
}

/** Stable 32-bit hash of a string, for seeding maps from names. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
