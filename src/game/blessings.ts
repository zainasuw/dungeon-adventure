import type { IconName } from '../ui/icons';

export type BlessingId = 'mighty' | 'swift' | 'heart' | 'pouch' | 'vampire' | 'fire' | 'frost' | 'spark' | 'thorns' | 'lucky' | 'surge';

/** The three powers that live on the weapon. A hero carries one at a time. */
export const ELEMENTS = ['fire', 'frost', 'spark'] as const;
export type ElementId = (typeof ELEMENTS)[number];

export interface Blessing {
  id: BlessingId;
  name: string;
  /** What one level does, in five words or fewer. Shown before choosing. */
  text: string;
  icon: IconName | 'potion';
  color: string;
  max: number;
  /** A weapon power: its colour shows on the weapon, and only one is held at a time. */
  element?: true;
}

/**
 * Power-ups offered after each hall, pick one of three. Every one is useful on
 * its own and says what it does in a few words. The first pick of a quest is
 * always the weapon power, so every hero carries one you can see.
 */
export const BLESSINGS: Record<BlessingId, Blessing> = {
  fire: { id: 'fire', name: 'Ember Strike', text: 'Hits set monsters on fire.', icon: 'sunRadiations', color: '#ff8a2a', max: 3, element: true },
  frost: { id: 'frost', name: 'Frost Strike', text: 'Hits freeze monsters still.', icon: 'snowflake', color: '#bfeaff', max: 3, element: true },
  spark: { id: 'spark', name: 'Gold Spark', text: 'Beaten monsters zap another.', icon: 'sparkJump', color: '#ffe27a', max: 3, element: true },
  mighty: { id: 'mighty', name: 'Mighty Strikes', text: 'Hits hurt monsters more.', icon: 'swordSlice', color: '#ff5a4a', max: 3 },
  swift: { id: 'swift', name: 'Swift Feet', text: 'Run and dodge faster.', icon: 'wingfoot', color: '#5ee0ff', max: 3 },
  heart: { id: 'heart', name: 'Big Heart', text: 'More health. Full heal now.', icon: 'regeneration', color: '#ff7ba0', max: 3 },
  pouch: { id: 'pouch', name: 'Potion Pouch', text: 'Bigger bag. Two potions now.', icon: 'potion', color: '#ff4f78', max: 3 },
  vampire: { id: 'vampire', name: 'Healing Hits', text: 'Every hit heals you.', icon: 'holySymbol', color: '#ff8f7a', max: 3 },
  thorns: { id: 'thorns', name: 'Thorn Armor', text: 'Hitting you hurts monsters.', icon: 'checkedShield', color: '#7dff9e', max: 3 },
  lucky: { id: 'lucky', name: 'Lucky Charm', text: 'Crates drop more potions.', icon: 'starSwirl', color: '#ffd23a', max: 2 },
  surge: { id: 'surge', name: 'Power Surge', text: 'Special moves recharge faster.', icon: 'boltSpellCast', color: '#8fb4ff', max: 3 },
};

export type BlessingLevels = Partial<Record<BlessingId, number>>;

/** The weapon power this hero carries, if any. */
export function heldElement(owned: BlessingLevels): ElementId | null {
  return ELEMENTS.find((id) => (owned[id] ?? 0) > 0) ?? null;
}

/**
 * Three different blessings that aren't maxed out yet. With no weapon power yet, the
 * offer is the three powers; after that the other two are never offered again, so the
 * weapon keeps one colour for the whole quest.
 */
export function rollBlessings(owned: BlessingLevels, count = 3): Blessing[] {
  const held = heldElement(owned);
  if (!held) return ELEMENTS.map((id) => BLESSINGS[id]).slice(0, count);
  const open = Object.values(BLESSINGS).filter((b) => (owned[b.id] ?? 0) < b.max && (!b.element || b.id === held));
  for (let i = open.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [open[i], open[j]] = [open[j], open[i]];
  }
  return open.slice(0, count);
}
