import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Character } from './actors/character';
import { HERO_CLASSES, type Ability, type ComboStep, type HeroClassId } from './actors/classes';
import { Hero, type HeroEvents, type HeroInput } from './actors/hero';
import type { Assets } from './core/assets';
import { CameraRig } from './core/camera-rig';
import { Input } from './core/input';
import { MOODS, type Mood } from './render/moods';
import { Renderer } from './render/renderer';
import { applySeeThrough, seeThrough } from './render/see-through';
import { LookDev } from './ui/lookdev';
import { buildCrypt, ROOM, type Crypt } from './world/crypt';
import { Particles } from './world/particles';

export class Game {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.5, 140);
  readonly rig: CameraRig;
  readonly renderer: Renderer;
  readonly input: Input;
  readonly crypt: Crypt;
  /** Additive particles: embers, sparks, magic. */
  readonly glow = new Particles(4000, true, 0.1);
  /** Alpha-blended particles: dust, smoke, bone shards. */
  readonly dust = new Particles(1500, false, 0.35);

  mood: Mood = MOODS[0];
  hero!: Hero;
  private readonly sleepers: Character[] = [];
  private readonly hemi = new THREE.HemisphereLight();
  private readonly moon = new THREE.DirectionalLight();
  private readonly heroLight = new THREE.PointLight('#ffd9a8', 9, 11, 2);
  private readonly fog = new THREE.FogExp2('#0a0f1c', 0.02);
  private readonly dustColor = new THREE.Color('#d9c7a0');
  private readonly heroColor = new THREE.Color();
  private readonly heroHot = new THREE.Color();
  private time = 0;
  private last = 0;
  private dustTimer = 0;

  // Scratch objects reused every frame.
  private readonly raycaster = new THREE.Raycaster();
  private readonly floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly projected = new THREE.Vector3();
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

  constructor(container: HTMLElement, ui: HTMLElement, private readonly assets: Assets) {
    this.renderer = new Renderer(container, this.scene, this.camera);
    this.input = new Input(this.renderer.gl.domElement);
    this.rig = new CameraRig(this.camera);

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
    this.crypt = buildCrypt(assets, this.glow);
    this.scene.add(this.crypt.group, this.glow.points, this.dust.points);

    const sleeperModels = ['Skeleton_Minion', 'Skeleton_Warrior', 'Skeleton_Rogue', 'Skeleton_Minion'] as const;
    this.crypt.dormant.forEach((spot, i) => {
      const skeleton = new Character(assets, sleeperModels[i], assets.skeletonClips);
      skeleton.position.copy(spot.position);
      skeleton.facing = spot.facing;
      skeleton.setGlow((n) => n.endsWith('_Eyes'), '#ffb83a', 4);
      skeleton.animator.play('Skeletons_Inactive_Floor_Pose');
      this.scene.add(skeleton.root);
      this.sleepers.push(skeleton);
    });

    this.setHero('warrior');
    this.rig.snap(this.hero.position);
    this.setMood(MOODS[0]);

    new LookDev(ui, {
      hero: (id) => this.setHero(id),
      mood: (i) => this.setMood(MOODS[i]),
      camera: (preset) => this.rig.setView(preset.yaw, preset.pitch, preset.distance),
    });
  }

  setHero(id: HeroClassId): void {
    const previous = this.hero;
    const hero = new Hero(this.assets, HERO_CLASSES[id]);
    hero.position.copy(previous ? previous.position : this.crypt.heroStart);
    hero.facing = previous ? previous.facing : Math.PI;
    if (previous) this.scene.remove(previous.root);
    this.scene.add(hero.root);
    this.hero = hero;
    this.heroColor.set(hero.def.color);
    this.heroHot.set(hero.def.hot);
    this.burst(hero.position.clone().setY(1), this.heroColor, 40, 4);
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

  start(): void {
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    this.update(dt);
    this.renderer.render(dt);
    this.input.endFrame();
    requestAnimationFrame(this.frame);
  };

  private update(dt: number): void {
    const t = this.time;
    this.readInput();
    this.hero.update(dt, this.heroInput, this.events);
    const before = this.hero.position.clone();
    this.crypt.colliders.resolve(this.hero.position, this.hero.radius);
    if (before.distanceToSquared(this.hero.position) > 1e-6) this.hero.clampDash();
    this.hero.updateVisuals(dt);
    for (const c of this.sleepers) c.updateVisuals(dt);

    this.crypt.torches.update(t, dt);
    this.crypt.runes.update(t);
    this.crypt.altar.update(t, dt);
    this.crypt.door.update(t, dt);
    this.spawnDust(dt);
    this.glow.update(dt);
    this.dust.update(dt);

    this.rig.update(dt, t, this.hero.position);
    this.moon.position.copy(this.rig.focus).add(new THREE.Vector3(-9, 22, 7));
    this.moon.target.position.copy(this.rig.focus);
    this.heroLight.position.copy(this.hero.position).add(new THREE.Vector3(0, 3.2, 0.6));
    this.updateSeeThrough();

    const h = this.renderer.bufferSize.y;
    this.glow.setScale(h, this.camera.fov);
    this.dust.setScale(h, this.camera.fov);
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
    if (!k.pointerActive || !this.raycaster.ray.intersectPlane(this.floor, this.heroInput.aim)) {
      this.heroInput.aim.copy(this.hero.position).add(new THREE.Vector3(Math.sin(this.hero.facing), 0, Math.cos(this.hero.facing)));
    }
    this.heroInput.attack = k.buttonPressed(0) || k.keyPressed('KeyJ');
    this.heroInput.secondary = k.buttonPressed(2) || k.keyPressed('KeyK');
    this.heroInput.dodge = k.keyPressed('Space') || k.keyPressed('ShiftLeft');
    this.heroInput.special = k.keyPressed('KeyQ');
  }

  // Placeholder effects until the combat pass: sparks in the class color.
  private onMelee(step: ComboStep, index: number): void {
    const f = this.hero.facing;
    const reach = step.range * 0.75;
    const p = this.hero.position;
    for (let i = 0; i < 26; i++) {
      const a = f + (Math.random() - 0.5) * step.arc;
      const r = reach * (0.6 + Math.random() * 0.5);
      this.glow.spawn({
        x: p.x + Math.sin(a) * r,
        y: 0.9 + Math.random() * 0.8,
        z: p.z + Math.cos(a) * r,
        vx: Math.sin(a) * 3,
        vy: Math.random() * 1.5,
        vz: Math.cos(a) * 3,
        life: 0.25 + Math.random() * 0.25,
        size: 0.12,
        sizeEnd: 0.02,
        color: Math.random() < 0.3 ? this.heroHot : this.heroColor,
        intensity: 4,
        drag: 4,
      });
    }
    if (index === 2) this.rig.addTrauma(0.22);
  }

  private onCast(ability: Ability, aim: THREE.Vector3): void {
    const p = this.hero.position.clone().setY(1.2);
    const kind = ability.kind;
    if (kind.type === 'nova' || kind.type === 'whirl' || kind.type === 'sanctuary') {
      const radius = kind.radius;
      for (let i = 0; i < 90; i++) {
        const a = (i / 90) * Math.PI * 2;
        this.glow.spawn({
          x: p.x + Math.sin(a) * 0.6,
          y: 0.6,
          z: p.z + Math.cos(a) * 0.6,
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
      this.rig.addTrauma(0.3);
    } else {
      const dir = aim.clone().sub(this.hero.position).setY(0).normalize();
      this.burst(p.addScaledVector(dir, 0.9), this.heroColor, 24, 2.5);
    }
  }

  private onDash(kind: 'roll' | 'shadowstep' | 'blink', from: THREE.Vector3, to: THREE.Vector3): void {
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
    seeThrough.radius.value = size.y * 0.13;
    seeThrough.depth.value = -this.projected.copy(this.hero.position).setY(1.2).applyMatrix4(this.camera.matrixWorldInverse).z;
  }
}
