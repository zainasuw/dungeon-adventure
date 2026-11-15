import * as THREE from 'three';
import type { Assets } from '../core/assets';
import { clamp, damp, dampAngle } from '../core/math';
import { Character } from './character';
import type { Ability, AbilityKind, ComboStep, HeroClass } from './classes';

/** What the hero asks the game to do this frame (hits, projectiles, effects). */
export interface HeroEvents {
  /** A melee swing has begun; the blow lands at `hitAt` of the clip (seconds given). */
  swing(step: ComboStep, comboIndex: number, secondsToHit: number): void;
  melee(step: ComboStep, comboIndex: number): void;
  cast(ability: Ability, aim: THREE.Vector3): void;
  dash(kind: 'roll' | 'shadowstep' | 'blink', from: THREE.Vector3, to: THREE.Vector3): void;
}

type State = 'free' | 'attack' | 'cast' | 'dash' | 'hurt' | 'dead' | 'interact';

export interface HeroInput {
  /** Camera-relative movement on the floor plane, length 0..1. */
  move: THREE.Vector3;
  /** Point on the floor the mouse is over. */
  aim: THREE.Vector3;
  attack: boolean;
  secondary: boolean;
  dodge: boolean;
  special: boolean;
}

const BUFFER_TIME = 0.22;

/**
 * The player character: movement, dodge, melee combos and casting, with input
 * buffering so presses during an animation still count.
 */
export class Hero extends Character {
  readonly def: HeroClass;
  resource = 100;
  readonly cooldowns: number[];
  /** Remaining damage-immunity time after being hit (a short mercy window). */
  invulnerable = 0;
  /** Remaining immunity from a dodge roll, step or blink: the only kind that counts as "Dodged!". */
  dodgeInvul = 0;
  /** Remaining time of the class's guard/barrier/smoke/renew effect. */
  buff = 0;
  /** Shield points left on the Mage's Arcane Shield. */
  barrier = 0;
  state: State = 'free';
  /** Blessing effects: move speed, and how fast the dodge and powers recharge. */
  speedBoost = 1;
  dodgeRecharge = 1;
  powerRecharge = 1;

  private stateTime = 0;
  private combo = 0;
  private comboResetTimer = 0;
  private hitDone = false;
  private castDone = false;
  private activeAbility: Ability | null = null;
  private buffered: { slot: number; time: number } | null = null;
  private readonly dashFrom = new THREE.Vector3();
  private readonly dashTo = new THREE.Vector3();
  private dashDuration = 0;
  private readonly aimDir = new THREE.Vector3(0, 0, -1);
  private lungeSpeed = 0;
  private readonly lungeDir = new THREE.Vector3();

  constructor(assets: Assets, def: HeroClass) {
    super(assets, def.model, assets.heroClips);
    this.def = def;
    this.maxHp = this.hp = def.maxHp;
    this.radius = 0.6;
    this.cooldowns = def.abilities.map(() => 0);
    this.hideParts(def.hide);
    for (const { item, hand, flip, tilt } of def.hold) this.hold(assets.weapon(item), hand, flip, tilt);
    this.animator.play('Idle');
  }

  /** Seconds left / total, per ability slot, for the HUD. */
  cooldownFraction(slot: number): number {
    const total = this.def.abilities[slot].cooldown;
    return total > 0 ? this.cooldowns[slot] / total : 0;
  }

  update(dt: number, input: HeroInput, events: HeroEvents): void {
    this.stateTime += dt;
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.dodgeInvul = Math.max(0, this.dodgeInvul - dt);
    this.buff = Math.max(0, this.buff - dt);
    if (this.buff === 0) this.barrier = 0;
    for (let i = 0; i < this.cooldowns.length; i++) this.cooldowns[i] = Math.max(0, this.cooldowns[i] - dt);
    this.resource = Math.min(100, this.resource + dt * 9);
    this.comboResetTimer -= dt;
    if (this.comboResetTimer <= 0) this.combo = 0;

    if (input.aim) this.aimDir.copy(input.aim).sub(this.position).setY(0);
    if (this.aimDir.lengthSq() < 0.01) this.aimDir.set(Math.sin(this.facing), 0, Math.cos(this.facing));
    this.aimDir.normalize();

    const pressed = [input.attack, input.secondary, input.dodge, input.special];
    pressed.forEach((p, slot) => {
      if (p) this.buffered = { slot, time: BUFFER_TIME };
    });
    if (this.buffered) {
      this.buffered.time -= dt;
      if (this.buffered.time <= 0) this.buffered = null;
    }

    switch (this.state) {
      case 'free':
        this.move(dt, input.move);
        this.tryStartBuffered(input, events);
        break;
      case 'attack':
        this.updateAttack(dt, input, events);
        break;
      case 'cast':
        this.updateCast(dt, input, events);
        break;
      case 'dash':
        this.updateDash();
        break;
      case 'hurt':
        this.slowDown(dt);
        if (this.stateTime > 0.32) this.toFree();
        break;
      case 'interact':
        this.slowDown(dt);
        if (this.stateTime > 0.7) this.toFree();
        break;
      case 'dead':
        this.slowDown(dt);
        break;
    }
    this.position.addScaledVector(this.velocity, dt);
  }

  /** Applies incoming damage after dodges, guards and shields. Returns damage taken. */
  takeHit(amount: number): number {
    if (!this.alive || this.invulnerable > 0 || this.dodgeInvul > 0) return 0;
    const kind = this.def.abilities[3].kind;
    if (this.buff > 0 && kind.type === 'guard') amount *= 1 - kind.reduction;
    if (this.barrier > 0) {
      const absorbed = Math.min(this.barrier, amount);
      this.barrier -= absorbed;
      amount -= absorbed;
    }
    if (amount <= 0) return 0;
    this.hp = Math.max(0, this.hp - amount);
    this.flash('#ff3030', 0.15);
    this.invulnerable = 0.45;
    if (this.hp === 0) {
      this.alive = false;
      this.state = 'dead';
      this.stateTime = 0;
      this.animator.play('Death_A', { loop: false, fade: 0.1 });
    } else if (this.state === 'free') {
      this.state = 'hurt';
      this.stateTime = 0;
      this.animator.play('Hit_A', { loop: false, speed: 1.4, fade: 0.06 });
    }
    return amount;
  }

  heal(amount: number): void {
    if (this.alive) this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  interact(): void {
    if (this.state !== 'free') return;
    this.state = 'interact';
    this.stateTime = 0;
    this.velocity.set(0, 0, 0);
    this.animator.play('Interact', { loop: false, speed: 1.3, fade: 0.1 });
  }

  /** Brings the hero back to full health in place (look-test restart). */
  revive(): void {
    this.alive = true;
    this.hp = this.maxHp;
    this.resource = 100;
    this.cooldowns.fill(0);
    this.invulnerable = 1;
    this.toFree();
  }

  private move(dt: number, move: THREE.Vector3): void {
    const target = move.lengthSq() > 0.001 ? move : null;
    const speed = this.def.speed * this.speedBoost;
    const lambda = target ? 26 : 22;
    this.velocity.x = damp(this.velocity.x, target ? target.x * speed : 0, lambda, dt);
    this.velocity.z = damp(this.velocity.z, target ? target.z * speed : 0, lambda, dt);
    if (target) this.facing = dampAngle(this.facing, Math.atan2(target.x, target.z), 32, dt);
    const moving = this.velocity.lengthSq() > 0.6;
    this.animator.play(moving ? 'Running_A' : 'Idle', { fade: 0.12, speed: moving ? clamp(this.velocity.length() / speed, 0.6, 1.1) * 1.05 : 1 });
  }

  private slowDown(dt: number): void {
    this.velocity.x = damp(this.velocity.x, 0, 12, dt);
    this.velocity.z = damp(this.velocity.z, 0, 12, dt);
  }

  private faceAim(): void {
    this.facing = Math.atan2(this.aimDir.x, this.aimDir.z);
  }

  private tryStartBuffered(input: HeroInput, events: HeroEvents): boolean {
    if (!this.buffered) return false;
    const slot = this.buffered.slot;
    const ability = this.def.abilities[slot];
    if (this.cooldowns[slot] > 0 || this.resource < ability.cost) return false;
    this.buffered = null;
    this.cooldowns[slot] = ability.cooldown * (slot === 2 ? this.dodgeRecharge : slot > 0 ? this.powerRecharge : 1);
    this.resource -= ability.cost;
    this.start(ability, input, events);
    return true;
  }

  private start(ability: Ability, input: HeroInput, events: HeroEvents): void {
    const kind = ability.kind;
    this.activeAbility = ability;
    this.stateTime = 0;
    this.hitDone = false;
    this.castDone = false;
    switch (kind.type) {
      case 'melee': {
        const step = kind.combo[this.combo % kind.combo.length];
        this.faceAim();
        this.state = 'attack';
        this.lungeDir.copy(this.aimDir);
        this.lungeSpeed = step.lunge * 7;
        this.animator.play(step.clip, { loop: false, speed: step.speed, fade: 0.06, restart: true });
        events.swing(step, this.combo % kind.combo.length, (this.animator.duration(step.clip) / step.speed) * step.hitAt);
        break;
      }
      case 'roll':
      case 'shadowstep':
      case 'blink':
        this.startDash(kind, input, events);
        break;
      default:
        this.faceAim();
        this.state = 'cast';
        this.velocity.multiplyScalar(0.3);
        this.animator.play(castClip(kind), { loop: false, speed: castSpeed(kind), fade: 0.06, restart: true });
    }
  }

  private updateAttack(dt: number, input: HeroInput, events: HeroEvents): void {
    const kind = this.activeAbility!.kind;
    if (kind.type !== 'melee') return this.toFree();
    const step = kind.combo[this.combo % kind.combo.length];
    const p = this.animator.progress;
    // Lunge forward early in the swing, then plant.
    this.lungeSpeed = damp(this.lungeSpeed, 0, 9, dt);
    this.velocity.copy(this.lungeDir).multiplyScalar(p < step.hitAt ? this.lungeSpeed : 0);
    if (!this.hitDone && p >= step.hitAt) {
      this.hitDone = true;
      events.melee(step, this.combo % kind.combo.length);
    }
    if (this.dodgeCancel(input, events)) return;
    // Walking cancels the end of a swing, so the hero never feels stuck.
    if (this.hitDone && p >= step.cancelAt * 0.85 && input.move.lengthSq() > 0.04 && this.buffered?.slot !== 0) {
      this.combo = (this.combo + 1) % kind.combo.length;
      this.comboResetTimer = 0.55;
      this.toFree();
      this.move(dt, input.move);
      return;
    }
    if (p >= step.cancelAt && this.buffered) {
      const slot = this.buffered.slot;
      if (slot === 0) {
        this.combo = (this.combo + 1) % kind.combo.length;
        this.comboResetTimer = 0.9;
      }
      if (this.tryStartBuffered(input, events)) return;
    }
    if (p >= 1) {
      this.combo = (this.combo + 1) % kind.combo.length;
      this.comboResetTimer = 0.55;
      this.toFree();
    }
  }

  private updateCast(dt: number, input: HeroInput, events: HeroEvents): void {
    const ability = this.activeAbility!;
    const p = this.animator.progress;
    this.slowDown(dt);
    if (!this.castDone && p >= castPoint(ability.kind)) {
      this.castDone = true;
      events.cast(ability, input.aim);
    }
    if (this.dodgeCancel(input, events)) return;
    if (this.castDone && p >= 0.5 && input.move.lengthSq() > 0.04 && !this.buffered) {
      this.toFree();
      this.move(dt, input.move);
      return;
    }
    if (p >= 0.62 && this.buffered && this.buffered.slot !== 0) {
      if (this.tryStartBuffered(input, events)) return;
    }
    if (p >= 0.8 && this.buffered?.slot === 0) {
      if (this.tryStartBuffered(input, events)) return;
    }
    if (p >= 1) this.toFree();
  }

  /** A dodge can interrupt any attack or cast after a few frames: it always feels responsive. */
  private dodgeCancel(input: HeroInput, events: HeroEvents): boolean {
    if (this.buffered?.slot !== 2 || this.stateTime < 0.08) return false;
    return this.tryStartBuffered(input, events);
  }

  private startDash(kind: AbilityKind & { distance: number }, input: HeroInput, events: HeroEvents): void {
    const dir = input.move.lengthSq() > 0.001 ? input.move.clone().normalize() : this.aimDir.clone();
    this.facing = Math.atan2(dir.x, dir.z);
    this.dashFrom.copy(this.position);
    this.dashTo.copy(this.position).addScaledVector(dir, kind.distance);
    this.state = 'dash';
    if (kind.type === 'blink') {
      this.dashDuration = 0.14;
      this.dodgeInvul = Math.max(this.dodgeInvul, 0.25);
      this.animator.play('Spellcast_Raise', { loop: false, speed: 2.2, fade: 0.05, restart: true });
    } else {
      this.dashDuration = kind.type === 'shadowstep' ? 0.3 : 0.38;
      this.dodgeInvul = Math.max(this.dodgeInvul, this.dashDuration * 0.85);
      this.animator.play('Dodge_Forward', { loop: false, speed: kind.type === 'shadowstep' ? 1.9 : 1.6, fade: 0.05, restart: true });
    }
    events.dash(kind.type as 'roll' | 'shadowstep' | 'blink', this.dashFrom, this.dashTo);
  }

  private updateDash(): void {
    const t = Math.min(1, this.stateTime / this.dashDuration);
    // Ease out: fast start, soft landing. The game resolves collisions after.
    const eased = 1 - (1 - t) * (1 - t);
    const target = this.dashFrom.clone().lerp(this.dashTo, eased);
    this.velocity.set(0, 0, 0);
    this.position.x = target.x;
    this.position.z = target.z;
    if (t >= 1) {
      this.dashTo.copy(this.position);
      this.toFree();
    }
  }

  /** Called by the game when a dash is stopped by a wall, so the next frame doesn't pull back. */
  clampDash(): void {
    if (this.state !== 'dash') return;
    this.dashFrom.copy(this.position);
    this.dashTo.copy(this.position);
  }

  private toFree(): void {
    this.state = 'free';
    this.stateTime = 0;
    this.activeAbility = null;
  }
}

function castClip(kind: AbilityKind): string {
  switch (kind.type) {
    case 'bolt':
      return kind.clip;
    case 'whirl':
      return '2H_Melee_Attack_Spin';
    case 'fan':
      return 'Throw';
    case 'nova':
      return 'Spellcast_Raise';
    case 'sanctuary':
      return 'Spellcast_Long';
    case 'guard':
      return 'Block';
    case 'smoke':
      return 'Throw';
    case 'barrier':
    case 'renew':
      return 'Use_Item';
    default:
      return 'Idle';
  }
}

function castSpeed(kind: AbilityKind): number {
  switch (kind.type) {
    case 'bolt':
      return kind.speed;
    case 'whirl':
      return 1.35;
    case 'sanctuary':
      return 1.6;
    default:
      return 1.7;
  }
}

/** Fraction of the cast animation at which the effect fires. */
function castPoint(kind: AbilityKind): number {
  switch (kind.type) {
    case 'bolt':
      return kind.castAt;
    case 'whirl':
      return 0.38;
    case 'nova':
      return 0.45;
    case 'sanctuary':
      return 0.5;
    default:
      return 0.35;
  }
}
