import * as THREE from 'three';

interface Bat {
  root: THREE.Group;
  left: THREE.Mesh;
  right: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  speed: number;
  phase: number;
}

/**
 * Little bats that flit across the room now and then, at uneven times, so the
 * dungeon never feels frozen. Purely for life; they don't hurt anyone.
 */
export class Bats {
  readonly group = new THREE.Group();
  private readonly bats: Bat[] = [];
  private timer = 3;
  private readonly wing: THREE.BufferGeometry;
  private readonly material = new THREE.MeshBasicMaterial({ color: '#0d0b10', side: THREE.DoubleSide });

  constructor() {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(0.42, 0.12);
    shape.lineTo(0.36, -0.02);
    shape.lineTo(0.26, 0.04);
    shape.lineTo(0.2, -0.06);
    shape.closePath();
    this.wing = new THREE.ShapeGeometry(shape);
    this.wing.rotateX(-Math.PI / 2);
  }

  /** Sends a few bats across the given area (center and half sizes). */
  private flock(center: THREE.Vector3, halfX: number, halfZ: number): void {
    const n = 2 + Math.floor(Math.random() * 3);
    const side = Math.random() < 0.5 ? -1 : 1;
    const z = center.z + (Math.random() - 0.5) * halfZ * 1.4;
    for (let i = 0; i < n; i++) {
      const root = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), this.material);
      const left = new THREE.Mesh(this.wing, this.material);
      const right = new THREE.Mesh(this.wing, this.material);
      right.scale.x = -1;
      root.add(body, left, right);
      const y = 3.2 + Math.random() * 1.6;
      const from = new THREE.Vector3(center.x + side * (halfX + 2), y, z + (Math.random() - 0.5) * 3);
      const to = new THREE.Vector3(center.x - side * (halfX + 2), y + (Math.random() - 0.5), z + (Math.random() - 0.5) * 6);
      root.position.copy(from);
      root.lookAt(to);
      this.group.add(root);
      this.bats.push({ root, left, right, from, to, t: -i * 0.12, speed: 0.18 + Math.random() * 0.08, phase: Math.random() * 6 });
    }
  }

  update(dt: number, time: number, center: THREE.Vector3, halfX: number, halfZ: number): void {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 9 + Math.random() * 14;
      this.flock(center, Math.min(halfX, 14), Math.min(halfZ, 14));
    }
    for (let i = this.bats.length - 1; i >= 0; i--) {
      const b = this.bats[i];
      b.t += dt * b.speed;
      if (b.t < 0) continue;
      const k = Math.min(1, b.t);
      b.root.position.lerpVectors(b.from, b.to, k);
      b.root.position.y += Math.sin(time * 9 + b.phase) * 0.15;
      const flap = Math.sin(time * 26 + b.phase) * 0.9;
      b.left.rotation.z = flap;
      b.right.rotation.z = -flap;
      if (k >= 1) {
        this.group.remove(b.root);
        this.bats.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const b of this.bats) this.group.remove(b.root);
    this.bats.length = 0;
  }
}
