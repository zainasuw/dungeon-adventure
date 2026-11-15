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
import { clearSave, DIFFICULTIES, LEVELS, loadSave, MAX_POTIONS, writeSave, type Difficulty, type DifficultyId, type SaveData } from './game/levels';
import { MOODS, type Mood } from './render/moods';
import { Renderer } from './render/renderer';
import { applySeeThrough, seeThrough } from './render/see-through';
import { HERO_ORDER, Ui, type FloatKind, type QuestStats } from './ui/ui';
import { buildCrypt, ROOM, type Crypt } from './world/crypt';
import { NavGrid } from './world/nav';
import { Particles } from './world/particles';

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

interface Crate {
  object: THREE.Object3D;
  box: { minX: number; maxX: number; minZ: number; maxZ: number };
  position: THREE.Vector3;
}

interface Timer {
  at: number;
  run: () => void;
}

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const ALTAR_REACH = 3.2;
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

  mood: Mood = MOODS[1];
  hero!: Hero;
  phase: Phase = 'title';
  step: Step = 'explore';
  paused = false;

  // The quest in progress.
  private heroName = '';
  private difficulty: Difficulty = DIFFICULTIES.easy;
  private level = 0;
  private pillars = 0;
  private potions = 1;
  private levelStartPotions = 1;
  private kills = 0;
  private potionsUsed = 0;
  private playTime = 0;

  private enemies: Enemy[] = [];
  private readonly rings = new Map<Enemy, THREE.Mesh>();
  private waves: EnemyKind[][] = [];
  private waveCooldown = 0;
  private projectiles: Projectile[] = [];
  private zones: Zone[] = [];
  private pickups: Potion[] = [];
  private crates: Crate[] = [];
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

  // Hero select: all four heroes in a row; the chosen one steps forward and spins.
  private lineup: Hero[] = [];
  private chosen = 0;
  private spin = 0;
  private lastDrag = -10;
  /** Seconds left of the swoop from the menu into the hall; input waits. */
  private introTimer = 0;
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
  private heartTexture: THREE.Texture | null = null;
  private readonly gold = new THREE.Color('#ffc35a');
  private readonly red = new THREE.Color('#ff4040');
  private readonly heal = new THREE.Color('#7dffa0');
  private time = 0;
  private last = 0;
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
    this.crypt = buildCrypt(assets, this.glow, 0);
    this.scene.add(this.crypt.group, this.glow.points, this.dust.points);
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
    const save = loadSave();
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
    this.blessings = {};
    this.heroName = name;
    this.difficulty = DIFFICULTIES[difficulty];
    this.level = 0;
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
    const start = stand ? stand.position.clone().setY(0) : new THREE.Vector3(0, 0, 5.4);
    const facing = stand ? stand.facing : Math.PI;
    this.setHero(id);
    this.applyBlessings();
    this.ui.hideScreen();
    this.ui.setHero(this.hero.def, this.heroName, this.hero.maxHp);
    this.ui.setBlessings(this.blessings, BLESSINGS);
    this.ui.showHud(false);
    this.phase = 'play';
    this.paused = false;
    this.setupLevel(this.level, true, start, true);
    this.hero.facing = facing;
    this.hero.animator.play('Cheer', { loop: false, fade: 0.1, restart: true });
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

  private saveProgress(): void {
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
    };
  }

  // ───────────────────────── Halls ─────────────────────────

  /** Builds hall `index`. With `live`, the hero is placed and the hall begins. */
  private setupLevel(index: number, live: boolean, start?: THREE.Vector3, intro = false): void {
    const level = LEVELS[index];
    this.level = index;
    this.clearActors();
    if (this.crypt.theme !== index) this.buildHall(index);
    this.setMood(MOODS[level.mood]);
    this.crypt.altar.reset();
    this.crypt.altar.setDormantColor(level.crystal);
    this.crypt.door.reset(index);

    this.crypt.dormant.forEach((spot, i) => {
      const kind = level.sleepers[i];
      if (!kind) return;
      const enemy = this.spawnEnemy(kind, spot.position);
      enemy.facing = spot.facing;
      enemy.sleep();
    });
    this.waves = level.waves.map((w) => [...w]);
    if (this.difficulty.dropLastWave && this.waves.length > 1) this.waves.pop();

    if (!live) return;
    for (const [x, z] of level.potions) this.dropPotion(new THREE.Vector3(x, 0, z));
    this.placeCrates();
    this.levelStartPotions = this.potions;
    this.step = 'explore';
    this.hero.revive();
    this.hero.invulnerable = 0;
    this.hero.root.visible = true;
    if (start) this.hero.position.copy(start);
    else this.hero.position.set(0, 0, 5.4);
    this.hallStart.copy(this.hero.position);
    this.hero.facing = Math.PI;
    this.hero.velocity.set(0, 0, 0);
    this.hero.animator.play('Idle', { fade: 0 });
    this.renew.left = 0;
    const view = LEVELS[index].view;
    this.rig.setView(view.yaw, view.pitch, view.distance);
    this.ui.setQuest(index, this.pillars);
    this.ui.objective('Follow the golden arrow to the altar');
    const delay = intro ? 1.1 : 0;
    this.later(delay + 2.6, () => this.tip('walk', 'Walk with <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or the arrow keys'));
    const banner = () => this.ui.banner(`Hall ${index + 1} of 4`, level.hall, `Guarding the Pillar of ${level.pillar}`);
    if (intro) this.later(delay, banner);
    else banner();
    this.ui.fade(false);
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
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    for (const z of this.zones) this.scene.remove(z.mesh);
    for (const p of this.pickups) this.scene.remove(p.object);
    for (const c of this.crates) this.removeCrate(c);
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
    this.enemies.push(enemy);
    return enemy;
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
      if (e.state !== 'dormant') return;
      this.later(0.35 + i * 0.35, () => {
        if (!e.alive) return;
        e.rise(false);
        this.audio.play('rise');
        this.puff(e.position, 14);
      });
    });
    this.waveCooldown = 4;
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
        enemy.rise(true);
        this.puff(at, 22);
        this.audio.play('rise');
      });
    });
  }

  private onCleared(): void {
    this.step = 'cleared';
    this.pillars = Math.max(this.pillars, this.level + 1);
    this.crypt.door.setProgress(this.pillars);
    this.crypt.door.open();
    this.ui.setQuest(this.level, this.pillars);
    this.audio.play('clear');
    this.later(0.6, () => this.audio.play('door'));
    const last = this.level === LEVELS.length - 1;
    const left = LEVELS.length - this.pillars;
    this.ui.banner(
      `Pillar ${this.pillars} of 4`,
      `Pillar of ${LEVELS[this.level].pillar}`,
      last ? 'All four pillars! Run for the golden door!' : `${left} more to go! Follow the arrow to the door`,
    );
    this.later(2.5, () => this.crypt.altar.settle());
    // A reward for clearing the hall, so you're never left without a potion.
    this.later(1.2, () => {
      this.dropPotion(new THREE.Vector3(1.8, 0, 3));
      this.burst(new THREE.Vector3(1.8, 1, 3), this.heal, 30, 3);
    });
    this.ui.objective(last ? 'The way out is open! Follow the arrow to the golden door' : 'Follow the arrow to the golden door');
    if (!last) this.later(2.9, () => this.offerBlessings());
    if (this.hero.state === 'free') this.hero.animator.play('Cheer', { loop: false, fade: 0.15, restart: true });
  }

  private exitHall(): void {
    this.step = 'exiting';
    this.ui.prompt(null);
    this.ui.fade(true);
    if (this.level === LEVELS.length - 1) {
      this.later(0.8, () => this.win());
      return;
    }
    this.later(0.8, () => {
      this.level += 1;
      this.potions = Math.min(this.maxPotions, this.potions);
      this.setupLevel(this.level, true, undefined, true);
      this.playEstablishingShot();
      this.saveProgress();
    });
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
    this.establishing = 1.3;
    this.introTimer = 2.4;
    this.input.clear();
    this.ui.showHud(false);
    this.later(2.4, () => this.ui.showHud(true));
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

    this.crypt.torches.update(t, dt);
    this.crypt.runes.update(t);
    this.crypt.altar.update(t, dt);
    this.crypt.door.update(t, dt);
    this.updatePickups(t);
    this.spawnDust(dt);
    this.glow.update(dt);
    this.dust.update(dt);

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

  private updateCamera(dt: number, t: number): void {
    if (this.phase !== 'select' && this.phase !== 'title' && this.camera.fov !== 30) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, 30, 6, dt);
      if (Math.abs(this.camera.fov - 30) < 0.05) this.camera.fov = 30;
      this.camera.updateProjectionMatrix();
    }
    if (this.phase === 'select' || this.phase === 'title') {
      // A wide lens on the row of heroes, swaying gently on the title.
      if (Math.abs(this.camera.fov - 36) > 0.01) {
        this.camera.fov = THREE.MathUtils.damp(this.camera.fov, 36, 5, dt);
        this.camera.updateProjectionMatrix();
      }
      const title = this.phase === 'title';
      this.rig.setView(title ? Math.sin(t * 0.25) * 4 : 0, title ? 10 : 8, title ? 9.8 : 8.6);
      this.rig.update(dt, t, this.camTarget.set(0, title ? 1.25 : 0.95, LINEUP_Z + 0.3));
      return;
    } else if (this.phase === 'victory') {
      // Hero stands to the right of the panel on wide screens.
      const wide = window.innerWidth > 900;
      this.rig.setView(0, 11, 8.4);
      this.rig.update(dt, t, this.camTarget.set(this.hero.position.x - (wide ? 2.3 : 0), wide ? 1.15 : 1.6, this.hero.position.z));
    } else {
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
      // Look a little ahead (north), where the altar and the door are.
      this.rig.update(dt, t, this.camTarget.copy(this.hero.position).setY(0).add(new THREE.Vector3(0, 0, -1.2)));
    }
  }

  private updatePlay(dt: number): void {
    if (this.choosing) return;
    this.runTimers(dt);
    if (this.introTimer > 0) {
      // The swoop: the hero cheers, then turns to face the hall. Input waits.
      this.introTimer -= dt;
      const hero = this.hero;
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

    // The hall's steps.
    const altarDist = hero.position.distanceTo(this.crypt.altar.position);
    const walked = hero.position.distanceTo(this.hallStart) > 0.4;
    if (this.step === 'explore' && altarDist < ALTAR_REACH && walked && hero.state === 'free') {
      this.step = 'claiming';
      hero.interact();
      this.crypt.altar.setCharge(1);
      this.later(0.55, () => {
        this.crypt.altar.setCharge(0);
        this.claimPillar();
      });
    }
    if (this.step === 'fight') {
      const living = this.enemies.filter((e) => e.alive);
      const awake = living.filter((e) => e.state !== 'dormant');
      if (this.waves.length > 0 && living.every((e) => e.state !== 'dormant')) {
        this.waveCooldown -= dt;
        if (this.waveCooldown <= 0 && awake.length <= 1) {
          const lastWave = this.waves.length === 1;
          this.spawnWave(this.waves.shift()!, lastWave);
          this.waveCooldown = 3;
        }
      }
      const pending = this.timers.length > 0 || this.waves.length > 0;
      if (living.length === 0 && !pending) this.onCleared();
      else this.ui.objective(`Defeat the skeletons: ${living.length + this.waves.flat().length} left`);
    }
    if (this.step === 'cleared') {
      this.guideToDoor(dt);
      const p = hero.position;
      if (this.crypt.door.isOpen && p.z < -10.1 && Math.abs(p.x) < 2.6) this.exitHall();
    }

    this.updateArrow(dt);
    this.autoPotion(dt);
    if (this.pickups.some((k) => k.base.distanceTo(this.tmp.copy(hero.position).setY(0)) < 6)) {
      this.tip('potion-seen', 'The glowing heart is a <b>health potion</b>. Walk over it to grab it!');
    } else if (this.crates.some((c) => c.position.distanceTo(hero.position) < 3)) {
      this.tip('crates', 'Smash barrels and crates with <kbd>F</kbd>. There might be a potion inside!');
    }
    if (this.step === 'fight') {
      if (this.enemies.some((e) => e.telegraph > 0.2 && e.position.distanceTo(hero.position) < e.def.reach + 1.5)) {
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
    if (move.lengthSq() > 1) move.normalize();

    this.raycaster.setFromCamera(k.pointer, this.camera);
    const hasMouse = k.pointerActive && this.raycaster.ray.intersectPlane(this.floor, this.heroInput.aim) !== null;
    // Aim assist: snap to the best monster near where the player points, or the nearest one.
    const target = this.autoTarget(hasMouse ? this.heroInput.aim : null);
    if (target) this.heroInput.aim.copy(target.position);
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
    this.heroInput.secondary = k.buttonPressed(2) || k.keyPressed('KeyK') || k.keyPressed('KeyG');
    this.heroInput.dodge = k.keyPressed('Space') || k.keyPressed('ShiftLeft');
    this.heroInput.special = k.keyPressed('KeyQ');
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
      if (e.state !== 'dormant' && d2 < min * min && d2 > 1e-6) {
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
      return false;
    });
  }

  private updateRings(): void {
    for (const [e, ring] of this.rings) {
      const on = e.alive && e.telegraph > 0;
      ring.visible = on;
      if (!on) continue;
      const reach = e.def.ranged ? 1.1 : e.def.reach * 0.9;
      ring.position.set(e.position.x, 0.04, e.position.z);
      ring.scale.setScalar(reach * (0.55 + e.telegraph * 0.45));
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.25 + e.telegraph * 0.65;
    }
  }

  private enemyStrike(e: Enemy): void {
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

  private enemyShoot(e: Enemy, dir: THREE.Vector3): void {
    const color = new THREE.Color(e.def.eyes);
    const mesh = this.orb(color, 2.6);
    mesh.scale.setScalar(1.4);
    mesh.position.copy(e.position).setY(1.3).addScaledVector(dir, 0.9);
    this.scene.add(mesh);
    this.audio.play('cast');
    this.projectiles.push({
      mesh,
      velocity: dir.clone().multiplyScalar(e.def.ranged!.projectileSpeed),
      damage: e.def.damage * this.difficulty.enemyDamage,
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
    for (const o of this.enemies) if (o !== e && o.alive && (o.state === 'windup' || o.state === 'recover')) busy++;
    return busy < limit;
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
    hero.maxHp = hero.def.maxHp + 30 * this.lvl('heart');
    hero.hp = Math.min(hero.hp, hero.maxHp);
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
    this.ui.setQuest(this.level, this.pillars);
    this.ui.objective('Follow the arrow to the golden door');
    this.ui.setBlessings(this.blessings, BLESSINGS);
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
    if (this.step === 'explore') goal = this.crypt.altar.position;
    else if (this.step === 'cleared' && this.crypt.door.isOpen) goal = new THREE.Vector3(0, 0, -11);
    else if (this.step === 'fight') {
      // Only when every monster is far away (or behind the hero), point to the closest.
      const near = this.nearestEnemy(hero.position, 7);
      const far = near ? null : this.nearestEnemy(hero.position, 40);
      if (far) {
        goal = far.position;
        color = '#ff5a4a';
      }
    }
    const mat = this.arrow.material as THREE.MeshBasicMaterial;
    const show = goal !== null && hero.alive && hero.position.distanceTo(goal) > 4.2;
    mat.opacity = THREE.MathUtils.damp(mat.opacity, show ? 0.75 + Math.sin(this.time * 5) * 0.2 : 0, 10, dt);
    if (!goal) return;
    mat.color.set(color).multiplyScalar(1.6);
    const dir = this.tmp.copy(goal).sub(hero.position).setY(0).normalize();
    const pulse = 2.9 + Math.sin(this.time * 5) * 0.2;
    // Floats just above the altar's steps so they can't hide it.
    this.arrow.position.set(hero.position.x + dir.x * pulse, 0.62, hero.position.z + dir.z * pulse);
    this.arrow.rotation.y = Math.atan2(dir.x, dir.z);
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
      else this.burst(c.position.clone().setY(0.8), this.gold, 20, 3);
      return false;
    });
    if (broke) this.nav = new NavGrid(this.crypt.colliders);
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
    const z = -3.5 - Math.random() * 7.5;
    this.glow.spawn({ x: (Math.random() - 0.5) * 0.8, y: 0.2, z, vz: -1.6, vy: 0.4, life: 1.2, size: 0.12, sizeEnd: 0.02, color: this.gold, intensity: 3 });
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
    if (this.step === 'cleared' && this.crypt.door.isOpen) {
      const s = this.toScreen(new THREE.Vector3(0, 0, -10.6), 0.2);
      this.ui.prompt(this.level === LEVELS.length - 1 ? 'Escape!' : 'Next hall', s.x, s.y);
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
        x: (Math.random() * 2 - 1) * (ROOM.halfX - 1),
        y: 0.4 + Math.random() * 3.6,
        z: (Math.random() * 2 - 1) * (ROOM.halfZ - 1),
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
