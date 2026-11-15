import { HERO_CLASSES, type HeroClass, type HeroClassId, type SlotKey } from '../actors/classes';
import { DIFFICULTIES, LEVELS, MAX_POTIONS, type DifficultyId, type SaveData } from '../game/levels';
import { ICONS, type IconName } from './icons';

/** Hero order on the select screen, as in the original game. */
export const HERO_ORDER: HeroClassId[] = ['warrior', 'priestess', 'thief', 'doctor'];

export interface UiHandlers {
  newQuest(): void;
  continueQuest(): void;
  /** `loud` adds a cheer and a sound (clicks and keys); hovering is quiet. */
  previewHero(id: HeroClassId, loud: boolean): void;
  /** Spins the chosen hero on the select screen by a number of radians. */
  spinHero(radians: number): void;
  /** Menu sounds: a soft tick on hover, a click on press. */
  sound(name: 'tick' | 'click'): void;
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

const KEY_LABEL: Record<SlotKey, string> = { LMB: 'F', RMB: 'G', SPACE: 'Space', Q: 'Q' };

// Two small drawings of our own for things the icon set lacks.
const POTION_PATH =
  'M206 36h100v44h-14v84c70 20 120 84 120 158 0 92-70 154-156 154S100 414 100 322c0-74 50-138 120-158V80h-14z M256 290c-18-28-66-26-66 12 0 32 66 70 66 70s66-38 66-70c0-38-48-40-66-12z';
const PILLAR_PATH =
  'M120 56h272v44H120z M152 100h208v26H152z M176 126h44v262h-44z M234 126h44v262h-44z M292 126h44v262h-44z M152 388h208v26H152z M120 414h272v44H120z';

function icon(path: string, className = 'icon', rule: 'nonzero' | 'evenodd' = 'nonzero'): string {
  return `<svg class="${className}" viewBox="0 0 512 512" aria-hidden="true"><path fill-rule="${rule}" d="${path}"/></svg>`;
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
  private readonly hintEl: HTMLElement;
  private hintTimer = 0;
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
    this.hintEl = el('div', 'hint');
    this.hintEl.setAttribute('role', 'status');
    this.bannerEl.setAttribute('role', 'status');
    this.bannerEl.setAttribute('aria-live', 'polite');
    root.append(this.lowHp, this.bars, this.floaters, this.promptEl, this.hud, this.hintEl, this.bannerEl, this.screen, this.fadeEl);
    window.addEventListener('keydown', this.onKey);
    // Menu sounds: a soft tick when the pointer reaches a button, a click when pressed.
    let hovered: Element | null = null;
    root.addEventListener('pointerover', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (b && b !== hovered) this.handlers.sound('tick');
      hovered = b;
    });
    root.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) this.handlers.sound('click');
    });
  }

  // ───────────────────────── Screens ─────────────────────────

  /** The title sits over the real hall with the four heroes already standing in it. */
  showTitle(save: SaveData | null): void {
    const cont = save
      ? `<button class="btn btn--primary btn--big" data-act="continue">
           <span>Continue</span>
           <small>${save.name ? `${escapeHtml(save.name)} the ` : ''}${HERO_CLASSES[save.hero].name} · Hall ${save.level + 1} of 4</small>
         </button>`
      : '';
    this.setScreen(
      'title',
      `<header class="title2">
        <p class="kicker">A 3D dungeon adventure</p>
        <h1 class="title2__name">Dungeon Adventure</h1>
        <p class="title2__tag">Wake the four pillars. Beat the skeletons. Escape!</p>
      </header>
      <div class="title2__actions">
        ${cont}
        <button class="btn ${save ? 'btn--big-alt' : 'btn--primary btn--big'}" data-act="new">${save ? 'New game' : 'Play'}</button>
        <button class="link-btn" data-act="howto">How to play</button>
      </div>
      <p class="credits">3D art: KayKit by Kay Lousberg (CC0) · Icons: game-icons.net (CC BY 3.0)</p>`,
    );
    this.on('continue', () => this.handlers.continueQuest());
    this.on('new', () => this.handlers.newQuest());
    this.on('howto', () => this.showHowTo(() => this.showTitle(save)));
    this.focusFirst();
  }

  /** Same hall, same heroes: pick one and press Start. */
  showSelect(hero: HeroClassId, name: string, difficulty: DifficultyId): void {
    this.selectState = { hero, name, difficulty };
    const tags = HERO_ORDER.map((id) => {
      const c = HERO_CLASSES[id];
      return `<button type="button" class="hero-pick" data-hero="${id}" role="radio" style="--hero:${c.color}" aria-label="${c.name}">
        <span class="hero-pick__hit"></span>
        <span class="hero-pick__tag">${c.name}</span>
      </button>`;
    }).join('');
    const diffs = (Object.keys(DIFFICULTIES) as DifficultyId[])
      .map((id) => `<button type="button" class="seg__btn" role="radio" data-diff="${id}">${DIFFICULTIES[id].label}</button>`)
      .join('');
    this.setScreen(
      'select',
      `<button type="button" class="link-btn pick-back" data-act="back">‹ Back</button>
      <header class="pick-head">
        <h2 class="pick-title">Choose your hero</h2>
        <p class="pick-help">Point at a hero or press <kbd>←</kbd> <kbd>→</kbd>, then <kbd>Enter</kbd>. Drag to spin them.</p>
      </header>
      <div class="hero-row" role="radiogroup" aria-label="Heroes">${tags}</div>
      <button type="button" class="nav-arrow nav-arrow--prev" data-act="prev" aria-label="Previous hero">${icon('M336 64L144 256l192 192', 'icon icon--stroke')}</button>
      <button type="button" class="nav-arrow nav-arrow--next" data-act="next" aria-label="Next hero">${icon('M176 64l192 192-192 192', 'icon icon--stroke')}</button>
      <section class="pick-card">
        <div class="pick-card__info" aria-live="polite"></div>
        <div class="pick-card__start">
          <div class="seg seg--small" role="radiogroup" aria-label="Difficulty">${diffs}</div>
          <p class="pick-card__hint" data-diff-hint></p>
          <button type="button" class="btn btn--primary btn--big pick-card__go" data-act="start"></button>
        </div>
      </section>`,
    );
    this.screen.querySelectorAll<HTMLButtonElement>('[data-hero]').forEach((b) => {
      const id = b.dataset.hero as HeroClassId;
      b.addEventListener('click', () => this.pickHero(id));
      // Hovering a hero picks it straight away (no click needed).
      b.addEventListener('pointerenter', (e) => {
        if (e.pointerType === 'mouse' && this.selectState.hero !== id) this.pickHero(id, true, false);
      });
    });
    this.screen.querySelectorAll<HTMLButtonElement>('[data-diff]').forEach((b) =>
      b.addEventListener('click', () => this.pickDifficulty(b.dataset.diff as DifficultyId)),
    );
    this.on('back', () => this.handlers.backToTitle());
    this.on('prev', () => this.stepHero(-1));
    this.on('next', () => this.stepHero(1));
    this.on('start', () => {
      const st = this.selectState;
      this.handlers.startQuest(st.hero, st.name.trim(), st.difficulty);
    });
    this.enableDrag();
    this.pickHero(hero, false);
    this.pickDifficulty(difficulty);
    this.screen.querySelector<HTMLElement>('[data-act="start"]')?.focus({ preventScroll: true });
  }

  /** Pins each hero's name tag and click area to where the 3D hero stands. */
  placeHeroTags(tags: { id: HeroClassId; x: number; top: number; bottom: number }[]): void {
    if (this.screenName !== 'select') return;
    for (const t of tags) {
      const b = this.screen.querySelector<HTMLElement>(`[data-hero="${t.id}"]`);
      if (!b) continue;
      const height = Math.max(60, t.bottom - t.top);
      b.style.transform = `translate(${t.x}px, ${t.top}px) translateX(-50%)`;
      b.style.height = `${height}px`;
      b.style.width = `${Math.max(110, height * 0.55)}px`;
    }
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
          ${step(1, 'Take the pillar', 'Follow the golden arrow to the glowing altar and walk up to it.', icon(PILLAR_PATH, 'icon icon--gold'))}
          ${step(2, 'Beat the skeletons', 'Taking the pillar wakes them up. Defeat them all.', iconByName('swordSlice', 'icon icon--gold'))}
          ${step(3, 'Go through the door', 'The golden door opens. Walk in to reach the next hall.', iconByName('teleport', 'icon icon--gold'))}
        </ol>
        <p class="howto__goal">Collect all <b>4 pillars</b> to escape and win.</p>
        <div class="keys">
          ${key('W A S D', 'Walk (arrow keys work too)')}
          ${key('F', 'Attack, or click (it aims for you)')}
          ${key('G', 'Special move, or right-click')}
          ${key('Space', 'Dodge')}
          ${key('Q', 'Hero power')}
          ${key('H', 'Drink a potion')}
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

  /** A one-line tip above the action bar that teaches the next thing to do. */
  hint(html: string | null, seconds = 5): void {
    window.clearTimeout(this.hintTimer);
    if (!html) {
      this.hintEl.classList.remove('hint--on');
      return;
    }
    this.hintEl.innerHTML = html;
    this.hintEl.classList.add('hint--on');
    this.hintTimer = window.setTimeout(() => this.hintEl.classList.remove('hint--on'), seconds * 1000);
  }

  fade(on: boolean): void {
    this.fadeEl.classList.toggle('fade--on', on);
  }

  // ───────────────────────── HUD ─────────────────────────

  showHud(visible: boolean): void {
    this.hud.classList.toggle('hud--hidden', !visible);
    if (!visible) {
      this.prompt(null);
      this.hint(null);
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
          <span class="slot__icon">${icon(POTION_PATH, 'icon', 'evenodd')}</span>
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

  private pickHero(id: HeroClassId, preview = true, loud = true): void {
    this.selectState.hero = id;
    const c = HERO_CLASSES[id];
    this.screen.querySelectorAll<HTMLButtonElement>('[data-hero]').forEach((b) => {
      const on = b.dataset.hero === id;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    this.screen.style.setProperty('--hero', c.color);
    const bar = (label: string, value: number) => {
      const v = Math.max(1, Math.min(5, value));
      return `<div class="stat-bar" aria-label="${label}: ${v} out of 5"><span>${label}</span><span class="stat-bar__track"><span style="width:${v * 20}%"></span></span></div>`;
    };
    const card = this.screen.querySelector('.pick-card__info');
    if (!card) return;
    card.innerHTML = `
      <h3 class="pick-card__name">${c.name}</h3>
      <p class="pick-card__blurb">${c.blurb}</p>
      <div class="pick-card__stats">
        ${bar('Health', Math.round(c.maxHp / 30))}
        ${bar('Power', c.stats.power)}
        ${bar('Speed', c.stats.agility)}
      </div>
      <p class="pick-card__power"><b>Special:</b> ${c.passive.name}. ${c.passive.text}</p>`;
    const go = this.screen.querySelector('[data-act="start"]');
    if (go) go.innerHTML = `Start as ${c.name} <kbd>Enter</kbd>`;
    if (preview) this.handlers.previewHero(id, loud);
  }

  private stepHero(delta: number): void {
    const i = HERO_ORDER.indexOf(this.selectState.hero);
    this.pickHero(HERO_ORDER[(i + delta + HERO_ORDER.length) % HERO_ORDER.length]);
  }

  /** Drag anywhere empty on the select screen to spin the chosen hero. */
  private enableDrag(): void {
    let last: number | null = null;
    this.screen.onpointerdown = (e) => {
      if ((e.target as HTMLElement).closest('button, .pick-card, input')) return;
      last = e.clientX;
      this.screen.setPointerCapture(e.pointerId);
      this.screen.classList.add('screen--dragging');
    };
    this.screen.onpointermove = (e) => {
      if (last === null) return;
      this.handlers.spinHero((e.clientX - last) * 0.012);
      last = e.clientX;
    };
    this.screen.onpointerup = this.screen.onpointercancel = () => {
      last = null;
      this.screen.classList.remove('screen--dragging');
    };
  }

  private pickDifficulty(id: DifficultyId): void {
    this.selectState.difficulty = id;
    this.screen.querySelectorAll<HTMLButtonElement>('[data-diff]').forEach((b) => {
      const on = b.dataset.diff === id;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    const hint = this.screen.querySelector('[data-diff-hint]');
    if (hint) hint.textContent = DIFFICULTIES[id].hint;
  }

  private setScreen(name: string, html: string): void {
    this.screen.onpointerdown = this.screen.onpointermove = this.screen.onpointerup = this.screen.onpointercancel = null;
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
    const right = e.key === 'ArrowRight' || e.code === 'KeyD';
    const left = e.key === 'ArrowLeft' || e.code === 'KeyA';
    if (name === 'select' && (right || left)) {
      e.preventDefault();
      this.stepHero(right ? 1 : -1);
      this.screen.querySelector<HTMLElement>('[data-act="start"]')?.focus({ preventScroll: true });
    } else if (name === 'title' && e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      this.screen.querySelector<HTMLElement>('.btn--primary')?.click();
    }
  };
}
