import type { HeroClassId } from '../actors/classes';
import { MOODS } from '../render/moods';

export interface CameraPreset {
  id: string;
  label: string;
  yaw: number;
  pitch: number;
  distance: number;
}

export const CAMERA_PRESETS: CameraPreset[] = [
  { id: 'iso', label: 'Isometric', yaw: 45, pitch: 54, distance: 23 },
  { id: 'front', label: 'Head-on', yaw: 0, pitch: 56, distance: 22 },
  { id: 'close', label: 'Close', yaw: 28, pitch: 46, distance: 16 },
];

const HEROES: { id: HeroClassId; label: string }[] = [
  { id: 'warrior', label: 'Warrior' },
  { id: 'rogue', label: 'Rogue' },
  { id: 'mage', label: 'Mage' },
  { id: 'healer', label: 'Healer' },
];

export interface LookDevHandlers {
  hero(id: HeroClassId): void;
  mood(index: number): void;
  camera(preset: CameraPreset): void;
}

/**
 * A small panel for comparing art-direction options live: hero, lighting mood
 * and camera angle. Keys: 1–4 hero, M mood, C camera, ` hides the panel.
 */
export class LookDev {
  private readonly panel: HTMLElement;
  private heroIndex = 0;
  private moodIndex = 0;
  private cameraIndex = 0;

  constructor(root: HTMLElement, private readonly on: LookDevHandlers) {
    this.panel = document.createElement('section');
    this.panel.className = 'lookdev';
    this.panel.setAttribute('aria-label', 'Look test');
    this.panel.innerHTML = `
      <h2 class="lookdev__title">Look test</h2>
      ${this.group('hero', 'Hero', HEROES.map((h) => h.label), '1–4')}
      ${this.group('mood', 'Mood', MOODS.map((m) => m.label), 'M')}
      ${this.group('camera', 'Camera', CAMERA_PRESETS.map((c) => c.label), 'C')}
      <p class="lookdev__help"><b>WASD</b> move · <b>Mouse</b> aim · <b>Click</b> attack · <b>Space</b> dodge · <b>\`</b> hide panel</p>
    `;
    root.appendChild(this.panel);
    this.panel.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest('button');
      if (!button) return;
      const index = Number(button.dataset.index);
      const group = button.dataset.group;
      if (group === 'hero') this.selectHero(index);
      if (group === 'mood') this.selectMood(index);
      if (group === 'camera') this.selectCamera(index);
      button.blur();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code.startsWith('Digit')) {
        const n = Number(e.code.slice(5)) - 1;
        if (n >= 0 && n < HEROES.length) this.selectHero(n);
      }
      if (e.code === 'KeyM') this.selectMood((this.moodIndex + 1) % MOODS.length);
      if (e.code === 'KeyC') this.selectCamera((this.cameraIndex + 1) % CAMERA_PRESETS.length);
      if (e.code === 'Backquote') this.panel.classList.toggle('lookdev--hidden');
    });
    this.sync();
  }

  private selectHero(i: number): void {
    if (i === this.heroIndex) return;
    this.heroIndex = i;
    this.on.hero(HEROES[i].id);
    this.sync();
  }

  private selectMood(i: number): void {
    this.moodIndex = i;
    this.on.mood(i);
    this.sync();
  }

  private selectCamera(i: number): void {
    this.cameraIndex = i;
    this.on.camera(CAMERA_PRESETS[i]);
    this.sync();
  }

  private group(id: string, label: string, options: string[], key: string): string {
    const buttons = options
      .map((o, i) => `<button type="button" data-group="${id}" data-index="${i}">${o}</button>`)
      .join('');
    return `<div class="lookdev__row"><span class="lookdev__label">${label} <kbd>${key}</kbd></span><div class="lookdev__options">${buttons}</div></div>`;
  }

  private sync(): void {
    const selected: Record<string, number> = { hero: this.heroIndex, mood: this.moodIndex, camera: this.cameraIndex };
    for (const button of this.panel.querySelectorAll<HTMLButtonElement>('button')) {
      const on = selected[button.dataset.group!] === Number(button.dataset.index);
      button.setAttribute('aria-pressed', String(on));
    }
  }
}
