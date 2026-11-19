import * as THREE from 'three';
import type { Assets } from '../core/assets';

export interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Props no wider than this (metres) let a body slip round them: barrels, crates, lanterns. */
const SLIP_SIZE = 1;

/** Axis-aligned walls and props on the floor plane, plus the room's inner bounds. */
export class Colliders {
  readonly boxes: Box[] = [];
  /**
   * The floor you may stand on, for places that aren't one big room (the
   * connected dungeon). Outside all of them is solid, so nothing can end up
   * out in the dark beyond the walls.
   */
  areas: Box[] | null = null;

  constructor(readonly bounds: Box) {}

  private inArea(x: number, z: number): boolean {
    return !this.areas || this.areas.some((a) => x >= a.minX && x <= a.maxX && z >= a.minZ && z <= a.maxZ);
  }

  add(cx: number, cz: number, halfX: number, halfZ: number): void {
    this.boxes.push({ minX: cx - halfX, maxX: cx + halfX, minZ: cz - halfZ, maxZ: cz + halfZ });
  }

  /** Adds the floor footprint of an object, shrunk a little so edges feel fair. */
  addObject(object: THREE.Object3D, shrink = 0.15): void {
    const box = new THREE.Box3().setFromObject(object);
    this.boxes.push({ minX: box.min.x + shrink, maxX: box.max.x - shrink, minZ: box.min.z + shrink, maxZ: box.max.z - shrink });
  }

  /**
   * Pushes a circle out of every box and keeps it inside the room. Walking square into a
   * small prop (a barrel, a crate, a lantern) slips you round it instead of stopping you
   * dead; walls, pillars and furniture still stop you.
   */
  resolve(p: THREE.Vector3, radius: number): void {
    const b = this.bounds;
    p.x = THREE.MathUtils.clamp(p.x, b.minX + radius, b.maxX - radius);
    p.z = THREE.MathUtils.clamp(p.z, b.minZ + radius, b.maxZ - radius);
    if (this.areas && !this.inArea(p.x, p.z)) {
      // Slipped outside the floor: back to the nearest edge of it. The areas are already
      // drawn for the middle of a body, so the edge itself is where it stops; stepping
      // further in would throw a body leaning on an edge back and forth every few frames.
      let best = Infinity;
      let bx = p.x;
      let bz = p.z;
      for (const a of this.areas) {
        const x = THREE.MathUtils.clamp(p.x, a.minX, a.maxX);
        const z = THREE.MathUtils.clamp(p.z, a.minZ, a.maxZ);
        const d = (x - p.x) ** 2 + (z - p.z) ** 2;
        if (d < best) {
          best = d;
          bx = x;
          bz = z;
        }
      }
      p.x = bx;
      p.z = bz;
    }
    for (const box of this.boxes) {
      const cx = THREE.MathUtils.clamp(p.x, box.minX, box.maxX);
      const cz = THREE.MathUtils.clamp(p.z, box.minZ, box.maxZ);
      const dx = p.x - cx;
      const dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        p.x = cx + (dx / d) * radius;
        p.z = cz + (dz / d) * radius;
        // Met on a flat side of something small: step sideways, away from its middle, by as
        // much as was pushed back, so the next steps carry on round its corner.
        if (box.maxX - box.minX <= SLIP_SIZE && box.maxZ - box.minZ <= SLIP_SIZE) {
          const push = radius - d;
          if (dx === 0) p.x += p.x >= (box.minX + box.maxX) / 2 ? push : -push;
          else if (dz === 0) p.z += p.z >= (box.minZ + box.maxZ) / 2 ? push : -push;
        }
      } else {
        // Center is inside the box: leave along the shortest axis.
        const left = p.x - box.minX + radius;
        const right = box.maxX - p.x + radius;
        const back = p.z - box.minZ + radius;
        const front = box.maxZ - p.z + radius;
        const m = Math.min(left, right, back, front);
        if (m === left) p.x -= left;
        else if (m === right) p.x += right;
        else if (m === back) p.z -= back;
        else p.z += front;
      }
    }
  }

  /** True if a circle at (x, z) overlaps a wall or prop. */
  hits(x: number, z: number, radius: number): boolean {
    const b = this.bounds;
    if (x < b.minX + radius || x > b.maxX - radius || z < b.minZ + radius || z > b.maxZ - radius) return true;
    if (!this.inArea(x, z)) return true;
    for (const box of this.boxes) {
      const cx = THREE.MathUtils.clamp(x, box.minX, box.maxX);
      const cz = THREE.MathUtils.clamp(z, box.minZ, box.maxZ);
      if ((x - cx) ** 2 + (z - cz) ** 2 < radius * radius) return true;
    }
    return false;
  }
}

/**
 * Places dungeon kit pieces. Repeated pieces become one InstancedMesh each, so a
 * room of a hundred tiles costs a handful of draw calls.
 */
export class KitPlacer {
  private readonly batches = new Map<string, { matrices: THREE.Matrix4[]; castShadow: boolean }>();
  private readonly tmp = new THREE.Object3D();

  constructor(
    private readonly assets: Assets,
    private readonly parent: THREE.Object3D,
  ) {}

  instance(name: string, x: number, y: number, z: number, rotY = 0, scale = 1, castShadow = true): void {
    this.tmp.position.set(x, y, z);
    this.tmp.rotation.set(0, rotY, 0);
    this.tmp.scale.setScalar(scale);
    this.tmp.updateMatrix();
    let batch = this.batches.get(name);
    if (!batch) {
      batch = { matrices: [], castShadow };
      this.batches.set(name, batch);
    }
    batch.matrices.push(this.tmp.matrix.clone());
  }

  /** A standalone copy, for pieces that animate, collide or get their own material. */
  single(name: string, x: number, y: number, z: number, rotY = 0, scale = 1): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    group.position.set(x, y, z);
    group.rotation.y = rotY;
    group.scale.setScalar(scale);
    const piece = this.assets.piece(name);
    piece.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    group.add(piece);
    this.parent.add(group);
    group.updateMatrixWorld(true);
    return group;
  }

  /** Builds the instanced meshes. Call once after placing everything. */
  flush(): void {
    for (const [name, batch] of this.batches) {
      if (!this.assets.isSingleMesh(name)) {
        // Multi-part pieces can't be instanced; place plain copies instead.
        for (const m of batch.matrices) {
          const group = new THREE.Group();
          group.matrixAutoUpdate = false;
          group.matrix.copy(m);
          const piece = this.assets.piece(name);
          piece.traverse((o) => {
            o.castShadow = batch.castShadow;
            o.receiveShadow = true;
          });
          group.add(piece);
          this.parent.add(group);
        }
        continue;
      }
      const { mesh, local } = this.assets.pieceMesh(name);
      const instanced = new THREE.InstancedMesh(mesh.geometry, mesh.material, batch.matrices.length);
      instanced.name = name;
      batch.matrices.forEach((m, i) => instanced.setMatrixAt(i, m.clone().multiply(local)));
      instanced.instanceMatrix.needsUpdate = true;
      instanced.castShadow = batch.castShadow;
      instanced.receiveShadow = true;
      instanced.computeBoundingSphere();
      this.parent.add(instanced);
    }
    this.batches.clear();
  }
}
