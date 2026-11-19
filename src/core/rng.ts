/**
 * Seeded randomness for everything that decides an outcome: loot, spawns, shop stock,
 * the route. One seed per run; every system draws from its own named stream, so a
 * loot roll never changes where the next monster appears, and a run can be replayed
 * exactly from its seed (for tests and bug reports).
 *
 * The generator is mulberry32 (32-bit state, period 2^32), plenty for a 15-minute run.
 * Stream seeds come from hashing the stream name into the run seed (FNV-1a), so
 * adding a new stream later doesn't shift the others.
 */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** A run seed from the clock, or any number, as a readable 8-digit hex string. */
  static newSeed(): number {
    return (Math.floor(Math.random() * 0xffffffff) ^ (Date.now() & 0xffffffff)) >>> 0;
  }

  static fromString(text: string): Rng {
    return new Rng(hashString(text));
  }

  /** A child generator for one purpose ("loot", "spawn", ...), independent of its siblings. */
  stream(name: string): Rng {
    return new Rng(hashString(name, this.s));
  }

  /** Uniform in [0, 1). */
  float(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.float() * n);
  }

  /** Uniform in [a, b). */
  range(a: number, b: number): number {
    return a + this.float() * (b - a);
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.float() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }

  /** A new, unbiased (Fisher–Yates) shuffle of the list. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /** One entry by weight (weights needn't sum to 1; zero weight never comes up). */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T {
    let total = 0;
    for (const it of items) total += Math.max(0, weight(it));
    let r = this.float() * total;
    for (const it of items) {
      r -= Math.max(0, weight(it));
      if (r < 0) return it;
    }
    return items[items.length - 1];
  }
}

/** FNV-1a over the text, folded with an optional base seed. */
export function hashString(text: string, base = 0): number {
  let h = (0x811c9dc5 ^ base) >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Pseudo-random distribution (Warcraft 3 / Dota 2 style): the chance of an event grows
 * by a constant C on every miss and resets on a hit, so the long-run rate equals p but
 * long dry streaks and double-hits are rarer than with a plain coin flip. C is solved
 * numerically once per p, so the expected rate stays exactly p.
 */
export class Prd {
  private readonly c: number;
  private misses = 0;

  constructor(
    readonly p: number,
    private readonly rng: Rng,
  ) {
    this.c = Prd.constantFor(p);
  }

  roll(): boolean {
    this.misses++;
    if (this.rng.float() < this.c * this.misses) {
      this.misses = 0;
      return true;
    }
    return false;
  }

  /** Expected hit rate for a given C (sum over the first-hit distribution). */
  private static rateFor(c: number): number {
    let pOnN = 1; // probability we reach attempt n without a hit
    let sumNP = 0;
    const maxN = Math.ceil(1 / c);
    for (let n = 1; n <= maxN; n++) {
      const pHit = Math.min(1, c * n);
      sumNP += n * pOnN * pHit;
      pOnN *= 1 - pHit;
    }
    return 1 / sumNP;
  }

  /** Binary search for the C whose long-run rate is p. */
  static constantFor(p: number): number {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let lo = 0;
    let hi = p;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (Prd.rateFor(mid) > p) hi = mid;
      else lo = mid;
    }
    return (lo + hi) / 2;
  }
}
