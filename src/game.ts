import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { HERO_CLASSES, type Ability, type ComboStep, type HeroClassId } from './actors/classes';
import { Enemy, ENEMIES, type EnemyKind } from './actors/enemy';
import { Hero, type HeroEvents, type HeroInput } from './actors/hero';
import type { Assets } from './core/assets';
import { CameraRig } from './core/camera-rig';
import { dampAngle } from './core/math';
import { Input } from './core/input';
import { Audio } from './game/audio';
import { BLESSINGS, rollBlessings, type Blessing, type BlessingLevels } from './game/blessings';
import { clearSave, DEFAULT_ROUTE, DIFFICULTIES, PATH_POOL, randomRoute, type PathReward, LEVELS, loadSave, MAX_POTIONS, PILLAR_HALLS, PILLARS, writeSave, type Difficulty, type DifficultyId, type SaveData } from './game/levels';
import { MOODS, type Mood } from './render/moods';
import { Renderer } from './render/renderer';
import { applySeeThrough, seeThrough } from './render/see-through';
import { HERO_ORDER, Ui, type FloatKind, type QuestStats, type ShopItem } from './ui/ui';
import { Character } from './actors/character';
import { buildCrypt, type Crypt } from './world/crypt';
import type { Encounter } from './world/dungeon';
import { NavGrid } from './world/nav';
import { Particles } from './world/particles';
import { Bats } from './world/bats';
import { makeBook, makeCrystal } from './world/job-props';

type Phase = 'title' | 'select' | 'play' | 'dead' | 'victory';
/** Steps inside one hall. */
type Step = 'explore' | 'claiming' | 'fight' | 'cleared' | 'exiting';

interface Projectile {
  mesh: THREE.Object3D;
  velocity: THREE.Vector3;
  damage: number;
  radius: number;
  life: number;
  hostile: boolean;
  color: THREE.Color;
  heal: number;
  hit: Set<Enemy>;
  pierce: boolean;
}

interface Zone {
  kind: 'sanctuary' | 'smoke';
  position: THREE.Vector3;
  radius: number;
  life: number;
  tick: number;
  healPerSecond: number;
  damagePerSecond: number;
  mesh: THREE.Mesh;
}

interface Potion {
  object: THREE.Group;
  base: THREE.Vector3;
}

/** One lantern, book or crystal of a hall's job. */
interface JobItem {
  object: THREE.Group;
  at: THREE.Vector3;
  done: boolean;
  /** Hits left (crystals). */
  hp: number;
  /** Lanterns get a light made up front (off), so the light count never changes mid-level. */
  light: THREE.PointLight | null;
  box: Crate['box'] | null;
  flash: number;
  seed: number;
}

interface Crate {
  object: THREE.Object3D;
  box: { minX: number; maxX: number; minZ: number; maxZ: number };
  position: THREE.Vector3;
}

interface Coin {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  age: number;
}

interface Chest {
  object: THREE.Group;
  box: { minX: number; maxX: number; minZ: number; maxZ: number };
  position: THREE.Vector3;
  opened: boolean;
}

interface Timer {
  at: number;
  run: () => void;
}

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const ALTAR_REACH = 3.2;
/** Save the quest in the browser and offer "Continue"? Off: every visit starts fresh. */
/** Progress is kept on this device, so closing the tab doesn't lose the quest (Continue on the title). */
const KEEP_PROGRESS = true;
/** Where the four heroes stand on the select screen. */
const LINEUP_X = [-3.375, -1.125, 1.125, 3.375];
const LINEUP_Z = 2.8;

export class Game {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.5, 140);
  readonly rig: CameraRig;
  readonly renderer: Renderer;
  readonly input: Input;
  crypt: Crypt;
  readonly ui: Ui;
  readonly audio = new Audio();
  /** Additive particles: embers, sparks, magic. */
  readonly glow = new Particles(4000, true, 0.1);
  /** Alpha-blended particles: dust, smoke, bone shards. */
  readonly dust = new Particles(1500, false, 0.35);
  /** Very soft puffs that fade from the middle out, for ground fog. */
  readonly mist = new Particles(200, false, 0);

  mood: Mood = MOODS[1];
  hero!: Hero;
  phase: Phase = 'title';
  step: Step = 'explore';
  paused = false;

  // The quest in progress.
  private heroName = '';
  private difficulty: Difficulty = DIFFICULTIES.easy;
  /** The scene being played (index into LEVELS). */
  private level = 0;
  /** The scenes of this run, in order, and how far along we are. */
  private route: number[] = [...DEFAULT_ROUTE];
  /** The reward promised by the door the player picked, given when that hall is cleared. */
  private pathReward: PathReward | null = null;
  private pathAsked = false;
  private stage = 0;
  private pillars = 0;
  private potions = 1;
  private levelStartPotions = 1;
  private kills = 0;
  private potionsUsed = 0;
  private playTime = 0;

  private enemies: Enemy[] = [];
  private readonly rings = new Map<Enemy, THREE.Mesh>();
  /** The red lane a Shield Rammer shows before it charges. */
  private readonly lanes = new Map<Enemy, THREE.Mesh>();
  /** Glowing summoning circles on the floor, shown just before a monster appears. */
  private portals: { mesh: THREE.Mesh; at: THREE.Vector3; t: number; size: number }[] = [];
  private readonly portalGeometry = new THREE.PlaneGeometry(2.2, 2.2);
  private readonly portalTexture = Game.makePortalTexture();
  private readonly laneTexture = Game.makeLaneTexture();
  private readonly portalColor = new THREE.Color('#b25cff');
  /** The travelling merchant who sets up shop in a cleared hall. */
  private merchant: { who: Character; props: THREE.Group; box: Crate['box']; items: ShopItem[] } | null = null;
  /** Max health bought at the shop (kept for the whole quest). */
  private bonusHp = 0;
  private jobItems: JobItem[] = [];
  private readonly wispColor = new THREE.Color('#9dffb8');
  private jobNag = 0;
  /** Seconds left to hold out in a "defend" hall (0 when not defending). */
  private defendLeft = 0;
  private defendSpawn = 0;
  private defendWave = 0;
  private readonly portalHot = new THREE.Color('#e9c2ff');
  private waves: EnemyKind[][] = [];
  private waveCooldown = 0;
  private projectiles: Projectile[] = [];
  private zones: Zone[] = [];
  private pickups: Potion[] = [];
  private crates: Crate[] = [];
  /** Ambush rooms in a connected dungeon: their monsters sleep until the hero walks in. */
  private ambushes: { encounter: Encounter; monsters: Enemy[]; sprung: boolean }[] = [];
  private coinsOnFloor: Coin[] = [];
  private chest: Chest | null = null;
  /** The Skeleton King, while the boss room is live. */
  private boss: Enemy | null = null;
  /** Health marks where the King calls guards (fractions of max health still to pass). */
  private bossCalls: number[] = [];
  private coins = 0;
  private readonly coinGeometry = new THREE.CylinderGeometry(0.2, 0.2, 0.06, 18);
  private readonly coinMaterial = new THREE.MeshStandardMaterial({ color: '#ffcc33', emissive: '#a86b00', emissiveIntensity: 0.6, metalness: 0.9, roughness: 0.25 });
  /** Blessings chosen this quest, by level. */
  private blessings: BlessingLevels = {};
  /** True while the blessing cards are up; the game waits. */
  private choosing = false;
  private timers: Timer[] = [];
  private renew = { left: 0, rate: 0 };
  private hitStop = 0;
  private deadTimer = 0;
  private frameCount = 0;
  /** Tips already shown this session, so each one teaches once. */
  private readonly tipsShown = new Set<string>();
  private autoPotionCooldown = 0;
  private hazardCooldown = 0;
  private arrow!: THREE.Mesh;
  private nav!: NavGrid;
  private navTimer = 0;
  /** A second walking map aimed at the arrow's goal, so the arrow leads through doorways. */
  private guideNav: { grid: Crypt; nav: NavGrid } | null = null;
  private readonly guideGoal = new THREE.Vector3();
  private readonly guideDir = new THREE.Vector3();
  private guideTimer = 0;
  private arrowYaw = 0;
  private arrowShown = false;
  private arrowTarget: Enemy | null = null;
  private readonly arrowColor = new THREE.Color();

  // Hero select: all four heroes in a row; the chosen one steps forward and spins.
  private lineup: Hero[] = [];
  private chosen = 0;
  private camX = 0;
  private spin = 0;
  private lastDrag = -10;
  /** Seconds left of the swoop from the menu into the hall; input waits. */
  private introTimer = 0;
  /** The player's own camera turn (degrees) and zoom, on top of each hall's view. */
  private camYaw = 0;
  private camZoom = 1;
  /** Extra tilt (degrees) from dragging up and down. */
  private camPitch = 0;
  /** How far the view has been slid away from the hero with Tab. */
  private readonly camPan = new THREE.Vector3();
  private looking = false;
  /** Coins dropped where the hero fell, waiting to be picked back up. */
  private lost: { coins: number; level: number; spot: THREE.Vector3; object: THREE.Group | null } | null = null;
  /** The first hall starts dark until the hero lights the torch. */
  private brazier: { position: THREE.Vector3; lit: boolean; light: THREE.PointLight } | null = null;
  private dark = 0;
  private dropSpeed = 0;
  private readonly bats = new Bats();
  private stepTimer = 0;
  /** The opening torch has been lit this quest (restarts don't go dark again). */
  private openingDone = false;
  private brazierSwaps: { mesh: THREE.Mesh; lit: THREE.Material }[] = [];
  /** Where the default camera may roam in this scene (keeps the near wall out of view). */
  private sceneBounds = { minX: -8, maxX: 8, minZ: -8.2, maxZ: 3.6 };
  private lastDt = 0;
  /** Seconds into walking out through the door. */
  private walkout = 0;
  /** Seconds left holding a hall's establishing shot before the swoop. */
  private establishing = 0;
  /** Where the hero began the hall, so the pillar is only taken after the player walks to it. */
  private readonly hallStart = new THREE.Vector3();
  private readonly lineupLight = new THREE.PointLight('#ffffff', 0, 7, 1.6);
  private lineupRing!: THREE.Mesh;

  private readonly hemi = new THREE.HemisphereLight();
  private readonly moon = new THREE.DirectionalLight();
  private readonly heroLight = new THREE.PointLight('#ffd9a8', 9, 11, 2);
  private readonly fog = new THREE.FogExp2('#0a0f1c', 0.02);
  private readonly dustColor = new THREE.Color('#d9c7a0');
  private readonly heroColor = new THREE.Color();
  private readonly heroHot = new THREE.Color();
  private readonly white = new THREE.Color('#ffffff');
  private readonly woodColor = new THREE.Color('#a0703f');
  private readonly fireColor = new THREE.Color('#ff8a2a');
  private readonly smokeColor = new THREE.Color('#5a5560');
  private readonly moonDust = new THREE.Color('#bcd0ff');
  private heartTexture: THREE.Texture | null = null;
  private readonly gold = new THREE.Color('#ffc35a');
  private readonly red = new THREE.Color('#ff4040');
  private readonly heal = new THREE.Color('#7dffa0');
  private time = 0;
  private last = 0;
  private lastPad = 0;
  private dustTimer = 0;

  // Scratch objects reused every frame.
  private readonly raycaster = new THREE.Raycaster();
  private readonly floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly projected = new THREE.Vector3();
  private readonly camTarget = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly heroInput: HeroInput = {
    move: new THREE.Vector3(),
    aim: new THREE.Vector3(),
    attack: false,
    secondary: false,
    dodge: false,
    special: false,
  };
  private readonly events: HeroEvents = {
    melee: (step, index) => this.onMelee(step, index),
    cast: (ability, aim) => this.onCast(ability, aim),
    dash: (kind, from, to) => this.onDash(kind, from, to),
  };

  private readonly orbGeometry = new THREE.IcosahedronGeometry(0.2, 1);
  private readonly knifeGeometry = new THREE.BoxGeometry(0.08, 0.06, 0.55);
  private readonly ringGeometry = new THREE.RingGeometry(0.82, 1, 48);
  private readonly discGeometry = new THREE.CircleGeometry(1, 48);

  constructor(container: HTMLElement, uiRoot: HTMLElement, private readonly assets: Assets) {
    this.renderer = new Renderer(container, this.scene, this.camera);
    // Input listens before the UI, so the UI can swallow a key press (Esc to resume).
    this.input = new Input(this.renderer.gl.domElement);
    this.rig = new CameraRig(this.camera);
    // Don't follow the hero right up to the south wall: it would fill the screen.
    this.rig.bounds.maxZ = 3.6;

    const pmrem = new THREE.PMREMGenerator(this.renderer.gl);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.fog = this.fog;

    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(2048, 2048);
    const s = this.moon.shadow.camera;
    s.left = -22;
    s.right = 22;
    s.top = 22;
    s.bottom = -22;
    s.near = 1;
    s.far = 70;
    this.moon.shadow.bias = -0.0004;
    this.moon.shadow.normalBias = 0.04;
    this.scene.add(this.hemi, this.moon, this.moon.target, this.heroLight);

    for (const material of assets.kitMaterials) applySeeThrough(material);
    for (const material of assets.outdoorMaterials) applySeeThrough(material);
    this.crypt = buildCrypt(assets, this.glow, 0);
    this.scene.add(this.crypt.group, this.glow.points, this.dust.points, this.mist.points, this.bats.group);
    this.nav = new NavGrid(this.crypt.colliders);
    this.arrow = this.makeArrow();
    this.scene.add(this.arrow);
    this.lineupRing = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.9, 64),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
    );
    this.lineupRing.rotation.x = -Math.PI / 2;
    this.scene.add(this.lineupRing, this.lineupLight);

    this.ui = new Ui(uiRoot, {
      newQuest: () => this.openSelect(),
      continueQuest: () => this.continueQuest(),
      previewHero: (id, loud) => this.previewHero(id, loud),
      spinHero: (radians) => {
        this.spin += radians;
        this.lastDrag = this.time;
      },
      sound: (name) => this.audio.play(name),
      startQuest: (id, name, difficulty) => this.startQuest(id, name, difficulty),
      backToTitle: () => this.openTitle(),
      resume: () => this.setPaused(false),
      restartLevel: () => this.restartLevel(),
      changeHero: () => this.openSelect(),
      toggleMute: () => {
        this.audio.setMuted(!this.audio.muted);
        return this.audio.muted;
      },
      pause: () => this.setPaused(true),
      slot: (code, down) => (down ? this.input.press(code) : this.input.release(code)),
      isTouch: () => this.input.touchMode && !this.input.padMode,
      isPad: () => this.input.padMode,
    });

    window.addEventListener('blur', () => {
      if (this.phase === 'play' && !this.paused) this.setPaused(true);
    });

    this.setHero('warrior');
    this.setupLevel(0, false);
    this.openTitle();
    this.rig.snap(new THREE.Vector3(0, 0, 0));
  }

  /**
   * The first look after loading: the camera starts close on the glowing pillar
   * and glides back to show the four heroes, who wave one after another.
   */
  reveal(): void {
    this.rig.yaw = 0;
    this.rig.pitch = THREE.MathUtils.degToRad(24);
    this.rig.distance = 4.5;
    this.rig.snap(new THREE.Vector3(0, 2.6, 0));
    this.lineup.forEach((h, i) => {
      window.setTimeout(() => {
        if (this.phase === 'title') h.animator.play('Cheer', { loop: false, fade: 0.2, restart: true });
      }, 700 + i * 220);
    });
  }

  start(): void {
    // Closing or hiding the tab mid-quest keeps the progress.
    window.addEventListener('pagehide', () => {
      if (this.phase === 'play' && this.step !== 'exiting') this.saveProgress();
    });
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  // ───────────────────────── Menus and flow ─────────────────────────

  private openTitle(): void {
    if (this.phase === 'play' && this.step !== 'exiting') this.saveProgress();
    this.phase = 'title';
    this.paused = false;
    this.ui.showHud(false);
    this.ui.clearWorldUi();
    const save = KEEP_PROGRESS ? loadSave() : null;
    this.setupLevel(0, false);
    this.hero.root.visible = false;
    this.chosen = -1;
    this.showLineup(true);
    this.ui.showTitle(save);
  }

  private openSelect(): void {
    this.paused = false;
    this.ui.showHud(false);
    this.ui.clearWorldUi();
    // From the title the hall and heroes are already there; only rebuild after a game.
    const fromTitle = this.phase === 'title';
    this.phase = 'select';
    if (!fromTitle) {
      this.setupLevel(0, false);
      this.showLineup(true);
    }
    this.hero.root.visible = false;
    const id = this.hero.def.id;
    this.previewHero(id, false);
    this.ui.showSelect(id, this.heroName, this.difficulty.id);
  }

  private previewHero(id: HeroClassId, cheer = true): void {
    this.chosen = HERO_ORDER.indexOf(id);
    this.spin = 0;
    const hero = this.lineup[this.chosen];
    if (cheer && hero) {
      hero.animator.play('Cheer', { loop: false, fade: 0.15, restart: true });
      this.burst(hero.position.clone().setY(1.2), new THREE.Color(hero.def.color), 30, 3);
      this.audio.play('click');
    }
  }

  private showLineup(visible: boolean): void {
    if (visible && this.lineup.length === 0) {
      this.lineup = HERO_ORDER.map((id) => {
        const h = new Hero(this.assets, HERO_CLASSES[id]);
        this.scene.add(h.root);
        return h;
      });
    }
    this.lineup.forEach((h, i) => {
      h.root.visible = visible;
      h.position.set(LINEUP_X[i], 0, LINEUP_Z);
      h.facing = 0;
    });
    this.lineupRing.visible = visible;
    this.lineupLight.visible = visible;
  }

  /** Eases the lineup: the chosen hero steps forward onto a glowing ring and turns slowly. */
  private updateLineup(dt: number): void {
    if (this.lineup.length === 0) return;
    if (this.phase !== 'select' && this.phase !== 'title') {
      // Leaving the menu: the heroes that weren't picked finish their cheer, then vanish.
      for (const h of this.lineup) if (h.root.visible) h.updateVisuals(dt);
      return;
    }
    const tags: { id: HeroClassId; x: number; top: number; bottom: number }[] = [];
    this.lineup.forEach((h, i) => {
      const chosen = i === this.chosen;
      const z = LINEUP_Z + (chosen ? 0.5 : 0);
      h.position.z = THREE.MathUtils.damp(h.position.z, z, 8, dt);
      const scale = chosen ? 1.06 : 1;
      h.root.scale.setScalar(THREE.MathUtils.damp(h.root.scale.x, scale, 8, dt));
      // On the title the heroes wave now and then, so the hall feels alive.
      if (this.phase === 'title' && h.animator.current === 'Idle' && Math.random() < dt * 0.12) {
        h.animator.play('Cheer', { loop: false, fade: 0.2, restart: true });
      }
      if (chosen) {
        if (this.time - this.lastDrag > 1.5) this.spin += dt * 0.7;
        h.facing = this.spin;
      } else {
        h.facing = THREE.MathUtils.damp(h.facing, 0, 6, dt);
      }
      if (h.animator.current === 'Cheer' && h.animator.progress >= 1) h.animator.play('Idle', { fade: 0.25 });
      h.updateVisuals(dt);
      const feet = this.toScreen(h.position, -0.05);
      const head = this.toScreen(h.position, 2.4 * scale);
      tags.push({ id: h.def.id, x: feet.x, top: head.y, bottom: feet.y });
    });
    const hero = this.lineup[this.chosen];
    this.lineupRing.visible = this.lineupLight.visible = !!hero;
    if (!hero) return;
    const color = new THREE.Color(hero.def.color);
    this.lineupRing.position.set(hero.position.x, 0.03, hero.position.z);
    (this.lineupRing.material as THREE.MeshBasicMaterial).color.copy(color).multiplyScalar(2);
    const mat = this.lineupRing.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.75 + Math.sin(this.time * 3) * 0.15;
    this.lineupRing.scale.setScalar(1.15 + Math.sin(this.time * 3) * 0.04);
    this.lineupLight.color.copy(color);
    this.lineupLight.intensity = 14;
    this.lineupLight.position.set(hero.position.x, 2.6, hero.position.z + 1.6);
    if (Math.random() < 0.4) {
      const a = Math.random() * Math.PI * 2;
      this.glow.spawn({ x: hero.position.x + Math.sin(a) * 0.8, y: 0.1, z: hero.position.z + Math.cos(a) * 0.8, vy: 1.4, life: 1, size: 0.08, sizeEnd: 0.01, color, intensity: 3 });
    }
    this.ui.placeHeroTags(tags);
  }

  private startQuest(id: HeroClassId, name: string, difficulty: DifficultyId): void {
    this.lost = null;
    this.openingDone = false;
    this.blessings = {};
    this.coins = 0;
    this.heroName = name;
    this.difficulty = DIFFICULTIES[difficulty];
    this.route = randomRoute();
    this.pathReward = null;
    this.bonusHp = 0;
    this.stage = 0;
    this.level = this.route[0];
    this.pillars = 0;
    this.potions = 1;
    this.kills = 0;
    this.potionsUsed = 0;
    this.playTime = 0;
    this.enterPlay(id);
  }

  private continueQuest(): void {
    const save = loadSave();
    if (!save) return this.openSelect();
    this.heroName = save.name;
    this.difficulty = DIFFICULTIES[save.difficulty] ?? DIFFICULTIES.normal;
    this.level = save.level;
    this.pillars = save.level;
    this.potions = save.potions;
    this.kills = save.kills;
    this.potionsUsed = save.potionsUsed;
    this.playTime = save.time;
    this.blessings = (save.blessings ?? {}) as BlessingLevels;
    this.coins = save.coins ?? 0;
    this.stage = save.stage ?? 0;
    this.route = save.route?.length === 5 ? [...save.route] : randomRoute();
    this.route[this.stage] = save.level;
    this.pillars = Math.min(this.stage, PILLAR_HALLS);
    this.bonusHp = save.bonusHp ?? 0;
    this.pathReward = null;
    this.openingDone = this.stage > 0;
    this.enterPlay(save.hero);
  }

  /**
   * The hand-off from menu to game, with no cut: the picked hero takes over the
   * spot where it stood in the lineup and cheers, the others vanish in sparkles,
   * and the camera swoops up behind it into the play view.
   */
  private enterPlay(id: HeroClassId): void {
    const i = HERO_ORDER.indexOf(id);
    const stand = this.lineup[i]?.root.visible ? this.lineup[i] : null;
    const facing = stand ? stand.facing : Math.PI;
    this.setHero(id);
    this.applyBlessings();
    this.ui.hideScreen();
    this.ui.setHero(this.hero.def, this.heroName, this.hero.maxHp);
    this.ui.setBlessings(this.blessings, BLESSINGS);
    this.ui.setCoins(this.coins, false);
    this.ui.showHud(false);
    this.phase = 'play';
    this.paused = false;
    // The new level's own start spot (setupLevel builds the level first, then places the hero).
    this.setupLevel(this.level, true, undefined, true);
    const start = this.hero.position.clone();
    this.hero.facing = facing;
    // Dropped in from above: a fall, then a thump and a puff of dust.
    this.hero.position.y = 9;
    this.dropSpeed = 0;
    this.hero.animator.play('Idle', { fade: 0 });
    this.lineupRing.visible = this.lineupLight.visible = false;
    this.lineup.forEach((h, j) => {
      if (j === i || !h.root.visible) {
        h.root.visible = false;
        return;
      }
      h.animator.play('Cheer', { loop: false, fade: 0.1, restart: true });
      this.later(0.35 + Math.abs(j - i) * 0.12, () => {
        h.root.visible = false;
        this.burst(h.position.clone().setY(1), this.gold, 40, 3.5);
        this.puff(h.position, 8);
      });
    });
    this.burst(start.clone().setY(1.1), this.heroColor, 60, 4.5);
    this.audio.play('start');
    this.introTimer = 1.6;
    this.later(1.6, () => this.ui.showHud(true));
    this.saveProgress();
  }

  private restartLevel(): void {
    this.potions = Math.max(this.levelStartPotions, 1);
    this.choosing = false;
    this.ui.hideScreen();
    this.ui.setHero(this.hero.def, this.heroName, this.hero.maxHp);
    this.ui.setBlessings(this.blessings, BLESSINGS);
    this.ui.setCoins(this.coins, false);
    this.ui.showHud(true);
    this.phase = 'play';
    this.paused = false;
    this.setupLevel(this.level, true);
  }

  private setPaused(paused: boolean): void {
    if (this.phase !== 'play' || this.choosing) return;
    this.paused = paused;
    this.input.endFrame();
    if (paused) {
      this.ui.prompt(null);
      this.ui.showPause();
    } else {
      this.ui.hideScreen();
    }
  }

  /**
   * Progress is not kept between visits: reloading always starts fresh at the
   * title (Zainab asked for this). Kept as a no-op so it's easy to bring back.
   */
  private saveProgress(): void {
    if (!KEEP_PROGRESS) return;
    writeSave({
      hero: this.hero.def.id,
      name: this.heroName,
      difficulty: this.difficulty.id,
      level: this.level,
      potions: this.levelStartPotions,
      kills: this.kills,
      potionsUsed: this.potionsUsed,
      time: this.playTime,
      blessings: this.blessings,
      coins: this.coins,
      stage: this.stage,
      route: this.route,
      bonusHp: this.bonusHp,
    } satisfies SaveData);
  }

  private stats(): QuestStats {
    return {
      heroName: this.heroName,
      hero: this.hero.def,
      difficulty: this.difficulty.id,
      level: this.level,
      pillars: this.pillars,
      kills: this.kills,
      potionsUsed: this.potionsUsed,
      time: this.playTime,
      coins: this.coins,
    };
  }

  // ───────────────────────── Halls ─────────────────────────

  /** Builds hall `index`. With `live`, the hero is placed and the hall begins. */
  private setupLevel(index: number, live: boolean, start?: THREE.Vector3, intro = false): void {
    const level = LEVELS[index];
    this.level = index;
    this.clearActors();
    if (this.crypt.theme !== index) this.buildHall(index);
    // The camera may roam a bigger or smaller room.
    const c = this.crypt;
    this.sceneBounds = c.connected
      ? { minX: c.center.x - c.halfX, maxX: c.center.x + c.halfX, minZ: c.center.z - c.halfZ, maxZ: c.center.z + c.halfZ }
      : { minX: -(c.halfX - 8), maxX: c.halfX - 8, minZ: -(c.halfZ - 3.8), maxZ: c.halfZ - 8.4 };
    this.rig.bounds = { ...this.sceneBounds };
    this.setMood(MOODS[level.mood]);
    this.audio.place = index === 5 ? 'night' : index === 6 ? 'forest' : index === 3 ? 'ember' : 'cave';
    this.crypt.altar.reset();
    this.crypt.altar.setDormantColor(level.crystal);
    this.crypt.door.reset(this.pillars);

    this.crypt.dormant.forEach((spot, i) => {
      const kind = level.sleepers[i];
      if (!kind) return;
      const enemy = this.spawnEnemy(kind, spot.position);
      enemy.facing = spot.facing;
      enemy.sleep();
    });
    this.placeChest();
    this.ambushes = this.crypt.encounters.map((encounter) => ({
      encounter,
      sprung: false,
      monsters: encounter.monsters.map((m) => {
        const e = this.spawnEnemy(m.kind, new THREE.Vector3(m.at[0], 0, m.at[1]));
        e.facing = m.facing;
        e.sleep();
        return e;
      }),
    }));
    if (live) this.placeLostTreasure();
    this.waves = level.waves.map((w) => [...w]);
    if (this.difficulty.dropLastWave && this.waves.length > 1) this.waves.pop();

    if (!live) return;
    for (const [x, z] of level.potions) this.dropPotion(new THREE.Vector3(x, 0, z));
    this.placeCrates();
    this.placeJob();
    this.levelStartPotions = this.potions;
    this.step = 'explore';
    this.hero.revive();
    this.hero.invulnerable = 0;
    this.hero.root.visible = true;
    if (start) this.hero.position.copy(start);
    else this.hero.position.copy(this.crypt.heroStart);
    // The very first hall starts in the dark: light the torch to begin.
    if (this.stage === 0 && !this.openingDone) this.darkenForOpening();
    this.hallStart.copy(this.hero.position);
    this.hero.facing = Math.PI;
    this.hero.velocity.set(0, 0, 0);
    this.hero.animator.play('Idle', { fade: 0 });
    this.renew.left = 0;
    const view = LEVELS[index].view;
    this.camYaw = 0;
    this.camPitch = 0;
    this.rig.setView(view.yaw, view.pitch, view.distance * this.camZoom);
    this.ui.setQuest(index, this.pillars, this.stage);
    this.ui.objective(level.boss ? 'The Skeleton King awakens…' : 'Follow the golden arrow to the altar');
    if (this.dark > 0) {
      this.applyDarkness();
      this.ui.objective('It\'s dark… Light the torch');
    } else if (this.jobLeft() > 0) {
      this.ui.objective(this.jobText());
      this.later((intro ? 1.1 : 0) + 3.4, () => this.ui.hint(this.jobIntro(), 6));
    }
    const delay = intro ? 1.1 : 0;
    this.later(delay + 2.6, () => this.tip('walk', 'Walk with <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or the arrow keys'));
    this.later(delay + 9, () => this.tip('camera', 'Look around: right-click and drag, or hold <kbd>Q</kbd> / <kbd>E</kbd>'));
    if (level.boss) this.startBossFight(intro ? 2.4 : 0.8);
    const banner = level.boss
      ? () => this.ui.banner('Final battle', level.hall, 'Defeat the Skeleton King to escape!')
      : () => this.ui.banner(`Hall ${this.stage + 1} of ${PILLAR_HALLS}`, level.hall, `Guarding the Pillar of ${PILLARS[this.stage]?.name}`);
    if (this.dark > 0) {
      // Banner comes when the torch is lit.
    } else if (intro) this.later(delay, banner);
    else banner();
    this.ui.fade(false);
  }

  /** The King lies before his throne, then rises when the room's opening shot is done. */
  private startBossFight(delay: number): void {
    this.step = 'fight';
    const king = this.spawnEnemy('king', new THREE.Vector3(0, 0, -5));
    king.facing = 0;
    king.sleep();
    this.boss = king;
    this.bossCalls = [0.66, 0.33];
    this.later(delay, () => {
      if (!king.alive) return;
      this.summon(king, 2.2);
      this.audio.play('defeat');
      this.later(Enemy.SUMMON_TIME, () => this.shake(0.4));
      this.ui.bossBar('Skeleton King', 1);
      this.ui.objective('Defeat the Skeleton King! Dodge out of the red rings');
      this.later(1.5, () => this.tip('boss', 'Big red ring = a huge slam is coming. Press <kbd>Space</kbd> to dodge out!', 6));
    });
  }

  /** Called every frame in the boss room: health bar, guards, phase two. */
  private updateBoss(): void {
    const king = this.boss;
    if (!king) return;
    const f = king.hp / king.maxHp;
    this.ui.bossBar('Skeleton King', f);
    if (this.bossCalls.length && f <= this.bossCalls[0] && king.alive) {
      this.bossCalls.shift();
      const second = this.bossCalls.length === 0;
      this.ui.banner('The King roars', second ? 'Guards, again!' : 'Guards, to me!', second ? 'He is weakening. Keep going!' : 'Beat his guards, then strike the King');
      this.audio.play('rise');
      this.shake(0.35);
      this.spawnWave(this.difficulty.id === 'easy' ? ['runt', 'runt'] : ['runt', 'skeleton', 'runt']);
    }
    if (f <= 0.5 && king.animSpeed === 1 && king.alive) {
      king.enrage();
      this.floatAt(king.position, 4.6, 'Enraged!', 'crit');
      this.tip('enraged', 'The King is angry: his slams now throw bones. Dodge them!');
    }
  }

  private onBossDefeated(): void {
    this.boss = null;
    this.ui.bossBar(null, 0);
    // Any guards left crumble with their king.
    for (const e of this.enemies) if (e.alive) {
      e.hurt(99999, e.position, 0);
      this.onEnemyDied(e);
    }
    this.crypt.door.setProgress(PILLAR_HALLS);
    this.crypt.door.open();
    this.audio.play('victory');
    this.shake(0.5);
    this.ui.banner('Victory!', 'The Skeleton King is defeated', 'The golden door is open. Escape!', 4);
    this.ui.objective('Escape through the golden door!');
    if (this.hero.state === 'free') this.hero.animator.play('Cheer', { loop: false, fade: 0.15, restart: true });
  }

  /** Swaps in the room for a hall: its own floor, walls, pillars, props and traps. */
  private buildHall(index: number): void {
    this.scene.remove(this.crypt.group);
    this.crypt = buildCrypt(this.assets, this.glow, index);
    this.scene.add(this.crypt.group);
    this.nav = new NavGrid(this.crypt.colliders);
    this.navTimer = 0;
  }

  private clearActors(): void {
    for (const e of this.enemies) this.scene.remove(e.root);
    for (const ring of this.rings.values()) this.scene.remove(ring);
    for (const lane of this.lanes.values()) this.scene.remove(lane);
    this.lanes.clear();
    for (const p of this.portals) this.scene.remove(p.mesh);
    this.portals = [];
    this.clearJob();
    this.removeMerchant();
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    for (const z of this.zones) this.scene.remove(z.mesh);
    for (const p of this.pickups) this.scene.remove(p.object);
    for (const c of this.crates) this.removeCrate(c);
    for (const c of this.coinsOnFloor) this.scene.remove(c.mesh);
    if (this.lost?.object) {
      this.scene.remove(this.lost.object);
      this.lost.object = null;
    }
    if (this.brazier) {
      this.scene.remove(this.brazier.light);
      this.brazier = null;
    }
    this.crypt.torches.lit = 1;
    this.dark = 0;
    this.coinsOnFloor = [];
    this.bats.clear();
    this.boss = null;
    this.ui.bossBar(null, 0);
    if (this.chest) {
      this.scene.remove(this.chest.object);
      const i = this.crypt.colliders.boxes.indexOf(this.chest.box);
      if (i >= 0) this.crypt.colliders.boxes.splice(i, 1);
      this.chest = null;
    }
    if (this.crates.length) this.nav = new NavGrid(this.crypt.colliders);
    this.crates = [];
    this.enemies = [];
    this.rings.clear();
    this.projectiles = [];
    this.zones = [];
    this.pickups = [];
    this.timers = [];
    this.ui.clearWorldUi();
  }

  private spawnEnemy(kind: EnemyKind, at: THREE.Vector3): Enemy {
    const enemy = new Enemy(this.assets, ENEMIES[kind], this.difficulty.enemyHp);
    enemy.position.copy(at);
    this.scene.add(enemy.root);
    const ring = new THREE.Mesh(
      this.ringGeometry,
      new THREE.MeshBasicMaterial({ color: '#ff2a2a', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    ring.visible = false;
    this.scene.add(ring);
    this.rings.set(enemy, ring);
    const charge = ENEMIES[kind].charge;
    if (charge) {
      const geo = new THREE.PlaneGeometry(1.5, charge.distance);
      geo.translate(0, charge.distance / 2, 0);
      geo.rotateX(Math.PI / 2);
      const lane = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ map: this.laneTexture, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
      );
      lane.visible = false;
      lane.renderOrder = 2;
      this.scene.add(lane);
      this.lanes.set(enemy, lane);
    }
    this.enemies.push(enemy);
    return enemy;
  }

  /**
   * Hades-style summoning: a purple circle glows on the floor with sparks
   * rising from it, so you can see where a monster is coming, and about a
   * second later the monster pops out in a puff of dark smoke.
   */
  private summon(e: Enemy, size = e.def.scale * 1.1): void {
    if (!e.alive) return;
    e.rise();
    const mesh = new THREE.Mesh(
      this.portalGeometry,
      new THREE.MeshBasicMaterial({ map: this.portalTexture, color: this.portalColor, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(e.position.x, 0.05, e.position.z);
    mesh.renderOrder = 2;
    this.scene.add(mesh);
    this.portals.push({ mesh, at: e.position.clone(), t: 0, size });
    this.audio.play('summon');
    this.later(Enemy.SUMMON_TIME, () => {
      if (!e.alive) return;
      this.puff(e.position, 18);
      this.burst(e.position.clone().setY(0.9), this.portalColor, 26, 3.5);
      this.audio.play('rise');
    });
  }

  /** The charge warning: a dark-edged red lane with white arrows, readable on any floor. */
  private static makeLaneTexture(): THREE.CanvasTexture {
    const w = 64;
    const h = 384;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(90, 0, 12, 0.6)';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255, 60, 60, 0.95)';
    g.fillRect(0, 0, 5, h);
    g.fillRect(w - 5, 0, 5, h);
    g.strokeStyle = 'rgba(255, 235, 235, 0.95)';
    g.lineWidth = 7;
    g.lineJoin = 'round';
    // Arrows pointing along the lane (the far end of the texture is the charge direction).
    for (let y = 30; y < h; y += 64) {
      g.beginPath();
      g.moveTo(14, y + 18);
      g.lineTo(w / 2, y);
      g.lineTo(w - 14, y + 18);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /** A soft glowing circle with a bright rim and a few rune ticks, drawn once. */
  private static makePortalTexture(): THREE.CanvasTexture {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d')!;
    const mid = size / 2;
    const fill = g.createRadialGradient(mid, mid, 0, mid, mid, mid);
    fill.addColorStop(0, 'rgba(255,255,255,0.35)');
    fill.addColorStop(0.6, 'rgba(255,255,255,0.18)');
    fill.addColorStop(0.78, 'rgba(255,255,255,0.9)');
    fill.addColorStop(0.84, 'rgba(255,255,255,1)');
    fill.addColorStop(0.9, 'rgba(255,255,255,0.25)');
    fill.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = fill;
    g.fillRect(0, 0, size, size);
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    g.lineWidth = 5;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.beginPath();
      g.arc(mid, mid, mid * 0.66, a, a + 0.32);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private updatePortals(dt: number): void {
    for (let i = this.portals.length - 1; i >= 0; i--) {
      const p = this.portals[i];
      p.t += dt;
      const grow = Math.min(1, p.t / 0.35);
      const fadeOut = p.t > Enemy.SUMMON_TIME ? Math.max(0, 1 - (p.t - Enemy.SUMMON_TIME) / 0.35) : 1;
      const mat = p.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = grow * fadeOut * (0.85 + Math.sin(p.t * 14) * 0.1);
      p.mesh.scale.setScalar(p.size * 0.9 * (0.4 + 0.6 * (1 - Math.pow(1 - grow, 3))));
      p.mesh.rotation.z += dt * 2.4;
      if (p.t < Enemy.SUMMON_TIME && Math.random() < dt * 40) {
        const a = Math.random() * Math.PI * 2;
        const r = p.size * (0.5 + Math.random() * 0.45);
        this.glow.spawn({
          x: p.at.x + Math.cos(a) * r,
          y: 0.1,
          z: p.at.z + Math.sin(a) * r,
          vy: 1.4 + Math.random() * 1.2,
          life: 0.5 + Math.random() * 0.3,
          size: 0.1,
          sizeEnd: 0.02,
          color: Math.random() < 0.3 ? this.portalHot : this.portalColor,
          intensity: 3,
        });
      }
      if (fadeOut <= 0) {
        this.scene.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        this.portals.splice(i, 1);
      }
    }
  }

  // ───────────────────────── The merchant ─────────────────────────

  /**
   * After a hall is cleared a merchant sets up beside the altar, like Charon's
   * shop in Hades: a small random stock, a bigger one before the King.
   */
  private placeMerchant(): void {
    if (this.merchant || this.phase !== 'play' || this.step !== 'cleared') return;
    const a = this.crypt.altar.position;
    const tries = [Math.PI / 2, -Math.PI / 2, Math.PI * 0.75, -Math.PI * 0.75, Math.PI * 0.25, -Math.PI * 0.25];
    let spot: THREE.Vector3 | null = null;
    for (const r of [4.6, 6, 7.5]) {
      for (const ang of tries) {
        const x = a.x + Math.sin(ang) * r;
        const z = a.z + Math.cos(ang) * r;
        if (!this.crypt.colliders.hits(x, z, 1.6) && this.hero.position.distanceTo(new THREE.Vector3(x, 0, z)) > 2.5) {
          spot = new THREE.Vector3(x, 0, z);
          break;
        }
      }
      if (spot) break;
    }
    if (!spot) return;
    const who = new Character(this.assets, 'Barbarian', this.assets.heroClips);
    who.hideParts(['Barbarian_Round_Shield', '2H_Axe', '1H_Axe', '1H_Axe_Offhand']);
    who.position.copy(spot);
    who.facing = Math.atan2(this.hero.position.x - spot.x, this.hero.position.z - spot.z);
    who.root.rotation.y = who.facing;
    who.animator.play('Cheer', { loop: false });
    who.root.traverse((o) => (o.castShadow = true));
    // A little stall: a chest of goods and some coins.
    const props = new THREE.Group();
    const side = new THREE.Vector3(Math.cos(who.facing), 0, -Math.sin(who.facing));
    const chest = this.assets.piece('chest_gold');
    chest.position.copy(spot).addScaledVector(side, 1.1);
    chest.rotation.y = who.facing;
    const coins = this.assets.piece('coin_stack_medium');
    coins.position.copy(spot).addScaledVector(side, -1);
    props.add(chest, coins);
    this.scene.add(who.root, props);
    const box = { minX: spot.x - 0.6, maxX: spot.x + 0.6, minZ: spot.z - 0.6, maxZ: spot.z + 0.6 };
    this.crypt.colliders.boxes.push(box);
    this.guideNav = null;
    this.burst(spot.clone().setY(1.2), this.gold, 40, 3.5);
    this.puff(spot, 12);
    this.audio.play('chest');
    const beforeKing = LEVELS[this.route[this.stage + 1]]?.boss === true;
    this.merchant = { who, props, box, items: this.rollShop(beforeKing ? 4 : 3) };
  }

  private rollShop(count: number): ShopItem[] {
    const all: ShopItem[] = [
      { name: 'Health Potion', text: 'One more potion for later.', price: 15, icon: 'potion', color: '#ff4f78', sold: false },
      { name: 'Hearty Meal', text: 'Heal all your health right now.', price: 20, icon: 'heal', color: '#7dff9e', sold: false },
      { name: 'Iron Heart', text: '+20 max health for the rest of the quest.', price: 40, icon: 'heart', color: '#5ee0ff', sold: false },
      { name: 'Blessing', text: 'Choose one more blessing.', price: 55, icon: 'blessing', color: '#ffd23a', sold: false },
    ];
    // The potion is always there (it's what kids need most); the rest are random.
    const rest = all.slice(1).sort(() => Math.random() - 0.5);
    return [all[0], ...rest].slice(0, count);
  }

  private nearMerchant(): boolean {
    return !!this.merchant && this.phase === 'play' && !this.choosing && this.merchant.who.position.distanceTo(this.hero.position) < 2.8;
  }

  private updateMerchant(dt: number): void {
    const m = this.merchant;
    if (!m) return;
    m.who.updateVisuals(dt);
    if (m.who.animator.progress >= 1) m.who.animator.play('Idle');
    if (!this.choosing && m.who.position.distanceTo(this.hero.position) < 9) this.tip('shop', 'A <b>merchant</b>! Walk up and press <kbd>F</kbd> to spend your coins.', 6);
    if (this.nearMerchant() && (this.input.keyPressed('KeyF') || this.input.keyPressed('KeyJ'))) this.openShop();
  }

  private openShop(): void {
    const m = this.merchant;
    if (!m) return;
    this.choosing = true;
    this.ui.hint(null);
    this.ui.prompt(null);
    this.audio.play('chest');
    m.who.animator.play('Cheer', { loop: false, restart: true });
    this.ui.showShop(m.items, this.coins, (i) => this.buy(i), () => this.closeShop());
  }

  private buy(i: number): void {
    const m = this.merchant;
    const it = m?.items[i];
    if (!m || !it || it.sold || it.price > this.coins) return;
    const hero = this.hero;
    if (it.icon === 'potion' && this.potions >= this.maxPotions) {
      this.ui.hint('Your potion bag is full!', 2);
      return;
    }
    this.coins -= it.price;
    it.sold = true;
    this.ui.setCoins(this.coins, true);
    this.audio.play('coin');
    this.audio.play('pickup');
    if (it.icon === 'potion') this.potions = Math.min(this.maxPotions, this.potions + 1);
    else if (it.icon === 'heal') hero.hp = hero.maxHp;
    else if (it.icon === 'heart') {
      this.bonusHp += 20;
      this.applyBlessings();
      hero.hp = Math.min(hero.maxHp, hero.hp + 20);
      this.ui.setHero(hero.def, this.heroName, hero.maxHp);
      this.ui.setBlessings(this.blessings, BLESSINGS);
      this.ui.setCoins(this.coins, false);
    }
    this.burst(hero.position.clone().setY(1.2), new THREE.Color(it.color), 30, 3);
    if (it.icon === 'blessing') {
      this.closeShop();
      this.later(0.3, () => this.offerBlessings());
      return;
    }
    this.ui.showShop(m.items, this.coins, (k) => this.buy(k), () => this.closeShop());
  }

  private closeShop(): void {
    this.choosing = false;
    this.input.clear();
    this.ui.hideScreen();
    this.ui.objective('Follow the arrow to the golden door');
  }

  private removeMerchant(): void {
    const m = this.merchant;
    if (!m) return;
    this.scene.remove(m.who.root, m.props);
    const i = this.crypt.colliders.boxes.indexOf(m.box);
    if (i >= 0) this.crypt.colliders.boxes.splice(i, 1);
    this.merchant = null;
  }

  // ───────────────────────── Room life ─────────────────────────

  private readonly lifeColors = {
    fog: new THREE.Color('#9aa6b8'),
    firefly: new THREE.Color('#e4ff7a'),
    leaf: new THREE.Color('#6fae4a'),
    mote: new THREE.Color('#bfe6ff'),
    ember: new THREE.Color('#ff7a2a'),
    royal: new THREE.Color('#c77dff'),
    dust: new THREE.Color('#e8d6a8'),
  };

  /**
   * Small things always moving, different in every hall, so no room ever
   * looks frozen: ground fog in the graveyard, fireflies in the forest,
   * falling leaves in the overgrown hall, floating dust in the library,
   * embers in the Ember Deep, royal sparks around the King's throne.
   */
  private updateRoomLife(dt: number): void {
    const c = this.crypt.center;
    const hx = Math.min(this.crypt.halfX, 18);
    const hz = Math.min(this.crypt.halfZ, 16);
    const rx = () => c.x + (Math.random() * 2 - 1) * hx;
    const rz = () => c.z + (Math.random() * 2 - 1) * hz;
    const col = this.lifeColors;
    const chance = (perSecond: number) => Math.random() < perSecond * dt;
    switch (this.level) {
      case 5: // Graveyard: low fog rolling over the ground.
        if (chance(4)) this.mist.spawn({ x: rx(), y: 0.3, z: rz(), vx: 0.45 + Math.random() * 0.3, vy: 0.01, life: 7, size: 3.2, sizeEnd: 4.4, color: col.fog, intensity: 0.13, drag: 0.05 });
        if (chance(1.5)) this.glow.spawn({ x: rx(), y: 0.6 + Math.random(), z: rz(), vx: (Math.random() - 0.5) * 0.3, vy: 0.1, vz: (Math.random() - 0.5) * 0.3, life: 3, size: 0.06, sizeEnd: 0.02, color: col.mote, intensity: 2 });
        break;
      case 6: // Forest: fireflies wandering.
        if (chance(6)) this.glow.spawn({ x: rx(), y: 0.4 + Math.random() * 2, z: rz(), vx: (Math.random() - 0.5) * 0.6, vy: (Math.random() - 0.5) * 0.3, vz: (Math.random() - 0.5) * 0.6, life: 3.5, size: 0.09, sizeEnd: 0.04, color: col.firefly, intensity: 3 });
        if (chance(2)) this.dust.spawn({ x: rx(), y: 5 + Math.random() * 2, z: rz(), vx: 0.4, vy: -0.6, life: 7, size: 0.18, sizeEnd: 0.16, color: col.leaf, intensity: 0.9, drag: 0.1 });
        break;
      case 1: // Overgrown: leaves drifting down from the vines.
        if (chance(4)) this.dust.spawn({ x: rx(), y: 5 + Math.random() * 2, z: rz(), vx: (Math.random() - 0.5) * 0.6, vy: -0.55, vz: (Math.random() - 0.5) * 0.4, life: 8, size: 0.2, sizeEnd: 0.18, color: col.leaf, intensity: 0.9, drag: 0.1 });
        if (chance(2)) this.glow.spawn({ x: rx(), y: 0.5 + Math.random() * 1.5, z: rz(), vx: (Math.random() - 0.5) * 0.4, vz: (Math.random() - 0.5) * 0.4, life: 3, size: 0.08, sizeEnd: 0.03, color: col.firefly, intensity: 2.5 });
        break;
      case 2: // Library: dust floating in the cold light.
        if (chance(8)) this.glow.spawn({ x: rx(), y: 0.5 + Math.random() * 3.5, z: rz(), vx: (Math.random() - 0.5) * 0.15, vy: 0.05, vz: (Math.random() - 0.5) * 0.15, life: 5, size: 0.05, sizeEnd: 0.05, color: col.mote, intensity: 1.4 });
        break;
      case 3: // Ember Deep: sparks rising off the hot floor.
        if (chance(10)) this.glow.spawn({ x: rx(), y: 0.1, z: rz(), vx: (Math.random() - 0.5) * 0.4, vy: 1 + Math.random() * 1.2, vz: (Math.random() - 0.5) * 0.4, life: 2, size: 0.07, sizeEnd: 0.01, color: col.ember, intensity: 3.5 });
        break;
      case 4: // Throne: royal sparks drifting up.
        if (chance(5)) this.glow.spawn({ x: rx(), y: 0.2, z: rz(), vy: 0.5 + Math.random() * 0.5, life: 4, size: 0.07, sizeEnd: 0.01, color: col.royal, intensity: 2.5 });
        break;
      default: // Old Crypt and the torchlit hall: dust drifting in the air.
        if (chance(5)) this.glow.spawn({ x: rx(), y: 0.5 + Math.random() * 3, z: rz(), vx: (Math.random() - 0.5) * 0.15, vy: -0.03, vz: (Math.random() - 0.5) * 0.15, life: 5, size: 0.04, sizeEnd: 0.04, color: col.dust, intensity: 1.2 });
    }
  }

  // ───────────────────────── Hall jobs ─────────────────────────

  private placeJob(): void {
    const job = LEVELS[this.level].job;
    if (!job || job.kind === 'defend') return;
    job.spots.forEach(([x, z], i) => {
      const at = new THREE.Vector3(x, 0, z);
      let object: THREE.Group;
      let light: THREE.PointLight | null = null;
      let box: Crate['box'] | null = null;
      if (job.kind === 'lanterns') {
        object = new THREE.Group();
        const lantern = this.assets.piece('hw_lantern_standing');
        lantern.scale.setScalar(1.8);
        lantern.traverse((o) => (o.castShadow = true));
        object.add(lantern);
        light = new THREE.PointLight('#ffb347', 0, 11, 2);
        light.position.set(0, 1.6, 0);
        object.add(light);
      } else if (job.kind === 'wisps') {
        object = new THREE.Group();
        const wisp = new THREE.Mesh(
          new THREE.SphereGeometry(0.28, 16, 12),
          new THREE.MeshStandardMaterial({ color: '#d9ffe6', emissive: '#7dff9e', emissiveIntensity: 3 }),
        );
        wisp.name = 'wisp';
        wisp.position.y = 1.2;
        object.add(wisp);
      } else if (job.kind === 'books') {
        object = new THREE.Group();
        const book = makeBook(['#6b3fa0', '#2f6db5', '#a83a3a'][i % 3]);
        book.name = 'book';
        object.add(book);
      } else {
        // Cursed purple, so it stands out on any floor (the Ember Deep is all orange).
        object = makeCrystal('#a24dff');
      }
      // A golden circle on the floor marks it as part of the job (the
      // graveyard has other, decorative lanterns).
      const mark = new THREE.Mesh(
        this.portalGeometry,
        new THREE.MeshBasicMaterial({ map: this.portalTexture, color: this.gold, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      mark.name = 'mark';
      mark.rotation.x = -Math.PI / 2;
      mark.position.y = 0.06;
      mark.scale.setScalar(job.kind === 'books' || job.kind === 'wisps' ? 0.85 : 1.3);
      mark.renderOrder = 2;
      object.add(mark);
      if (job.kind === 'books') object.getObjectByName('book')!.scale.setScalar(1.45);
      object.position.copy(at);
      this.scene.add(object);
      if (job.kind === 'lanterns' || job.kind === 'crystals') {
        const half = job.kind === 'crystals' ? 0.6 : 0.35;
        box = { minX: x - half, maxX: x + half, minZ: z - half, maxZ: z + half };
        this.crypt.colliders.boxes.push(box);
      }
      this.jobItems.push({ object, at, done: false, hp: job.kind === 'crystals' ? 3 : 1, light, box, flash: 0, seed: i * 1.7 });
    });
    this.nav = new NavGrid(this.crypt.colliders);
  }

  private clearJob(): void {
    for (const item of this.jobItems) {
      this.scene.remove(item.object);
      const i = item.box ? this.crypt.colliders.boxes.indexOf(item.box) : -1;
      if (i >= 0) this.crypt.colliders.boxes.splice(i, 1);
    }
    this.jobItems = [];
    this.defendLeft = 0;
  }

  private jobLeft(): number {
    return this.jobItems.filter((j) => !j.done).length;
  }

  private jobText(): string {
    const job = LEVELS[this.level].job;
    const done = this.jobItems.length - this.jobLeft();
    const n = this.jobItems.length;
    if (job?.kind === 'lanterns') return `Light the lanterns: ${done} of ${n}`;
    if (job?.kind === 'books') return `Find the lost books: ${done} of ${n}`;
    if (job?.kind === 'crystals') return `Smash the cursed crystals: ${done} of ${n}`;
    if (job?.kind === 'wisps') return `Catch the wisps: ${done} of ${n}`;
    return '';
  }

  private jobIntro(): string {
    const job = LEVELS[this.level].job;
    const n = this.jobItems.length;
    if (job?.kind === 'lanterns') return `Light the <b>${n} lanterns</b> to wake the pillar. Walk up and press <kbd>F</kbd>. Careful, the graves are restless!`;
    if (job?.kind === 'books') return `Find the <b>${n} lost spell books</b> to wake the pillar. Walk over a book to grab it.`;
    if (job?.kind === 'crystals') return `Smash the <b>${n} cursed crystals</b> to wake the pillar. Hit each one with <kbd>F</kbd>.`;
    if (job?.kind === 'wisps') return `Catch the <b>${n} runaway wisps</b> to wake the pillar. They float away, so chase them into a corner!`;
    return '';
  }

  private nearestJobItem(): JobItem | null {
    let best: JobItem | null = null;
    let bestD = Infinity;
    for (const j of this.jobItems) {
      if (j.done) continue;
      const d = j.at.distanceTo(this.hero.position);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    return best;
  }

  private nearCrystal(within: number): JobItem | null {
    if (LEVELS[this.level].job?.kind !== 'crystals') return null;
    return this.jobItems.find((j) => !j.done && j.at.distanceTo(this.hero.position) < within) ?? null;
  }

  private nearLantern(): JobItem | null {
    if (LEVELS[this.level].job?.kind !== 'lanterns' || this.phase !== 'play') return null;
    return this.jobItems.find((j) => !j.done && j.at.distanceTo(this.hero.position) < 2.6) ?? null;
  }

  private updateJob(dt: number): void {
    const job = LEVELS[this.level].job;
    if (!job || job.kind === 'defend' || !this.jobItems.length) return;
    const t = this.time;
    const hero = this.hero;
    for (const j of this.jobItems) {
      j.flash = Math.max(0, j.flash - dt * 4);
      const mark = j.object.getObjectByName('mark');
      if (mark) {
        mark.rotation.z = t * 0.5 + j.seed;
        ((mark as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = j.done ? 0 : 0.55 + Math.sin(t * 2.2 + j.seed) * 0.15;
      }
      if (job.kind === 'wisps') {
        if (j.done) continue;
        const wisp = j.object.getObjectByName('wisp')!;
        wisp.position.y = 1.1 + Math.sin(t * 3 + j.seed) * 0.25;
        // Drifts away from the hero, a bit slower than walking, so it can be caught.
        const away = this.tmp.copy(j.at).sub(hero.position).setY(0);
        const d = away.length();
        if (d < 5.5 && d > 0.01) {
          away.divideScalar(d);
          const wobble = Math.sin(t * 2.3 + j.seed * 3) * 0.6;
          j.at.x += (away.x + away.z * wobble) * 3.4 * dt;
          j.at.z += (away.z - away.x * wobble) * 3.4 * dt;
          this.crypt.colliders.resolve(j.at, 0.5);
          j.object.position.copy(j.at);
        }
        if (Math.random() < dt * 20) this.glow.spawn({ x: j.at.x, y: wisp.position.y, z: j.at.z, vx: (Math.random() - 0.5) * 0.4, vy: 0.2, vz: (Math.random() - 0.5) * 0.4, life: 0.7, size: 0.1, sizeEnd: 0.01, color: this.wispColor, intensity: 3 });
        if (hero.alive && d < 1.4) this.finishJobItem(j);
        continue;
      }
      if (job.kind === 'books') {
        const book = j.object.getObjectByName('book')!;
        if (j.done) continue;
        book.position.y = 0.9 + Math.sin(t * 2 + j.seed) * 0.15;
        book.rotation.y = t * 0.9 + j.seed;
        if (Math.random() < dt * 14) this.glow.spawn({ x: j.at.x + (Math.random() - 0.5) * 0.8, y: 0.6 + Math.random() * 0.6, z: j.at.z + (Math.random() - 0.5) * 0.8, vy: 0.6, life: 0.9, size: 0.08, sizeEnd: 0.01, color: this.gold, intensity: 3 });
        if (hero.alive && j.at.distanceTo(hero.position) < 1.4) this.finishJobItem(j);
      } else if (job.kind === 'lanterns') {
        if (j.done) {
          j.light!.intensity = 9 + Math.sin(t * 11 + j.seed) * 1.2;
          if (Math.random() < dt * 10) this.glow.spawn({ x: j.at.x, y: 1.75, z: j.at.z, vy: 0.9, life: 0.5, size: 0.1, sizeEnd: 0.02, color: this.fireColor, intensity: 3 });
          continue;
        }
        // Unlit: a faint wisp, so you can spot them in the dark.
        if (Math.random() < dt * 5) this.glow.spawn({ x: j.at.x + (Math.random() - 0.5) * 0.3, y: 1.6, z: j.at.z + (Math.random() - 0.5) * 0.3, vy: 0.4, life: 1.2, size: 0.07, sizeEnd: 0.01, color: this.gold, intensity: 2 });
        if (hero.alive && j.at.distanceTo(hero.position) < 2.6 && (this.input.keyPressed('KeyF') || this.input.keyPressed('KeyJ'))) this.finishJobItem(j);
      } else {
        if (j.done) continue;
        const core = j.object.getObjectByName('core')!;
        core.rotation.y = t * 0.6 + j.seed;
        j.object.position.x = j.at.x + (j.flash > 0 ? Math.sin(t * 90) * 0.08 * j.flash : 0);
        const mat = (core as THREE.Mesh).material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 1.2 + Math.sin(t * 3 + j.seed) * 0.3 + j.flash * 3;
        if (Math.random() < dt * 6) this.glow.spawn({ x: j.at.x + (Math.random() - 0.5) * 1, y: 0.4 + Math.random() * 2, z: j.at.z + (Math.random() - 0.5) * 1, vy: 0.5, life: 1, size: 0.07, sizeEnd: 0.01, color: this.portalColor, intensity: 2.5 });
        if (hero.alive && j.at.distanceTo(hero.position) < 4) this.tip('crystal', 'Hit the crystal with <kbd>F</kbd> to smash it!', 5);
      }
    }
  }

  /** A swing, spin or shot reached the crystals. Returns true if one was hit. */
  private hitCrystals(from: THREE.Vector3, reach: number, facing?: THREE.Vector3, arc = Math.PI * 2): boolean {
    if (LEVELS[this.level].job?.kind !== 'crystals') return false;
    let hit = false;
    for (const j of this.jobItems) {
      if (j.done) continue;
      const d = this.tmp.copy(j.at).sub(from).setY(0);
      const dist = d.length();
      if (dist > reach + 0.6) continue;
      if (facing && dist > 1 && d.normalize().dot(facing) < Math.cos(arc / 2)) continue;
      hit = true;
      j.hp -= 1;
      j.flash = 1;
      this.burst(j.at.clone().setY(1.3), this.portalColor, 16, 3.5);
      this.audio.play('block');
      this.shake(0.12);
      if (j.hp <= 0) this.finishJobItem(j);
      else this.floatAt(j.at, 2.8, j.hp === 1 ? 'Cracking!' : 'Crack!', 'damage');
    }
    return hit;
  }

  private finishJobItem(j: JobItem): void {
    if (j.done) return;
    j.done = true;
    const kind = LEVELS[this.level].job?.kind;
    const easy = this.difficulty.id === 'easy';
    if (kind === 'books' || kind === 'wisps') {
      this.scene.remove(j.object);
      this.audio.play('pickup');
      this.burst(j.at.clone().setY(1), this.gold, 30, 3.5);
      this.floatAt(j.at, 1.8, kind === 'wisps' ? 'Caught!' : 'Book found!', 'heal');
      // A guardian answers the alarm.
      this.summonNear(j.at, [easy ? 'runt' : 'skeleton']);
    } else if (kind === 'lanterns') {
      this.audio.play('cast');
      this.burst(j.at.clone().setY(1.7), this.fireColor, 40, 3.5);
      this.floatAt(j.at, 2.6, 'Lit!', 'heal');
      // The graves nearby burst open.
      this.ui.hint('The graves burst open!', 2.5);
      this.later(0.4, () => this.summonNear(j.at, easy ? ['runt'] : ['runt', 'skeleton']));
    } else {
      this.scene.remove(j.object);
      if (j.box) {
        const i = this.crypt.colliders.boxes.indexOf(j.box);
        if (i >= 0) this.crypt.colliders.boxes.splice(i, 1);
        this.nav = new NavGrid(this.crypt.colliders);
        this.guideNav = null;
      }
      this.audio.play('crit');
      this.shake(0.35);
      this.burst(j.at.clone().setY(1.3), this.portalColor, 70, 6);
      this.puff(j.at, 16);
      this.dropCoins(j.at, 4);
      this.summonNear(j.at, [easy ? 'runt' : 'skeleton']);
    }
    if (this.jobLeft() > 0) {
      this.ui.objective(this.jobText());
      return;
    }
    // All done: the pillar wakes up.
    this.later(0.6, () => {
      this.audio.play('clear');
      this.burst(this.crypt.altar.position.clone().setY(2.6), this.gold, 70, 5);
      this.ui.objective('The pillar is awake! Go to the altar');
      this.ui.hint('The pillar is awake! Follow the arrow to the altar.', 4);
    });
  }

  /** Summons monsters around a spot, on open floor. */
  private summonNear(at: THREE.Vector3, kinds: EnemyKind[]): void {
    kinds.forEach((kind, i) => {
      const a = Math.atan2(this.hero.position.x - at.x, this.hero.position.z - at.z) + Math.PI + (i - (kinds.length - 1) / 2) * 1.3;
      const spot = new THREE.Vector3(at.x + Math.sin(a) * 2.4, 0, at.z + Math.cos(a) * 2.4);
      this.crypt.colliders.resolve(spot, 0.6);
      this.later(i * 0.3, () => {
        const e = this.spawnEnemy(kind, spot);
        e.facing = Math.atan2(this.hero.position.x - spot.x, this.hero.position.z - spot.z);
        this.summon(e);
      });
    });
  }

  /** Forest: monsters keep coming until the timer runs out. */
  private updateDefend(dt: number, living: number): void {
    const was = Math.ceil(this.defendLeft);
    this.defendLeft = Math.max(0, this.defendLeft - dt);
    const left = Math.ceil(this.defendLeft);
    if (left !== was && left <= 5 && left > 0) this.audio.play('tick');
    this.ui.objective(`Protect the pillar! Hold out: ${left} s`);
    this.defendSpawn -= dt;
    const pool = LEVELS[this.level].waves;
    if (this.defendSpawn <= 0 && this.defendLeft > 4 && pool.length) {
      this.defendSpawn = this.difficulty.id === 'easy' ? 8 : 6;
      if (living < (this.difficulty.id === 'easy' ? 4 : 6)) this.spawnWave(pool[this.defendWave++ % pool.length]);
    }
    if (this.defendLeft > 0) return;
    // Time! The pillar's light blasts every monster away.
    this.burst(this.crypt.altar.position.clone().setY(2), this.gold, 120, 9);
    this.shake(0.5);
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.summoning) {
        e.alive = false;
        e.root.visible = false;
        continue;
      }
      e.hurt(99999, this.crypt.altar.position, 4);
      this.onEnemyDied(e);
    }
    this.waves.length = 0;
    this.ui.hint('You held out! The pillar\'s light blasts the monsters away.', 4);
    this.onCleared();
  }

  private claimPillar(): void {
    this.step = 'fight';
    this.crypt.altar.awaken();
    this.burst(this.crypt.altar.position.clone().setY(2.8), this.gold, 80, 6);
    this.shake(0.35);
    this.audio.play('pillar');
    this.ui.objective('The skeletons are waking up! Defeat them all');
    this.later(1.2, () => this.tip('attack', 'Press <kbd>F</kbd> to attack. Hold it to keep swinging. Your hero aims for you!', 6));
    this.enemies.forEach((e, i) => {
      if (e.state !== 'dormant' || this.waitingInAmbush(e)) return;
      this.later(0.35 + i * 0.35, () => {
        if (!e.alive) return;
        this.summon(e);
      });
    });
    this.waveCooldown = 4;
    const job = LEVELS[this.level].job;
    if (job?.kind === 'defend') {
      this.defendLeft = job.seconds;
      this.defendSpawn = 5;
      this.defendWave = 0;
      this.ui.objective(`Protect the pillar! Hold out for ${job.seconds} seconds`);
      this.later(1.4, () => this.ui.hint('Monsters will keep coming. <b>Stay alive until the timer runs out!</b>', 5));
    }
  }

  private spawnWave(kinds: EnemyKind[], eliteFirst = false): void {
    const points = [...this.crypt.spawnPoints]
      .filter((p) => p.distanceTo(this.hero.position) > 4.5)
      .sort(() => Math.random() - 0.5);
    kinds.forEach((kind, i) => {
      const at = points[i % points.length].clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.5, 0, (Math.random() - 0.5) * 1.5));
      this.later(i * 0.4, () => {
        const enemy = this.spawnEnemy(kind, at);
        if (eliteFirst && i === 0) {
          enemy.makeElite(this.difficulty.id === 'easy' ? 1.5 : 2.2);
          this.floatAt(at, 3, 'Elite!', 'crit');
        }
        enemy.facing = Math.atan2(this.hero.position.x - at.x, this.hero.position.z - at.z);
        this.summon(enemy);
      });
    });
  }

  private onCleared(): void {
    this.step = 'cleared';
    if (LEVELS[this.level].boss) return this.onBossDefeated();
    this.givePathReward();
    this.later(1.2, () => this.placeMerchant());
    this.pillars = Math.max(this.pillars, this.stage + 1);
    this.crypt.door.setProgress(this.pillars);
    this.crypt.door.open();
    this.ui.setQuest(this.level, this.pillars, this.stage);
    this.audio.play('clear');
    this.later(0.6, () => this.audio.play('door'));
    const last = this.pillars >= PILLAR_HALLS;
    const left = PILLAR_HALLS - this.pillars;
    this.ui.banner(
      `Pillar ${this.pillars} of ${PILLAR_HALLS}`,
      `Pillar of ${PILLARS[this.stage]?.name}`,
      last ? 'All four pillars! The way to the Skeleton King is open' : `${left} more to go! Follow the arrow to the door`,
    );
    this.later(2.5, () => this.crypt.altar.settle());
    // A reward for clearing the hall, so you're never left without a potion.
    this.later(1.2, () => {
      const at = this.crypt.altar.position.clone().add(new THREE.Vector3(1.8, 0, 3));
      this.dropPotion(at);
      this.burst(at.clone().setY(1), this.heal, 30, 3);
    });
    this.ui.objective(last ? 'Face the Skeleton King! Follow the arrow to the door' : 'Follow the arrow to the golden door');
    this.later(2.9, () => this.offerBlessings());
    if (this.hero.state === 'free') this.hero.animator.play('Cheer', { loop: false, fade: 0.15, restart: true });
  }

  /**
   * Through the door: the hero runs on into the torch-lit corridor toward the
   * light while the camera drops in behind, then the next hall opens. No cut.
   */
  private exitHall(): void {
    this.step = 'exiting';
    this.walkout = 0;
    this.pathAsked = false;
    this.ui.prompt(null);
    this.ui.hint(null);
    this.ui.showHud(false);
    this.audio.play('door');
    this.input.clear();
  }

  private updateWalkout(dt: number): void {
    const hero = this.hero;
    const before = this.walkout;
    this.walkout += dt;
    const door = this.crypt.doorAt;
    hero.position.x = THREE.MathUtils.damp(hero.position.x, door.x, 6, dt);
    hero.position.z = Math.max(door.z - 0.2, hero.position.z - 4.6 * dt);
    hero.facing = dampAngle(hero.facing, Math.PI, 10, dt);
    hero.animator.play('Running_A', { fade: 0.15 });
    if (Math.random() < 0.5) this.glow.spawn({ x: (Math.random() - 0.5) * 3, y: 0.3 + Math.random() * 2.5, z: hero.position.z - 2 - Math.random() * 3, vz: 1.5, life: 1, size: 0.1, sizeEnd: 0.01, color: this.gold, intensity: 3 });
    // The doorway flares with light as the hero steps into it.
    if (this.walkout > 0.4) this.crypt.door.flare(Math.min(1, (this.walkout - 0.4) / 0.6));
    // Halfway into the doorway: choose which hall comes next (not before the King).
    if (before < 0.7 && this.walkout >= 0.7 && !this.pathAsked && this.stage + 2 < this.route.length) {
      this.pathAsked = true;
      this.offerPaths();
      return;
    }
    if (before < 0.85 && this.walkout >= 0.85) this.ui.fade(true, true);
    if (before < 1.45 && this.walkout >= 1.45) {
      if (this.stage >= this.route.length - 1) {
        this.win();
        return;
      }
      this.stage += 1;
      this.level = this.route[this.stage];
      this.potions = Math.min(this.maxPotions, this.potions);
      this.setupLevel(this.level, true, undefined, true);
      this.playEstablishingShot();
      this.saveProgress();
    }
  }

  /**
   * Opens a new hall on its own wide shot (each hall has a different angle),
   * holds it for a moment, then swoops down behind the hero. Held keys are
   * forgotten so the hero doesn't walk off before the player has looked around.
   */
  private playEstablishingShot(): void {
    const shot = LEVELS[this.level].intro;
    this.rig.yaw = THREE.MathUtils.degToRad(shot.yaw);
    this.rig.pitch = THREE.MathUtils.degToRad(shot.pitch);
    this.rig.distance = shot.distance;
    this.rig.setView(shot.yaw, shot.pitch, shot.distance);
    this.rig.focus.set(...shot.focus);
    this.establishing = 0.9;
    this.introTimer = 1.9;
    this.input.clear();
    this.ui.showHud(true);
  }

  private win(): void {
    this.phase = 'victory';
    clearSave();
    this.ui.showHud(false);
    this.ui.clearWorldUi();
    this.clearActors();
    this.ui.fade(false);
    this.hero.revive();
    this.hero.position.set(0, 0, 3.1);
    this.hero.facing = 0;
    this.hero.animator.play('Cheer', { fade: 0.1 });
    this.crypt.altar.awaken();
    this.audio.play('victory');
    this.ui.showVictory(this.stats());
  }

  private lose(): void {
    if (this.coins > 0) {
      this.lost = { coins: (this.lost?.coins ?? 0) + this.coins, level: this.level, spot: this.hero.position.clone().setY(0), object: null };
      this.coins = 0;
      this.ui.setCoins(0, false);
    }
    this.phase = 'dead';
    this.deadTimer = 0;
    this.audio.play('defeat');
    this.ui.prompt(null);
  }

  // ───────────────────────── Frame ─────────────────────────

  private frame = (now: number): void => {
    let dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.frameCount++;
    if (this.paused || this.choosing) dt = 0;
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      dt *= 0.1;
    }
    this.time += dt;
    this.input.pollGamepad(this.phase !== 'play' || this.paused || this.choosing, Math.min(0.05, (now - (this.lastPad || now)) / 1000));
    this.lastPad = now;
    this.update(dt);
    this.renderer.render(dt);
    this.input.endFrame();
    requestAnimationFrame(this.frame);
  };

  private update(dt: number): void {
    const t = this.time;
    if (this.phase === 'play' && !this.paused) this.updatePlay(dt);
    else if (this.phase === 'dead') this.updateDead(dt);

    this.hero.updateVisuals(dt);
    this.updateLineup(dt);
    for (const e of this.enemies) e.updateVisuals(dt);
    this.updateRings();
    if (this.phase === 'select' || this.phase === 'victory') {
      // Back to idle after a cheer.
      if (this.hero.animator.current === 'Cheer' && this.hero.animator.progress >= 1 && this.phase === 'select') {
        this.hero.animator.play('Idle', { fade: 0.25 });
      }
    }

    this.crypt.torches.update(t, dt, this.hero.position);
    this.crypt.runes.update(t);
    this.crypt.altar.update(t, dt);
    this.crypt.door.update(t, dt);
    this.updatePickups(t);
    this.spawnDust(dt);
    this.glow.update(dt);
    this.dust.update(dt);
    this.mist.update(dt);

    this.updateCamera(dt, t);
    this.moon.position.copy(this.rig.focus).add(new THREE.Vector3(-9, 22, 7));
    this.moon.target.position.copy(this.rig.focus);
    this.heroLight.position.copy(this.hero.position).add(new THREE.Vector3(0, 3.2, 0.6));
    this.heroLight.visible = this.hero.root.visible;
    this.updateSeeThrough();

    const h = this.renderer.bufferSize.y;
    this.glow.setScale(h, this.camera.fov);
    this.dust.setScale(h, this.camera.fov);
    if (this.phase === 'play') this.updateWorldUi();
  }

  /**
   * "Hor+": on a narrow screen (a phone held upright) the lens widens so you
   * still see as much of the room from side to side as on a wide screen.
   */
  private fovFor(base: number): number {
    const aspect = this.camera.aspect;
    const ref = 1.4;
    if (aspect >= ref) return base;
    const half = THREE.MathUtils.degToRad(base / 2);
    const wide = Math.atan(Math.tan(half) * ref);
    const v = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(wide) / aspect));
    return Math.min(v, 62);
  }

  private updateCamera(dt: number, t: number): void {
    const playFov = this.fovFor(30);
    if (this.phase !== 'select' && this.phase !== 'title' && this.camera.fov !== playFov) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, playFov, 6, dt);
      if (Math.abs(this.camera.fov - playFov) < 0.05) this.camera.fov = playFov;
      this.camera.updateProjectionMatrix();
    }
    if (this.phase === 'select' || this.phase === 'title') {
      // A wide lens on the row of heroes, swaying gently on the title.
      const menuFov = this.fovFor(36);
      if (Math.abs(this.camera.fov - menuFov) > 0.01) {
        this.camera.fov = THREE.MathUtils.damp(this.camera.fov, menuFov, 5, dt);
        this.camera.updateProjectionMatrix();
      }
      const title = this.phase === 'title';
      this.rig.setView(title ? Math.sin(t * 0.25) * 4 : 0, title ? 10 : 8, title ? 9.8 : 8.6);
      // On a narrow phone only two heroes fit: follow the one being looked at.
      const pick = !title && this.camera.aspect < 1 ? this.lineup[this.chosen] : undefined;
      this.camX = THREE.MathUtils.damp(this.camX, pick ? pick.position.x * 0.85 : 0, 6, dt);
      this.rig.update(dt, t, this.camTarget.set(this.camX, title ? 1.25 : pick ? 0.15 : 0.95, LINEUP_Z + 0.3));
      return;
    } else if (this.phase === 'victory') {
      // Hero stands to the right of the panel on wide screens.
      const wide = window.innerWidth > 900;
      this.rig.setView(0, 11, 8.4);
      this.rig.update(dt, t, this.camTarget.set(this.hero.position.x - (wide ? 2.3 : 0), wide ? 1.15 : 1.6, this.hero.position.z));
    } else {
      if (this.step === 'exiting') {
        // Stay in the room, a little lower and closer, watching the hero run into the light.
        this.rig.setView(0, 30, 12);
        this.rig.update(dt, t, this.camTarget.copy(this.hero.position).setY(1.2));
        return;
      }
      if (this.establishing > 0) {
        this.establishing -= dt;
        const shot = LEVELS[this.level].intro;
        this.rig.setView(shot.yaw, shot.pitch, shot.distance);
        this.rig.update(dt, t, this.camTarget.set(...shot.focus));
        if (this.establishing <= 0) {
          const v = LEVELS[this.level].view;
          this.rig.setView(v.yaw, v.pitch, v.distance);
        }
        return;
      }
      // The hall's view, turned and zoomed by the player. Look a little ahead.
      const v = LEVELS[this.level].view;
      this.rig.setView(v.yaw + this.camYaw, THREE.MathUtils.clamp(v.pitch + this.camPitch, 30, 76), v.distance * this.camZoom);
      // Once the player turns or zooms, keep the hero centred anywhere in the room.
      const free = Math.abs(this.camYaw) > 4 || this.camZoom < 0.95 || this.camPan.lengthSq() > 0.5;
      const c = this.crypt;
      this.rig.bounds = free ? { minX: c.center.x - c.halfX, maxX: c.center.x + c.halfX, minZ: c.center.z - c.halfZ, maxZ: c.center.z + c.halfZ } : this.sceneBounds;
      this.rig.axes(this.forward, this.right);
      this.rig.update(dt, t, this.camTarget.copy(this.hero.position).setY(0).addScaledVector(this.forward, 1.2).add(this.camPan));
    }
  }

  private updatePlay(dt: number): void {
    this.lastDt = dt;
    if (this.choosing) return;
    this.runTimers(dt);
    if (this.step === 'exiting') {
      this.updateWalkout(dt);
      this.input.endFrame();
      return;
    }
    if (this.introTimer > 0) {
      // The swoop: the hero cheers, then turns to face the hall. Input waits.
      this.introTimer -= dt;
      const hero = this.hero;
      if (hero.position.y > 0) {
        this.dropSpeed += 34 * dt;
        hero.position.y = Math.max(0, hero.position.y - this.dropSpeed * dt);
        if (hero.position.y === 0) {
          this.shake(0.45);
          this.puff(hero.position, 26);
          this.ring(hero.position.clone().setY(0.2), 2.5, 50);
          this.audio.play('hurt');
          hero.animator.play('Cheer', { loop: false, fade: 0.1, restart: true });
        }
      }
      if (this.introTimer < 1.0) hero.facing = dampAngle(hero.facing, Math.PI, 4, dt);
      if (hero.animator.current === 'Cheer' && hero.animator.progress >= 1) hero.animator.play('Idle', { fade: 0.2 });
      this.input.endFrame();
      return;
    }
    this.playTime += dt;

    if (this.input.keyPressed('Escape') || this.input.keyPressed('KeyP')) {
      this.setPaused(true);
      return;
    }
    if (this.input.keyPressed('KeyM')) this.audio.setMuted(!this.audio.muted);

    const hero = this.hero;
    this.readInput();
    if (this.input.keyPressed('KeyH')) this.drinkPotion();
    hero.update(dt, this.heroInput, this.events);
    const before = hero.position.clone();
    this.crypt.colliders.resolve(hero.position, hero.radius);
    if (before.distanceToSquared(hero.position) > 1e-6) hero.clampDash();

    if (this.renew.left > 0) {
      this.renew.left -= dt;
      this.healHero(this.renew.rate * dt, false);
    }

    this.updateEnemies(dt);
    this.updateProjectiles(dt);
    this.updateZones(dt);
    this.collectPickups();
    this.updateHazards(dt);
    // Bats under a roof or the night sky, not in the sunny forest.
    if (this.level !== 6) this.bats.update(dt, this.time, this.crypt.center, this.crypt.halfX, this.crypt.halfZ);
    this.updateRoomLife(dt);
    // Dust drifting down through the moonlight where the hero fell in.
    if (this.crypt.connected && Math.random() < 0.5) {
      const h = this.crypt.heroStart;
      this.glow.spawn({ x: h.x + (Math.random() - 0.5) * 2.4, y: 4 + Math.random() * 3, z: h.z + (Math.random() - 0.5) * 2.4, vy: -0.35, life: 4, size: 0.05, sizeEnd: 0.02, color: this.moonDust, intensity: 1.6 });
    }
    // Footsteps while walking.
    if (hero.state === 'free' && hero.velocity.lengthSq() > 4) {
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) {
        this.stepTimer = 0.34;
        this.audio.play('step');
      }
    }
    this.updateAmbushes();
    this.updatePortals(dt);
    this.updateLostTreasure();
    this.updateBrazier(dt);
    this.updateBoss();
    this.updateCoins(dt);
    this.updateChest();

    // The hall's steps.
    const altarDist = hero.position.distanceTo(this.crypt.altar.position);
    const walked = hero.position.distanceTo(this.hallStart) > 0.4 && !(this.brazier && !this.brazier.lit);
    this.updateJob(dt);
    this.updateMerchant(dt);
    if (this.step === 'explore' && altarDist < ALTAR_REACH + 1.5 && this.jobLeft() > 0 && (this.jobNag -= dt) < 0) {
      this.jobNag = 4;
      this.ui.hint(`The pillar is still asleep. ${this.jobIntro()}`, 3.5);
    }
    if (this.step === 'explore' && altarDist < ALTAR_REACH && walked && hero.state === 'free' && this.jobLeft() === 0) {
      this.step = 'claiming';
      hero.interact();
      this.crypt.altar.setCharge(1);
      this.later(0.55, () => {
        this.crypt.altar.setCharge(0);
        this.claimPillar();
      });
    }
    if (this.step === 'fight' && this.boss && !this.boss.alive) this.onCleared();
    if (this.step === 'fight') {
      const living = this.enemies.filter((e) => e.alive && !this.waitingInAmbush(e));
      const awake = living.filter((e) => e.state !== 'dormant');
      if (this.defendLeft <= 0 && this.waves.length > 0 && living.every((e) => e.state !== 'dormant')) {
        this.waveCooldown -= dt;
        if (this.waveCooldown <= 0 && awake.length <= 1) {
          const lastWave = this.waves.length === 1;
          this.spawnWave(this.waves.shift()!, lastWave);
          this.waveCooldown = 3;
        }
      }
      if (this.defendLeft > 0) {
        this.updateDefend(dt, living.length);
        return;
      }
      const pending = this.timers.length > 0 || this.waves.length > 0;
      if (living.length === 0 && !pending) this.onCleared();
      else if (this.boss) {
        const guards = living.filter((e) => e !== this.boss).length;
        this.ui.objective(guards ? `Defeat the Skeleton King! (${guards} ${guards === 1 ? 'guard' : 'guards'} left)` : 'Defeat the Skeleton King!');
      } else this.ui.objective(`Defeat the skeletons: ${living.length + this.waves.flat().length} left`);
    }
    if (this.step === 'cleared') {
      this.guideToDoor(dt);
      const p = hero.position;
      const door = this.crypt.doorAt;
      if (this.crypt.door.isOpen && p.z < door.z + 1.9 && Math.abs(p.x - door.x) < 2.6) this.exitHall();
    }

    this.updateArrow(dt);
    this.autoPotion(dt);
    if (this.pickups.some((k) => k.base.distanceTo(this.tmp.copy(hero.position).setY(0)) < 6)) {
      this.tip('potion-seen', 'The glowing heart is a <b>health potion</b>. Walk over it to grab it!');
    } else if (this.crates.some((c) => c.position.distanceTo(hero.position) < 3)) {
      this.tip('crates', 'Smash barrels and crates with <kbd>F</kbd>. There might be a potion inside!');
    }
    if (this.step === 'fight') {
      if (this.enemies.some((e) => e.chargeWarning)) {
        this.tip('charge', 'Red lane = a <b>Shield Rammer</b> is about to charge. Step out of the lane!', 5);
      }
      if (this.enemies.some((e) => e.telegraph > 0.2 && !e.def.charge && e.position.distanceTo(hero.position) < e.def.reach + 1.5)) {
        this.tip('dodge', 'Red ring = a skeleton is about to hit. Press <kbd>Space</kbd> to dodge!');
      }
      if (hero.hp < hero.maxHp * 0.6 && this.potions > 0) this.tip('potion', 'Hurt? Press <kbd>H</kbd> to drink a potion');
      if (this.kills >= 2) this.tip('special', 'Try your special move: <kbd>G</kbd>');
    }

    if (!hero.alive) this.lose();

    const ui = this.ui;
    ui.updateHud(
      hero.hp,
      hero.maxHp,
      hero.resource,
      this.potions,
      hero.def.abilities.map((_, i) => hero.cooldownFraction(i)),
      hero.cooldowns,
      this.maxPotions,
    );
  }

  private updateDead(dt: number): void {
    this.deadTimer += dt;
    this.runTimers(dt);
    this.updateEnemies(dt);
    this.updateProjectiles(dt);
    if (this.deadTimer > 1.8 && this.ui.screenName !== 'gameover') {
      this.ui.showHud(false);
      this.ui.clearWorldUi();
      this.ui.showGameOver(this.stats());
    }
  }

  private readInput(): void {
    const k = this.input;
    const move = this.heroInput.move.set(0, 0, 0);
    this.rig.axes(this.forward, this.right);
    if (k.key('KeyW') || k.key('ArrowUp')) move.add(this.forward);
    if (k.key('KeyS') || k.key('ArrowDown')) move.sub(this.forward);
    if (k.key('KeyD') || k.key('ArrowRight')) move.add(this.right);
    if (k.key('KeyA') || k.key('ArrowLeft')) move.sub(this.right);
    if (k.stick.lengthSq() > 0) move.addScaledVector(this.forward, k.stick.y).addScaledVector(this.right, k.stick.x);
    if (move.lengthSq() > 1) move.normalize();

    this.raycaster.setFromCamera(k.pointer, this.camera);
    const hasMouse = k.pointerActive && this.raycaster.ray.intersectPlane(this.floor, this.heroInput.aim) !== null;
    // Aim assist: snap to the best monster near where the player points, or the nearest one.
    const target = this.autoTarget(hasMouse ? this.heroInput.aim : null);
    const crystal = target ? null : this.nearCrystal(3.6);
    if (target) this.heroInput.aim.copy(target.position);
    // No monster close: swings aim at a cursed crystal within reach, so kids don't have to line up.
    else if (crystal) this.heroInput.aim.copy(crystal.at);
    else if (!hasMouse) {
      const dir = move.lengthSq() > 0.01 ? move : new THREE.Vector3(Math.sin(this.hero.facing), 0, Math.cos(this.hero.facing));
      this.heroInput.aim.copy(this.hero.position).add(dir);
    }
    // F (or J, or a click) attacks; holding keeps swinging.
    // Holding keeps swinging only while a monster is in reach and you aren't walking away,
    // so a held key never pins the hero in place.
    const holding = k.button(0) || k.key('KeyF') || k.key('KeyJ');
    const inReach = this.nearestEnemy(this.hero.position, 3.4) !== null;
    const walking = move.lengthSq() > 0.04;
    this.heroInput.attack =
      k.buttonPressed(0) || k.keyPressed('KeyF') || k.keyPressed('KeyJ') || (holding && inReach && !walking && this.hero.state === 'free');
    this.heroInput.secondary = k.rightTap || k.keyPressed('KeyK') || k.keyPressed('KeyG');
    this.heroInput.dodge = k.keyPressed('Space') || k.keyPressed('ShiftLeft');
    this.heroInput.special = k.keyPressed('KeyR');
    // Turning the camera: hold Q / E, or drag with the middle mouse button. Scroll to zoom.
    // Like Roblox: the left/right arrow keys turn the camera too.
    // Only deliberate turning: Q / E, or a real right-drag (see Input). Arrow keys walk.
    const turn = (k.key('KeyQ') ? 1 : 0) - (k.key('KeyE') ? 1 : 0) - k.look.x;
    // Dragging with the right (or middle) button up and down tilts the view (or a controller's right stick).
    this.camPitch = THREE.MathUtils.clamp(this.camPitch + k.dragY * 0.25 + k.look.y * 50 * this.lastDt, -22, 26);
    this.camYaw += turn * 90 * this.lastDt - k.dragX * 0.3;
    if (k.wheel) this.camZoom = THREE.MathUtils.clamp(this.camZoom * (1 + k.wheel * 0.05), 0.7, 1.35);
    if (turn || k.dragX) this.tipsShown.add('camera');
    // Look around: hold Tab and W A S D slides the view across the room instead of moving the hero.
    this.looking = k.key('Tab');
    if (this.looking) {
      this.camPan.addScaledVector(move, 14 * this.lastDt);
      const c = this.crypt;
      this.camPan.x = THREE.MathUtils.clamp(this.camPan.x, c.center.x - c.halfX - this.hero.position.x, c.center.x + c.halfX - this.hero.position.x);
      this.camPan.z = THREE.MathUtils.clamp(this.camPan.z, c.center.z - c.halfZ - this.hero.position.z, c.center.z + c.halfZ - this.hero.position.z);
      move.set(0, 0, 0);
      this.tipsShown.add('look');
    } else {
      this.camPan.multiplyScalar(Math.exp(-6 * this.lastDt));
    }
    const pressed = [this.heroInput.attack && k.buttonPressed(0), this.heroInput.secondary, this.heroInput.dodge, this.heroInput.special];
    pressed.forEach((p, i) => {
      if (p && this.hero.cooldowns[i] <= 0 && i > 0) this.ui.pulseSlot(i);
    });
  }

  // ───────────────────────── Enemies ─────────────────────────

  private updateEnemies(dt: number): void {
    const heroHidden = this.zones.some((z) => z.kind === 'smoke' && z.position.distanceTo(this.hero.position) < z.radius);
    const ctx = {
      target: this.hero.position,
      targetVisible: this.hero.alive && !heroHidden,
      others: this.enemies,
      strike: (e: Enemy) => this.enemyStrike(e),
      shoot: (e: Enemy, dir: THREE.Vector3) => this.enemyShoot(e, dir),
      path: (pos: THREE.Vector3, out: THREE.Vector3) => this.nav.direction(pos, out),
      mayAttack: (e: Enemy) => this.mayAttack(e),
      bump: (e: Enemy) => {
        this.shake(0.25);
        this.puff(e.position, 14);
        this.audio.play('block');
        this.floatAt(e.position, e.def.scale * 2.4, 'Dazed!', 'crit');
        this.tip('dazed', 'It hit the wall and is <b>dazed</b>! Now is your chance to hit it!', 4);
      },
    };
    // Refresh the walking map toward the hero a few times a second.
    this.navTimer -= dt;
    if (this.navTimer <= 0) {
      this.navTimer = 0.25;
      this.nav.update(this.hero.position);
    }
    for (const e of this.enemies) {
      e.update(dt, ctx);
      if (!e.alive) continue;
      if (e.burn > 0) {
        e.burn -= dt;
        e.burnTick -= dt;
        if (Math.random() < 0.5) this.glow.spawn({ x: e.position.x + (Math.random() - 0.5) * 0.6, y: 0.4 + Math.random() * 1.4, z: e.position.z + (Math.random() - 0.5) * 0.6, vy: 1.6, life: 0.5, size: 0.14, sizeEnd: 0.02, color: this.fireColor, intensity: 4 });
        if (e.burnTick <= 0) {
          e.burnTick = 0.5;
          const dealt = e.hurt(Math.round(e.burnDps * 0.5), e.position, 0);
          if (dealt > 0) this.floatAt(e.position, e.def.scale * 2, String(dealt), 'crit');
          if (!e.alive) {
            this.onEnemyDied(e);
            continue;
          }
        }
      }
      const bx = e.position.x;
      const bz = e.position.z;
      this.crypt.colliders.resolve(e.position, e.radius);
      // Pushed back by a wall or the altar: slide sideways around it, toward the hero.
      const cx = e.position.x - bx;
      const cz = e.position.z - bz;
      const push = Math.hypot(cx, cz);
      if (push > 1e-4 && e.state === 'chase') {
        const along = (-cz / push) * (this.hero.position.x - e.position.x) + (cx / push) * (this.hero.position.z - e.position.z);
        // Straight across the obstacle: keep going round the side it already chose.
        if (Math.abs(along) > 0.6) e.slide = Math.sign(along);
        const tx = (-cz / push) * e.slide;
        const tz = (cx / push) * e.slide;
        e.position.x += tx * e.def.speed * dt;
        e.position.z += tz * e.def.speed * dt;
        this.crypt.colliders.resolve(e.position, e.radius);
      }
      // Keep monsters from standing inside the hero.
      const dx = e.position.x - this.hero.position.x;
      const dz = e.position.z - this.hero.position.z;
      const min = e.radius + this.hero.radius;
      const d2 = dx * dx + dz * dz;
      if (!e.summoning && d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        e.position.x += (dx / d) * (min - d);
        e.position.z += (dz / d) * (min - d);
      }
    }
    // Remove the fallen once they have sunk away.
    this.enemies = this.enemies.filter((e) => {
      if (e.alive || e.deadTime < 3) return true;
      this.scene.remove(e.root);
      const ring = this.rings.get(e);
      if (ring) this.scene.remove(ring);
      this.rings.delete(e);
      const lane = this.lanes.get(e);
      if (lane) this.scene.remove(lane);
      this.lanes.delete(e);
      return false;
    });
  }

  private updateRings(): void {
    for (const [e, lane] of this.lanes) {
      const on = e.alive && e.chargeWarning;
      lane.visible = on;
      if (!on) continue;
      lane.position.set(e.position.x, 0.05, e.position.z);
      lane.rotation.y = e.facing;
      // Flickers faster as the charge gets close.
      const t = e.telegraph;
      (lane.material as THREE.MeshBasicMaterial).opacity = 0.35 + t * 0.55 + (t > 0.7 ? Math.sin(this.time * 40) * 0.1 : 0);
    }
    for (const [e, ring] of this.rings) {
      const on = e.alive && e.telegraph > 0 && !e.def.charge;
      ring.visible = on;
      if (!on) continue;
      const reach = e.def.ranged ? 1.1 : e.def.reach * 0.9;
      ring.position.set(e.position.x, 0.04, e.position.z);
      ring.scale.setScalar(reach * (0.55 + e.telegraph * 0.45));
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.25 + e.telegraph * 0.65;
    }
  }

  private enemyStrike(e: Enemy): void {
    if (e.def.kind === 'king') return this.kingSlam(e);
    const hero = this.hero;
    this.tmp.copy(hero.position).sub(e.position).setY(0);
    const dist = this.tmp.length();
    const facing = new THREE.Vector3(Math.sin(e.facing), 0, Math.cos(e.facing));
    const inArc = dist < 1.1 || this.tmp.normalize().dot(facing) > 0.15;
    this.audio.play('swing');
    if (dist > e.def.reach + hero.radius || !inArc || !hero.alive) return;
    const before = hero.hp;
    this.damageHero(e.def.damage * this.difficulty.enemyDamage, e.position);
    if (hero.hp < before && this.lvl('thorns') && e.alive) {
      const back = e.hurt(12 * this.lvl('thorns'), hero.position, 1.5);
      if (back > 0) this.floatAt(e.position, e.def.scale * 2.2, `${back} Thorns`, 'heal');
      if (!e.alive) this.onEnemyDied(e);
    }
    if (e.def.kind === 'brute') this.shake(0.3);
  }

  /** A ground slam that hits everything inside the red ring; in phase two it also throws bones. */
  private kingSlam(king: Enemy): void {
    const hero = this.hero;
    this.shake(0.45);
    this.audio.play('hurt');
    this.ring(king.position.clone().setY(0.3), king.def.reach, 70);
    this.puff(king.position, 24);
    const dist = Math.hypot(hero.position.x - king.position.x, hero.position.z - king.position.z);
    if (hero.alive && dist < king.def.reach * 0.9 + hero.radius) {
      this.damageHero(king.def.damage * this.difficulty.enemyDamage, king.position);
    }
    if (king.animSpeed > 1) {
      const n = this.difficulty.id === 'easy' ? 6 : 10;
      const spin = Math.random() * Math.PI;
      for (let i = 0; i < n; i++) {
        const a = spin + (i / n) * Math.PI * 2;
        this.enemyShoot(king, new THREE.Vector3(Math.sin(a), 0, Math.cos(a)), 6.5);
      }
    }
  }

  private enemyShoot(e: Enemy, dir: THREE.Vector3, speed?: number): void {
    const color = new THREE.Color(e.def.eyes);
    const mesh = this.orb(color, 2.6);
    mesh.scale.setScalar(1.4);
    mesh.position.copy(e.position).setY(1.3).addScaledVector(dir, 0.9);
    this.scene.add(mesh);
    this.audio.play('cast');
    this.projectiles.push({
      mesh,
      velocity: dir.clone().multiplyScalar(speed ?? e.def.ranged!.projectileSpeed),
      damage: (e.def.kind === 'king' ? 10 : e.def.damage) * this.difficulty.enemyDamage,
      radius: 0.35,
      life: 3,
      hostile: true,
      color,
      heal: 0,
      hit: new Set(),
      pierce: false,
    });
  }

  private damageHero(amount: number, from: THREE.Vector3): void {
    const hero = this.hero;
    if (hero.invulnerable > 0) {
      this.floatAt(hero.position, 2.4, 'Dodged!', 'info');
      return;
    }
    const taken = hero.takeHit(amount);
    if (taken <= 0) {
      this.floatAt(hero.position, 2.4, 'Blocked', 'block');
      this.audio.play('block');
      return;
    }
    this.floatAt(hero.position, 2.3, `-${Math.round(taken)}`, 'hurt');
    this.audio.play('hurt');
    this.shake(0.22);
    this.burst(hero.position.clone().setY(1.1), this.red, 14, 2.5);
    // A short grace period so a crowd can't chain hits.
    hero.invulnerable = Math.max(hero.invulnerable, 0.45);
    this.tmp.copy(hero.position).sub(from).setY(0).normalize();
    hero.velocity.addScaledVector(this.tmp, 4);
    // Doctor: Auto-Heal.
    const passive = hero.def.passive;
    if (hero.alive && hero.def.id === 'doctor' && Math.random() < passive.chance) {
      this.later(0.35, () => this.healHero(12 + Math.random() * 10, true, 'Auto-Heal'));
    }
  }

  private hitEnemy(e: Enemy, amount: number, from: THREE.Vector3, knockback: number, quiet = false): boolean {
    const hero = this.hero;
    let damage = amount;
    let crit = false;
    if (hero.def.id === 'warrior' && Math.random() < hero.def.passive.chance) {
      damage *= 2.2;
      crit = true;
    }
    damage *= 1 + 0.25 * this.lvl('mighty');
    damage = Math.round(damage * (0.9 + Math.random() * 0.2));
    const dealt = e.hurt(damage, from, crit ? knockback * 1.8 : knockback);
    if (dealt < 0) return false;
    const head = e.def.scale * 2.2;
    if (dealt === 0) {
      this.floatAt(e.position, head, 'Blocked', 'block');
      this.audio.play('block');
      return true;
    }
    this.floatAt(e.position, head, crit ? `${dealt} Crushing Blow!` : String(dealt), crit ? 'crit' : 'damage');
    this.burst(e.position.clone().setY(1.1 * e.def.scale), crit ? this.gold : this.white, crit ? 26 : 10, crit ? 4.5 : 3);
    if (!quiet) this.audio.play(crit ? 'crit' : 'hit');
    this.hitStop = Math.max(this.hitStop, crit ? 0.09 : 0.045);
    if (crit) this.shake(0.25);
    hero.resource = Math.min(100, hero.resource + 3);
    if (this.lvl('vampire')) this.healHero(2 * this.lvl('vampire'), false);
    if (this.lvl('fire') && e.alive) {
      e.burn = 3;
      e.burnDps = 6 * this.lvl('fire');
    }
    if (!e.alive) this.onEnemyDied(e);
    // Thief: Surprise Attack.
    else if (hero.def.id === 'thief' && Math.random() < hero.def.passive.chance) {
      this.later(0.12, () => {
        if (!e.alive) return;
        const extra = e.hurt(Math.round(amount * 0.6), from, 0.5);
        if (extra > 0) {
          this.floatAt(e.position, head + 0.4, `${extra} Surprise!`, 'crit');
          this.audio.play('hit');
          if (!e.alive) this.onEnemyDied(e);
        }
      });
    }
    return true;
  }

  private onEnemyDied(e: Enemy): void {
    this.kills++;
    const worth = { runt: 2, skeleton: 3, mage: 4, brute: 6, charger: 4, king: 60 }[e.def.kind] + (e.elite ? 10 : 0);
    this.dropCoins(e.position, worth);
    this.audio.play('bones');
    this.puff(e.position, 18);
    this.burst(e.position.clone().setY(1), this.gold, 18, 3);
    if (e.elite) {
      this.burst(e.position.clone().setY(1.2), this.gold, 50, 5);
      this.shake(0.3);
      this.later(0.5, () => this.dropPotion(e.position.clone().setY(0)));
    } else if (Math.random() < this.difficulty.potionDrop + 0.15 * this.lvl('lucky')) {
      this.later(0.5, () => this.dropPotion(e.position.clone().setY(0)));
    }
  }

  /**
   * Picks what an attack should aim at. Monsters close to the hero always win;
   * further ones count when they are roughly where the mouse points.
   */
  private autoTarget(pointer: THREE.Vector3 | null): Enemy | null {
    const hero = this.hero.position;
    let best: Enemy | null = null;
    let bestScore = Infinity;
    const want = pointer ? this.tmp.copy(pointer).sub(hero).setY(0) : null;
    if (want && want.lengthSq() > 0.01) want.normalize();
    for (const e of this.enemies) {
      if (!e.active) continue;
      const dx = e.position.x - hero.x;
      const dz = e.position.z - hero.z;
      const d = Math.hypot(dx, dz);
      if (d > 11) continue;
      let score = d;
      if (want && d > 3.2) {
        const cos = (dx * want.x + dz * want.z) / Math.max(d, 0.001);
        if (cos < Math.cos(THREE.MathUtils.degToRad(40))) continue;
        score += (1 - cos) * 6;
      }
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  /**
   * Attack tickets: only a few monsters may swing at once (one on Easy), the
   * rest circle and wait. Fights stay readable and fair even with a crowd.
   */
  private mayAttack(e: Enemy): boolean {
    const limit = this.difficulty.id === 'easy' ? 1 : this.difficulty.id === 'normal' ? 2 : 3;
    let busy = 0;
    for (const o of this.enemies) if (o !== e && o.alive && (o.state === 'windup' || o.state === 'recover' || o.state === 'charge')) busy++;
    return busy < limit;
  }

  private darkenForOpening(): void {
    this.dark = 1;
    this.crypt.torches.lit = 0;
    // Straight ahead of where the hero lands, so it's the first thing you see.
    const p = this.crypt.heroStart.clone().add(new THREE.Vector3(0, 0, -3.6));
    const light = new THREE.PointLight('#ff9a3c', 0, 9, 2);
    light.position.copy(p).setY(1.4);
    this.scene.add(light);
    // A standing torch, cold until the hero lights it.
    const torch = new THREE.Group();
    const model = this.assets.piece('torch_lit');
    // Cold and charred until lit: dark copies of its materials, swapped back on lighting.
    const swaps: { mesh: THREE.Mesh; lit: THREE.Material }[] = [];
    model.traverse((o) => {
      o.castShadow = true;
      if (o instanceof THREE.Mesh) {
        const cold = (o.material as THREE.MeshStandardMaterial).clone();
        cold.color.set('#2c2a2a');
        cold.emissive.set('#000000');
        cold.map = null;
        swaps.push({ mesh: o, lit: o.material as THREE.Material });
        o.material = cold;
      }
    });
    this.brazierSwaps = swaps;
    torch.add(model);
    torch.position.copy(p);
    torch.scale.setScalar(1.9);
    light.add(torch);
    torch.position.set(0, -1.4, 0);
    this.brazier = { position: p, lit: false, light };
    this.ui.objective('It\'s dark… Light the torch');
  }

  /** The unlit torch by the entrance: press F next to it to light it, then the hall lights up. */
  private updateBrazier(dt: number): void {
    const b = this.brazier;
    if (!b) return;
    const t = this.time;
    const near = b.position.distanceTo(this.hero.position) < 2.4;
    if (!b.lit) {
      // Unlit: no flame, but warm embers smoulder in it. The warmest, brightest thing in the
      // dark room, so the eye goes straight to it (warm light leads the player).
      b.light.color.set('#ff6a1f');
      b.light.intensity = 4.5 + Math.sin(t * 2.3) * 1.2 + Math.sin(t * 7.1) * 0.6;
      if (Math.random() < 0.35) this.glow.spawn({ x: b.position.x + (Math.random() - 0.5) * 0.4, y: 1.3, z: b.position.z + (Math.random() - 0.5) * 0.4, vy: 0.5 + Math.random() * 0.5, vx: (Math.random() - 0.5) * 0.2, life: 1.1, size: 0.07, sizeEnd: 0.01, color: this.fireColor, intensity: 3 });
      if (Math.random() < 0.12) this.dust.spawn({ x: b.position.x, y: 1.7, z: b.position.z, vy: 0.5, vx: (Math.random() - 0.5) * 0.2, life: 2.2, size: 0.25, sizeEnd: 0.8, color: this.smokeColor, intensity: 0.35, drag: 0.4 });
      if (near) this.tip('torch', 'Press <kbd>F</kbd> to light the torch', 8);
      if (near && (this.input.keyPressed('KeyF') || this.input.keyPressed('KeyJ') || this.input.buttonPressed(0))) {
        b.lit = true;
        this.openingDone = true;
        for (const sw of this.brazierSwaps) sw.mesh.material = sw.lit;
        b.light.color.set('#ff9a3c');
        this.ui.hint(null);
        this.audio.play('cast');
        this.later(0.2, () => this.audio.play('clear'));
        this.burst(b.position.clone().setY(1.4), this.fireColor, 60, 4);
        this.ui.objective('Follow the golden arrow to the altar');
        this.later(0.8, () => this.ui.banner(`Hall 1 of ${PILLAR_HALLS}`, LEVELS[this.level].hall, `Guarding the Pillar of ${PILLARS[0].name}`));
      }
      return;
    }
    // Lit: a real fire, and the room comes back to light torch by torch.
    b.light.intensity = 14 + Math.sin(t * 13) * 2;
    for (let i = 0; i < 2; i++) this.glow.spawn({ x: b.position.x + (Math.random() - 0.5) * 0.3, y: 1.0 + Math.random() * 0.4, z: b.position.z + (Math.random() - 0.5) * 0.3, vy: 1.6 + Math.random(), life: 0.5, size: 0.22, sizeEnd: 0.04, color: Math.random() < 0.4 ? this.gold : this.fireColor, intensity: 4 });
    if (this.dark > 0) {
      this.dark = Math.max(0, this.dark - dt * 0.55);
      this.crypt.torches.lit = 1 - this.dark;
      this.applyDarkness();
    }
  }

  /** Dims the room's ambient light by `this.dark` (0 = normal). */
  private applyDarkness(): void {
    const m = this.mood;
    const k = 1 - this.dark * 0.62;
    this.hemi.intensity = m.hemi.intensity * k;
    this.moon.intensity = m.moon.intensity * k;
    this.scene.environmentIntensity = m.environment * k;
    this.crypt.runes.setColor(m.rune.color, m.rune.intensity * (1 - this.dark));
  }

  /** The bag of coins dropped when the hero fell: glowing where it lies, walk over it to get them back. */
  private placeLostTreasure(): void {
    const lost = this.lost;
    if (!lost || lost.level !== this.level) return;
    const p = lost.spot.clone();
    for (let i = 0; i < 20 && this.crypt.colliders.hits(p.x, p.z, 0.7); i++) p.multiplyScalar(0.92);
    lost.spot.copy(p);
    const object = new THREE.Group();
    // A little pile of gold: reads as "your coins" at a glance.
    for (const [name, x, z, r] of [['coin_stack_large', 0, 0, 0.3], ['coin_stack_medium', 0.55, 0.35, 1.2], ['coin_stack_small', -0.5, 0.3, 2.1]] as [string, number, number, number][]) {
      const pile = this.assets.piece(name);
      pile.position.set(x, 0, z);
      pile.rotation.y = r;
      pile.traverse((o) => {
        o.castShadow = true;
      });
      object.add(pile);
    }
    const light = new THREE.PointLight('#ffd23a', 6, 5, 2);
    light.position.y = 2.4;
    object.add(light);
    object.position.copy(p);
    this.scene.add(object);
    lost.object = object;
    this.later(1.2, () => this.ui.hint(`Your <b>${lost.coins} coins</b> fell where you did. Go and get them back!`, 6));
  }

  private updateLostTreasure(): void {
    const lost = this.lost;
    if (!lost?.object) return;
    const p = lost.spot;
    if (Math.random() < 0.5) this.glow.spawn({ x: p.x + (Math.random() - 0.5) * 0.8, y: 0.3, z: p.z + (Math.random() - 0.5) * 0.8, vy: 2.2, life: 1, size: 0.12, sizeEnd: 0.02, color: this.gold, intensity: 3 });
    if (p.distanceTo(this.tmp.copy(this.hero.position).setY(0)) > 1.4) return;
    this.scene.remove(lost.object);
    this.coins += lost.coins;
    this.ui.setCoins(this.coins, true);
    this.audio.play('chest');
    this.burst(p.clone().setY(1), this.gold, 50, 4);
    this.floatAt(p, 2.2, `Treasure recovered! +${lost.coins}`, 'crit');
    this.lost = null;
  }

  /** The hall's treasure chest: locked until the hall is cleared, then walk up to open it. */
  private placeChest(): void {
    const spot = this.crypt.chest;
    const object = new THREE.Group();
    const piece = this.assets.piece('chest_gold');
    piece.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    object.add(piece);
    object.position.copy(spot.position);
    object.rotation.y = spot.facing;
    this.scene.add(object);
    const p = spot.position;
    const box = { minX: p.x - 0.8, maxX: p.x + 0.8, minZ: p.z - 0.55, maxZ: p.z + 0.55 };
    this.crypt.colliders.boxes.push(box);
    this.chest = { object, box, position: p.clone(), opened: false };
    this.nav = new NavGrid(this.crypt.colliders);
  }

  private updateChest(): void {
    const chest = this.chest;
    if (!chest || chest.opened) return;
    const near = chest.position.distanceTo(this.hero.position) < 2.2;
    const ready = this.step === 'cleared';
    if (ready && Math.random() < 0.3) {
      this.glow.spawn({ x: chest.position.x + (Math.random() - 0.5) * 1.4, y: 0.6 + Math.random() * 0.6, z: chest.position.z + (Math.random() - 0.5) * 0.8, vy: 1, life: 0.9, size: 0.1, sizeEnd: 0.01, color: this.gold, intensity: 3 });
    }
    if (!near) return;
    if (!ready) {
      this.tip('chest-locked', 'A treasure chest! It opens once the hall is cleared.');
      return;
    }
    chest.opened = true;
    this.audio.play('chest');
    this.shake(0.2);
    this.burst(chest.position.clone().setY(1.2), this.gold, 70, 5);
    chest.object.scale.set(1.15, 0.85, 1.15);
    this.later(0.15, () => chest.object.scale.setScalar(1));
    const out = chest.position.z > 0 ? -1 : 1;
    this.dropCoins(chest.position.clone().add(new THREE.Vector3(0, 0, out)), 12 + this.stage * 4);
    if (Math.random() < 0.6) this.later(0.4, () => this.dropPotion(chest.position.clone().add(new THREE.Vector3(1.4, 0, out * 1.2))));
    this.floatAt(chest.position, 2, 'Treasure!', 'crit');
  }

  /** Coins spill out, bounce, then fly to the hero when close (no chasing them around). */
  private dropCoins(at: THREE.Vector3, count: number): void {
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.coinGeometry, this.coinMaterial);
      mesh.castShadow = true;
      mesh.position.set(at.x, 0.8, at.z);
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 2.5;
      this.scene.add(mesh);
      this.coinsOnFloor.push({ mesh, velocity: new THREE.Vector3(Math.cos(a) * sp, 4 + Math.random() * 2, Math.sin(a) * sp), age: 0 });
    }
  }

  private coinStreak = 0;
  private coinStreakTimer = 0;

  private updateCoins(dt: number): void {
    const hero = this.hero.position;
    let got = 0;
    this.coinsOnFloor = this.coinsOnFloor.filter((c) => {
      c.age += dt;
      const p = c.mesh.position;
      const d = Math.hypot(hero.x - p.x, hero.z - p.z);
      if (c.age > 0.5 && d < 3.2) {
        const pull = 14 * dt;
        p.x += (hero.x - p.x) * Math.min(1, pull / Math.max(d, 0.3));
        p.z += (hero.z - p.z) * Math.min(1, pull / Math.max(d, 0.3));
        p.y += (1 - p.y) * Math.min(1, dt * 8);
      } else {
        c.velocity.y -= 18 * dt;
        p.addScaledVector(c.velocity, dt);
        if (p.y < 0.12) {
          p.y = 0.12;
          c.velocity.y = Math.abs(c.velocity.y) * 0.35;
          c.velocity.x *= 0.6;
          c.velocity.z *= 0.6;
        }
        this.crypt.colliders.resolve(p, 0.2);
      }
      c.mesh.rotation.set(Math.PI / 2, 0, c.age * 6);
      if (c.age > 0.5 && d < 0.7) {
        this.scene.remove(c.mesh);
        got++;
        return false;
      }
      return true;
    });
    this.coinStreakTimer -= dt;
    if (this.coinStreakTimer <= 0) this.coinStreak = 0;
    if (got) {
      this.coins += got;
      this.ui.setCoins(this.coins, true);
      this.audio.coin(this.coinStreak);
      this.coinStreak += got;
      this.coinStreakTimer = 0.7;
      this.burst(this.hero.position.clone().setY(1.1), this.gold, 6 * got, 2.2);
      this.tip('coins', 'Coins! Spend them at the <b>merchant</b> who comes after each hall.');
    }
  }

  /** A monster asleep in an ambush room the hero hasn't entered yet. */
  private waitingInAmbush(e: Enemy): boolean {
    return this.ambushes.some((a) => !a.sprung && a.monsters.includes(e));
  }

  /** Walking into an ambush room wakes its monsters. */
  private updateAmbushes(): void {
    const p = this.hero.position;
    for (const a of this.ambushes) {
      const r = a.encounter.room;
      if (a.sprung || p.x < r.x0 + 1 || p.x > r.x1 - 1 || p.z < r.z0 + 1 || p.z > r.z1 - 1) continue;
      a.sprung = true;
      this.ui.hint(a.encounter.shout, 3.5);
      this.shake(0.15);
      a.monsters.forEach((e, i) => {
        this.later(0.2 + i * 0.3, () => {
          if (!e.alive) return;
          this.summon(e);
        });
      });
    }
  }

  /** Spike traps: a sharp poke and a hop back if the hero steps on one. */
  private updateHazards(dt: number): void {
    this.hazardCooldown -= dt;
    const hero = this.hero;
    if (!hero.alive || this.hazardCooldown > 0) return;
    const p = hero.position;
    const trap = this.crypt.hazards.find((h) => Math.abs(p.x - h.x) < h.half && Math.abs(p.z - h.z) < h.half);
    if (!trap) return;
    this.hazardCooldown = 0.8;
    this.tip('spikes', 'Ouch! Watch out for spike traps on the floor.');
    this.damageHero(8 * Math.max(0.5, this.difficulty.enemyDamage), new THREE.Vector3(trap.x, 0, trap.z));
  }

  private lvl(id: keyof typeof BLESSINGS): number {
    return this.blessings[id] ?? 0;
  }

  private get maxPotions(): number {
    return MAX_POTIONS + this.lvl('pouch');
  }

  /** Puts the chosen blessings' effects on the hero (after a new hero is made). */
  private applyBlessings(): void {
    const hero = this.hero;
    hero.speedBoost = 1 + 0.12 * this.lvl('swift');
    hero.dodgeRecharge = Math.max(0.4, 1 - 0.2 * this.lvl('swift'));
    hero.powerRecharge = Math.max(0.3, 1 - 0.25 * this.lvl('surge'));
    hero.maxHp = hero.def.maxHp + 30 * this.lvl('heart') + this.bonusHp;
    hero.hp = Math.min(hero.hp, hero.maxHp);
  }

  private offerPaths(): void {
    const used = new Set(this.route.slice(0, this.stage + 1));
    const open = PATH_POOL.filter((l) => !used.has(l)).sort(() => Math.random() - 0.5);
    const halls = open.slice(0, 2);
    if (halls.length < 2) return;
    const rewards = (['potions', 'coins', 'heal'] as PathReward[]).sort(() => Math.random() - 0.5);
    this.choosing = true;
    this.audio.play('pillar');
    this.ui.showPaths(
      halls.map((l, i) => ({ name: LEVELS[l].hall, blurb: LEVELS[l].blurb ?? '', color: LEVELS[l].crystal, reward: rewards[i] })),
      (i) => {
        this.route[this.stage + 1] = halls[i];
        this.pathReward = rewards[i];
        this.choosing = false;
        this.input.clear();
        this.ui.hideScreen();
        this.audio.play('start');
      },
    );
  }

  /** Gives the reward the chosen door promised. */
  private givePathReward(): void {
    const r = this.pathReward;
    this.pathReward = null;
    if (!r) return;
    const hero = this.hero;
    let text = '';
    if (r === 'potions') {
      this.potions = Math.min(this.maxPotions, this.potions + 2);
      text = '+2 potions';
    } else if (r === 'coins') {
      this.coins += 40;
      this.ui.setCoins(this.coins, true);
      text = '+40 coins';
    } else {
      hero.hp = hero.maxHp;
      text = 'Full health!';
    }
    this.audio.play('chest');
    this.burst(hero.position.clone().setY(1.2), this.gold, 40, 4);
    this.floatAt(hero.position, 3.2, `Path reward: ${text}`, 'heal');
  }

  private offerBlessings(): void {
    if (this.phase !== 'play' || !this.hero.alive) return;
    const options = rollBlessings(this.blessings);
    if (!options.length) return;
    this.choosing = true;
    this.ui.prompt(null);
    this.ui.hint(null);
    this.audio.play('pillar');
    this.ui.showBlessings(options, this.blessings, (b: Blessing) => this.takeBlessing(b));
  }

  private takeBlessing(b: Blessing): void {
    this.blessings[b.id] = (this.blessings[b.id] ?? 0) + 1;
    this.applyBlessings();
    const hero = this.hero;
    if (b.id === 'heart') hero.hp = hero.maxHp;
    if (b.id === 'pouch') this.potions = Math.min(this.maxPotions, this.potions + 2);
    this.choosing = false;
    this.input.clear();
    this.ui.hideScreen();
    this.ui.setHero(hero.def, this.heroName, hero.maxHp);
    this.ui.setQuest(this.level, this.pillars, this.stage);
    this.ui.objective('Follow the arrow to the golden door');
    this.ui.setBlessings(this.blessings, BLESSINGS);
    this.ui.setCoins(this.coins, false);
    this.audio.play('start');
    this.burst(hero.position.clone().setY(1.2), new THREE.Color(b.color), 60, 4);
    this.floatAt(hero.position, 2.8, b.name + '!', 'heal');
    this.saveProgress();
  }

  /** Teaches something once, the first time it matters. */
  private tip(id: string, html: string, seconds = 5): void {
    if (this.tipsShown.has(id)) return;
    this.tipsShown.add(id);
    this.ui.hint(html, seconds);
  }

  /** Easy mode drinks a potion by itself when health runs low. */
  private autoPotion(dt: number): void {
    this.autoPotionCooldown -= dt;
    const hero = this.hero;
    if (this.difficulty.id !== 'easy' || !hero.alive || this.potions <= 0 || this.autoPotionCooldown > 0) return;
    if (hero.hp > hero.maxHp * 0.3) return;
    this.autoPotionCooldown = 4;
    this.floatAt(hero.position, 2.8, 'Auto potion!', 'heal');
    this.drinkPotion();
  }

  private makeArrow(): THREE.Mesh {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.55);
    shape.lineTo(0.42, 0);
    shape.lineTo(0.18, 0);
    shape.lineTo(0.18, -0.45);
    shape.lineTo(-0.18, -0.45);
    shape.lineTo(-0.18, 0);
    shape.lineTo(-0.42, 0);
    shape.closePath();
    const geometry = new THREE.ShapeGeometry(shape);
    geometry.rotateX(-Math.PI / 2);
    geometry.rotateY(Math.PI);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffc35a').multiplyScalar(1.6), transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
    );
    mesh.renderOrder = 2;
    return mesh;
  }

  /** The golden arrow on the floor that points at the next thing to do. */
  private updateArrow(dt: number): void {
    const hero = this.hero;
    let goal: THREE.Vector3 | null = null;
    let color = '#ffc35a';
    if (this.brazier && !this.brazier.lit) goal = this.brazier.position;
    else if (this.step === 'explore' && this.jobLeft() > 0) goal = this.nearestJobItem()?.at ?? null;
    else if (this.step === 'explore') goal = this.crypt.altar.position;
    else if (this.step === 'cleared' && this.crypt.door.isOpen) goal = this.crypt.doorAt.clone().add(new THREE.Vector3(0, 0, 1));
    else if (this.step === 'fight') {
      // Only when every monster is far away, point to one. Stick with the same
      // monster until it dies, so the arrow doesn't flick between them.
      const t = this.arrowTarget;
      if (!t || !t.alive || !t.active) this.arrowTarget = this.nearestEnemy(hero.position, 7) ? null : this.nearestEnemy(hero.position, 40);
      const far = this.arrowTarget;
      if (far && far.position.distanceTo(hero.position) > 6) {
        goal = far.position;
        color = '#ff5a4a';
      }
    } else this.arrowTarget = null;
    // Show/hide with a gap between the two distances, so it doesn't blink on and off at the edge.
    const d = goal ? hero.position.distanceTo(goal) : 0;
    if (!goal || !hero.alive || d < 3.6) this.arrowShown = false;
    else if (d > 4.6) this.arrowShown = true;
    const mat = this.arrow.material as THREE.MeshBasicMaterial;
    // A slow, gentle breathe instead of a fast flash.
    mat.opacity = THREE.MathUtils.damp(mat.opacity, this.arrowShown ? 0.72 + Math.sin(this.time * 2) * 0.08 : 0, 6, dt);
    if (!goal) return;
    this.arrowColor.set(color).multiplyScalar(1.6);
    mat.color.lerp(this.arrowColor, 1 - Math.exp(-6 * dt));
    let dir = this.tmp.copy(goal).sub(hero.position).setY(0).normalize();
    // Follow the walking path around pillars and through doorways, not a straight line.
    {
      if (!this.guideNav || this.guideNav.grid !== this.crypt || this.guideGoal.distanceToSquared(goal) > 4 || (this.guideTimer -= dt) < 0) {
        if (!this.guideNav || this.guideNav.grid !== this.crypt) this.guideNav = { grid: this.crypt, nav: new NavGrid(this.crypt.colliders, 0.7) };
        this.guideNav.nav.update(goal);
        this.guideGoal.copy(goal);
        this.guideTimer = 1;
      }
      const step = this.guideNav.nav.lookAhead(hero.position, this.guideDir, 6);
      if (step) dir = this.tmp.copy(step);
    }
    // Turn smoothly toward the new direction (the walking map gives steps in
    // 45-degree jumps; snapping to them is what made it look glitchy).
    const want = Math.atan2(dir.x, dir.z);
    if (mat.opacity < 0.05) this.arrowYaw = want;
    else {
      let diff = want - this.arrowYaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.arrowYaw += diff * (1 - Math.exp(-5 * dt));
    }
    const ax = Math.sin(this.arrowYaw);
    const az = Math.cos(this.arrowYaw);
    const ring = 2.9 + Math.sin(this.time * 2) * 0.12;
    // Floats just above the altar's steps so they can't hide it.
    this.arrow.position.set(hero.position.x + ax * ring, 0.62, hero.position.z + az * ring);
    this.arrow.rotation.y = this.arrowYaw;
    this.arrow.scale.setScalar(1.7);
  }

  private nearestEnemy(from: THREE.Vector3, within: number): Enemy | null {
    let best: Enemy | null = null;
    let bestD = within;
    for (const e of this.enemies) {
      if (!e.active) continue;
      const d = e.position.distanceTo(from);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  // ───────────────────────── Hero actions ─────────────────────────

  private onMelee(step: ComboStep, index: number): void {
    const hero = this.hero;
    const f = hero.facing;
    const p = hero.position;
    const dir = new THREE.Vector3(Math.sin(f), 0, Math.cos(f));
    this.audio.play('swing');
    for (let i = 0; i < 22; i++) {
      const a = f + (Math.random() - 0.5) * step.arc;
      const r = step.range * 0.75 * (0.6 + Math.random() * 0.5);
      this.glow.spawn({
        x: p.x + Math.sin(a) * r,
        y: 0.9 + Math.random() * 0.8,
        z: p.z + Math.cos(a) * r,
        vx: Math.sin(a) * 3,
        vy: Math.random() * 1.5,
        vz: Math.cos(a) * 3,
        life: 0.22 + Math.random() * 0.2,
        size: 0.12,
        sizeEnd: 0.02,
        color: Math.random() < 0.3 ? this.heroHot : this.heroColor,
        intensity: 4,
        drag: 4,
      });
    }
    const finisher = index === 2;
    for (const e of this.enemies) {
      if (!e.active) continue;
      this.tmp.copy(e.position).sub(p).setY(0);
      const dist = this.tmp.length() - e.radius;
      if (dist > step.range) continue;
      // Generous: anything touching the hero counts, the cone covers the rest.
      if (dist > 0.6 && this.tmp.normalize().dot(dir) < Math.cos(step.arc / 2)) continue;
      this.hitEnemy(e, step.damage, p, finisher ? 4.5 : 2.2);
    }
    this.smashCrates(p, step.range + 0.6, dir, step.arc);
    this.hitCrystals(p, step.range + 0.9, dir, step.arc);
    if (finisher) this.shake(0.18);
  }

  private onCast(ability: Ability, aim: THREE.Vector3): void {
    const hero = this.hero;
    const p = hero.position.clone().setY(1.2);
    const kind = ability.kind;
    const dir = aim.clone().sub(hero.position).setY(0);
    if (dir.lengthSq() < 0.01) dir.set(Math.sin(hero.facing), 0, Math.cos(hero.facing));
    dir.normalize();
    const slot = hero.def.abilities.indexOf(ability);
    if (slot > 0) this.ui.pulseSlot(slot);

    switch (kind.type) {
      case 'whirl':
      case 'nova': {
        this.ring(p, kind.radius, kind.type === 'nova' ? 90 : 60);
        this.shake(0.3);
        this.audio.play(kind.type === 'nova' ? 'cast' : 'swing');
        for (const e of this.enemies) {
          if (!e.active || e.position.distanceTo(hero.position) > kind.radius + e.radius) continue;
          this.hitEnemy(e, kind.damage, hero.position, kind.type === 'nova' ? 6 : 3.5);
        }
        this.smashCrates(hero.position, kind.radius + 0.6);
        this.hitCrystals(hero.position, kind.radius + 0.9);
        break;
      }
      case 'bolt': {
        const color = this.heroColor.clone();
        const mesh = this.orb(color, 3);
        mesh.position.copy(p).addScaledVector(dir, 0.8);
        this.scene.add(mesh);
        this.audio.play('cast');
        this.projectiles.push({
          mesh,
          velocity: dir.clone().multiplyScalar(kind.projectileSpeed),
          damage: kind.damage,
          radius: 0.45,
          life: 1.4,
          hostile: false,
          color,
          heal: kind.heal ?? 0,
          hit: new Set(),
          pierce: false,
        });
        break;
      }
      case 'fan': {
        this.audio.play('swing');
        for (let i = 0; i < kind.knives; i++) {
          const a = Math.atan2(dir.x, dir.z) + (i / (kind.knives - 1) - 0.5) * kind.spread;
          const v = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
          const mesh = new THREE.Mesh(this.knifeGeometry, new THREE.MeshBasicMaterial({ color: this.heroHot.clone().multiplyScalar(2.5), toneMapped: false }));
          mesh.position.copy(p).addScaledVector(v, 0.6);
          mesh.rotation.y = a;
          this.scene.add(mesh);
          this.projectiles.push({
            mesh,
            velocity: v.multiplyScalar(22),
            damage: kind.damage,
            radius: 0.4,
            life: 0.55,
            hostile: false,
            color: this.heroColor,
            heal: 0,
            hit: new Set(),
            pierce: true,
          });
        }
        break;
      }
      case 'sanctuary':
        this.addZone('sanctuary', hero.position.clone(), kind.radius, kind.duration, kind.healPerSecond, kind.damagePerSecond);
        this.audio.play('cast');
        break;
      case 'smoke':
        this.addZone('smoke', hero.position.clone(), kind.radius, kind.duration, 0, 0);
        for (let i = 0; i < 60; i++) this.puff(hero.position, 1);
        this.audio.play('cast');
        break;
      case 'guard':
        hero.buff = kind.duration;
        this.burst(p, this.heroColor, 30, 2);
        this.floatAt(hero.position, 2.5, 'Shield up!', 'info');
        this.audio.play('block');
        break;
      case 'barrier':
        hero.buff = kind.duration;
        hero.barrier = kind.absorb;
        this.burst(p, this.heroColor, 40, 2.5);
        this.floatAt(hero.position, 2.5, 'Protected!', 'info');
        this.audio.play('cast');
        break;
      case 'renew':
        this.renew.left = kind.duration;
        this.renew.rate = kind.heal / kind.duration;
        this.burst(p, this.heal, 40, 2);
        this.floatAt(hero.position, 2.5, 'Healing Prayer', 'heal');
        this.audio.play('potion');
        break;
      default:
        break;
    }
  }

  private onDash(kind: 'roll' | 'shadowstep' | 'blink', from: THREE.Vector3, to: THREE.Vector3): void {
    // Stop the dash at the first wall, so a quick step can never skip through one.
    const r = this.hero.radius;
    const dir = this.tmp.copy(to).sub(from).setY(0);
    const len = dir.length();
    if (len > 0.01) {
      dir.divideScalar(len);
      let safe = 0;
      for (let d = 0.2; d <= len + 1e-6; d += 0.2) {
        if (this.crypt.colliders.hits(from.x + dir.x * d, from.z + dir.z * d, r * 0.9)) break;
        safe = d;
      }
      to.set(from.x + dir.x * safe, to.y, from.z + dir.z * safe);
    }
    this.ui.pulseSlot(2);
    const steps = kind === 'roll' ? 8 : 18;
    for (let i = 0; i <= steps; i++) {
      const p = from.clone().lerp(to, i / steps);
      this.dust.spawn({
        x: p.x + (Math.random() - 0.5) * 0.4,
        y: 0.15,
        z: p.z + (Math.random() - 0.5) * 0.4,
        vy: 0.3,
        life: 0.6,
        size: 0.35,
        sizeEnd: 0.6,
        color: this.dustColor,
        intensity: 0.5,
        drag: 2,
      });
    }
    if (kind !== 'roll') {
      this.burst(from.clone().setY(1), this.heroColor, 30, 3);
      if (kind === 'blink') this.burst(to.clone().setY(1), this.heroColor, 30, 3);
    }
  }

  private drinkPotion(): void {
    const hero = this.hero;
    if (!hero.alive) return;
    if (this.potions <= 0) {
      this.floatAt(hero.position, 2.4, 'No potions', 'info');
      return;
    }
    if (hero.hp >= hero.maxHp) {
      this.floatAt(hero.position, 2.4, 'Already healthy', 'info');
      return;
    }
    this.potions--;
    this.potionsUsed++;
    this.ui.pulseSlot('potion');
    this.audio.play('potion');
    this.healHero(hero.maxHp * 0.45, true);
    for (let i = 0; i < 30; i++) {
      this.glow.spawn({
        x: hero.position.x + (Math.random() - 0.5) * 1.2,
        y: 0.2 + Math.random() * 0.5,
        z: hero.position.z + (Math.random() - 0.5) * 1.2,
        vy: 1.5 + Math.random() * 1.5,
        life: 0.8,
        size: 0.12,
        sizeEnd: 0.02,
        color: this.heal,
        intensity: 3,
        drag: 1,
      });
    }
  }

  private healHero(amount: number, show: boolean, label?: string): void {
    const hero = this.hero;
    if (!hero.alive) return;
    const before = hero.hp;
    hero.heal(amount);
    const gained = hero.hp - before;
    if (show && gained > 0.5) this.floatAt(hero.position, 2.4, `${label ? label + ' ' : ''}+${Math.round(gained)}`, 'heal');
  }

  // ───────────────────────── Projectiles, zones, pickups ─────────────────────────

  private orb(color: THREE.Color, strength: number): THREE.Mesh {
    return new THREE.Mesh(this.orbGeometry, new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(strength), toneMapped: false }));
  }

  private updateProjectiles(dt: number): void {
    const keep: Projectile[] = [];
    for (const p of this.projectiles) {
      p.life -= dt;
      p.mesh.position.addScaledVector(p.velocity, dt);
      p.mesh.rotation.y += dt * 6;
      const pos = p.mesh.position;
      this.glow.spawn({ x: pos.x, y: pos.y, z: pos.z, life: 0.25, size: 0.16, sizeEnd: 0.01, color: p.color, intensity: 3, drag: 2 });
      if (!p.hostile && this.smashCrates(pos, 0.9)) p.life = 0;
      if (!p.hostile && p.life > 0 && this.hitCrystals(pos, 1.2)) p.life = 0;
      let dead = p.life <= 0 || this.crypt.colliders.hits(pos.x, pos.z, 0.1);
      if (!dead && p.hostile) {
        const hero = this.hero;
        if (hero.alive && Math.hypot(pos.x - hero.position.x, pos.z - hero.position.z) < p.radius + hero.radius) {
          this.damageHero(p.damage, pos);
          dead = true;
        }
      } else if (!dead) {
        for (const e of this.enemies) {
          if (!e.active || p.hit.has(e)) continue;
          if (Math.hypot(pos.x - e.position.x, pos.z - e.position.z) > p.radius + e.radius) continue;
          p.hit.add(e);
          if (this.hitEnemy(e, p.damage, pos.clone().sub(p.velocity), 2.5) && p.heal > 0) this.healHero(p.heal, false);
          if (!p.pierce) {
            dead = true;
            break;
          }
        }
      }
      if (dead) {
        this.burst(pos.clone(), p.color, 12, 2.5);
        this.scene.remove(p.mesh);
      } else keep.push(p);
    }
    this.projectiles = keep;
  }

  private addZone(kind: Zone['kind'], position: THREE.Vector3, radius: number, life: number, healPerSecond: number, damagePerSecond: number): void {
    const color = kind === 'smoke' ? new THREE.Color('#6b6380') : this.heroColor.clone();
    const mesh = new THREE.Mesh(
      this.discGeometry,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: kind === 'smoke' ? 0.35 : 0.22, depthWrite: false, blending: kind === 'smoke' ? THREE.NormalBlending : THREE.AdditiveBlending }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(position).setY(0.05);
    mesh.scale.setScalar(radius);
    this.scene.add(mesh);
    this.zones.push({ kind, position, radius, life, tick: 0, healPerSecond, damagePerSecond, mesh });
  }

  private updateZones(dt: number): void {
    this.zones = this.zones.filter((z) => {
      z.life -= dt;
      z.tick -= dt;
      const mat = z.mesh.material as THREE.MeshBasicMaterial;
      if (z.life < 0.5) mat.opacity *= 0.9;
      if (z.kind === 'sanctuary') {
        // Rising motes around the edge.
        const a = Math.random() * Math.PI * 2;
        this.glow.spawn({ x: z.position.x + Math.sin(a) * z.radius, y: 0.1, z: z.position.z + Math.cos(a) * z.radius, vy: 2, life: 0.8, size: 0.14, sizeEnd: 0.02, color: this.heroColor, intensity: 3 });
        if (z.tick <= 0) {
          z.tick = 0.33;
          if (this.hero.position.distanceTo(z.position) < z.radius) this.healHero(z.healPerSecond * 0.33, false);
          for (const e of this.enemies) {
            if (e.active && e.position.distanceTo(z.position) < z.radius + e.radius) this.hitEnemy(e, z.damagePerSecond * 0.33, z.position, 0.3, true);
          }
        }
      } else if (Math.random() < 0.6) {
        this.puff(z.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * z.radius * 1.6, 0, (Math.random() - 0.5) * z.radius * 1.6)), 1);
      }
      if (z.life > 0) return true;
      this.scene.remove(z.mesh);
      return false;
    });
  }

  private dropPotion(at: THREE.Vector3): void {
    // Nudge toward the middle until the spot is clear of props.
    const p = at.clone();
    for (let i = 0; i < 20 && this.crypt.colliders.hits(p.x, p.z, 0.6); i++) p.multiplyScalar(0.9);
    const object = this.makePotion();
    object.position.copy(p);
    this.scene.add(object);
    this.pickups.push({ object, base: p.clone() });
  }

  /** A round flask of glowing red potion with a white heart floating over it: reads as "health". */
  private makePotion(): THREE.Group {
    const group = new THREE.Group();
    const liquid = new THREE.Mesh(
      new THREE.SphereGeometry(0.27, 24, 16),
      new THREE.MeshStandardMaterial({ color: '#ff2a4f', emissive: '#ff1040', emissiveIntensity: 0.7, roughness: 0.15, metalness: 0.1 }),
    );
    liquid.position.y = 0.27;
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.1, 0.2, 16),
      new THREE.MeshStandardMaterial({ color: '#ffe3ea', roughness: 0.1, transparent: true, opacity: 0.85 }),
    );
    neck.position.y = 0.6;
    const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.085, 0.09, 12), new THREE.MeshStandardMaterial({ color: '#8a5a32', roughness: 0.8 }));
    cork.position.y = 0.73;
    for (const m of [liquid, neck, cork]) m.castShadow = true;
    if (!this.heartTexture) this.heartTexture = makeHeartTexture();
    const heart = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.heartTexture, transparent: true, depthWrite: false }));
    heart.position.y = 1.25;
    heart.scale.setScalar(0.55);
    heart.name = 'heart';
    group.add(liquid, neck, cork, heart);
    return group;
  }

  /** Barrels and crates to smash. Each blocks the way until it's broken. */
  private placeCrates(): void {
    this.crypt.crateSpots.forEach((spot, i) => {
      const object = this.assets.piece(i % 2 ? 'box_small' : 'barrel_small');
      object.traverse((o) => {
        o.castShadow = true;
        o.receiveShadow = true;
      });
      const holder = new THREE.Group();
      holder.add(object);
      holder.position.copy(spot);
      holder.rotation.y = (i * 1.7) % Math.PI;
      this.scene.add(holder);
      const half = 0.45;
      const box = { minX: spot.x - half, maxX: spot.x + half, minZ: spot.z - half, maxZ: spot.z + half };
      this.crypt.colliders.boxes.push(box);
      this.crates.push({ object: holder, box, position: spot.clone() });
    });
    this.nav = new NavGrid(this.crypt.colliders);
  }

  private removeCrate(c: Crate): void {
    this.scene.remove(c.object);
    const i = this.crypt.colliders.boxes.indexOf(c.box);
    if (i >= 0) this.crypt.colliders.boxes.splice(i, 1);
  }

  /** Breaks crates within reach (in front of the hero for a swing). Returns true if any broke. */
  private smashCrates(from: THREE.Vector3, reach: number, facing?: THREE.Vector3, arc = Math.PI * 2): boolean {
    let broke = false;
    this.crates = this.crates.filter((c) => {
      const d = this.tmp.copy(c.position).sub(from).setY(0);
      const dist = d.length();
      if (dist > reach) return true;
      if (facing && dist > 0.8 && d.normalize().dot(facing) < Math.cos(arc / 2)) return true;
      broke = true;
      this.removeCrate(c);
      this.puff(c.position, 14);
      for (let i = 0; i < 18; i++) {
        const v = new THREE.Vector3().randomDirection().multiplyScalar(3);
        this.dust.spawn({ x: c.position.x, y: 0.6, z: c.position.z, vx: v.x, vy: Math.abs(v.y) + 2, vz: v.z, life: 0.8, size: 0.16, sizeEnd: 0.06, color: this.woodColor, intensity: 1, drag: 1.5 });
      }
      this.audio.play('block');
      this.audio.play('hit');
      this.shake(0.12);
      const chance = (this.difficulty.id === 'easy' ? 0.5 : 0.35) + 0.15 * this.lvl('lucky');
      if (Math.random() < chance) this.later(0.15, () => this.dropPotion(c.position.clone()));
      else this.dropCoins(c.position, 3 + Math.floor(Math.random() * 3));
      return false;
    });
    if (broke) {
      this.nav = new NavGrid(this.crypt.colliders);
      this.guideNav = null;
    }
    return broke;
  }

  private updatePickups(t: number): void {
    for (const pk of this.pickups) {
      pk.object.position.y = 0.12 + Math.sin(t * 2.4 + pk.base.x) * 0.1;
      pk.object.rotation.y = t * 1.4;
      const heart = pk.object.getObjectByName('heart');
      if (heart) heart.scale.setScalar(0.55 + Math.sin(t * 5 + pk.base.z) * 0.06);
      if (Math.random() < 0.15) {
        this.glow.spawn({ x: pk.base.x + (Math.random() - 0.5) * 0.6, y: 0.4, z: pk.base.z + (Math.random() - 0.5) * 0.6, vy: 0.9, life: 0.9, size: 0.09, sizeEnd: 0.01, color: this.red, intensity: 2.5 });
      }
    }
  }

  private collectPickups(): void {
    this.pickups = this.pickups.filter((pk) => {
      if (pk.base.distanceTo(this.hero.position.clone().setY(0)) > 1.3) return true;
      if (this.potions >= this.maxPotions) return true;
      this.potions++;
      this.audio.play('pickup');
      this.floatAt(pk.base, 1.6, 'Potion +1', 'heal');
      this.scene.remove(pk.object);
      return false;
    });
  }

  /** Golden motes drifting from the altar to the open door. */
  private guideToDoor(dt: number): void {
    if (Math.random() > dt * 30) return;
    const a = this.crypt.altar.position;
    const d = this.crypt.doorAt;
    const z = a.z - 3.5 - Math.random() * Math.max(0, a.z - 3.5 - (d.z + 1));
    this.glow.spawn({ x: d.x + (Math.random() - 0.5) * 0.8, y: 0.2, z, vz: -1.6, vy: 0.4, life: 1.2, size: 0.12, sizeEnd: 0.02, color: this.gold, intensity: 3 });
  }

  // ───────────────────────── Screen-space UI ─────────────────────────

  private toScreen(p: THREE.Vector3, lift: number): { x: number; y: number; on: boolean } {
    const v = this.projected.copy(p).setY(p.y + lift).project(this.camera);
    const canvas = this.renderer.gl.domElement;
    return { x: ((v.x + 1) / 2) * canvas.clientWidth, y: ((1 - v.y) / 2) * canvas.clientHeight, on: v.z < 1 };
  }

  private floatAt(p: THREE.Vector3, lift: number, text: string, kind: FloatKind): void {
    const s = this.toScreen(p, lift);
    if (s.on) this.ui.float(text, s.x, s.y, kind);
  }

  private updateWorldUi(): void {
    const frame = this.frameCount;
    for (const e of this.enemies) {
      const s = this.toScreen(e.position, e.def.scale * 2.15);
      this.ui.enemyBar(e, s.x, s.y, e.hp / e.maxHp, e.alive && e.active && s.on, frame);
    }
    this.ui.sweepBars(frame);

    if (this.paused) return;
    if (this.brazier && !this.brazier.lit && this.introTimer <= 0) {
      // Just under the torch, so it never hides behind the goal line at the top.
      const s = this.toScreen(this.brazier.position, -0.2);
      this.ui.prompt('<kbd>F</kbd> Light the torch', s.x, s.y + 8);
    } else if (this.nearMerchant()) {
      const s = this.toScreen(this.merchant!.who.position, 2.6);
      this.ui.prompt('<kbd>F</kbd> Shop', s.x, s.y);
    } else if (this.nearLantern()) {
      const s = this.toScreen(this.nearLantern()!.at, -0.2);
      this.ui.prompt('<kbd>F</kbd> Light the lantern', s.x, s.y + 8);
    } else if (this.step === 'cleared' && this.crypt.door.isOpen) {
      const s = this.toScreen(this.crypt.doorAt.clone().add(new THREE.Vector3(0, 0, 1.4)), 0.2);
      const next = LEVELS[this.route[this.stage + 1]];
      this.ui.prompt(!next ? 'Escape!' : next.boss ? 'To the King' : 'Next hall', s.x, s.y);
    } else {
      this.ui.prompt(null);
    }
  }

  // ───────────────────────── Helpers ─────────────────────────

  private later(seconds: number, run: () => void): void {
    this.timers.push({ at: seconds, run });
  }

  private runTimers(dt: number): void {
    if (this.timers.length === 0) return;
    const due: Timer[] = [];
    this.timers = this.timers.filter((t) => {
      t.at -= dt;
      if (t.at > 0) return true;
      due.push(t);
      return false;
    });
    for (const t of due) t.run();
  }

  private shake(amount: number): void {
    this.rig.addTrauma(REDUCED_MOTION ? amount * 0.25 : amount);
  }

  setHero(id: HeroClassId): void {
    const previous = this.hero;
    const hero = new Hero(this.assets, HERO_CLASSES[id]);
    hero.position.copy(previous ? previous.position : this.crypt.heroStart);
    hero.facing = previous ? previous.facing : Math.PI;
    hero.root.visible = previous ? previous.root.visible : true;
    if (previous) this.scene.remove(previous.root);
    this.scene.add(hero.root);
    this.hero = hero;
    this.heroColor.set(hero.def.color);
    this.heroHot.set(hero.def.hot);
    if (previous?.root.visible) this.burst(hero.position.clone().setY(1), this.heroColor, 40, 4);
  }

  setMood(mood: Mood): void {
    this.mood = mood;
    this.scene.background = new THREE.Color(mood.background);
    this.fog.color.set(mood.fog.color);
    this.fog.density = mood.fog.density;
    this.hemi.color.set(mood.hemi.sky);
    this.hemi.groundColor.set(mood.hemi.ground);
    this.hemi.intensity = mood.hemi.intensity;
    this.moon.color.set(mood.moon.color);
    this.moon.intensity = mood.moon.intensity;
    this.scene.environmentIntensity = mood.environment;
    this.heroLight.intensity = mood.heroLight;
    for (const material of this.assets.kitMaterials) {
      if (material instanceof THREE.MeshStandardMaterial) material.color.set(mood.stone);
    }
    this.crypt.torches.applyMood(mood);
    this.crypt.runes.setColor(mood.rune.color, mood.rune.intensity);
    this.renderer.applyMood(mood);
  }

  private ring(at: THREE.Vector3, radius: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      this.glow.spawn({
        x: at.x + Math.sin(a) * 0.6,
        y: 0.6,
        z: at.z + Math.cos(a) * 0.6,
        vx: Math.sin(a) * radius * 2.4,
        vz: Math.cos(a) * radius * 2.4,
        life: 0.45,
        size: 0.22,
        sizeEnd: 0.05,
        color: i % 3 === 0 ? this.heroHot : this.heroColor,
        intensity: 5,
        drag: 5,
      });
    }
  }

  private burst(at: THREE.Vector3, color: THREE.Color, count: number, speed: number): void {
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(speed * (0.4 + Math.random()));
      this.glow.spawn({
        x: at.x,
        y: at.y,
        z: at.z,
        vx: v.x,
        vy: v.y,
        vz: v.z,
        life: 0.35 + Math.random() * 0.3,
        size: 0.13,
        sizeEnd: 0.02,
        color,
        intensity: 4,
        drag: 3,
      });
    }
  }

  /** Dust kicked up from the floor. */
  private puff(at: THREE.Vector3, count: number): void {
    for (let i = 0; i < count; i++) {
      this.dust.spawn({
        x: at.x + (Math.random() - 0.5) * 1.2,
        y: 0.2 + Math.random() * 0.4,
        z: at.z + (Math.random() - 0.5) * 1.2,
        vx: (Math.random() - 0.5) * 1.2,
        vy: 0.4 + Math.random() * 0.6,
        vz: (Math.random() - 0.5) * 1.2,
        life: 0.9 + Math.random() * 0.6,
        size: 0.4,
        sizeEnd: 0.9,
        color: this.dustColor,
        intensity: 0.55,
        drag: 2,
      });
    }
  }

  /** Slow motes drifting through the torchlight. */
  private spawnDust(dt: number): void {
    this.dustTimer -= dt;
    while (this.dustTimer <= 0) {
      this.dustTimer += 0.05;
      this.dust.spawn({
        x: this.crypt.center.x + (Math.random() * 2 - 1) * (this.crypt.halfX - 1),
        y: 0.4 + Math.random() * 3.6,
        z: this.crypt.center.z + (Math.random() * 2 - 1) * (this.crypt.halfZ - 1),
        vx: (Math.random() - 0.5) * 0.12,
        vy: (Math.random() - 0.3) * 0.08,
        vz: (Math.random() - 0.5) * 0.12,
        life: 5 + Math.random() * 5,
        size: 0.035 + Math.random() * 0.03,
        color: this.dustColor,
        intensity: 0.9,
      });
    }
  }

  private updateSeeThrough(): void {
    const p = this.projected.copy(this.hero.position).setY(1.2).project(this.camera);
    const size = this.renderer.bufferSize;
    seeThrough.center.value.set(((p.x + 1) / 2) * size.x, ((p.y + 1) / 2) * size.y);
    seeThrough.radius.value = this.hero.root.visible ? size.y * 0.13 : 0;
    seeThrough.depth.value = -this.projected.copy(this.hero.position).setY(1.2).applyMatrix4(this.camera.matrixWorldInverse).z;
  }
}

/** A white heart with a soft red glow, drawn once for every potion's floating marker. */
function makeHeartTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const heart = (): void => {
    ctx.beginPath();
    ctx.moveTo(64, 104);
    ctx.bezierCurveTo(20, 74, 14, 46, 30, 32);
    ctx.bezierCurveTo(44, 20, 60, 26, 64, 40);
    ctx.bezierCurveTo(68, 26, 84, 20, 98, 32);
    ctx.bezierCurveTo(114, 46, 108, 74, 64, 104);
    ctx.closePath();
  };
  ctx.shadowColor = 'rgba(255, 40, 80, 0.95)';
  ctx.shadowBlur = 22;
  ctx.fillStyle = '#ff3b5c';
  heart();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 7;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
