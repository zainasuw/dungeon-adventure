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
  /** Keeps the view from drifting too far past the room's walls. */
  bounds = { minX: -8, maxX: 8, minZ: -6.5, maxZ: 7.5 };

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
    this.yaw = damp(this.yaw, this.goal.yaw, 4, dt);
    this.pitch = damp(this.pitch, this.goal.pitch, 4, dt);
    this.distance = damp(this.distance, this.goal.distance, 4, dt);
    this.focus.x = damp(this.focus.x, target.x, 5, dt);
    this.focus.y = damp(this.focus.y, target.y, 5, dt);
    this.focus.z = damp(this.focus.z, target.z, 5, dt);
    this.clampFocus();

    const cp = Math.cos(this.pitch);
    this.offset.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).multiplyScalar(this.distance);
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
