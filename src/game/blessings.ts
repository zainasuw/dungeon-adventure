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
  mighty: { id: 'mighty', name: 'Mighty Strikes', text: 'Your hits do 25% more damage.', icon: 'swordSlice', color: '#ff5a4a', max: 3 },
  swift: { id: 'swift', name: 'Swift Feet', text: 'Move 12% faster and dodge more often.', icon: 'wingfoot', color: '#5ee0ff', max: 3 },
  heart: { id: 'heart', name: 'Big Heart', text: '+30 max health, and heal to full now.', icon: 'regeneration', color: '#ff7ba0', max: 3 },
  pouch: { id: 'pouch', name: 'Potion Pouch', text: 'Carry 1 more potion and get 2 right now.', icon: 'potion', color: '#ff4f78', max: 3 },
  vampire: { id: 'vampire', name: 'Life Steal', text: 'Every hit heals you 2 health.', icon: 'holySymbol', color: '#c46bff', max: 3 },
  fire: { id: 'fire', name: 'Fire Blade', text: 'Hits set monsters on fire for 3 seconds.', icon: 'sunRadiations', color: '#ff9a2e', max: 3 },
  thorns: { id: 'thorns', name: 'Thorn Armor', text: 'Monsters that hit you take 12 damage back.', icon: 'checkedShield', color: '#7dff9e', max: 3 },
  lucky: { id: 'lucky', name: 'Lucky Charm', text: 'Monsters and crates drop potions more often.', icon: 'starSwirl', color: '#ffd23a', max: 2 },
  surge: { id: 'surge', name: 'Power Surge', text: 'Special moves and powers recharge 25% faster.', icon: 'boltSpellCast', color: '#8fb4ff', max: 3 },
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
