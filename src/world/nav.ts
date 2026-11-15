import * as THREE from 'three';
import type { Colliders } from './static-world';

const SQRT2 = Math.SQRT2;
const NEIGHBORS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

/**
 * A walking map of the room for the monsters: a grid of floor cells, each one
 * knowing how far it is from the hero around pillars, the altar and props.
 * A monster steps toward whichever neighbouring cell is closer to the hero, so
 * it walks around obstacles instead of running into them.
 */
export class NavGrid {
  private readonly cell = 0.5;
  private readonly cols: number;
  private readonly rows: number;
  private readonly minX: number;
  private readonly minZ: number;
  private readonly blocked: Uint8Array;
  private readonly dist: Float32Array;
  private readonly heap: number[] = [];

  constructor(colliders: Colliders, clearance = 0.6) {
    const b = colliders.bounds;
    this.minX = b.minX;
    this.minZ = b.minZ;
    this.cols = Math.ceil((b.maxX - b.minX) / this.cell);
    this.rows = Math.ceil((b.maxZ - b.minZ) / this.cell);
    this.blocked = new Uint8Array(this.cols * this.rows);
    this.dist = new Float32Array(this.cols * this.rows).fill(Infinity);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = this.minX + (c + 0.5) * this.cell;
        const z = this.minZ + (r + 0.5) * this.cell;
        this.blocked[r * this.cols + c] = colliders.hits(x, z, clearance) ? 1 : 0;
      }
    }
  }

  /** Recomputes every cell's walking distance to the target (Dijkstra over the grid). */
  update(target: THREE.Vector3): void {
    const { cols, rows, dist, blocked } = this;
    dist.fill(Infinity);
    const start = this.nearestOpen(this.index(target.x, target.z));
    if (start < 0) return;
    const heap = this.heap;
    heap.length = 0;
    dist[start] = 0;
    this.push(start);
    while (heap.length) {
      const i = this.pop();
      const d = dist[i];
      const c = i % cols;
      const r = (i - c) / cols;
      for (const [dc, dr, cost] of NEIGHBORS) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const n = nr * cols + nc;
        if (blocked[n]) continue;
        // No cutting corners past a blocked cell.
        if (dc && dr && (blocked[r * cols + nc] || blocked[nr * cols + c])) continue;
        const nd = d + cost;
        if (nd < dist[n]) {
          dist[n] = nd;
          this.push(n);
        }
      }
    }
  }

  /**
   * The direction to walk from `pos` to get closer to the target, or null when
   * there's no better neighbour (already next to the target, or off the map).
   */
  /**
   * Like direction(), but points at a spot several steps down the path, so the
   * result changes smoothly instead of jumping from cell to cell.
   */
  lookAhead(pos: THREE.Vector3, out: THREE.Vector3, steps = 5): THREE.Vector3 | null {
    const { cols, rows, dist } = this;
    let i = this.index(pos.x, pos.z);
    if (i < 0) return null;
    if (dist[i] === Infinity) i = this.nearestOpen(i);
    if (i < 0) return null;
    for (let s = 0; s < steps; s++) {
      const c = i % cols;
      const r = (i - c) / cols;
      let best = -1;
      let bestD = dist[i];
      for (const [dc, dr] of NEIGHBORS) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const n = nr * cols + nc;
        if (dist[n] < bestD) {
          bestD = dist[n];
          best = n;
        }
      }
      if (best < 0) break;
      i = best;
    }
    const c = i % cols;
    const r = (i - c) / cols;
    out.set(this.minX + (c + 0.5) * this.cell - pos.x, 0, this.minZ + (r + 0.5) * this.cell - pos.z);
    return out.lengthSq() > 1e-4 ? out.normalize() : null;
  }

  direction(pos: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 | null {
    const { cols, rows, dist } = this;
    let i = this.index(pos.x, pos.z);
    if (i < 0) return null;
    if (dist[i] === Infinity) i = this.nearestOpen(i);
    if (i < 0) return null;
    const c = i % cols;
    const r = (i - c) / cols;
    let best = -1;
    let bestD = dist[i];
    for (const [dc, dr] of NEIGHBORS) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const n = nr * cols + nc;
      if (dist[n] < bestD) {
        bestD = dist[n];
        best = n;
      }
    }
    if (best < 0) return null;
    const bc = best % cols;
    const br = (best - bc) / cols;
    out.set(this.minX + (bc + 0.5) * this.cell - pos.x, 0, this.minZ + (br + 0.5) * this.cell - pos.z);
    return out.lengthSq() > 1e-6 ? out.normalize() : null;
  }

  private index(x: number, z: number): number {
    const c = Math.floor((x - this.minX) / this.cell);
    const r = Math.floor((z - this.minZ) / this.cell);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  /** The closest open cell to `i`, searching outward a few rings. */
  private nearestOpen(i: number): number {
    if (i < 0) return -1;
    if (!this.blocked[i]) return i;
    const c = i % this.cols;
    const r = (i - c) / this.cols;
    for (let ring = 1; ring < 6; ring++) {
      for (let dr = -ring; dr <= ring; dr++) {
        for (let dc = -ring; dc <= ring; dc++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue;
          const nc = c + dc;
          const nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
          const n = nr * this.cols + nc;
          if (!this.blocked[n]) return n;
        }
      }
    }
    return -1;
  }

  // A small binary heap keyed by distance.
  private push(i: number): void {
    const heap = this.heap;
    const d = this.dist;
    heap.push(i);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (d[heap[p]] <= d[heap[k]]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  }

  private pop(): number {
    const heap = this.heap;
    const d = this.dist;
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && d[heap[l]] < d[heap[m]]) m = l;
        if (r < heap.length && d[heap[r]] < d[heap[m]]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  }
}
