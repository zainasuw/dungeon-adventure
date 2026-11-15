/**
 * Lighting and grading presets. The look-test panel switches between them so
 * the art direction can be chosen by eye.
 */
export interface Mood {
  id: string;
  label: string;
  background: string;
  fog: { color: string; density: number };
  hemi: { sky: string; ground: string; intensity: number };
  moon: { color: string; intensity: number };
  environment: number;
  /** Multiplied into the dungeon kit's texture: cold stone vs warm stone. */
  stone: string;
  torch: { color: string; intensity: number; distance: number };
  rune: { color: string; intensity: number };
  heroLight: number;
  bloom: { intensity: number; threshold: number };
  saturation: number;
  contrast: number;
  brightness: number;
  vignette: number;
  ao: number;
}

export const MOODS: Mood[] = [
  {
    id: 'gilded',
    label: 'Gilded Crypt',
    background: '#05070d',
    fog: { color: '#070b14', density: 0.022 },
    hemi: { sky: '#2f4a85', ground: '#08090e', intensity: 0.62 },
    moon: { color: '#7f9fdc', intensity: 0.45 },
    environment: 0.08,
    stone: '#93a2c4',
    torch: { color: '#ff8233', intensity: 27, distance: 11.5 },
    rune: { color: '#2fd2ff', intensity: 2.6 },
    heroLight: 9,
    bloom: { intensity: 1.25, threshold: 0.72 },
    saturation: 0.14,
    contrast: 0.14,
    brightness: 0,
    vignette: 0.75,
    ao: 3,
  },
  {
    id: 'torchlit',
    label: 'Torchlit',
    background: '#0b0806',
    fog: { color: '#120c08', density: 0.018 },
    hemi: { sky: '#5a4636', ground: '#0e0a08', intensity: 0.6 },
    moon: { color: '#c8a27a', intensity: 0.4 },
    environment: 0.12,
    stone: '#b9ad9a',
    torch: { color: '#ff9443', intensity: 38, distance: 16 },
    rune: { color: '#47d6ff', intensity: 2.2 },
    heroLight: 10,
    bloom: { intensity: 1.05, threshold: 0.78 },
    saturation: 0.2,
    contrast: 0.1,
    brightness: 0.01,
    vignette: 0.6,
    ao: 2.6,
  },
  {
    id: 'abyssal',
    label: 'Abyssal',
    background: '#020308',
    fog: { color: '#03050a', density: 0.032 },
    hemi: { sky: '#1a2b4c', ground: '#04050a', intensity: 0.24 },
    moon: { color: '#4f78d8', intensity: 0.24 },
    environment: 0.05,
    stone: '#7484a4',
    torch: { color: '#ff6a26', intensity: 28, distance: 12 },
    rune: { color: '#46f2ff', intensity: 3.4 },
    heroLight: 7,
    bloom: { intensity: 1.6, threshold: 0.66 },
    saturation: 0.06,
    contrast: 0.2,
    brightness: -0.01,
    vignette: 0.9,
    ao: 3.2,
  },
  {
    id: 'verdant',
    label: 'Overgrown',
    background: '#040a07',
    fog: { color: '#07120c', density: 0.02 },
    hemi: { sky: '#3f7a5a', ground: '#07100b', intensity: 0.66 },
    moon: { color: '#a6e0b4', intensity: 0.42 },
    environment: 0.1,
    stone: '#9fb8a2',
    torch: { color: '#ffb347', intensity: 30, distance: 13 },
    rune: { color: '#7dff9e', intensity: 2.6 },
    heroLight: 10,
    bloom: { intensity: 1.2, threshold: 0.74 },
    saturation: 0.22,
    contrast: 0.12,
    brightness: 0.01,
    vignette: 0.7,
    ao: 2.8,
  },
  {
    id: 'ember',
    label: 'Ember Deep',
    background: '#0c0403',
    fog: { color: '#170705', density: 0.022 },
    hemi: { sky: '#7a3424', ground: '#100504', intensity: 0.6 },
    moon: { color: '#ff9a6a', intensity: 0.38 },
    environment: 0.1,
    stone: '#c49a8a',
    torch: { color: '#ff5a1f', intensity: 36, distance: 14 },
    rune: { color: '#ff7a2f', intensity: 3 },
    heroLight: 10,
    bloom: { intensity: 1.35, threshold: 0.7 },
    saturation: 0.24,
    contrast: 0.14,
    brightness: 0.01,
    vignette: 0.75,
    ao: 2.8,
  },
];
