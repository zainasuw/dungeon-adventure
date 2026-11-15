import { HERO_CLASSES, type HeroClass, type HeroClassId, type SlotKey } from '../actors/classes';
import { DIFFICULTIES, LEVELS, MAX_POTIONS, type DifficultyId, type SaveData } from '../game/levels';
import { ICONS, type IconName } from './icons';

/** Hero order on the select screen, as in the original game. */
export const HERO_ORDER: HeroClassId[] = ['warrior', 'priestess', 'thief', 'doctor'];

export interface UiHandlers {
  newQuest(): void;
  continueQuest(): void;
  previewHero(id: HeroClassId): void;
  startQuest(hero: HeroClassId, name: string, difficulty: DifficultyId): void;
  backToTitle(): void;
  resume(): void;
  restartLevel(): void;
  changeHero(): void;
  toggleMute(): boolean;
  pause(): void;
}

export interface QuestStats {
  heroName: string;
  hero: HeroClass;
  difficulty: DifficultyId;
  level: number;
  pillars: number;
  kills: number;
  potionsUsed: number;
  time: number;
}

export type FloatKind = 'damage' | 'crit' | 'hurt' | 'heal' | 'info' | 'block';

const KEY_LABEL: Record<SlotKey, string> = { LMB: 'Click', RMB: 'R-Click', SPACE: 'Space', Q: 'Q' };

// Two small drawings of our own for things the icon set lacks.
const POTION_PATH =
  'M200 40h112v40h-16v86c74 22 128 90 128 170 0 98-80 136-168 136S88 434 88 336c0-80 54-148 128-170V80h-16z M146 330c0 64 50 92 110 92s110-28 110-92c0-12-2-24-6-34H152c-4 10-6 22-6 34z';
const PILLAR_PATH =
  'M120 56h272v44H120z M152 100h208v26H152z M176 126h44v262h-44z M234 126h44v262h-44z M292 126h44v262h-44z M152 388h208v26H152z M120 414h272v44H120z';

function icon(path: string, className = 'icon'): string {
  return `<svg class="${className}" viewBox="0 0 512 512" aria-hidden="true"><path d="${path}"/></svg>`;
}

function iconByName(name: IconName, className?: string): string {
  return icon(ICONS[name], className);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, html = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (html) node.innerHTML = html;
  return node;
}

/** All menus and the in-game HUD, drawn in HTML over the 3D view. */
export class Ui {
  private readonly screen: HTMLElement;
  private readonly hud: HTMLElement;
  private readonly floaters: HTMLElement;
  private readonly bars: HTMLElement;
  private readonly bannerEl: HTMLElement;
  private readonly fadeEl: HTMLElement;
  private readonly promptEl: HTMLElement;
  private readonly lowHp: HTMLElement;
  private readonly enemyBars = new Map<object, { root: HTMLElement; fill: HTMLElement; seen: number }>();
  private bannerTimer = 0;
  private selectState = { hero: 'warrior' as HeroClassId, name: '', difficulty: 'easy' as DifficultyId };
  private overlayReturn: (() => void) | null = null;
  private muted = false;

  // HUD parts, filled by setHero.
  private hpFill!: HTMLElement;
  private hpLag!: HTMLElement;
  private hpText!: HTMLElement;
  private resFill!: HTMLElement;
  private potionCount!: HTMLElement;
  private potionSlot!: HTMLElement;
  private slots: { root: HTMLElement; sweep: HTMLElement; time: HTMLElement; cost: number }[] = [];
  private pillarsEl!: HTMLElement;
  private hallEl!: HTMLElement;
  private objectiveEl!: HTMLElement;
  private shownHp = -1;
  private lagHp = 0;

  constructor(
    root: HTMLElement,
    private readonly handlers: UiHandlers,
  ) {
    this.bars = el('div', 'enemy-bars');
    this.floaters = el('div', 'floaters');
    this.promptEl = el('div', 'world-prompt');
    this.hud = el('div', 'hud hud--hidden');
    this.lowHp = el('div', 'low-hp');
    this.bannerEl = el('div', 'banner');
    this.screen = el('div', 'screen-layer');
    this.fadeEl = el('div', 'fade');
    this.bannerEl.setAttribute('role', 'status');
    this.bannerEl.setAttribute('aria-live', 'polite');
    root.append(this.lowHp, this.bars, this.floaters, this.promptEl, this.hud, this.bannerEl, this.screen, this.fadeEl);
    window.addEventListener('keydown', this.onKey);
  }

  // ───────────────────────── Screens ─────────────────────────

  showTitle(save: SaveData | null): void {
    const cont = save
      ? `<button class="btn btn--primary" data-act="continue">
           <span>Continue</span>
           <small>${save.name ? `${escapeHtml(save.name)} the ` : ''}${HERO_CLASSES[save.hero].name} · Hall ${save.level + 1} of 4</small>
         </button>`
      : '';
    this.setScreen(
      'title',
      `<div class="title">
        <p class="kicker">A 3D dungeon crawler</p>
        <h1 class="title__name">Dungeon<br/>Adventure</h1>
        <p class="title__tag">Wake the four pillars. Defeat the skeletons.<br/>Escape through the golden door.</p>
        <div class="title__actions">
          ${cont}
          <button class="btn ${save ? '' : 'btn--primary'}" data-act="new">${save ? 'New quest' : 'Start a quest'}</button>
          <button class="btn btn--ghost" data-act="howto">How to play</button>
        </div>
      </div>
      <p class="credits">3D art: KayKit by Kay Lousberg (CC0) · Icons: game-icons.net (CC BY 3.0)</p>`,
    );
    this.on('continue', () => this.handlers.continueQuest());
    this.on('new', () => this.handlers.newQuest());
    this.on('howto', () => this.showHowTo(() => this.showTitle(save)));
    this.focusFirst();
  }

  showSelect(hero: HeroClassId, name: string, difficulty: DifficultyId): void {
    this.selectState = { hero, name, difficulty };
    const tabs = HERO_ORDER.map((id) => {
      const c = HERO_CLASSES[id];
      return `<button type="button" class="hero-tab" role="radio" data-hero="${id}" style="--hero:${c.color}">
        <span class="hero-tab__icon">${iconByName(c.abilities[0].icon)}</span>
        <span class="hero-tab__name">${c.name}</span>
      </button>`;
    }).join('');
    const diffs = (Object.keys(DIFFICULTIES) as DifficultyId[])
      .map((id) => `<button type="button" class="seg__btn" role="radio" data-diff="${id}">${DIFFICULTIES[id].label}</button>`)
      .join('');
    this.setScreen(
      'select',
      `<form class="select" novalidate>
        <header class="select__head">
          <button type="button" class="link-btn" data-act="back">‹ Back</button>
          <h2 class="select__title">Choose your hero</h2>
        </header>
        <div class="hero-tabs" role="radiogroup" aria-label="Hero">${tabs}</div>
        <section class="hero-detail" aria-live="polite"></section>
        <div class="select__fields">
          <label class="field">
            <span class="field__label">Your hero's name</span>
            <input class="field__input" name="hero-name" maxlength="16" autocomplete="off" spellcheck="false" placeholder="Type a name" />
          </label>
          <div class="field">
            <span class="field__label" id="diff-label">Difficulty</span>
            <div class="seg" role="radiogroup" aria-labelledby="diff-label">${diffs}</div>
            <p class="field__hint" data-diff-hint></p>
          </div>
        </div>
        <button type="submit" class="btn btn--primary btn--wide">Enter the crypt</button>
      </form>`,
    );
    const form = this.screen.querySelector('form')!;
    const input = form.querySelector<HTMLInputElement>('.field__input')!;
    input.value = name;
    input.addEventListener('input', () => (this.selectState.name = input.value));
    this.screen.querySelectorAll<HTMLButtonElement>('[data-hero]').forEach((b) =>
      b.addEventListener('click', () => this.pickHero(b.dataset.hero as HeroClassId)),
    );
    this.screen.querySelectorAll<HTMLButtonElement>('[data-diff]').forEach((b) =>
      b.addEventListener('click', () => this.pickDifficulty(b.dataset.diff as DifficultyId)),
    );
    this.on('back', () => this.handlers.backToTitle());
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const s = this.selectState;
      this.handlers.startQuest(s.hero, s.name.trim(), s.difficulty);
    });
    this.pickHero(hero, false);
    this.pickDifficulty(difficulty);
    this.screen.querySelector<HTMLButtonElement>(`[data-hero="${hero}"]`)?.focus();
  }

  showHowTo(onClose: () => void): void {
    this.overlayReturn = onClose;
    const step = (n: number, title: string, text: string, art: string) =>
      `<li class="howto__step"><span class="howto__num">${n}</span><span class="howto__art">${art}</span><b>${title}</b><span>${text}</span></li>`;
    const key = (k: string, what: string) => `<div class="keyrow"><kbd>${k}</kbd><span>${what}</span></div>`;
    this.setScreen(
      'howto',
      `<div class="card card--wide" role="dialog" aria-modal="true" aria-labelledby="howto-title">
        <h2 id="howto-title" class="card__title">How to play</h2>
        <ol class="howto">
          ${step(1, 'Take the pillar', 'Walk to the glowing altar and press <kbd>E</kbd>.', icon(PILLAR_PATH, 'icon icon--gold'))}
          ${step(2, 'Beat the skeletons', 'Taking the pillar wakes them up. Defeat them all.', iconByName('swordSlice', 'icon icon--gold'))}
          ${step(3, 'Go through the door', 'The golden door opens. Walk in to reach the next hall.', iconByName('teleport', 'icon icon--gold'))}
        </ol>
        <p class="howto__goal">Collect all <b>4 pillars</b> to escape and win.</p>
        <div class="keys">
          ${key('W A S D', 'Walk (arrow keys work too)')}
          ${key('Mouse', 'Aim where you point')}
          ${key('Click', 'Attack')}
          ${key('R-Click', 'Special move')}
          ${key('Space', 'Dodge')}
          ${key('Q', 'Hero power')}
          ${key('H', 'Drink a potion')}
          ${key('E', 'Take the pillar')}
          ${key('Esc', 'Pause')}
        </div>
        <p class="howto__tip">Tip: a red ring on the floor means a skeleton is about to swing. Dodge out of it!</p>
        <button class="btn btn--primary" data-act="close">Got it</button>
      </div>`,
    );
    this.on('close', () => this.closeOverlay());
    this.focusFirst('[data-act="close"]');
  }

  showPause(): void {
    this.setScreen(
      'pause',
      `<div class="card" role="dialog" aria-modal="true" aria-labelledby="pause-title">
        <h2 id="pause-title" class="card__title">Paused</h2>
        <div class="stack">
          <button class="btn btn--primary" data-act="resume">Resume</button>
          <button class="btn" data-act="howto">How to play</button>
          <button class="btn" data-act="mute">${this.muted ? 'Sound: off' : 'Sound: on'}</button>
          <button class="btn" data-act="restart">Restart this hall</button>
          <button class="btn btn--ghost" data-act="quit">Save and quit to title</button>
        </div>
      </div>`,
    );
    this.on('resume', () => this.handlers.resume());
    this.on('howto', () => this.showHowTo(() => this.showPause()));
    this.on('mute', () => {
      this.muted = this.handlers.toggleMute();
      this.showPause();
      this.focusFirst('[data-act="mute"]');
    });
    this.on('restart', () => this.handlers.restartLevel());
    this.on('quit', () => this.handlers.backToTitle());
    this.focusFirst();
  }

  showGameOver(stats: QuestStats): void {
    const hall = LEVELS[stats.level].hall.replace(/^The /, 'the ');
    this.setScreen(
      'gameover',
      `<div class="card card--end" role="dialog" aria-modal="true" aria-labelledby="go-title">
        <p class="kicker kicker--blood">Defeated</p>
        <h2 id="go-title" class="card__title">${escapeHtml(stats.heroName || `The ${stats.hero.name}`)} fell in ${hall}</h2>
        <p class="card__text">Don't give up! You keep your ${stats.pillars} ${stats.pillars === 1 ? 'pillar' : 'pillars'} and start this hall fresh.</p>
        ${this.pillarRow(stats.pillars)}
        <div class="stack">
          <button class="btn btn--primary" data-act="retry">Try again</button>
          <button class="btn" data-act="hero">Pick another hero</button>
          <button class="btn btn--ghost" data-act="quit">Quit to title</button>
        </div>
      </div>`,
    );
    this.on('retry', () => this.handlers.restartLevel());
    this.on('hero', () => this.handlers.changeHero());
    this.on('quit', () => this.handlers.backToTitle());
    this.focusFirst();
  }

  showVictory(stats: QuestStats): void {
    const stat = (label: string, value: string) => `<div class="stat"><span>${label}</span><b>${value}</b></div>`;
    this.setScreen(
      'victory',
      `<div class="card card--end card--victory" role="dialog" aria-modal="true" aria-labelledby="win-title">
        <p class="kicker">Quest complete</p>
        <h2 id="win-title" class="card__title card__title--big">You escaped!</h2>
        <p class="card__text">${stats.heroName ? `${escapeHtml(stats.heroName)} the ${stats.hero.name}` : `The ${stats.hero.name}`} woke all four pillars and walked out into the light.</p>
        ${this.pillarRow(4)}
        <div class="stats">
          ${stat('Time', formatTime(stats.time))}
          ${stat('Skeletons beaten', String(stats.kills))}
          ${stat('Potions drunk', String(stats.potionsUsed))}
          ${stat('Difficulty', DIFFICULTIES[stats.difficulty].label)}
        </div>
        <div class="stack stack--row">
          <button class="btn btn--primary" data-act="again">Play again</button>
          <button class="btn btn--ghost" data-act="quit">Title screen</button>
        </div>
      </div>`,
    );
    this.on('again', () => this.handlers.changeHero());
    this.on('quit', () => this.handlers.backToTitle());
    this.focusFirst();
  }

  hideScreen(): void {
    delete this.screen.dataset.screen;
    this.screen.className = 'screen-layer';
    this.screen.innerHTML = '';
    this.overlayReturn = null;
  }

  get screenName(): string {
    return this.screen.dataset.screen ?? '';
  }

  /** A big title card for entering a hall or claiming a pillar. */
  banner(kicker: string, title: string, sub: string, seconds = 2.8): void {
    this.bannerEl.innerHTML = `<p class="kicker">${kicker}</p><h2 class="banner__title">${title}</h2><p class="banner__sub">${sub}</p>`;
    this.bannerEl.classList.remove('banner--show');
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('banner--show');
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.bannerEl.classList.remove('banner--show'), seconds * 1000);
  }

  fade(on: boolean): void {
    this.fadeEl.classList.toggle('fade--on', on);
  }

  // ───────────────────────── HUD ─────────────────────────

  showHud(visible: boolean): void {
    this.hud.classList.toggle('hud--hidden', !visible);
    if (!visible) {
      this.prompt(null);
      this.lowHp.classList.remove('low-hp--on');
    }
  }

  setHero(def: HeroClass, name: string, maxHp: number): void {
    const slots = def.abilities
      .map(
        (a, i) => `<div class="slot" data-slot="${i}" title="${a.name}">
          <span class="slot__icon">${iconByName(a.icon)}</span>
          <span class="slot__sweep"></span>
          <span class="slot__time"></span>
          <kbd class="slot__key">${KEY_LABEL[a.key]}</kbd>
          <span class="slot__name">${a.name}</span>
        </div>`,
      )
      .join('');
    this.hud.style.setProperty('--hero', def.color);
    this.hud.innerHTML = `
      <div class="plate">
        <div class="plate__crest">${iconByName(def.abilities[0].icon)}</div>
        <div class="plate__body">
          <p class="plate__name">${name ? `${escapeHtml(name)} <span>the ${def.name}</span>` : def.name}</p>
          <div class="bar bar--hp" role="meter" aria-label="Health" aria-valuemin="0" aria-valuemax="${maxHp}">
            <span class="bar__lag"></span><span class="bar__fill"></span><span class="bar__text"></span>
          </div>
          <div class="bar bar--res" aria-hidden="true"><span class="bar__fill"></span></div>
          <p class="plate__passive">${iconByName('holySymbol', 'icon icon--tiny')} ${def.passive.name}: ${def.passive.text}</p>
        </div>
      </div>
      <div class="quest">
        <p class="quest__hall"></p>
        <div class="quest__pillars"></div>
        <p class="quest__objective"></p>
      </div>
      <div class="topright">
        <button class="icon-btn" data-act="pause" aria-label="Pause">${icon('M160 96h64v320h-64z M288 96h64v320h-64z')}</button>
      </div>
      <div class="dock">
        ${slots}
        <div class="slot slot--potion" title="Drink a potion">
          <span class="slot__icon">${icon(POTION_PATH)}</span>
          <span class="slot__count"></span>
          <kbd class="slot__key">H</kbd>
          <span class="slot__name">Potion</span>
        </div>
      </div>`;
    this.hud.querySelector('[data-act="pause"]')!.addEventListener('click', () => this.handlers.pause());
    this.hpFill = this.hud.querySelector('.bar--hp .bar__fill')!;
    this.hpLag = this.hud.querySelector('.bar--hp .bar__lag')!;
    this.hpText = this.hud.querySelector('.bar--hp .bar__text')!;
    this.resFill = this.hud.querySelector('.bar--res .bar__fill')!;
    this.potionSlot = this.hud.querySelector('.slot--potion')!;
    this.potionCount = this.hud.querySelector('.slot__count')!;
    this.pillarsEl = this.hud.querySelector('.quest__pillars')!;
    this.hallEl = this.hud.querySelector('.quest__hall')!;
    this.objectiveEl = this.hud.querySelector('.quest__objective')!;
    this.slots = def.abilities.map((a, i) => {
      const root = this.hud.querySelector<HTMLElement>(`[data-slot="${i}"]`)!;
      return { root, sweep: root.querySelector('.slot__sweep')!, time: root.querySelector('.slot__time')!, cost: a.cost };
    });
    this.shownHp = -1;
  }

  setQuest(level: number, pillars: number): void {
    const l = LEVELS[level];
    this.hallEl.textContent = `Hall ${level + 1} of 4 · ${l.hall}`;
    this.pillarsEl.innerHTML = LEVELS.map(
      (lv, i) =>
        `<span class="pip ${i < pillars ? 'pip--lit' : ''} ${i === level && i >= pillars ? 'pip--now' : ''}" style="--pip:${lv.crystal}" title="Pillar of ${lv.pillar}">${icon(PILLAR_PATH)}</span>`,
    ).join('');
  }

  objective(text: string): void {
    if (this.objectiveEl.textContent === text) return;
    this.objectiveEl.textContent = text;
    this.objectiveEl.classList.remove('quest__objective--new');
    void this.objectiveEl.offsetWidth;
    this.objectiveEl.classList.add('quest__objective--new');
  }

  updateHud(hp: number, maxHp: number, resource: number, potions: number, cooldowns: number[], cooldownLeft: number[]): void {
    if (this.shownHp < 0) this.lagHp = hp;
    if (hp !== this.shownHp) {
      this.shownHp = hp;
      this.hpFill.style.transform = `scaleX(${hp / maxHp})`;
      this.hpText.textContent = `${Math.ceil(hp)} / ${maxHp}`;
      this.lowHp.classList.toggle('low-hp--on', hp > 0 && hp / maxHp < 0.3);
    }
    // The pale "lag" bar drains after the red one so a hit reads clearly.
    this.lagHp = this.lagHp > hp ? Math.max(hp, this.lagHp - maxHp * 0.012) : hp;
    this.hpLag.style.transform = `scaleX(${this.lagHp / maxHp})`;
    this.resFill.style.transform = `scaleX(${resource / 100})`;
    this.potionCount.textContent = `${potions}/${MAX_POTIONS}`;
    this.potionSlot.classList.toggle('slot--empty', potions === 0);
    this.slots.forEach((s, i) => {
      const f = cooldowns[i];
      s.sweep.style.setProperty('--cd', String(f));
      s.time.textContent = cooldownLeft[i] > 0.95 ? String(Math.ceil(cooldownLeft[i])) : '';
      s.root.classList.toggle('slot--cooling', f > 0);
      s.root.classList.toggle('slot--low', s.cost > resource);
    });
  }

  /** Flashes an ability or potion slot when used. */
  pulseSlot(index: number | 'potion'): void {
    const node = index === 'potion' ? this.potionSlot : this.slots[index]?.root;
    if (!node) return;
    node.classList.remove('slot--pulse');
    void node.offsetWidth;
    node.classList.add('slot--pulse');
  }

  /** A hint pinned to a point on screen, or null to hide it. */
  prompt(text: string | null, x = 0, y = 0): void {
    if (!text) {
      this.promptEl.classList.remove('world-prompt--on');
      return;
    }
    if (this.promptEl.dataset.text !== text) {
      this.promptEl.dataset.text = text;
      this.promptEl.innerHTML = text;
    }
    this.promptEl.style.transform = `translate(${x}px, ${y}px) translate(-50%, 0)`;
    this.promptEl.classList.add('world-prompt--on');
  }

  float(text: string, x: number, y: number, kind: FloatKind): void {
    const node = el('span', `float float--${kind}`, text);
    node.style.left = `${x + (Math.random() - 0.5) * 24}px`;
    node.style.top = `${y}px`;
    this.floaters.append(node);
    node.addEventListener('animationend', () => node.remove(), { once: true });
  }

  /** Health bars over hurt monsters. Call once per frame for each living monster. */
  enemyBar(key: object, x: number, y: number, fraction: number, visible: boolean, frame: number): void {
    let bar = this.enemyBars.get(key);
    if (!visible) {
      if (bar) bar.root.style.opacity = '0';
      return;
    }
    if (!bar) {
      const root = el('div', 'ebar', '<span class="ebar__fill"></span>');
      this.bars.append(root);
      bar = { root, fill: root.firstElementChild as HTMLElement, seen: frame };
      this.enemyBars.set(key, bar);
    }
    bar.seen = frame;
    bar.root.style.opacity = '1';
    bar.root.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    bar.fill.style.transform = `scaleX(${fraction})`;
  }

  /** Removes bars whose monster is gone. */
  sweepBars(frame: number): void {
    for (const [key, bar] of this.enemyBars) {
      if (bar.seen !== frame) {
        bar.root.remove();
        this.enemyBars.delete(key);
      }
    }
  }

  clearWorldUi(): void {
    for (const bar of this.enemyBars.values()) bar.root.remove();
    this.enemyBars.clear();
    this.floaters.innerHTML = '';
    this.prompt(null);
  }

  // ───────────────────────── Internals ─────────────────────────

  private pillarRow(lit: number): string {
    return `<div class="pillar-row">${LEVELS.map(
      (lv, i) => `<span class="pip pip--big ${i < lit ? 'pip--lit' : ''}" style="--pip:${lv.crystal}">${icon(PILLAR_PATH)}<small>${lv.pillar}</small></span>`,
    ).join('')}</div>`;
  }

  private pickHero(id: HeroClassId, preview = true): void {
    this.selectState.hero = id;
    const c = HERO_CLASSES[id];
    this.screen.querySelectorAll<HTMLButtonElement>('[data-hero]').forEach((b) => {
      const on = b.dataset.hero === id;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    this.screen.style.setProperty('--hero', c.color);
    const meter = (label: string, value: number) => {
      const v = Math.max(1, Math.min(5, value));
      const pips = Array.from({ length: 5 }, (_, i) => `<i class="${i < v ? 'on' : ''}"></i>`).join('');
      return `<div class="meter" aria-label="${label} ${v} of 5"><span>${label}</span><span class="meter__track">${pips}</span></div>`;
    };
    const abilities = c.abilities
      .map((a) => `<li>${iconByName(a.icon, 'icon icon--hero')}<span>${a.name}</span><kbd>${KEY_LABEL[a.key]}</kbd></li>`)
      .join('');
    this.screen.querySelector('.hero-detail')!.innerHTML = `
      <h3 class="hero-detail__name">${c.name}</h3>
      <p class="hero-detail__epithet">${c.epithet}</p>
      <p class="hero-detail__blurb">${c.blurb}</p>
      <div class="meters">
        ${meter('Health', Math.round(c.maxHp / 30))}
        ${meter('Power', c.stats.power)}
        ${meter('Speed', c.stats.agility)}
      </div>
      <p class="passive"><b>${c.passive.name}</b> ${c.passive.text}</p>
      <ul class="abilities">${abilities}</ul>`;
    if (preview) this.handlers.previewHero(id);
  }

  private pickDifficulty(id: DifficultyId): void {
    this.selectState.difficulty = id;
    this.screen.querySelectorAll<HTMLButtonElement>('[data-diff]').forEach((b) => {
      const on = b.dataset.diff === id;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    this.screen.querySelector('[data-diff-hint]')!.textContent = DIFFICULTIES[id].hint;
  }

  private setScreen(name: string, html: string): void {
    this.screen.dataset.screen = name;
    this.screen.className = `screen-layer screen-layer--on screen--${name}`;
    this.screen.innerHTML = html;
  }

  private on(act: string, fn: () => void): void {
    this.screen.querySelector(`[data-act="${act}"]`)?.addEventListener('click', fn);
  }

  private focusFirst(selector = '.btn'): void {
    this.screen.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
  }

  private closeOverlay(): void {
    const back = this.overlayReturn;
    this.overlayReturn = null;
    back?.();
  }

  private onKey = (e: KeyboardEvent): void => {
    const name = this.screenName;
    if (e.target instanceof HTMLInputElement && e.key !== 'Escape') return;
    if (e.key === 'Escape') {
      if (name === 'howto') {
        e.preventDefault();
        this.closeOverlay();
      } else if (name === 'pause') {
        e.preventDefault();
        this.handlers.resume();
      } else if (name === 'select') {
        e.preventDefault();
        this.handlers.backToTitle();
      }
      return;
    }
    if (name === 'select' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      const inDiff = (e.target as HTMLElement).closest?.('.seg');
      if (inDiff) {
        const ids = Object.keys(DIFFICULTIES) as DifficultyId[];
        const i = ids.indexOf(this.selectState.difficulty);
        const next = ids[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : ids.length - 1)) % ids.length];
        this.pickDifficulty(next);
        this.screen.querySelector<HTMLElement>(`[data-diff="${next}"]`)?.focus();
      } else {
        const i = HERO_ORDER.indexOf(this.selectState.hero);
        const next = HERO_ORDER[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : HERO_ORDER.length - 1)) % HERO_ORDER.length];
        this.pickHero(next);
        this.screen.querySelector<HTMLElement>(`[data-hero="${next}"]`)?.focus();
      }
      e.preventDefault();
    }
  };
}
