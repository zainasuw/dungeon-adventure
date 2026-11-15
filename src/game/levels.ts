import type { EnemyKind } from '../actors/enemy';
import type { HeroClassId } from '../actors/classes';

/** Camera angle in degrees and distance. */
export interface View {
  yaw: number;
  pitch: number;
  distance: number;
}

/**
 * Each hall's own job, so halls play differently (not just "beat everyone").
 * Lanterns, books and crystals must be done before the pillar wakes; "defend"
 * changes the pillar fight into holding out until a timer runs down.
 */
export type Job =
  | { kind: 'lanterns'; spots: [number, number][] }
  | { kind: 'books'; spots: [number, number][] }
  | { kind: 'crystals'; spots: [number, number][] }
  | { kind: 'wisps'; spots: [number, number][] }
  | { kind: 'defend'; seconds: number };

export interface Level {
  /** The play camera. "Up" always walks toward the door; zoom and tilt vary by hall. */
  view: View;
  /** The establishing shot the hall opens on before the camera swoops down to play. */
  intro: View & { focus: [number, number, number] };
  /** The pillar from the original game that this hall guards. */
  pillar: string;
  hall: string;
  /** Index into MOODS. */
  mood: number;
  /** Color of the pillar crystal before it is claimed. */
  crystal: string;
  /** Skeletons lying on the floor, in the crypt's four sleeping spots. */
  sleepers: EnemyKind[];
  /** Reinforcements that climb out of the ground once the fight starts. */
  waves: EnemyKind[][];
  /** Potions lying around the hall. */
  potions: [number, number][];
  /** The final room: a boss fight instead of a pillar. */
  boss?: boolean;
  /** This hall's special job (see Job). */
  job?: Job;
  /** One short line for the choose-your-path doors: what this hall is like. */
  blurb?: string;
}

export const LEVELS: Level[] = [
  {
    view: { yaw: 0, pitch: 42, distance: 18 },
    intro: { yaw: 0, pitch: 18, distance: 16, focus: [0, 2, -4] },
    pillar: 'Abstraction',
    hall: 'The Torchlit Hall',
    mood: 1,
    crystal: '#ffd166',
    sleepers: ['runt', 'skeleton', 'runt'],
    waves: [['runt', 'runt']],
    potions: [[-12.5, 8.5], [12.5, -8.5]],
  },
  {
    view: { yaw: 0, pitch: 46, distance: 19 },
    intro: { yaw: 38, pitch: 30, distance: 21, focus: [0, 1, -1] },
    pillar: 'Encapsulation',
    hall: 'The Overgrown Hall',
    blurb: 'Catch the runaway wisps!',
    mood: 3,
    crystal: '#7dff9e',
    sleepers: ['skeleton', 'runt', 'charger', 'runt'],
    waves: [['skeleton', 'runt', 'runt']],
    potions: [[-13, -8], [13, 8.5]],
    job: { kind: 'wisps', spots: [[-10, 6], [9, 6], [0, -8]] },
  },
  {
    view: { yaw: 0, pitch: 40, distance: 17 },
    intro: { yaw: -40, pitch: 22, distance: 17, focus: [0, 2.2, 0] },
    pillar: 'Inheritance',
    hall: 'The Frozen Library',
    blurb: 'Find the lost spell books.',
    mood: 0,
    crystal: '#5ee0ff',
    sleepers: ['skeleton', 'brute', 'runt', 'mage'],
    waves: [['runt', 'runt', 'skeleton']],
    potions: [[-13, 8.5], [13, -8], [0, 10]],
    job: { kind: 'books', spots: [[-8, 10], [8, -4], [-4.9, -8.9]] },
  },
  {
    view: { yaw: 0, pitch: 48, distance: 20 },
    intro: { yaw: 180, pitch: 26, distance: 15, focus: [0, 1.5, 2] },
    pillar: 'Polymorphism',
    hall: 'The Ember Deep',
    blurb: 'Smash the cursed crystals. Mind the spikes!',
    mood: 4,
    crystal: '#ff7a3d',
    sleepers: ['brute', 'charger', 'mage', 'skeleton'],
    waves: [['runt', 'runt', 'runt']],
    potions: [[-13, -8.5], [13, 8.5], [-13, 8.5]],
    job: { kind: 'crystals', spots: [[-8, 7], [8.2, 7.8], [0, -8]] },
  },
  {
    view: { yaw: 0, pitch: 50, distance: 22 },
    intro: { yaw: 0, pitch: 14, distance: 13, focus: [0, 2.6, -5] },
    pillar: '',
    hall: 'The Throne of Bones',
    mood: 5,
    crystal: '#c77dff',
    sleepers: [],
    waves: [],
    potions: [[-12.5, 8], [12.5, 8], [-12.5, -6], [12.5, -6]],
    boss: true,
  },
  {
    view: { yaw: 0, pitch: 46, distance: 22 },
    intro: { yaw: 30, pitch: 24, distance: 26, focus: [0, 1, -2] },
    pillar: '',
    hall: 'The Moonlit Graveyard',
    blurb: 'Light the lanterns. The graves are restless!',
    mood: 6,
    crystal: '#8fd3ff',
    sleepers: ['skeleton', 'runt', 'skeleton', 'mage'],
    waves: [['runt', 'charger', 'skeleton']],
    potions: [[-18, -9], [18, 10.5], [0, -11]],
    job: { kind: 'lanterns', spots: [[-13, 7], [13, 7], [0, -9]] },
  },
  {
    view: { yaw: 0, pitch: 44, distance: 20 },
    intro: { yaw: -35, pitch: 26, distance: 22, focus: [0, 1, -1] },
    pillar: '',
    hall: 'The Forest Clearing',
    blurb: 'Protect the pillar until time runs out.',
    mood: 7,
    crystal: '#ffe27a',
    sleepers: ['runt', 'skeleton', 'runt', 'brute'],
    waves: [['runt', 'runt'], ['charger', 'runt'], ['runt', 'brute'], ['skeleton', 'charger']],
    potions: [[-14, -9], [14, 9], [-3, 11.5]],
    job: { kind: 'defend', seconds: 40 },
  },
  {
    // 7. The Old Crypt: a connected dungeon (entrance, guard room, treasure room, altar room).
    view: { yaw: 0, pitch: 46, distance: 19 },
    intro: { yaw: 0, pitch: 30, distance: 16, focus: [0, 1, 18] },
    pillar: '',
    hall: 'The Old Crypt',
    mood: 1,
    crystal: '#ffd166',
    sleepers: ['runt', 'skeleton', 'runt', 'skeleton'],
    waves: [['runt', 'runt'], ['skeleton', 'runt']],
    potions: [[3.6, 16.6], [-8.4, -4.6], [27.8, -1.2], [-8, -24.4]],
  },
];

/** The four pillars, in the order they're won (from the original assignment). */
export const PILLARS = [
  { name: 'Abstraction', color: '#ffd166' },
  { name: 'Encapsulation', color: '#7dff9e' },
  { name: 'Inheritance', color: '#5ee0ff' },
  { name: 'Polymorphism', color: '#ff7a3d' },
];

/** How many halls hold a pillar in one run (then the boss). */
export const PILLAR_HALLS = PILLARS.length;

/** Scene indexes (into LEVELS) for a run: four pillar halls, then the boss. */
export const DEFAULT_ROUTE = [7, 5, 2, 6, 4];

/** Halls the choose-your-path doors pick from (the Old Crypt is always first, the King last). */
export const PATH_POOL = [5, 2, 6, 3, 1];

/** What a path door promises when that hall is cleared. */
export type PathReward = 'potions' | 'coins' | 'heal';

/** A fresh run: the crypt, three halls (replaced by the player's door picks), then the King. */
export function randomRoute(): number[] {
  const pool = [...PATH_POOL].sort(() => Math.random() - 0.5);
  return [7, pool[0], pool[1], pool[2], 4];
}

export type DifficultyId = 'easy' | 'normal' | 'hard';

export interface Difficulty {
  id: DifficultyId;
  label: string;
  hint: string;
  enemyHp: number;
  enemyDamage: number;
  /** Chance a defeated monster drops a potion. */
  potionDrop: number;
  /** Easy skips the last wave of reinforcements. */
  dropLastWave: boolean;
  /** Multiplier on monsters' wind-up time before a blow (longer = more time to react). */
  windup: number;
}

export const DIFFICULTIES: Record<DifficultyId, Difficulty> = {
  easy: { id: 'easy', label: 'Easy', hint: 'Gentle monsters, lots of potions. Great for kids.', enemyHp: 0.7, enemyDamage: 0.45, potionDrop: 0.45, dropLastWave: true, windup: 1.5 },
  normal: { id: 'normal', label: 'Normal', hint: 'A fair fight.', enemyHp: 1, enemyDamage: 1, potionDrop: 0.25, dropLastWave: false, windup: 1 },
  hard: { id: 'hard', label: 'Hard', hint: 'For brave souls only.', enemyHp: 1.3, enemyDamage: 1.5, potionDrop: 0.15, dropLastWave: false, windup: 1 },
};

export const MAX_POTIONS = 5;

/** Everything needed to pick a quest back up. */
export interface SaveData {
  hero: HeroClassId;
  name: string;
  difficulty: DifficultyId;
  level: number;
  potions: number;
  kills: number;
  potionsUsed: number;
  /** Seconds played. */
  time: number;
  /** Coins collected so far. */
  coins?: number;
  /** Blessings chosen so far, by id and level. */
  blessings?: Partial<Record<string, number>>;
  /** Which hall of the run (0 = first) and the run's halls in order. */
  stage?: number;
  route?: number[];
  /** Max health bought from the merchant. */
  bonusHp?: number;
}

const SAVE_KEY = 'dungeon-adventure:quest';
// The quest lives only as long as this browser tab: a refresh picks it straight
// back up, but closing the game and opening a fresh link starts a new game.
// Older versions kept it forever in localStorage; forget that copy.
try {
  localStorage.removeItem(SAVE_KEY);
} catch {
  // Storage can be off; nothing to forget then.
}

export function loadSave(): SaveData | null {
  try {
    const raw = sessionStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SaveData;
    return typeof data.level === 'number' && data.level < LEVELS.length ? data : null;
  } catch {
    return null;
  }
}

export function writeSave(data: SaveData): void {
  try {
    sessionStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    // Private windows can refuse storage; the game still plays.
  }
}

export function clearSave(): void {
  try {
    sessionStorage.removeItem(SAVE_KEY);
  } catch {
    // Nothing to clear.
  }
}
