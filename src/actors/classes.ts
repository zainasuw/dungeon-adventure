import type { HeroModel } from '../core/assets';
import type { IconName } from '../ui/icons';
import type { Hand } from './character';

export type HeroClassId = 'warrior' | 'rogue' | 'mage' | 'healer';
export type SlotKey = 'LMB' | 'RMB' | 'SPACE' | 'Q';

/** One swing of a melee combo. Times are fractions of the clip. */
export interface ComboStep {
  clip: string;
  speed: number;
  /** When the hit lands. */
  hitAt: number;
  /** After this, the next attack or a dodge may start. */
  cancelAt: number;
  range: number;
  /** Full width of the hit cone in radians. */
  arc: number;
  damage: number;
  /** Forward step during the swing, in units. */
  lunge: number;
}

export type AbilityKind =
  | { type: 'melee'; combo: ComboStep[] }
  | { type: 'bolt'; clip: string; speed: number; castAt: number; damage: number; projectileSpeed: number; heal?: number }
  | { type: 'whirl'; damage: number; radius: number }
  | { type: 'fan'; damage: number; knives: number; spread: number }
  | { type: 'nova'; damage: number; radius: number }
  | { type: 'sanctuary'; radius: number; duration: number; healPerSecond: number; damagePerSecond: number }
  | { type: 'roll'; distance: number }
  | { type: 'shadowstep'; distance: number }
  | { type: 'blink'; distance: number }
  | { type: 'guard'; duration: number; reduction: number }
  | { type: 'smoke'; duration: number; radius: number }
  | { type: 'barrier'; duration: number; absorb: number }
  | { type: 'renew'; duration: number; heal: number };

export interface Ability {
  name: string;
  icon: IconName;
  key: SlotKey;
  cooldown: number;
  cost: number;
  kind: AbilityKind;
}

export interface HeroClass {
  id: HeroClassId;
  name: string;
  epithet: string;
  model: HeroModel;
  hide: string[];
  hold: { item: string; hand: Hand; flip?: boolean; tilt?: number }[];
  /** Signature color for this class's effects. */
  color: string;
  /** Highlight color for the brightest parts of its effects. */
  hot: string;
  maxHp: number;
  speed: number;
  resource: string;
  /** 1–5, for the hero select screen. */
  stats: { power: number; agility: number; resilience: number };
  abilities: Ability[];
}

const ROLL: Ability = { name: 'Roll', icon: 'dodging', key: 'SPACE', cooldown: 0.7, cost: 0, kind: { type: 'roll', distance: 5.2 } };

export const HERO_CLASSES: Record<HeroClassId, HeroClass> = {
  warrior: {
    id: 'warrior',
    name: 'Warrior',
    epithet: 'Shield of the Living',
    model: 'Knight',
    hide: ['1H_Sword_Offhand', 'Badge_Shield', 'Rectangle_Shield', 'Spike_Shield', '2H_Sword'],
    hold: [],
    color: '#ff3a32',
    hot: '#ffd2a8',
    maxHp: 140,
    speed: 6.4,
    resource: 'Rage',
    stats: { power: 4, agility: 2, resilience: 5 },
    abilities: [
      {
        name: 'Sword Combo',
        icon: 'swordSlice',
        key: 'LMB',
        cooldown: 0,
        cost: 0,
        kind: {
          type: 'melee',
          combo: [
            { clip: '1H_Melee_Attack_Chop', speed: 1.55, hitAt: 0.36, cancelAt: 0.55, range: 2.5, arc: 2.1, damage: 22, lunge: 0.9 },
            { clip: '1H_Melee_Attack_Slice_Diagonal', speed: 1.6, hitAt: 0.34, cancelAt: 0.52, range: 2.5, arc: 2.3, damage: 24, lunge: 0.9 },
            { clip: '1H_Melee_Attack_Slice_Horizontal', speed: 1.45, hitAt: 0.33, cancelAt: 0.62, range: 2.8, arc: 2.9, damage: 34, lunge: 1.3 },
          ],
        },
      },
      { name: 'Whirlwind', icon: 'swordSpin', key: 'RMB', cooldown: 5, cost: 25, kind: { type: 'whirl', damage: 38, radius: 3.4 } },
      ROLL,
      { name: 'Shield Wall', icon: 'checkedShield', key: 'Q', cooldown: 10, cost: 20, kind: { type: 'guard', duration: 3, reduction: 0.8 } },
    ],
  },
  rogue: {
    id: 'rogue',
    name: 'Rogue',
    epithet: 'Knife in the Dark',
    model: 'Rogue_Hooded',
    hide: ['1H_Crossbow', '2H_Crossbow', 'Throwable'],
    hold: [],
    color: '#b45cff',
    hot: '#f1d6ff',
    maxHp: 95,
    speed: 7.4,
    resource: 'Energy',
    stats: { power: 3, agility: 5, resilience: 2 },
    abilities: [
      {
        name: 'Twin Blades',
        icon: 'daggers',
        key: 'LMB',
        cooldown: 0,
        cost: 0,
        kind: {
          type: 'melee',
          combo: [
            { clip: 'Dualwield_Melee_Attack_Slice', speed: 1.9, hitAt: 0.32, cancelAt: 0.48, range: 2.2, arc: 2.2, damage: 15, lunge: 0.8 },
            { clip: 'Dualwield_Melee_Attack_Chop', speed: 1.9, hitAt: 0.34, cancelAt: 0.5, range: 2.2, arc: 2.0, damage: 16, lunge: 0.8 },
            { clip: 'Dualwield_Melee_Attack_Stab', speed: 1.7, hitAt: 0.36, cancelAt: 0.6, range: 2.6, arc: 1.4, damage: 30, lunge: 1.6 },
          ],
        },
      },
      { name: 'Fan of Knives', icon: 'thrownDaggers', key: 'RMB', cooldown: 4, cost: 20, kind: { type: 'fan', damage: 14, knives: 5, spread: 0.9 } },
      { name: 'Shadow Step', icon: 'shadowFollower', key: 'SPACE', cooldown: 0.9, cost: 0, kind: { type: 'shadowstep', distance: 6.5 } },
      { name: 'Smoke Bomb', icon: 'smokeBomb', key: 'Q', cooldown: 12, cost: 25, kind: { type: 'smoke', duration: 3.5, radius: 4 } },
    ],
  },
  mage: {
    id: 'mage',
    name: 'Mage',
    epithet: 'Keeper of the Storm',
    model: 'Mage',
    hide: ['Spellbook', 'Spellbook_open', '1H_Wand', '2H_Staff'],
    hold: [{ item: 'staff', hand: 'right', flip: true, tilt: -0.6 }],
    color: '#3aa6ff',
    hot: '#d8f4ff',
    maxHp: 85,
    speed: 6.1,
    resource: 'Mana',
    stats: { power: 5, agility: 3, resilience: 1 },
    abilities: [
      {
        name: 'Arcane Bolt',
        icon: 'boltSpellCast',
        key: 'LMB',
        cooldown: 0,
        cost: 0,
        kind: { type: 'bolt', clip: 'Spellcast_Shoot', speed: 1.9, castAt: 0.3, damage: 20, projectileSpeed: 24 },
      },
      { name: 'Nova', icon: 'starSwirl', key: 'RMB', cooldown: 6, cost: 30, kind: { type: 'nova', damage: 45, radius: 5.8 } },
      { name: 'Blink', icon: 'teleport', key: 'SPACE', cooldown: 2.5, cost: 0, kind: { type: 'blink', distance: 6.5 } },
      { name: 'Arcane Shield', icon: 'magicShield', key: 'Q', cooldown: 12, cost: 25, kind: { type: 'barrier', duration: 5, absorb: 45 } },
    ],
  },
  healer: {
    id: 'healer',
    name: 'Healer',
    epithet: 'Light Against the Dead',
    model: 'Rogue',
    hide: ['Knife', 'Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Throwable'],
    hold: [
      { item: 'staff', hand: 'right', flip: true, tilt: -0.6 },
      { item: 'spellbook_open', hand: 'left' },
    ],
    color: '#ffb23c',
    hot: '#fff3c8',
    maxHp: 105,
    speed: 6.3,
    resource: 'Faith',
    stats: { power: 2, agility: 3, resilience: 4 },
    abilities: [
      {
        name: 'Radiant Orb',
        icon: 'sunRadiations',
        key: 'LMB',
        cooldown: 0,
        cost: 0,
        kind: { type: 'bolt', clip: 'Spellcast_Shoot', speed: 1.7, castAt: 0.32, damage: 17, projectileSpeed: 17, heal: 3 },
      },
      {
        name: 'Sanctuary',
        icon: 'holySymbol',
        key: 'RMB',
        cooldown: 9,
        cost: 30,
        kind: { type: 'sanctuary', radius: 4.2, duration: 4.5, healPerSecond: 9, damagePerSecond: 22 },
      },
      { ...ROLL, name: 'Swift Step', icon: 'wingfoot', cooldown: 0.8 },
      { name: 'Renew', icon: 'regeneration', key: 'Q', cooldown: 10, cost: 25, kind: { type: 'renew', duration: 4, heal: 45 } },
    ],
  },
};
