import * as THREE from 'three';
import { clamp, damp, noise1 } from './math';

/**
 * Angled top-down follow camera. Leans toward where the player aims and
 * shakes with "trauma" (shake grows with the square of trauma, then decays).
 */
export class CameraRig {
  yaw = Math.PI / 4;
  pitch = THREE.MathUtils.degToRad(54);
  distance = 23;
  readonly focus = new THREE.Vector3();
  /** How quickly the camera catches up with its target (higher = tighter). */
  followRate = 5;
  /**
   * For the low camera behind the hero: returns how much of the way from the
   * hero to the camera is clear (0..1), so walls pull the camera in instead of
   * blocking the view (Roblox's "zoom" occlusion).
   */
  occlude: ((from: THREE.Vector3, to: THREE.Vector3) => number) | null = null;
  private pull = 1;
  /** 1 when nothing is in the way, smaller when a wall pulls the camera in. */
  get clearance(): number {
    return this.pull;
  }
  private readonly wanted = new THREE.Vector3();
  /** Keeps the view from drifting too far past the room's walls. */
  bounds = { minX: -8, maxX: 8, minZ: -8.2, maxZ: 7.5 };

  /** Where yaw, pitch and distance are easing toward (camera presets). */
  private readonly goal = { yaw: this.yaw, pitch: this.pitch, distance: this.distance };
  private trauma = 0;
  private readonly offset = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  /** Snaps to a point with no easing, e.g. on load. */
  snap(target: THREE.Vector3): void {
    this.focus.copy(target);
    this.clampFocus();
  }

  /** Jumps straight to the goal angle and distance (a cut, not a glide). */
  jumpToGoal(): void {
    this.yaw = this.goal.yaw;
    this.pitch = this.goal.pitch;
    this.distance = this.goal.distance;
    this.pull = 1;
  }

  /** Eases to a new angle and distance. Angles in degrees. */
  setView(yawDeg: number, pitchDeg: number, distance: number): void {
    this.goal.yaw = THREE.MathUtils.degToRad(yawDeg);
    this.goal.pitch = THREE.MathUtils.degToRad(pitchDeg);
    this.goal.distance = distance;
  }

  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Camera-relative movement axes on the floor plane. */
  axes(forward: THREE.Vector3, right: THREE.Vector3): void {
    forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  update(dt: number, time: number, target: THREE.Vector3): void {
    // Turn the short way round. The first-person view lets the angle run past a full
    // circle; easing straight back would spin the camera through the walls.
    const turn = Math.atan2(Math.sin(this.goal.yaw - this.yaw), Math.cos(this.goal.yaw - this.yaw));
    this.yaw = this.goal.yaw - turn + turn * (1 - Math.exp(-4 * dt));
    this.pitch = damp(this.pitch, this.goal.pitch, 4, dt);
    this.distance = damp(this.distance, this.goal.distance, 4, dt);
    this.focus.x = damp(this.focus.x, target.x, this.followRate, dt);
    this.focus.y = damp(this.focus.y, target.y, this.followRate, dt);
    this.focus.z = damp(this.focus.z, target.z, this.followRate, dt);
    this.clampFocus();

    const cp = Math.cos(this.pitch);
    this.offset.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).multiplyScalar(this.distance);
    if (this.occlude) {
      // Pull in at once when a wall is in the way; ease back out slowly so it doesn't bob.
      this.wanted.copy(this.focus).add(this.offset);
      const clear = Math.max(0.18, this.occlude(this.focus, this.wanted));
      this.pull = clear < this.pull ? clear : damp(this.pull, clear, 2, dt);
      // Squeezed by a wall: come in closer AND rise up to look down over the hero,
      // instead of pressing against the back of their head.
      const lift = (1 - this.pull) * this.distance * 0.6;
      this.offset.x *= this.pull;
      this.offset.z *= this.pull;
      this.offset.y += lift;
    } else this.pull = 1;
    this.camera.position.copy(this.focus).add(this.offset);
    this.camera.lookAt(this.focus);

    this.trauma = Math.max(0, this.trauma - dt * 1.7);
    const shake = this.trauma * this.trauma;
    if (shake > 0) {
      this.right.setFromMatrixColumn(this.camera.matrixWorld, 0);
      this.up.setFromMatrixColumn(this.camera.matrixWorld, 1);
      const t = time * 32;
      this.camera.position
        .addScaledVector(this.right, noise1(t) * 0.55 * shake)
        .addScaledVector(this.up, noise1(t + 71) * 0.55 * shake);
      this.camera.rotateZ(noise1(t + 143) * 0.02 * shake);
    }
  }

  private clampFocus(): void {
    this.focus.x = clamp(this.focus.x, this.bounds.minX, this.bounds.maxX);
    this.focus.z = clamp(this.focus.z, this.bounds.minZ, this.bounds.maxZ);
  }
}
