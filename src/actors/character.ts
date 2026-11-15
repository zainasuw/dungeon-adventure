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

  /** Advances animation and visual state. Call once per frame. */
  updateVisuals(dt: number): void {
    this.root.rotation.y = this.facing;
    this.animator.update(dt);
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
