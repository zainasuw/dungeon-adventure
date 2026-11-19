import * as THREE from 'three';
import type { Assets, CharacterModel } from '../core/assets';
import { Animator } from './animator';

export type Hand = 'right' | 'left';

/** A rigged KayKit character: model, animations, facing, health and hit flash. */
export class Character {
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  readonly animator: Animator;
  readonly velocity = new THREE.Vector3();
  /** Yaw in radians; 0 faces +Z. */
  facing = 0;
  radius = 0.55;
  maxHp = 100;
  hp = 100;
  alive = true;

  private readonly materials: { material: THREE.MeshStandardMaterial; base: THREE.Color; baseIntensity: number }[] = [];
  private readonly flashColor = new THREE.Color();
  private flashTime = 0;
  private flashDuration = 0.1;
  /**
   * Life in the body, cheaply: every character has its own clock offset so a crowd never
   * moves in lockstep; it leans into turns and speed; and a hit sets off a small spring on
   * the torso that overshoots and settles (anticipation and follow-through, not a snap).
   */
  private readonly seed = Math.random() * 100;
  private prevFacing = 0;
  private prevSpeed = 0;
  private lean = 0;
  private leanFwd = 0;
  private springPitch = 0;
  private springPitchVel = 0;
  private springRoll = 0;
  private springRollVel = 0;
  private clock = 0;
  /** Extra forward pitch while rising out of the ground, so the skull breaks the surface first. */
  riseTilt = 0;

  constructor(assets: Assets, model: CharacterModel, clips: Map<string, THREE.AnimationClip>) {
    this.model = assets.character(model);
    this.root.add(this.model);
    this.model.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) {
        this.materials.push({ material: o.material, base: o.material.emissive.clone(), baseIntensity: o.material.emissiveIntensity });
      }
    });
    this.animator = new Animator(this.model, clips);
  }

  get position(): THREE.Vector3 {
    return this.root.position;
  }

  /** Hides the named meshes (KayKit models ship with every weapon variant attached). */
  hideParts(names: string[]): void {
    for (const name of names) {
      const part = this.model.getObjectByName(name);
      if (part) part.visible = false;
    }
  }

  /**
   * Puts a prop in a hand. Right-hand items face backwards in the KayKit rig;
   * `flip` turns a prop end over end and `tilt` leans it forward or back, so a
   * staff can stand upright in the idle pose instead of trailing on the floor.
   */
  hold(prop: THREE.Object3D, hand: Hand, flip = false, tilt = 0): void {
    const bone = this.model.getObjectByName(hand === 'right' ? 'handslotr' : 'handslotl');
    if (!bone) throw new Error('Character has no hand slot');
    const mount = new THREE.Group();
    mount.rotation.set(tilt, hand === 'right' ? Math.PI : 0, flip ? Math.PI : 0);
    prop.traverse((o) => {
      o.castShadow = true;
    });
    mount.add(prop);
    bone.add(mount);
  }

  /** Makes matching meshes glow, e.g. a skeleton's eyes. */
  setGlow(match: (name: string) => boolean, color: THREE.ColorRepresentation, intensity: number): void {
    this.model.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || !match(o.name)) return;
      const entry = this.materials.find((m) => m.material === o.material);
      if (!entry) return;
      entry.base.set(color);
      entry.baseIntensity = intensity;
      entry.material.emissive.set(color);
      entry.material.emissiveIntensity = intensity;
    });
  }

  flash(color: THREE.ColorRepresentation, duration = 0.1): void {
    this.flashColor.set(color);
    this.flashTime = duration;
    this.flashDuration = duration;
  }

  /**
   * Frees what this character owns on the GPU: its skeleton's bone texture and
   * its own material copies. Geometries and textures stay: they belong to the
   * shared asset library.
   */
  dispose(): void {
    this.animator.mixer.stopAllAction();
    this.animator.mixer.uncacheRoot(this.model);
    this.model.traverse((o) => {
      if (o instanceof THREE.SkinnedMesh) o.skeleton.dispose();
      if (o instanceof THREE.Mesh && o.material instanceof THREE.Material && !o.material.userData.shared) o.material.dispose();
    });
  }

  /** A blow from `from` (world point): the body is jolted away from it, then springs back. */
  jolt(from: THREE.Vector3, strength = 1): void {
    const dx = this.position.x - from.x;
    const dz = this.position.z - from.z;
    const len = Math.hypot(dx, dz) || 1;
    const fx = Math.sin(this.facing);
    const fz = Math.cos(this.facing);
    // Along the body's facing: a hit from the front rocks the torso back; from the side it rolls.
    const along = (dx / len) * fx + (dz / len) * fz;
    const side = (dx / len) * fz - (dz / len) * fx;
    this.springPitchVel += -along * 3.2 * strength;
    this.springRollVel += side * 2.6 * strength;
  }

  /** Advances animation and visual state. Call once per frame. */
  updateVisuals(dt: number): void {
    this.root.rotation.y = this.facing;
    this.animator.update(dt);
    if (dt > 0) {
      this.clock += dt;
      // Lean into turns and into speed, damped so it reads as weight, not jitter.
      let turn = this.facing - this.prevFacing;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn)) / dt;
      this.prevFacing = this.facing;
      const speed = Math.hypot(this.velocity.x, this.velocity.z);
      const accel = (speed - this.prevSpeed) / dt;
      this.prevSpeed = speed;
      const leanTarget = THREE.MathUtils.clamp(-turn * 0.035, -0.09, 0.09);
      const fwdTarget = THREE.MathUtils.clamp(speed * 0.012 + accel * 0.004, -0.04, 0.08);
      this.lean += (leanTarget - this.lean) * (1 - Math.exp(-8 * dt));
      this.leanFwd += (fwdTarget - this.leanFwd) * (1 - Math.exp(-6 * dt));
      // The hit spring: stiff, well damped, so it overshoots once and settles.
      const stiff = 90;
      const dampK = 12;
      this.springPitchVel += (-stiff * this.springPitch - dampK * this.springPitchVel) * dt;
      this.springPitch += this.springPitchVel * dt;
      this.springRollVel += (-stiff * this.springRoll - dampK * this.springRollVel) * dt;
      this.springRoll += this.springRollVel * dt;
      // Idle sway: two slow sines on this body's own clock.
      const sway = 0.01 * Math.sin(this.clock * 0.9 + this.seed) + 0.006 * Math.sin(this.clock * 0.37 + this.seed * 1.7);
      this.model.rotation.set(this.leanFwd + this.springPitch + this.riseTilt, sway, this.lean + this.springRoll);
    }
    if (this.flashTime > 0 || this.flashDuration > 0) {
      this.flashTime = Math.max(0, this.flashTime - dt);
      const k = this.flashTime / this.flashDuration;
      for (const m of this.materials) {
        m.material.emissive.copy(m.base).lerp(this.flashColor, k);
        m.material.emissiveIntensity = THREE.MathUtils.lerp(m.baseIntensity, 2.2, k);
      }
      if (this.flashTime === 0) this.flashDuration = 0;
    }
  }
}
