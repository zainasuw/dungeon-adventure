import { Prd, type Rng } from '../core/rng';
import type { Difficulty } from './levels';

/**
 * One place that decides every drop, so the pickups add up to one economy instead of
 * eight separate rules. The ideas come from games that handle healing well:
 * - healing comes from what the player is doing (Doom's glory kills, Diablo's health
 *   globes), and more of it when they are hurt;
 * - a pseudo-random distribution (Warcraft 3 / Dota 2) keeps the long-run rate exact while
 *   making dry streaks and double-drops rare;
 * - potions are keyed to the bag (Hamlet's inventory view): a reward you cannot carry is
 *   not a reward, so a full bag turns potions into coins instead of waste;
 * - caps per hall and a target bag level keep the run on the "comfort zone", about half
 *   health with dips and crests, without rubber-banding monsters.
 */

/** Heart drop chance by hero health band, per difficulty. */
const HEART_P: Record<Difficulty['id'], { high: number; mid: number; low: number }> = {
  easy: { high: 0.2, mid: 0.4, low: 0.65 },
  normal: { high: 0.12, mid: 0.28, low: 0.5 },
  hard: { high: 0.08, mid: 0.2, low: 0.35 },
};
/** Hearts a hall may give before kills pay only coins (8/6/5 = 96/72/60 % of max health). */
const HEART_CAP: Record<Difficulty['id'], number> = { easy: 8, normal: 6, hard: 5 };
/** The potion count the economy steers toward; above it, potion sources pay coins. */
const BAG_TARGET: Record<Difficulty['id'], number> = { easy: 3, normal: 2, hard: 2 };
/** Crates per hall that can hold a potion at all (a shuffle bag, so it is never all or none). */
const POTION_CRATES = 2;

export type Reward = 'heart' | 'potion' | 'coins' | 'none';

export interface LootState {
  misses: number;
  heartsThisHall: number;
  potionCratesThisHall: number;
}

export class LootDirector {
  private misses = 0;
  private heartsThisHall = 0;
  private potionCratesThisHall = 0;
  private potionCrates = new Set<number>();
  private readonly cFor = new Map<number, number>();

  constructor(
    private readonly rng: Rng,
    private difficulty: Difficulty,
  ) {}

  setDifficulty(d: Difficulty): void {
    this.difficulty = d;
  }

  /** A new hall: fresh caps, and which of its crates may hold a potion. */
  newHall(crateCount: number): void {
    this.heartsThisHall = 0;
    this.potionCratesThisHall = 0;
    const order = this.rng.shuffle([...Array(crateCount).keys()]);
    this.potionCrates = new Set(order.slice(0, POTION_CRATES));
  }

  /**
   * A monster died. Rolls for a small heart on a PRD counter: the more kills since the
   * last heart and the lower the hero's health, the likelier. At nearly full health no
   * roll happens (and the counter does not advance), so a heart is never wasted and
   * misses can't be banked by fighting at full health.
   */
  onKill(hpFraction: number, big: boolean): Reward {
    if (hpFraction >= 0.9) return 'none';
    if (this.heartsThisHall >= HEART_CAP[this.difficulty.id]) return 'none';
    const p = HEART_P[this.difficulty.id];
    const chance = hpFraction >= 0.7 ? p.high : hpFraction >= 0.4 ? p.mid : p.low;
    const attempts = big ? 2 : 1;
    for (let i = 0; i < attempts; i++) {
      this.misses++;
      if (this.rng.float() < this.constant(chance) * this.misses) {
        this.misses = 0;
        this.heartsThisHall++;
        return 'heart';
      }
    }
    return 'none';
  }

  /** An elite always pays: a potion if the bag is below target, otherwise a heart (and coins). */
  eliteReward(potions: number): Reward {
    return potions < BAG_TARGET[this.difficulty.id] ? 'potion' : 'heart';
  }

  /** Clearing a hall: a potion if the bag is below target, otherwise coins. */
  clearReward(potions: number, nextIsBoss: boolean): Reward {
    // Never walk into the King's hall with nothing to drink.
    if (nextIsBoss && potions === 0) return 'potion';
    return potions < BAG_TARGET[this.difficulty.id] ? 'potion' : 'coins';
  }

  /** The hall's chest: coins always; a potion sometimes, only if there is room for it to matter. */
  chestReward(potions: number): Reward {
    if (potions >= BAG_TARGET[this.difficulty.id]) return 'coins';
    return this.rng.chance(0.6) ? 'potion' : 'coins';
  }

  /** A smashed crate: a potion only from a potion-capable crate, with the difficulty's chance, below target. */
  crateReward(index: number, potions: number, luckyLevels: number): Reward {
    const canHold = this.potionCrates.has(index) && this.potionCratesThisHall < POTION_CRATES;
    if (canHold && potions < BAG_TARGET[this.difficulty.id] && this.rng.chance(this.difficulty.crateDrop + 0.15 * luckyLevels)) {
      this.potionCratesThisHall++;
      return 'potion';
    }
    return 'coins';
  }

  /** Coins a crate pays when it holds no potion. */
  crateCoins(): number {
    return 3 + this.rng.int(3);
  }

  state(): LootState {
    return { misses: this.misses, heartsThisHall: this.heartsThisHall, potionCratesThisHall: this.potionCratesThisHall };
  }

  restore(s: LootState | undefined): void {
    if (!s) return;
    this.misses = s.misses;
    this.heartsThisHall = s.heartsThisHall;
    this.potionCratesThisHall = s.potionCratesThisHall;
  }

  private constant(p: number): number {
    let c = this.cFor.get(p);
    if (c === undefined) {
      c = Prd.constantFor(p);
      this.cFor.set(p, c);
    }
    return c;
  }
}
