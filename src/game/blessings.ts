import type { IconName } from '../ui/icons';

export type BlessingId = 'mighty' | 'swift' | 'heart' | 'pouch' | 'vampire' | 'fire' | 'thorns' | 'lucky' | 'surge';

export interface Blessing {
  id: BlessingId;
  name: string;
  /** What one level does, in plain words. Shown before choosing. */
  text: string;
  icon: IconName | 'potion';
  color: string;
  max: number;
}

/**
 * Power-ups offered after each hall, pick one of three. Every one is useful on
 * its own and says exactly what it does (lessons from Archero and Hades).
 */
export const BLESSINGS: Record<BlessingId, Blessing> = {
  mighty: { id: 'mighty', name: 'Mighty Strikes', text: 'Your hits hurt monsters more.', icon: 'swordSlice', color: '#ff5a4a', max: 3 },
  swift: { id: 'swift', name: 'Swift Feet', text: 'Run faster and dodge more often.', icon: 'wingfoot', color: '#5ee0ff', max: 3 },
  heart: { id: 'heart', name: 'Big Heart', text: 'More health, and you heal all the way up now.', icon: 'regeneration', color: '#ff7ba0', max: 3 },
  pouch: { id: 'pouch', name: 'Potion Pouch', text: 'Carry one more potion, and get 2 potions now.', icon: 'potion', color: '#ff4f78', max: 3 },
  vampire: { id: 'vampire', name: 'Healing Hits', text: 'Every hit heals you a little.', icon: 'holySymbol', color: '#c46bff', max: 3 },
  fire: { id: 'fire', name: 'Fire Blade', text: 'Your hits set monsters on fire!', icon: 'sunRadiations', color: '#ff9a2e', max: 3 },
  thorns: { id: 'thorns', name: 'Thorn Armor', text: 'Monsters that hit you get hurt too.', icon: 'checkedShield', color: '#7dff9e', max: 3 },
  lucky: { id: 'lucky', name: 'Lucky Charm', text: 'Monsters and crates drop potions more often.', icon: 'starSwirl', color: '#ffd23a', max: 2 },
  surge: { id: 'surge', name: 'Power Surge', text: 'Your special moves are ready again sooner.', icon: 'boltSpellCast', color: '#8fb4ff', max: 3 },
};

export type BlessingLevels = Partial<Record<BlessingId, number>>;

/** Three different blessings that aren't maxed out yet. */
export function rollBlessings(owned: BlessingLevels, count = 3): Blessing[] {
  const open = Object.values(BLESSINGS).filter((b) => (owned[b.id] ?? 0) < b.max);
  for (let i = open.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [open[i], open[j]] = [open[j], open[i]];
  }
  return open.slice(0, count);
}
