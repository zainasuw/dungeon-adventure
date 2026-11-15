import type { EnemyKind } from '../actors/enemy';
import type { HeroClassId } from '../actors/classes';

/** Camera angle in degrees and distance. */
export interface View {
  yaw: number;
  pitch: number;
  distance: number;
}

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
    mood: 3,
    crystal: '#7dff9e',
    sleepers: ['skeleton', 'runt', 'skeleton', 'runt'],
    waves: [['skeleton', 'runt', 'runt']],
    potions: [[-13, -8], [13, 8.5]],
  },
  {
    view: { yaw: 0, pitch: 40, distance: 17 },
    intro: { yaw: -40, pitch: 22, distance: 17, focus: [0, 2.2, 0] },
    pillar: 'Inheritance',
    hall: 'The Frozen Hall',
    mood: 0,
    crystal: '#5ee0ff',
    sleepers: ['skeleton', 'brute', 'runt', 'mage'],
    waves: [['runt', 'runt', 'skeleton'], ['mage', 'skeleton']],
    potions: [[-13, 8.5], [13, -8], [0, 10]],
  },
  {
    view: { yaw: 0, pitch: 48, distance: 20 },
    intro: { yaw: 180, pitch: 26, distance: 15, focus: [0, 1.5, 2] },
    pillar: 'Polymorphism',
    hall: 'The Ember Deep',
    mood: 4,
    crystal: '#ff7a3d',
    sleepers: ['brute', 'skeleton', 'mage', 'skeleton'],
    waves: [['runt', 'runt', 'runt'], ['brute', 'mage', 'skeleton']],
    potions: [[-13, -8.5], [13, 8.5], [-13, 8.5]],
  },
];

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
}

export const DIFFICULTIES: Record<DifficultyId, Difficulty> = {
  easy: { id: 'easy', label: 'Easy', hint: 'Gentle monsters, lots of potions. Great for kids.', enemyHp: 0.7, enemyDamage: 0.45, potionDrop: 0.45, dropLastWave: true },
  normal: { id: 'normal', label: 'Normal', hint: 'A fair fight.', enemyHp: 1, enemyDamage: 1, potionDrop: 0.25, dropLastWave: false },
  hard: { id: 'hard', label: 'Hard', hint: 'For brave souls only.', enemyHp: 1.3, enemyDamage: 1.5, potionDrop: 0.15, dropLastWave: false },
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
  /** Blessings chosen so far, by id and level. */
  blessings?: Partial<Record<string, number>>;
}

const SAVE_KEY = 'dungeon-adventure:quest';

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SaveData;
    return typeof data.level === 'number' && data.level < LEVELS.length ? data : null;
  } catch {
    return null;
  }
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    // Private windows can refuse storage; the game still plays.
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // Nothing to clear.
  }
}
