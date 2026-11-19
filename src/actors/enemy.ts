import * as THREE from 'three';
import type { Assets, SkeletonModel } from '../core/assets';
import { damp, dampAngle } from '../core/math';
import { Character } from './character';

export type EnemyKind = 'runt' | 'skeleton' | 'brute' | 'mage' | 'king' | 'charger';

export interface EnemyDef {
  kind: EnemyKind;
  name: string;
  model: SkeletonModel;
  scale: number;
  hp: number;
  speed: number;
  damage: number;
  /** How close it must be to swing. */
  reach: number;
  /** Seconds between attacks. */
  rest: number;
  clip: string;
  clipSpeed: number;
  /** Fraction of the clip at which the blow lands. */
  hitAt: number;
  /** Chance to shrug off a hit with its shield. */
  block: number;
  ranged?: { keepAway: number; projectileSpeed: number };
  /** Lowers its shield and rushes in a straight line after a warning (the red lane). */
  charge?: { distance: number; speed: number; windup: number };
  weapons: { item: string; hand: 'right' | 'left'; flip?: boolean; tilt?: number }[];
  eyes: string;
}

/**
 * The four monsters. They fill the roles of the original game's monsters:
 * the Brute is the Ogre (slow, tough, hits hard), the Runt is the Gremlin
 * (fast and fragile), the Skeleton keeps its shield block.
 */
export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  runt: {
    kind: 'runt',
    name: 'Runt',
    model: 'Skeleton_Minion',
    scale: 0.92,
    hp: 40,
    speed: 4.4,
    damage: 7,
    reach: 1.8,
    rest: 1.2,
    clip: '1H_Melee_Attack_Chop',
    clipSpeed: 1.05,
    hitAt: 0.42,
    block: 0,
    weapons: [{ item: 'Skeleton_Blade', hand: 'right' }],
    eyes: '#ffb83a',
  },
  skeleton: {
    kind: 'skeleton',
    name: 'Skeleton',
    model: 'Skeleton_Rogue',
    scale: 1,
    hp: 75,
    speed: 3.5,
    damage: 10,
    reach: 2,
    rest: 1.4,
    clip: '1H_Melee_Attack_Chop',
    clipSpeed: 0.95,
    hitAt: 0.44,
    block: 0.2,
    weapons: [
      { item: 'Skeleton_Blade', hand: 'right' },
      { item: 'Skeleton_Shield_Small_A', hand: 'left' },
    ],
    eyes: '#ffb83a',
  },
  brute: {
    kind: 'brute',
    name: 'Brute',
    model: 'Skeleton_Warrior',
    scale: 1.32,
    hp: 170,
    speed: 2.6,
    damage: 17,
    reach: 2.6,
    rest: 1.9,
    clip: '2H_Melee_Attack_Chop',
    clipSpeed: 0.72,
    hitAt: 0.5,
    block: 0,
    weapons: [{ item: 'Skeleton_Axe', hand: 'right' }],
    eyes: '#ff5a2a',
  },
  king: {
    kind: 'king',
    name: 'Skeleton King',
    model: 'Skeleton_Warrior',
    scale: 2.1,
    hp: 760,
    speed: 2.3,
    damage: 20,
    reach: 3.3,
    rest: 1.5,
    clip: '2H_Melee_Attack_Chop',
    clipSpeed: 0.5,
    hitAt: 0.55,
    block: 0,
    weapons: [{ item: 'Skeleton_Axe', hand: 'right' }],
    eyes: '#c77dff',
  },
  charger: {
    kind: 'charger',
    name: 'Shield Rammer',
    model: 'Skeleton_Rogue',
    scale: 1.12,
    hp: 90,
    speed: 3.2,
    damage: 14,
    reach: 1.7,
    rest: 2.2,
    clip: 'Taunt',
    clipSpeed: 1,
    hitAt: 0.5,
    block: 0,
    charge: { distance: 10, speed: 15, windup: 1 },
    weapons: [{ item: 'Skeleton_Shield_Large_A', hand: 'left' }],
    eyes: '#ff3a3a',
  },
  mage: {
    kind: 'mage',
    name: 'Bone Mage',
    model: 'Skeleton_Mage',
    scale: 1,
    hp: 55,
    speed: 3,
    damage: 9,
    reach: 11,
    rest: 2.4,
    clip: 'Spellcast_Shoot',
    clipSpeed: 0.9,
    hitAt: 0.45,
    block: 0,
    ranged: { keepAway: 7, projectileSpeed: 8.5 },
    weapons: [{ item: 'Skeleton_Staff', hand: 'right', flip: true, tilt: -0.6 }],
    eyes: '#c77dff',
  },
};

type State = 'dormant' | 'rising' | 'chase' | 'windup' | 'recover' | 'hurt' | 'dead' | 'charge';

export interface EnemyContext {
  target: THREE.Vector3;
  /** False while the hero hides in smoke: enemies wander instead. */
  targetVisible: boolean;
  others: readonly Enemy[];
  strike(enemy: Enemy): void;
  shoot(enemy: Enemy, direction: THREE.Vector3): void;
  /** True if this monster may start an attack now (only a few attack at once). */
  mayAttack(enemy: Enemy): boolean;
  /** Which way to walk to reach the hero around obstacles, or null to go straight. */
  path(position: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 | null;
  /** A charging monster ran into a wall. */
  bump(enemy: Enemy): void;
  /** A monster has just started winding up a blow (play its warning). */
  warn(enemy: Enemy): void;
}

/** A skeleton that wakes, chases, telegraphs its swing, and falls apart. */
export class Enemy extends Character {
  readonly def: EnemyDef;
  state: State = 'dormant';
  /** Seconds since death, for the sink-away. */
  deadTime = 0;
  /** 0..1 while winding up a blow; drives the red warning ring. */
  telegraph = 0;
  /** Fire Blade: seconds left burning, and damage per second. */
  burn = 0;
  burnDps = 0;
  burnTick = 0;
  /** A tougher, glowing champion: bigger, more health, always drops a reward. */
  elite = false;
  /** Which way it slides around obstacles: 1 or -1. */
  slide = Math.random() < 0.5 ? 1 : -1;
  /** Seconds left of being stunned by a heavy hit. */
  private stun = 0;
  private stateTime = 0;
  private cooldown = 0;
  private struck = false;
  private wanderAngle = Math.random() * Math.PI * 2;
  private readonly toTarget = new THREE.Vector3();
  private readonly steer = new THREE.Vector3();
  private readonly knock = new THREE.Vector3();
  private readonly route = new THREE.Vector3();
  /** The Shield Rammer's rush: its direction, and how far is left to run. */
  readonly chargeDir = new THREE.Vector3();
  chargeLeft = 0;
  /** First person: when this monster was first refused an attack for being out of view (see the game's mayAttack). */
  offscreenSince = -1;
  /** Extra reach while the player is in first person, so a monster can strike from further off the camera. */
  reachBonus = 0;
  /** How far this monster's blow reaches right now. */
  get reach(): number {
    return this.def.reach + (this.def.ranged ? 0 : this.reachBonus);
  }
  /** When the player first had it in frame after it appeared (telemetry: sight to first swing). */
  firstSeenAt = -1;
  /** Has the player been warned of this one (a rattle when it first comes into view)? */
  announced = true;
  /** How many times the game put off its entrance for lack of a fair spot. */
  spawnRetries = 0;
  /** Test bookkeeping: when and where it came in, and whether its stuck check ran. */
  spawnedAt = -1;
  readonly spawnedWhere = new THREE.Vector3();
  stuckChecked = false;
  /** Frontal hits stopped by the shield in a row; the guard breaks after a few. */
  blocksInRow = 0;
  /** True while the red warning lane should show. */
  get chargeWarning(): boolean {
    return this.state === 'windup' && !!this.def.charge;
  }
  private readonly lastPos = new THREE.Vector3();

  /** Stretches the wind-up of every blow (Easy gives young players longer to see it coming). */
  windupScale = 1;

  constructor(assets: Assets, def: EnemyDef, hpScale: number, windupScale = 1) {
    super(assets, def.model, assets.skeletonClips);
    this.windupScale = windupScale;
    this.def = def;
    this.maxHp = this.hp = Math.round(def.hp * hpScale);
    this.radius = 0.55 * def.scale;
    this.model.scale.setScalar(def.scale);
    for (const w of def.weapons) this.hold(assets.weapon(w.item), w.hand, w.flip, w.tilt);
    this.setGlow((n) => n.endsWith('_Eyes'), def.eyes, 4);
    this.cooldown = 0.6 + Math.random() * 0.8;
  }

  /** The King's second phase: quicker swings and shorter warnings. */
  enrage(): void {
    this.speedBoost = 1.3;
    this.animSpeed = 1.35;
  }

  speedBoost = 1;
  animSpeed = 1;

  /** Turns this monster into an elite champion. */
  makeElite(hpBoost: number): void {
    this.elite = true;
    this.maxHp = this.hp = Math.round(this.maxHp * hpBoost);
    this.model.scale.multiplyScalar(1.22);
    this.radius *= 1.15;
    this.setGlow((n) => n.endsWith('_Eyes'), '#ffd23a', 7);
  }

  get active(): boolean {
    return this.alive && this.state !== 'dormant' && this.state !== 'rising';
  }

  /** Waits out of sight until it is summoned. */
  sleep(): void {
    this.state = 'dormant';
    this.root.visible = false;
    this.animator.play('Idle_Combat', { fade: 0 });
  }

  /**
   * How a monster comes into the world. Timings follow the readable-telegraph rule
   * (a tell, then the body, then a pause before the first swing):
   * - grave: a tell under the ground (TELL), an upright rise out of the earth (RISE),
   *   a shake awake while turning to face the hero (AWAKEN), then slow first steps;
   * - wake: standing in place, shakes awake (the King, sleepers found in the open);
   * - walk: already on its feet out of sight, walks in slowly and speeds up.
   */
  static readonly TELL = 0.8;
  static readonly RISE = 2.2;
  /** Depth the body starts at, in model units (the rig is ~2 m tall at scale 1). */
  private static readonly SUNK = 1.9;
  /** The rise cannot be hurt until the torso clears the ground. */
  private static readonly HITTABLE_DEPTH = 0.6;
  private riseMode: 'grave' | 'wake' | 'walk' = 'grave';
  /** Seconds since the rise began, driving the phases above. */
  private awakenEnd = 0;
  /** 0..1: a freshly risen skeleton shuffles stiffly, then picks up speed as it comes for you. */
  wake = 1;
  /** Seconds left of gentle collision resolve after rising inside a grave's footprint. */
  collisionEase = 0;
  /** Where to turn while awakening (the hero), set by the game. */
  readonly faceTarget = new THREE.Vector3();
  private readonly fullScale = new THREE.Vector3();

  rise(mode: 'grave' | 'wake' | 'walk' = 'grave'): void {
    if (this.state !== 'rising') this.fullScale.copy(this.model.scale);
    this.spawnedWhere.copy(this.position);
    this.state = 'rising';
    this.stateTime = 0;
    this.awakenEnd = 0;
    this.riseMode = mode;
    this.model.scale.copy(this.fullScale);
    this.root.visible = true;
    if (mode === 'walk') {
      this.wakeUp();
      return;
    }
    // Sunk in the ground (grave) or standing still (wake), inert until the awaken clip.
    this.model.position.y = mode === 'grave' ? -Enemy.SUNK * this.fullScale.y : 0;
    this.animator.play('Skeleton_Inactive_Standing_Pose', { fade: 0, restart: true });
    this.setGlow((n) => n.endsWith('_Eyes'), this.def.eyes, 0);
  }

  /** Leaves the rising state and starts slow, speeding up over a few seconds. */
  private wakeUp(): void {
    this.model.position.y = 0;
    this.riseTilt = 0;
    this.wake = 0.25;
    this.cooldown = Math.max(this.cooldown, 1.2);
    this.collisionEase = 1;
    this.toChase();
  }

  /** Where the body is in its rise: 0 = fully sunk, 1 = feet on the ground. */
  get riseProgress(): number {
    if (this.state !== 'rising' || this.riseMode !== 'grave') return 1;
    const t = this.stateTime - Enemy.TELL;
    if (t <= 0) return 0;
    const k = Math.min(1, t / Enemy.RISE);
    return 1 - Math.pow(1 - k, 3);
  }

  /** Steps into the room already awake (from a niche or a corridor), slow at first. */
  emerge(): void {
    this.model.scale.copy(this.state === 'rising' ? this.fullScale : this.model.scale);
    this.root.visible = true;
    this.wakeUp();
  }

  /** True while the monster is not yet out: hidden, or still mostly under the ground. */
  get summoning(): boolean {
    if (this.state === 'dormant') return true;
    if (this.state !== 'rising') return false;
    if (this.riseMode === 'grave') return this.model.position.y < -Enemy.HITTABLE_DEPTH * this.fullScale.y;
    return this.stateTime < 0.3;
  }

  /** Applies a hit. Returns the damage dealt, 0 if blocked, -1 if it can't be hurt right now. */
  hurt(amount: number, from: THREE.Vector3, knockback: number): number {
    if (!this.alive || this.summoning) return -1;
    if (this.def.block > 0 && this.guardUp(from)) {
      this.flash('#9fd8ff', 0.12);
      this.blocksInRow++;
      if (this.blocksInRow >= 3) {
        // Three blows on the shield knock it aside: a clear opening.
        this.blocksInRow = 0;
        this.state = 'hurt';
        this.stateTime = 0;
        this.telegraph = 0;
        this.stun = 1.1;
        this.animator.play('Hit_B', { loop: false, fade: 0.05, speed: 1.1, restart: true });
        return -2;
      }
      return 0;
    }
    this.blocksInRow = 0;
    this.hp = Math.max(0, this.hp - amount);
    this.flash('#ffffff', 0.08);
    this.jolt(from, Math.min(1.4, 0.6 + amount / 40));
    this.knock.copy(this.position).sub(from).setY(0);
    if (this.knock.lengthSq() > 0.0001) this.knock.normalize().multiplyScalar(knockback / Math.sqrt(this.def.scale));
    if (this.hp === 0) {
      this.alive = false;
      this.state = 'dead';
      this.stateTime = 0;
      this.telegraph = 0;
      this.animator.play(Math.random() < 0.5 ? 'Death_A' : 'Death_C_Skeletons', { loop: false, fade: 0.08, restart: true });
      return amount;
    }
    // Heavy hits interrupt light enemies; the Brute only flinches.
    if (this.state !== 'rising' && this.def.kind !== 'king' && (this.def.kind !== 'brute' || amount >= 30)) {
      this.state = 'hurt';
      this.stateTime = 0;
      this.telegraph = 0;
      this.stun = 0.32;
      this.animator.play(Math.random() < 0.5 ? 'Hit_A' : 'Hit_B', { loop: false, fade: 0.05, speed: 1.4, restart: true });
    }
    return amount;
  }

  /**
   * A shield skeleton's guard: it stops blows from the front while it walks or
   * waits. It is open from the sides and behind, while it swings and recovers,
   * and while it is staggered. Readable, and the opening is learnable.
   */
  guardUp(from: THREE.Vector3): boolean {
    if (this.def.block <= 0 || this.state !== 'chase') return false;
    const dx = from.x - this.position.x;
    const dz = from.z - this.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.01) return false;
    const facing = Math.sin(this.facing) * (dx / d) + Math.cos(this.facing) * (dz / d);
    return facing > 0.45;
  }

  update(dt: number, ctx: EnemyContext): void {
    this.warnCtx = ctx;
    this.stateTime += dt;
    this.cooldown -= dt;
    // Knockback slides out over a few frames.
    this.position.addScaledVector(this.knock, dt * 8);
    this.knock.multiplyScalar(Math.exp(-10 * dt));

    switch (this.state) {
      case 'dormant':
        return;
      case 'dead':
        this.deadTime += dt;
        if (this.deadTime > 1.8) this.position.y = -(this.deadTime - 1.8) * 0.9;
        return;
      case 'rising': {
        const t = this.stateTime;
        if (this.riseMode === 'grave') {
          const k = this.riseProgress;
          this.model.position.y = -Enemy.SUNK * this.fullScale.y * (1 - k);
          // Leans forward as it comes up, so the skull and a hand break the earth before the body.
          this.riseTilt = 0.32 * (1 - k) * Math.min(1, k * 4);
          // The eyes light up as the head clears the ground (under the floor nobody would see them).
          this.setGlow((n) => n.endsWith('_Eyes'), this.def.eyes, 4 * Math.min(1, Math.max(0, (k - 0.45) / 0.3)));
        }
        const awakenAt = this.riseMode === 'grave' ? Enemy.TELL + Enemy.RISE : Enemy.TELL;
        if (t >= awakenAt && this.awakenEnd === 0) {
          const a = this.animator.play('Skeletons_Awaken_Standing', { fade: 0.12, loop: false, restart: true, speed: 0.9 });
          this.awakenEnd = awakenAt + a.getClip().duration / 0.9;
          this.setGlow((n) => n.endsWith('_Eyes'), this.def.eyes, 4);
        }
        // Turns to face the hero while it shakes awake (no snap).
        if (this.awakenEnd > 0) this.facing = dampAngle(this.facing, Math.atan2(this.faceTarget.x - this.position.x, this.faceTarget.z - this.position.z), 2.5, dt);
        if (this.awakenEnd > 0 && t >= this.awakenEnd) this.wakeUp();
        return;
      }
      case 'hurt':
        this.stun -= dt;
        this.velocity.multiplyScalar(Math.exp(-12 * dt));
        this.position.addScaledVector(this.velocity, dt);
        if (this.stun <= 0) this.toChase();
        return;
      case 'windup':
      case 'recover':
        this.updateAttack(dt, ctx);
        return;
      case 'chase':
        this.updateChase(dt, ctx);
        return;
      case 'charge':
        this.updateCharge(dt, ctx);
    }
  }

  private updateCharge(dt: number, ctx: EnemyContext): void {
    const c = this.def.charge!;
    // Hit a wall last frame (the game pushed it back)? Dazed: a free moment to hit it.
    const moved = this.position.distanceTo(this.lastPos);
    if (this.stateTime > 0.12 && moved < c.speed * dt * 0.35) {
      this.chargeLeft = 0;
      this.state = 'hurt';
      this.stateTime = 0;
      this.stun = 1.6;
      this.velocity.set(0, 0, 0);
      this.animator.play('Hit_B', { loop: false, fade: 0.05, restart: true });
      ctx.bump(this);
      return;
    }
    this.lastPos.copy(this.position);
    const step = Math.min(this.chargeLeft, c.speed * dt);
    this.position.addScaledVector(this.chargeDir, step);
    this.chargeLeft -= step;
    if (!this.struck && this.position.distanceTo(ctx.target) < this.def.reach) {
      this.struck = true;
      ctx.strike(this);
    }
    if (this.chargeLeft <= 0) {
      this.cooldown = this.def.rest * (0.8 + Math.random() * 0.4);
      this.toChase();
    }
  }

  private toChase(): void {
    this.state = 'chase';
    this.stateTime = 0;
    this.telegraph = 0;
  }

  private updateChase(dt: number, ctx: EnemyContext): void {
    const def = this.def;
    this.toTarget.copy(ctx.target).sub(this.position).setY(0);
    const dist = this.toTarget.length();
    this.steer.set(0, 0, 0);

    if (!ctx.targetVisible) {
      // Lost the hero in the smoke: shuffle about.
      this.wanderAngle += (Math.random() - 0.5) * dt * 3;
      this.steer.set(Math.sin(this.wanderAngle), 0, Math.cos(this.wanderAngle)).multiplyScalar(0.35);
    } else if (def.charge && dist > 2.5 && dist < def.charge.distance - 1 && this.cooldown <= 0 && ctx.mayAttack(this)) {
      return this.startAttack(this.toTarget.clone().divideScalar(Math.max(dist, 0.001)));
    } else if (def.ranged) {
      const dir = this.toTarget.clone().divideScalar(Math.max(dist, 0.001));
      if (dist > def.ranged.keepAway + 1.5) this.steer.copy(ctx.path(this.position, this.route) ?? dir);
      else if (dist < def.ranged.keepAway - 1.5) this.steer.copy(dir).negate();
      if (dist < def.reach && this.cooldown <= 0 && ctx.mayAttack(this)) return this.startAttack(dir);
    } else {
      if (dist > this.reach * 0.8) {
        // Far away: follow the walking map around pillars; close up: go straight in.
        const around = dist > 1.8 ? ctx.path(this.position, this.route) : null;
        if (around) this.steer.copy(around);
        else this.steer.copy(this.toTarget).divideScalar(Math.max(dist, 0.001));
      }
      if (dist < this.reach && this.cooldown <= 0) {
        if (ctx.mayAttack(this)) return this.startAttack(this.toTarget.clone().divideScalar(Math.max(dist, 0.001)));
        // Waiting for a turn: step around the hero instead of crowding in.
        this.steer.set(-this.toTarget.z, 0, this.toTarget.x).normalize().multiplyScalar(this.slide * 0.6);
        if (dist < this.reach * 0.7) this.steer.addScaledVector(this.toTarget, -0.6 / Math.max(dist, 0.001));
      }
    }

    // Keep a little space from the others so they surround instead of stacking.
    for (const other of ctx.others) {
      if (other === this || !other.alive || other.state === 'dormant') continue;
      const dx = this.position.x - other.position.x;
      const dz = this.position.z - other.position.z;
      const d2 = dx * dx + dz * dz;
      const min = (this.radius + other.radius) * 1.6;
      if (d2 > 0.0001 && d2 < min * min) {
        const d = Math.sqrt(d2);
        this.steer.x += (dx / d) * (min - d) * 1.4;
        this.steer.z += (dz / d) * (min - d) * 1.4;
      }
    }

    if (this.wake < 1) this.wake = Math.min(1, this.wake + dt / 3.5);
    const speed = def.speed * this.speedBoost * this.wake;
    this.velocity.x = damp(this.velocity.x, this.steer.x * speed, 8, dt);
    this.velocity.z = damp(this.velocity.z, this.steer.z * speed, 8, dt);
    this.position.addScaledVector(this.velocity, dt);
    const moving = this.velocity.lengthSq() > 0.4;
    const faceDir = ctx.targetVisible && dist < 9 ? this.toTarget : this.velocity;
    // A shield bearer turns slowly while it guards up close, so stepping round it is a real opening.
    const turnRate = this.def.block > 0 && dist < 3.5 ? 2.2 : 9;
    if (faceDir.lengthSq() > 0.01) this.facing = dampAngle(this.facing, Math.atan2(faceDir.x, faceDir.z), turnRate, dt);
    if (moving) {
      const fast = this.def.kind === 'runt' && this.wake > 0.7;
      this.animator.play(fast ? 'Running_C' : 'Walking_D_Skeletons', { speed: fast ? 1 : 1.25 * (speed / 3), fade: 0.15 });
    } else {
      this.animator.play('Idle_Combat', { fade: 0.2 });
    }
  }

  private startAttack(dir: THREE.Vector3): void {
    this.state = 'windup';
    this.stateTime = 0;
    this.struck = false;
    this.facing = Math.atan2(dir.x, dir.z);
    this.velocity.set(0, 0, 0);
    // The warning part of the swing runs slower on Easy; once the blow lands the clip finishes at normal speed.
    this.animator.play(this.def.clip, { loop: false, speed: (this.def.clipSpeed * this.animSpeed) / this.windupScale, fade: 0.08, restart: true });
    this.warnCtx?.warn(this);
  }

  private warnCtx: EnemyContext | null = null;

  private updateAttack(dt: number, ctx: EnemyContext): void {
    const p = this.animator.progress;
    if (this.state === 'windup') {
      // Keep turning toward the hero during the windup, slowly, so a dodge still works.
      if (ctx.targetVisible) {
        this.toTarget.copy(ctx.target).sub(this.position).setY(0);
        this.facing = dampAngle(this.facing, Math.atan2(this.toTarget.x, this.toTarget.z), 2.5, dt);
      }
      if (this.def.charge) {
        // Aim locks in for the last half of the warning, so a sidestep dodges it.
        const c = this.def.charge;
        if (this.stateTime < c.windup * 0.5 && ctx.targetVisible) {
          this.toTarget.copy(ctx.target).sub(this.position).setY(0);
          this.facing = dampAngle(this.facing, Math.atan2(this.toTarget.x, this.toTarget.z), 6, dt);
        }
        this.chargeDir.set(Math.sin(this.facing), 0, Math.cos(this.facing));
        this.telegraph = Math.min(1, this.stateTime / (c.windup * this.windupScale));
        if (this.stateTime >= c.windup * this.windupScale) {
          this.telegraph = 0;
          this.state = 'charge';
          this.stateTime = 0;
          this.struck = false;
          this.chargeLeft = c.distance;
          this.lastPos.copy(this.position);
          this.animator.play('Running_C', { speed: 1.6, fade: 0.05 });
        }
        return;
      }
      this.telegraph = Math.min(1, p / this.def.hitAt);
      if (p >= this.def.hitAt && !this.struck) {
        this.struck = true;
        this.telegraph = 0;
        this.state = 'recover';
        if (this.windupScale !== 1) this.animator.play(this.def.clip, { loop: false, speed: this.def.clipSpeed * this.animSpeed, fade: 0, restart: false }).timeScale = this.def.clipSpeed * this.animSpeed;
        if (this.def.ranged) {
          ctx.shoot(this, new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing)));
        } else {
          ctx.strike(this);
        }
      }
    } else if (p >= 1) {
      this.cooldown = this.def.rest * (0.8 + Math.random() * 0.4);
      this.toChase();
    }
  }
}
