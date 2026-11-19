import * as THREE from 'three';
import { pick } from '../core/math';
import type { Encounter, Rect } from './dungeon';
import type { Box, Colliders, KitPlacer } from './static-world';
import type { Torches } from './torches';
import type { EnemyKind } from '../actors/enemy';

const QUARTER = Math.PI / 2;

/** How the approach's edges look: stone walls, an iron fence, or a wall of trees. */
export type EdgeStyle = 'stone' | 'fence' | 'trees';

export interface ApproachOptions {
  kit: KitPlacer;
  colliders: Colliders;
  rng: () => number;
  /** Half size of the main hall it leads into (the hall sits at the origin). */
  hx: number;
  hz: number;
  style: EdgeStyle;
  /** Which side the side room is on: -1 west, 1 east. */
  side: 1 | -1;
  /** Lays the floor of one 4x4 slot (tiles indoors, dirt patches outdoors). */
  floor: (x: number, z: number) => void;
  torches: Torches;
  top: (o: THREE.Object3D) => THREE.Vector3;
  /** The hall's guards in the side room, and what they shout. */
  guards: EnemyKind[];
  shout: string;
}

export interface Approach {
  /** Floor you can stand on (centers of bodies), for the colliders. */
  areas: Box[];
  heroStart: THREE.Vector3;
  encounter: Encounter;
  chest: { position: THREE.Vector3; facing: number };
  crateSpots: THREE.Vector3[];
  /** Bounds of everything (hall + approach), for the camera. */
  all: Rect;
}

/**
 * The way into a hall, so every level is a walk through rooms and not one
 * big room: you arrive in an entrance room, a corridor leads north to the
 * hall, and a side room off the entrance hides the treasure (and guards).
 */
export function buildApproach(o: ApproachOptions): Approach {
  const { kit, colliders, rng, hx, hz, style, side } = o;
  const corridor: Rect = { x0: -2, x1: 2, z0: hz, z1: hz + 8 };
  const entrance: Rect = { x0: -8, x1: 8, z0: hz + 8, z1: hz + 20 };
  const room: Rect = side < 0 ? { x0: -20, x1: -8, z0: hz + 10, z1: hz + 18 } : { x0: 8, x1: 20, z0: hz + 10, z1: hz + 18 };
  const hall: Rect = { x0: -hx, x1: hx, z0: -hz, z1: hz };
  const built = [corridor, entrance, room];
  const every = [hall, ...built];
  const inside = (r: Rect, x: number, z: number) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;
  const openAt = (x: number, z: number) => every.some((r) => inside(r, x, z));

  // Floors.
  for (const r of built) for (let x = r.x0 + 2; x < r.x1; x += 4) for (let z = r.z0 + 2; z < r.z1; z += 4) o.floor(x, z);

  // Edges, leaving openings where another area carries on.
  const trees = ['hx_trees_A_large', 'hx_trees_B_large', 'hx_trees_A_medium', 'hx_trees_B_medium'];
  const torchSpots: [number, number, number][] = [];
  const edge = (x: number, z: number, rot: number, low: boolean, outward: THREE.Vector2) => {
    if (style === 'stone') {
      kit.instance(pick(rng, ['wall', 'wall', 'wall_cracked', 'wall_arched']), x, 0, z, rot);
    } else if (style === 'fence') {
      kit.instance(rng() < 0.25 ? 'hw_fence_broken' : 'hw_fence', x, 0, z, rot);
    } else if (low || [-0.6, 0, 0.6].some((d) => openAt(x + outward.x * 2.5 + d, z + outward.y * 2.5 + d))) {
      // Low rocks on near edges and on edges shared with another area (trees there would fill the room).
      kit.instance(pick(rng, ['hx_rock_single_A', 'hx_rock_single_B', 'hx_rock_single_C']), x + outward.x * 1.2, 0, z + outward.y * 1.2, rng() * 6, 1.8 + rng());
    } else {
      kit.instance(pick(rng, trees), x + outward.x * 2.8, 0, z + outward.y * 2.8, rng() * 6, 2.2 + rng() * 0.6);
    }
  };
  // A wall piece is 4 wide but an opening (the 4-wide corridor) can straddle two pieces:
  // check each half of the piece, and where only one half is closed, place a half wall
  // there, so the corridor is never walled over.
  const halfEdge = (x: number, z: number, rot: number, outward: THREE.Vector2) => {
    if (style === 'stone') kit.instance('wall_half', x, 0, z, rot);
    else if (style === 'trees') edge(x, z, rot, true, outward);
  };
  for (const r of built) {
    const isCorridor = r === corridor;
    for (let x = r.x0 + 2; x < r.x1; x += 4) {
      const n0 = !openAt(x - 1, r.z0 - 0.6);
      const n1 = !openAt(x + 1, r.z0 - 0.6);
      if (n0 && n1) {
        edge(x, r.z0, 0, false, new THREE.Vector2(0, -1));
        if (!isCorridor && rng() < 0.6) torchSpots.push([x, r.z0 + 0.5, 0]);
      } else if (n0 || n1) halfEdge(n0 ? x - 1 : x + 1, r.z0, 0, new THREE.Vector2(0, -1));
      const s0 = !openAt(x - 1, r.z1 + 0.6);
      const s1 = !openAt(x + 1, r.z1 + 0.6);
      if (s0 && s1) edge(x, r.z1, Math.PI, true, new THREE.Vector2(0, 1));
      else if (s0 || s1) halfEdge(s0 ? x - 1 : x + 1, r.z1, Math.PI, new THREE.Vector2(0, 1));
    }
    for (let z = r.z0 + 2; z < r.z1; z += 4) {
      const w0 = !openAt(r.x0 - 0.6, z - 1);
      const w1 = !openAt(r.x0 - 0.6, z + 1);
      if (w0 && w1) {
        edge(r.x0, z, QUARTER, false, new THREE.Vector2(-1, 0));
        if (!isCorridor && rng() < 0.4) torchSpots.push([r.x0 + 0.5, z, QUARTER]);
      } else if (w0 || w1) halfEdge(r.x0, w0 ? z - 1 : z + 1, QUARTER, new THREE.Vector2(-1, 0));
      const e0 = !openAt(r.x1 + 0.6, z - 1);
      const e1 = !openAt(r.x1 + 0.6, z + 1);
      if (e0 && e1) {
        edge(r.x1, z, -QUARTER, false, new THREE.Vector2(1, 0));
        if (!isCorridor && rng() < 0.4) torchSpots.push([r.x1 - 0.5, z, -QUARTER]);
      } else if (e0 || e1) halfEdge(r.x1, e0 ? z - 1 : z + 1, -QUARTER, new THREE.Vector2(1, 0));
    }
  }
  if (style === 'stone') {
    for (const r of [entrance, room]) {
      for (const [x, z, rot] of [[r.x1, r.z0, 0], [r.x0, r.z0, QUARTER], [r.x1, r.z1, -QUARTER], [r.x0, r.z1, Math.PI]] as [number, number, number][]) {
        if (!openAt(x + (rot === 0 || rot === -QUARTER ? 0.6 : -0.6), z)) kit.instance('wall_corner', x, 0, z, rot);
      }
    }
  }

  // Light: torches on stone walls, lanterns by the fence, nothing needed in sunny woods.
  if (style === 'stone') {
    for (const [x, z, rot] of torchSpots.slice(0, 6)) o.torches.add(o.top(kit.single('torch_mounted', x, 2.05, z, rot)));
  } else if (style === 'fence') {
    for (const [x, z] of [[-5.5, hz + 10], [5.5, hz + 10], [room.x0 + 2, room.z0 + 2]]) {
      o.torches.add(o.top(kit.single('hw_lantern_standing', x, 0, z, 0, 1.3)));
      colliders.add(x, z, 0.4, 0.4);
    }
  }

  // Dressing: the side room is a little treasure store.
  const mid = (room.x0 + room.x1) / 2;
  if (style === 'stone') {
    kit.instance('coin_stack_large', room.x0 + 2, 0, room.z0 + 1.6, 0.3);
    kit.instance('coin_stack_medium', room.x1 - 2, 0, room.z1 - 1.6, 1.1);
    colliders.addObject(kit.single('barrel_large', room.x1 - 2, 0, room.z0 + 1.8, 0));
    kit.instance('rubble_half', 4.4, 0, hz + 17.6, 0.8);
  } else if (style === 'fence') {
    kit.instance('hw_gravestone', mid - 3, 0, room.z0 + 1.4, 0);
    kit.instance('hw_grave_A', mid + 2.5, 0, room.z0 + 1.6, 0);
    kit.instance('hw_pumpkin_orange_jackolantern', -5.8, 0, hz + 18.4, 0.4);
  } else {
    colliders.addObject(kit.single('hx_tent', mid, 0, room.z0 + 2.2, 0, 1.2));
    kit.instance('hx_barrel', room.x1 - 1.8, 0, room.z1 - 1.6, 0);
    kit.instance('hx_sack', room.x0 + 1.8, 0, room.z1 - 1.8, 0.6);
  }

  // Bodies keep 1 unit from the edge line (half a wall plus the body).
  const inner = (r: Rect, pad = 1): Box => ({ minX: r.x0 + pad, maxX: r.x1 - pad, minZ: r.z0 + pad, maxZ: r.z1 - pad });
  const areas: Box[] = [
    inner(hall),
    // The corridor runs into the hall and the entrance so the walkable bits overlap.
    { minX: -1, maxX: 1, minZ: hz - 1.5, maxZ: hz + 9.5 },
    inner(entrance),
    inner(room),
    // Doorway between the entrance and the side room.
    side < 0 ? { minX: -10, maxX: -6, minZ: hz + 13, maxZ: hz + 15 } : { minX: 6, maxX: 10, minZ: hz + 13, maxZ: hz + 15 },
    // Behind the golden door, for walking out.
    { minX: -1.5, maxX: 1.5, minZ: -hz - 9, maxZ: -hz + 1.5 },
  ];

  const guards = o.guards.map((kind, i) => ({
    kind,
    at: [mid + (i - (o.guards.length - 1) / 2) * 3, room.z0 + 4 + (i % 2)] as [number, number],
    facing: side < 0 ? QUARTER : -QUARTER,
  }));
  return {
    areas,
    heroStart: new THREE.Vector3(0, 0, hz + 15),
    encounter: { room, shout: o.shout, monsters: guards },
    chest: { position: new THREE.Vector3(room.x0 + (side < 0 ? 1.8 : room.x1 - room.x0 - 1.8), 0, (room.z0 + room.z1) / 2), facing: side < 0 ? QUARTER : -QUARTER },
    crateSpots: [new THREE.Vector3(-5.6, 0, hz + 12), new THREE.Vector3(5.6, 0, hz + 17.6), new THREE.Vector3(side < 0 ? 5.8 : -5.8, 0, hz + 11.2)],
    all: { x0: Math.min(-hx, room.x0), x1: Math.max(hx, room.x1), z0: -hz, z1: entrance.z1 },
  };
}
