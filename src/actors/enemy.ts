import * as THREE from 'three';
import type { Assets, SkeletonModel } from '../core/assets';
import { damp, dampAngle } from '../core/math';
import { Character } from './character';

export type EnemyKind = 'runt' | 'skeleton' | 'brute' | 'mage' | 'king';

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

type State = 'dormant' | 'rising' | 'chase' | 'windup' | 'recover' | 'hurt' | 'dead';

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

  constructor(assets: Assets, def: EnemyDef, hpScale: number) {
    super(assets, def.model, assets.skeletonClips);
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

  /** Lies on the floor until woken. */
  sleep(): void {
    this.state = 'dormant';
    this.animator.play('Skeletons_Inactive_Floor_Pose', { fade: 0 });
  }

  /** Gets up off the floor (dormant ones) or climbs out of the ground (reinforcements). */
  rise(fromGround: boolean): void {
    this.state = 'rising';
    this.stateTime = 0;
    const clip = fromGround ? 'Spawn_Ground_Skeletons' : 'Skeletons_Awaken_Floor';
    this.animator.play(clip, { loop: false, fade: fromGround ? 0 : 0.1, speed: fromGround ? 1.15 : 1.35, restart: true });
  }

  /** Applies a hit. Returns the damage dealt, 0 if blocked, -1 if it can't be hurt right now. */
  hurt(amount: number, from: THREE.Vector3, knockback: number): number {
    if (!this.alive || this.state === 'dormant') return -1;
    if (this.def.block > 0 && this.state !== 'windup' && Math.random() < this.def.block) {
      this.flash('#9fd8ff', 0.12);
      return 0;
    }
    this.hp = Math.max(0, this.hp - amount);
    this.flash('#ffffff', 0.12);
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

  update(dt: number, ctx: EnemyContext): void {
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
      case 'rising':
        if (this.animator.progress >= 1) this.toChase();
        return;
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
    } else if (def.ranged) {
      const dir = this.toTarget.clone().divideScalar(Math.max(dist, 0.001));
      if (dist > def.ranged.keepAway + 1.5) this.steer.copy(ctx.path(this.position, this.route) ?? dir);
      else if (dist < def.ranged.keepAway - 1.5) this.steer.copy(dir).negate();
      if (dist < def.reach && this.cooldown <= 0 && ctx.mayAttack(this)) return this.startAttack(dir);
    } else {
      if (dist > def.reach * 0.8) {
        // Far away: follow the walking map around pillars; close up: go straight in.
        const around = dist > 1.8 ? ctx.path(this.position, this.route) : null;
        if (around) this.steer.copy(around);
        else this.steer.copy(this.toTarget).divideScalar(Math.max(dist, 0.001));
      }
      if (dist < def.reach && this.cooldown <= 0) {
        if (ctx.mayAttack(this)) return this.startAttack(this.toTarget.clone().divideScalar(Math.max(dist, 0.001)));
        // Waiting for a turn: step around the hero instead of crowding in.
        this.steer.set(-this.toTarget.z, 0, this.toTarget.x).normalize().multiplyScalar(this.slide * 0.6);
        if (dist < def.reach * 0.7) this.steer.addScaledVector(this.toTarget, -0.6 / Math.max(dist, 0.001));
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

    const speed = def.speed * this.speedBoost;
    this.velocity.x = damp(this.velocity.x, this.steer.x * speed, 8, dt);
    this.velocity.z = damp(this.velocity.z, this.steer.z * speed, 8, dt);
    this.position.addScaledVector(this.velocity, dt);
    const moving = this.velocity.lengthSq() > 0.4;
    const faceDir = ctx.targetVisible && dist < 9 ? this.toTarget : this.velocity;
    if (faceDir.lengthSq() > 0.01) this.facing = dampAngle(this.facing, Math.atan2(faceDir.x, faceDir.z), 9, dt);
    if (moving) {
      const fast = this.def.kind === 'runt';
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
    this.animator.play(this.def.clip, { loop: false, speed: this.def.clipSpeed * this.animSpeed, fade: 0.08, restart: true });
  }

  private updateAttack(dt: number, ctx: EnemyContext): void {
    const p = this.animator.progress;
    if (this.state === 'windup') {
      // Keep turning toward the hero during the windup, slowly, so a dodge still works.
      if (ctx.targetVisible) {
        this.toTarget.copy(ctx.target).sub(this.position).setY(0);
        this.facing = dampAngle(this.facing, Math.atan2(this.toTarget.x, this.toTarget.z), 2.5, dt);
      }
      this.telegraph = Math.min(1, p / this.def.hitAt);
      if (p >= this.def.hitAt && !this.struck) {
        this.struck = true;
        this.telegraph = 0;
        this.state = 'recover';
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
