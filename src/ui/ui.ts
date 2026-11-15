import { HERO_CLASSES, type HeroClass, type HeroClassId, type SlotKey } from '../actors/classes';
import { DIFFICULTIES, LEVELS, MAX_POTIONS, PILLAR_HALLS, PILLARS, type DifficultyId, type SaveData } from '../game/levels';
import { ICONS, type IconName } from './icons';
import type { Blessing, BlessingLevels } from '../game/blessings';

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
  /** An action button on screen was pressed or let go (touch, or a mouse click on it). */
  slot(code: string, down: boolean): void;
  isTouch(): boolean;
  /** A game controller is being used: tips name its buttons. */
  isPad(): boolean;
}

const SLOT_CODE: Record<SlotKey, string> = { LMB: 'KeyF', RMB: 'KeyG', SPACE: 'Space', Q: 'KeyR' };

export interface QuestStats {
  heroName: string;
  hero: HeroClass;
  difficulty: DifficultyId;
  level: number;
  pillars: number;
  kills: number;
  potionsUsed: number;
  time: number;
  coins: number;
}

export type FloatKind = 'damage' | 'crit' | 'hurt' | 'heal' | 'info' | 'block';

const KEY_LABEL: Record<SlotKey, string> = { LMB: 'F', RMB: 'G', SPACE: 'Space', Q: 'R' };

// Two small drawings of our own for things the icon set lacks.
export interface ShopItem {
  name: string;
  text: string;
  price: number;
  icon: 'potion' | 'heal' | 'heart' | 'blessing';
  color: string;
  sold: boolean;
}

export interface PathOption {
  name: string;
  blurb: string;
  color: string;
  reward: 'potions' | 'coins' | 'heal';
}

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
  private blessPick: ((i: number) => void) | null = null;

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
    private readonly root: HTMLElement,
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
           <small>${save.name ? `${escapeHtml(save.name)} the ` : ''}${HERO_CLASSES[save.hero].name} · ${LEVELS[save.level]?.boss ? 'Final battle' : `Hall ${(save.stage ?? 0) + 1} of ${PILLAR_HALLS} · ${LEVELS[save.level]?.hall ?? ''}`}</small>
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
        <p class="pick-help">${this.handlers.isTouch() ? 'Tap a hero, then tap Start. Swipe to spin them.' : 'Point at a hero or press <kbd>←</kbd> <kbd>→</kbd>, then <kbd>Enter</kbd>. Drag to spin them.'}</p>
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
          ${step(1, 'Do the hall\'s job', 'Follow the golden arrow. Each hall has a job: light lanterns, find books, smash crystals, catch wisps or hold out.', iconByName('starSwirl', 'icon icon--gold'))}
          ${step(2, 'Take the pillar', 'Walk up to the glowing altar. The skeletons wake up: beat them all!', icon(PILLAR_PATH, 'icon icon--gold'))}
          ${step(3, 'Power up', 'Pick a blessing, and spend your coins at the merchant.', iconByName('holySymbol', 'icon icon--gold'))}
          ${step(4, 'Pick a door', 'Choose which hall comes next. Each door shows its reward.', iconByName('teleport', 'icon icon--gold'))}
        </ol>
        <p class="howto__goal">Wake all <b>4 pillars</b>, then beat the <b>Skeleton King</b> to escape!</p>
        ${
          this.handlers.isPad()
            ? `<div class="keys keys--touch">
          ${key('Left stick', 'Walk')}
          ${key('Right stick', 'Turn and tilt the camera')}
          ${key('A', 'Attack, light, open the shop')}
          ${key('X', 'Special move')}
          ${key('B', 'Dodge')}
          ${key('Y', 'Hero power')}
          ${key('RB', 'Drink a potion')}
          ${key('Start', 'Pause')}
        </div>`
            : this.handlers.isTouch()
            ? `<div class="keys keys--touch">
          ${key('Left thumb', 'Put it down anywhere on the left and slide to walk')}
          ${key('Tap right side', 'Attack (it aims for you)')}
          ${key('Round buttons', 'Special move, dodge, hero power, potion')}
          ${key('Pause', 'The button in the top corner')}
        </div>`
            : `<div class="keys">
          ${key('W A S D', 'Walk (arrow keys work too)')}
          ${key('F', 'Attack, light, open the shop (it aims for you)')}
          ${key('G', 'Special move, or right-click')}
          ${key('Space', 'Dodge')}
          ${key('R', 'Hero power')}
          ${key('H', 'Drink a potion')}
          ${key('Right-drag', 'Turn and tilt the camera')}
          ${key('Q / E', 'Turn the camera')}
          ${key('Scroll', 'Zoom in and out')}
          ${key('Tab', 'Hold to look around')}
          ${key('Esc', 'Pause')}
        </div>`
        }
        <ul class="howto__tips">
          <li><b class="tip-red">Red ring</b> on the floor: a skeleton is about to swing. Dodge out!</li>
          <li><b class="tip-red">Red lane with arrows</b>: a Shield Rammer is about to charge. Step aside, and it bumps into the wall.</li>
          <li><b class="tip-purple">Purple circle</b>: a monster is about to appear there.</li>
        </ul>
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
          ${stat('Coins', String(stats.coins))}
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

  /** After a hall: three blessing cards, pick one (click, 1/2/3, or arrows and Enter). */
  showBlessings(options: Blessing[], owned: BlessingLevels, onPick: (b: Blessing) => void): void {
    const cards = options
      .map((b, i) => {
        const lvl = owned[b.id] ?? 0;
        const pips = Array.from({ length: b.max }, (_, k) => `<i class="${k < lvl ? 'on' : k === lvl ? 'next' : ''}"></i>`).join('');
        const art = b.icon === 'potion' ? icon(POTION_PATH, 'icon', 'evenodd') : iconByName(b.icon);
        return `<button type="button" class="bless" data-i="${i}" style="--c:${b.color}">
          <span class="bless__key">${i + 1}</span>
          <span class="bless__art">${art}</span>
          <b class="bless__name">${b.name}</b>
          <span class="bless__text">${b.text}</span>
          <span class="bless__lvl">${lvl ? `Level ${lvl + 1}` : 'New!'}<span class="bless__pips">${pips}</span></span>
        </button>`;
      })
      .join('');
    this.setScreen(
      'bless',
      `<div class="bless-wrap" role="dialog" aria-modal="true" aria-labelledby="bless-title">
        <p class="kicker">The pillar blesses you</p>
        <h2 id="bless-title" class="card__title card__title--big">Choose a blessing</h2>
        <div class="bless-row">${cards}</div>
        <p class="bless-help">Click one, or press <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd></p>
      </div>`,
    );
    const pick = (i: number): void => {
      const b = options[i];
      if (!b) return;
      this.blessPick = null;
      onPick(b);
    };
    this.blessPick = pick;
    this.screen.querySelectorAll<HTMLButtonElement>('.bless').forEach((el) => el.addEventListener('click', () => pick(Number(el.dataset.i))));
    this.focusFirst('.bless');
  }

  /**
   * Choose your path, like Hades: two doors, each showing the hall behind it,
   * what you'll do there and the reward for clearing it.
   */
  showPaths(options: PathOption[], onPick: (i: number) => void): void {
    const rewardArt: Record<PathOption['reward'], string> = {
      potions: icon(POTION_PATH, 'icon', 'evenodd'),
      coins: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="#ffd23a" stroke="#a9781a" stroke-width="2"/><circle cx="12" cy="12" r="5" fill="none" stroke="#a9781a" stroke-width="1.5"/></svg>',
      heal: iconByName('regeneration'),
    };
    const rewardText: Record<PathOption['reward'], string> = { potions: '2 potions', coins: '40 coins', heal: 'Full health' };
    const cards = options
      .map(
        (o, i) => `<button type="button" class="bless path" data-i="${i}" style="--c:${o.color}">
          <span class="bless__key">${i + 1}</span>
          <span class="path__glow" aria-hidden="true"></span>
          <b class="bless__name">${o.name}</b>
          <span class="bless__text">${o.blurb}</span>
          <span class="path__reward"><span class="path__reward-art">${rewardArt[o.reward]}</span>Reward: ${rewardText[o.reward]}</span>
        </button>`,
      )
      .join('');
    this.setScreen(
      'paths',
      `<div class="bless-wrap path-wrap" role="dialog" aria-modal="true" aria-labelledby="path-title">
        <p class="kicker">Two doors open</p>
        <h2 id="path-title" class="card__title card__title--big">Choose your path</h2>
        <div class="bless-row path-row">${cards}</div>
        <p class="bless-help">Click one, or press <kbd>1</kbd> <kbd>2</kbd></p>
      </div>`,
    );
    const pick = (i: number): void => {
      if (!options[i]) return;
      this.blessPick = null;
      onPick(i);
    };
    this.blessPick = pick;
    this.screen.querySelectorAll<HTMLButtonElement>('.path').forEach((el) => el.addEventListener('click', () => pick(Number(el.dataset.i))));
    this.focusFirst('.path');
  }

  /** The travelling merchant's shop: a few things to spend coins on. */
  showShop(items: ShopItem[], coins: number, onBuy: (i: number) => void, onLeave: () => void): void {
    const art: Record<ShopItem['icon'], string> = {
      potion: icon(POTION_PATH, 'icon', 'evenodd'),
      heal: iconByName('regeneration'),
      heart: iconByName('checkedShield'),
      blessing: iconByName('starSwirl'),
    };
    const cards = items
      .map((it, i) => {
        const poor = !it.sold && it.price > coins;
        return `<button type="button" class="bless shop-item${it.sold ? ' shop-item--sold' : ''}${poor ? ' shop-item--poor' : ''}" data-i="${i}" style="--c:${it.color}" ${it.sold || poor ? 'aria-disabled="true"' : ''}>
          <span class="bless__key">${i + 1}</span>
          <span class="bless__art">${art[it.icon]}</span>
          <b class="bless__name">${it.name}</b>
          <span class="bless__text">${it.text}</span>
          <span class="shop-item__price">${it.sold ? 'Sold!' : `<i class="coin-dot"></i>${it.price}`}</span>
        </button>`;
      })
      .join('');
    this.setScreen(
      'shop',
      `<div class="bless-wrap shop-wrap" role="dialog" aria-modal="true" aria-labelledby="shop-title">
        <p class="kicker">The travelling merchant</p>
        <h2 id="shop-title" class="card__title card__title--big">Spend your coins</h2>
        <p class="shop-purse">You have <i class="coin-dot"></i><b>${coins}</b> coins</p>
        <div class="bless-row shop-row" style="--n:${items.length}">${cards}</div>
        <button type="button" class="btn btn--ghost shop-leave">Done shopping</button>
        <p class="bless-help">Press <kbd>1</kbd>–<kbd>${items.length}</kbd> to buy, <kbd>Esc</kbd> when you're done</p>
      </div>`,
    );
    this.blessPick = (i: number): void => {
      const it = items[i];
      if (!it || it.sold || it.price > coins) {
        this.handlers.sound('tick');
        return;
      }
      onBuy(i);
    };
    this.shopLeave = onLeave;
    this.screen.querySelectorAll<HTMLButtonElement>('.shop-item').forEach((el) => el.addEventListener('click', () => this.blessPick?.(Number(el.dataset.i))));
    this.screen.querySelector('.shop-leave')!.addEventListener('click', () => onLeave());
    this.focusFirst('.shop-item:not([aria-disabled]), .shop-leave');
  }

  private shopLeave: (() => void) | null = null;

  /** The big health bar for the Skeleton King, or null to hide it. */
  bossBar(name: string | null, fraction: number): void {
    let bar = this.root.querySelector<HTMLElement>('.boss-bar');
    if (!name) {
      bar?.classList.remove('boss-bar--on');
      return;
    }
    if (!bar) {
      bar = el('div', 'boss-bar', `<p class="boss-bar__name"></p><div class="boss-bar__track"><span class="boss-bar__lag"></span><span class="boss-bar__fill"></span><i style="left:66%"></i><i style="left:33%"></i></div>`);
      this.root.append(bar);
    }
    bar.classList.add('boss-bar--on');
    bar.querySelector('.boss-bar__name')!.textContent = name;
    (bar.querySelector('.boss-bar__fill') as HTMLElement).style.transform = `scaleX(${Math.max(0, fraction)})`;
    (bar.querySelector('.boss-bar__lag') as HTMLElement).style.transform = `scaleX(${Math.max(0, fraction)})`;
  }

  setCoins(n: number, pop: boolean): void {
    const el = this.hud.querySelector<HTMLElement>('[data-coins]');
    if (!el) return;
    el.textContent = String(n);
    if (pop) {
      const box = el.parentElement!;
      box.classList.remove('plate__coins--pop');
      void box.offsetWidth;
      box.classList.add('plate__coins--pop');
    }
  }

  /** Small icons under the hero plate for the blessings you have. */
  setBlessings(owned: BlessingLevels, all: Record<string, Blessing>): void {
    const row = this.hud.querySelector('.plate__blessings');
    if (!row) return;
    row.innerHTML = Object.entries(owned)
      .filter(([, lvl]) => (lvl ?? 0) > 0)
      .map(([id, lvl]) => {
        const b = all[id];
        const art = b.icon === 'potion' ? icon(POTION_PATH, 'icon', 'evenodd') : iconByName(b.icon);
        return `<span class="mini-bless" style="--c:${b.color}" title="${b.name} (level ${lvl}): ${b.text}">${art}${(lvl ?? 0) > 1 ? `<small>${lvl}</small>` : ''}</span>`;
      })
      .join('');
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

  /** On touch screens, tips name the on-screen buttons instead of keys. */
  private forTouch(html: string): string {
    if (this.handlers.isPad()) {
      if (html.includes('<kbd>W</kbd>')) return 'Walk with the <b>left stick</b>';
      if (html.includes('<kbd>Q</kbd>')) return 'Turn the camera with the <b>right stick</b>';
      const pad: Record<string, string> = { F: 'A', J: 'A', G: 'X', K: 'X', Space: 'B', R: 'Y', H: 'RB' };
      return html.replace(/<kbd>([A-Za-z]+)<\/kbd>/g, (m, k: string) => (pad[k] ? `<kbd>${pad[k]}</kbd>` : m));
    }
    if (!this.handlers.isTouch()) return html;
    if (html.includes('<kbd>W</kbd>')) return 'Walk: put your thumb on the <b>left side</b> of the screen and slide it';
    if (html.includes('<kbd>Q</kbd>')) return 'Tap the <b>right side</b> of the screen to attack';
    const names: Record<string, string> = { F: 'Attack', J: 'Attack', G: 'Special', Space: 'Dodge', R: 'Power', H: 'Potion', K: 'Special' };
    return html.replace(/<kbd>([A-Za-z]+)<\/kbd>/g, (m, k: string) => (names[k] ? `<kbd>${names[k]}</kbd>` : m)).replace(/Press /g, 'Tap ').replace(/press /g, 'tap ');
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
    this.hintEl.innerHTML = this.forTouch(html);
    this.hintEl.classList.add('hint--on');
    this.hintTimer = window.setTimeout(() => this.hintEl.classList.remove('hint--on'), seconds * 1000);
  }

  /** Fades to black, or (light) to a warm golden white for stepping through a door. */
  fade(on: boolean, light = false): void {
    if (on) this.fadeEl.classList.toggle('fade--light', light);
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
          <p class="plate__coins" title="Coins"><span class="coin-icon" aria-hidden="true"></span><b data-coins>0</b></p>
          <p class="plate__name">${name ? `${escapeHtml(name)} <span>the ${def.name}</span>` : def.name}</p>
          <div class="bar bar--hp" role="meter" aria-label="Health" aria-valuemin="0" aria-valuemax="${maxHp}">
            <span class="bar__lag"></span><span class="bar__fill"></span><span class="bar__text"></span>
          </div>
          <div class="bar bar--res" aria-hidden="true"><span class="bar__fill"></span></div>
          <div class="plate__blessings"></div>
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
    // The action buttons work as buttons too (big thumb buttons on touch screens).
    const codes = [...def.abilities.map((a) => SLOT_CODE[a.key]), 'KeyH'];
    this.hud.querySelectorAll<HTMLElement>('.dock .slot').forEach((slot, i) => {
      const code = codes[i];
      const up = (): void => this.handlers.slot(code, false);
      slot.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.handlers.slot(code, true);
      });
      slot.addEventListener('pointerup', up);
      slot.addEventListener('pointercancel', up);
      slot.addEventListener('pointerleave', up);
    });
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

  setQuest(level: number, pillars: number, stage = pillars): void {
    const l = LEVELS[level];
    this.hallEl.textContent = l.boss ? `Final battle · ${l.hall}` : `Hall ${stage + 1} of ${PILLAR_HALLS} · ${l.hall}`;
    this.pillarsEl.innerHTML = PILLARS.map(
      (p, i) =>
        `<span class="pip ${i < pillars ? 'pip--lit' : ''} ${i === stage && i >= pillars ? 'pip--now' : ''}" style="--pip:${p.color}" title="Pillar of ${p.name}">${icon(PILLAR_PATH)}</span>`,
    ).join('');
  }

  objective(text: string): void {
    if (this.objectiveEl.textContent === text) return;
    this.objectiveEl.textContent = text;
    this.objectiveEl.classList.remove('quest__objective--new');
    void this.objectiveEl.offsetWidth;
    this.objectiveEl.classList.add('quest__objective--new');
  }

  updateHud(hp: number, maxHp: number, resource: number, potions: number, cooldowns: number[], cooldownLeft: number[], maxPotions = MAX_POTIONS): void {
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
    this.potionCount.textContent = `${potions}/${maxPotions}`;
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
    const key = `${this.handlers.isTouch()}${this.handlers.isPad()}${text}`;
    if (this.promptEl.dataset.text !== key) {
      this.promptEl.dataset.text = key;
      this.promptEl.innerHTML = this.handlers.isPad()
        ? text.replace(/<kbd>F<\/kbd>/g, '<kbd>A</kbd>')
        : this.handlers.isTouch()
          ? text.replace(/<kbd>F<\/kbd>/g, '<kbd>Tap</kbd>')
          : text;
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
    return `<div class="pillar-row">${PILLARS.map(
      (p, i) => `<span class="pip pip--big ${i < lit ? 'pip--lit' : ''}" style="--pip:${p.color}">${icon(PILLAR_PATH)}<small>${p.name}</small></span>`,
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
    // A menu or end card never shares the screen with a hall banner.
    window.clearTimeout(this.bannerTimer);
    this.bannerEl.classList.remove('banner--show');
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
    if (name === 'shop' && e.key === 'Escape') {
      e.preventDefault();
      this.shopLeave?.();
      return;
    }
    if ((name === 'bless' || name === 'paths' || name === 'shop') && this.blessPick && /^[1234]$/.test(e.key)) {
      e.preventDefault();
      this.blessPick(Number(e.key) - 1);
      return;
    }
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
