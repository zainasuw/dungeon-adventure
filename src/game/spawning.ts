import * as THREE from 'three';
import type { Rng } from '../core/rng';
import type { NavGrid } from '../world/nav';
import type { Colliders } from '../world/static-world';

/**
 * Where a monster may appear. The rules come from the games that do this well:
 * never create one where the player is looking (Left 4 Dead spawns only in areas no
 * survivor can see), never right behind them in first person (God of War: enemies
 * don't attack off screen, Killzone: "in first person it feels really unfair"), lock
 * spots the player has just looked at (Space Marine 2), keep the attack coming from
 * one side rather than surrounding, and fall back gracefully (L4D's "Anywhere" set).
 */
export interface SpawnContext {
  hero: THREE.Vector3;
  /** Direction the player is looking (first person) or facing (other views). */
  forward: THREE.Vector3;
  camera: THREE.Camera;
  view: 'first' | 'behind' | 'top';
  colliders: Colliders;
  nav: NavGrid;
  /** Living monsters' positions, for spacing. */
  others: THREE.Vector3[];
  /** Is a wall between two floor points? (Props don't count.) */
  wallBetween: (a: THREE.Vector3, b: THREE.Vector3) => boolean;
  /** Spots the player has recently been near or looked at: [x, z, time]. */
  recentlySeen: { x: number; z: number; t: number }[];
  now: number;
  /** The last spawn of this wave, to keep a consistent direction of attack. */
  lastSpawn: THREE.Vector3 | null;
  rng: Rng;
  /** Melee monsters appear closer than ranged ones. */
  ranged: boolean;
}

export interface SpawnChoice {
  at: THREE.Vector3;
  /** Which rule set found it: 0 strict … 3 visible-but-far (telegraphed), 4 none found. */
  tier: number;
  /** The spot is in view, so the monster must be fully telegraphed before it appears. */
  visible: boolean;
}

const UP = new THREE.Vector3(0, 1, 0);
const frustum = new THREE.Frustum();
const viewProj = new THREE.Matrix4();
const sphere = new THREE.Sphere();
const tmp = new THREE.Vector3();
const camPos = new THREE.Vector3();

/** Could the camera see a monster standing at `p`? Conservative: in frustum and not walled off. */
export function visibleFrom(ctx: SpawnContext, p: THREE.Vector3): boolean {
  viewProj.multiplyMatrices(ctx.camera.projectionMatrix, ctx.camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(viewProj);
  sphere.center.copy(p).addScaledVector(UP, 1);
  sphere.radius = 1.3;
  if (!frustum.intersectsSphere(sphere)) return false;
  ctx.camera.getWorldPosition(camPos).setY(0);
  // Walled off at the feet, the waist and the head: hidden. Any one line clear: seen.
  for (const h of [0.3, 1.0, 1.7]) {
    tmp.copy(p).setY(h);
    if (!ctx.wallBetween(camPos, tmp)) return true;
  }
  return false;
}

/**
 * Picks a spot for a monster to walk in from. Tries the strict rules first, then relaxes
 * them one at a time; a spot in view is accepted only far away, and the caller must
 * telegraph it. Returns tier 4 with the anchor when nothing is acceptable (caller retries).
 */
export function chooseSpawnSpot(ctx: SpawnContext, anchor: THREE.Vector3): SpawnChoice {
  const minD = 7;
  const maxD = ctx.ranged ? 18 : 14;
  const cells = ctx.nav.cellsWithin(minD, maxD);
  if (!cells.length) return { at: anchor.clone(), tier: 4, visible: true };
  const behindLimit = ctx.view === 'first' ? -0.2 : ctx.view === 'behind' ? -0.5 : -1;
  const check = (p: THREE.Vector3, relax: { seen?: boolean; behind?: boolean; occludedOk?: boolean; visibleOk?: boolean }): boolean => {
    if (ctx.colliders.hits(p.x, p.z, 0.8)) return false;
    tmp.copy(p).sub(ctx.hero).setY(0);
    const d = tmp.length();
    if (d < 1e-3) return false;
    tmp.divideScalar(d);
    // A spot the player will watch rise must never be off to their back; a hidden one may be
    // a little further round, but never straight behind.
    const limit = relax.visibleOk ? behindLimit : relax.behind ? -0.5 : behindLimit;
    if (tmp.dot(ctx.forward) < limit) return false;
    for (const o of ctx.others) if (o.distanceToSquared(p) < 1.6 * 1.6) return false;
    if (!relax.seen) for (const r of ctx.recentlySeen) if (ctx.now - r.t < 6 && Math.hypot(r.x - p.x, r.z - p.z) < 5) return false;
    const seen = visibleFrom(ctx, p);
    if (seen && !relax.visibleOk) return false;
    if (seen && d < 12) return false;
    return true;
  };
  const score = (p: THREE.Vector3): number => {
    // Prefer the previous spawn's side (one direction of attack), then nearer the anchor.
    let s = -p.distanceTo(anchor) * 0.1;
    if (ctx.lastSpawn) s += ctx.lastSpawn.distanceTo(p) < 7 ? 2 : 0;
    return s + ctx.rng.float() * 0.5;
  };
  const tiers = [
    { tier: 0, relax: {} },
    { tier: 1, relax: { seen: true } },
    { tier: 2, relax: { seen: true, behind: true } },
    { tier: 3, relax: { seen: true, behind: true, visibleOk: true } },
  ];
  for (const { tier, relax } of tiers) {
    let best: THREE.Vector3 | null = null;
    let bestScore = -Infinity;
    for (const c of cells) {
      if (!check(c, relax)) continue;
      const s = score(c);
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    if (best) return { at: best.clone(), tier, visible: tier === 3 };
  }
  return { at: anchor.clone(), tier: 4, visible: true };
}

/**
 * The graveyard: a grave to rise from. Rising is a show, so a grave the player can see
 * is preferred, but never one right at their feet or straight behind them.
 */
export function chooseGrave(ctx: SpawnContext, graves: readonly [number, number][], anchor: THREE.Vector3, occupied: readonly [number, number][]): THREE.Vector3 | null {
  let best: THREE.Vector3 | null = null;
  let bestScore = -Infinity;
  for (const [gx, gz] of graves) {
    if (occupied.some(([ox, oz]) => Math.hypot(ox - gx, oz - gz) < 1.3)) continue;
    const p = new THREE.Vector3(gx, 0, gz);
    const d = ctx.nav.walkDistance(gx, gz);
    if (!Number.isFinite(d) || d < 6.5 || d > 30) continue;
    if (p.distanceTo(ctx.hero) < 6) continue;
    tmp.copy(p).sub(ctx.hero).setY(0).normalize();
    const facing = tmp.dot(ctx.forward);
    if (ctx.view === 'first' && facing < -0.2) continue;
    if (ctx.others.some((o) => o.distanceToSquared(p) < 2.2 * 2.2)) continue;
    const seen = visibleFrom(ctx, p);
    let s = seen ? 3 : 0;
    s += facing * 1.5;
    s -= Math.abs(d - 10) * 0.12;
    s -= p.distanceTo(anchor) * 0.05;
    if (ctx.lastSpawn && ctx.lastSpawn.distanceTo(p) < 8) s += 1;
    s += ctx.rng.float() * 0.8;
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }
  return best;
}
