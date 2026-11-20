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
  private readonly side = new THREE.Vector3();
  private readonly from2 = new THREE.Vector3();
  private readonly to2 = new THREE.Vector3();
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
      this.wanted.copy(this.focus).add(this.offset);
      // Three rays, not one: the middle and both sides of the lens, so a wall edge
      // sliding past one corner of the view doesn't flip the whole camera in and out.
      const len = Math.hypot(this.offset.x, this.offset.z) || 1;
      this.side.set(-this.offset.z / len, 0, this.offset.x / len).multiplyScalar(0.35);
      let clear = this.occlude(this.focus, this.wanted);
      clear = Math.min(clear, this.occlude(this.from2.copy(this.focus).add(this.side), this.to2.copy(this.wanted).add(this.side)));
      clear = Math.min(clear, this.occlude(this.from2.copy(this.focus).sub(this.side), this.to2.copy(this.wanted).sub(this.side)));
      clear = Math.max(0.18, clear);
      // Pull in quickly (but smoothly) when a wall is in the way; ease back out slowly.
      // A small dead band in between, so tiny changes along a wall don't pump the camera.
      if (clear < this.pull - 0.02) this.pull = damp(this.pull, clear, 16, dt);
      else if (clear > this.pull + 0.06) this.pull = damp(this.pull, clear, 3, dt);
      // Squeezed by a wall: come in along the same line, as a third-person camera does, with
      // a small rise. The rise is small on purpose: the view stays behind the hero and never
      // turns into one from above (the game fades the hero out when the lens gets this close).
      const lift = Math.min(0.5, (1 - this.pull) * 0.8);
      this.offset.x *= this.pull;
      this.offset.z *= this.pull;
      this.offset.y = this.offset.y * this.pull + lift;
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
