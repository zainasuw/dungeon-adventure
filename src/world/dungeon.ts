import * as THREE from 'three';
import type { Assets } from '../core/assets';
import { createRng, pick } from '../core/math';
import type { EnemyKind } from '../actors/enemy';
import { Altar } from './altar';
import type { Crypt } from './crypt';
import { GoldenDoor } from './door';
import type { Particles } from './particles';
import { Runes } from './runes';
import { Colliders, KitPlacer } from './static-world';
import { Torches } from './torches';

/** A rectangle on the floor: min/max x and z. Sizes are multiples of 4 so wall pieces line up. */
export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Monsters that wake when the hero walks into a room (an ambush). */
export interface Encounter {
  room: Rect;
  monsters: { kind: EnemyKind; at: [number, number]; facing: number }[];
  /** Shown when it springs. */
  shout: string;
}

const QUARTER = Math.PI / 2;

// The sample connected dungeon. North is -z. The hero drops into the entrance (south),
// walks north through the guard room (ambush), can detour east to the treasure room,
// and reaches the altar room with the golden exit door.
const ENTRANCE: Rect = { x0: -6, x1: 6, z0: 14, z1: 26 };
const HALL_1: Rect = { x0: -2, x1: 2, z0: 2, z1: 14 };
const GUARD: Rect = { x0: -10, x1: 10, z0: -10, z1: 2 };
const HALL_EAST: Rect = { x0: 10, x1: 22, z0: -6, z1: -2 };
const TREASURE: Rect = { x0: 22, x1: 30, z0: -10, z1: 2 };
const HALL_2: Rect = { x0: -2, x1: 2, z0: -22, z1: -10 };
const ALTAR_ROOM: Rect = { x0: -10, x1: 10, z0: -42, z1: -22 };

const ROOMS = [ENTRANCE, GUARD, TREASURE, ALTAR_ROOM];
const HALLS = [HALL_1, HALL_EAST, HALL_2];
const AREAS = [...ROOMS, ...HALLS];

export const DUNGEON_ENCOUNTERS: Encounter[] = [
  {
    room: GUARD,
    shout: 'Ambush! Skeletons in the guard room!',
    monsters: [
      { kind: 'runt', at: [-6, -6], facing: 0.6 },
      { kind: 'skeleton', at: [6, -6.5], facing: -0.6 },
      { kind: 'runt', at: [-7, -1], facing: 1.4 },
    ],
  },
  {
    room: TREASURE,
    shout: 'The treasure has guards!',
    monsters: [{ kind: 'skeleton', at: [26, -7], facing: 0 }],
  },
];

function inside(r: Rect, x: number, z: number): boolean {
  return x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;
}

/** Builds the connected dungeon: several rooms joined by corridors, one altar, one golden door. */
export function buildDungeon(assets: Assets, embers: Particles, themeIndex: number): Crypt {
  const group = new THREE.Group();
  group.name = 'dungeon';
  const rng = createRng(4242);
  const kit = new KitPlacer(assets, group);
  const all = AREAS.reduce((b, r) => ({ x0: Math.min(b.x0, r.x0), x1: Math.max(b.x1, r.x1), z0: Math.min(b.z0, r.z0), z1: Math.max(b.z1, r.z1) }), { x0: 0, x1: 0, z0: 0, z1: 0 });
  // The walls themselves block movement, so the outer bounds only need to be loose.
  const colliders = new Colliders({ minX: all.x0 - 1, maxX: all.x1 + 1, minZ: all.z0 - 9, maxZ: all.z1 + 1 });
  // Only the rooms, corridors and the passage behind the golden door are floor.
  colliders.areas = [
    ...AREAS.map((r) => ({ minX: r.x0, maxX: r.x1, minZ: r.z0, maxZ: r.z1 })),
    { minX: -2.5, maxX: 2.5, minZ: all.z0 - 9, maxZ: ALTAR_ROOM.z0 + 0.5 },
  ];

  // Floors.
  const small = ['floor_tile_small', 'floor_tile_small_broken_A', 'floor_tile_small_weeds_A', 'floor_tile_small_decorated'];
  for (const r of AREAS) {
    for (let x = r.x0 + 2; x < r.x1; x += 4) {
      for (let z = r.z0 + 2; z < r.z1; z += 4) {
        const roll = rng();
        const rot = Math.floor(rng() * 4) * QUARTER;
        if (roll < 0.72) kit.instance('floor_tile_large', x, 0, z, rot, 1, false);
        else if (roll < 0.84) kit.instance('floor_tile_large_rocks', x, 0, z, rot, 1, false);
        else for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) kit.instance(pick(rng, small), x + dx, 0, z + dz, Math.floor(rng() * 4) * QUARTER, 1, false);
      }
    }
  }

  // Walls around every room and corridor, leaving openings where another area continues.
  const openAt = (x: number, z: number) => AREAS.some((r) => inside(r, x, z));
  const wallMix = ['wall', 'wall', 'wall_cracked', 'wall', 'wall_arched'];
  let doorway: THREE.Group | null = null;
  const doorAt = new THREE.Vector3(0, 0, ALTAR_ROOM.z0);
  const torchSpots: [number, number, number][] = [];
  const addWall = (x: number, z: number, rot: number, south: boolean, isHall: boolean) => {
    const piece = south ? 'wall_half' : pick(rng, isHall ? ['wall', 'wall_cracked'] : wallMix);
    kit.instance(piece, x, 0, z, rot);
    const horizontal = rot === 0 || rot === Math.PI;
    colliders.add(x, z, horizontal ? 2 : 0.5, horizontal ? 0.5 : 2);
  };
  for (const r of AREAS) {
    const isHall = HALLS.includes(r);
    // North edge (wall faces south into the room).
    for (let x = r.x0 + 2; x < r.x1; x += 4) {
      if (openAt(x, r.z0 - 0.6)) continue;
      if (r === ALTAR_ROOM && x === 0) {
        doorway = kit.single('wall_doorway', x, 0, r.z0, 0);
        continue;
      }
      addWall(x, r.z0, 0, false, isHall);
      if (!isHall && Math.abs(x) > 3 && rng() < 0.55) torchSpots.push([x, r.z0 + 0.5, 0]);
    }
    // South edge: a low ledge so the camera always sees in.
    for (let x = r.x0 + 2; x < r.x1; x += 4) if (!openAt(x, r.z1 + 0.6)) addWall(x, r.z1, Math.PI, true, isHall);
    // West and east edges.
    for (let z = r.z0 + 2; z < r.z1; z += 4) {
      if (!openAt(r.x0 - 0.6, z)) {
        addWall(r.x0, z, QUARTER, false, isHall);
        if (!isHall && rng() < 0.4) torchSpots.push([r.x0 + 0.5, z, QUARTER]);
      }
      if (!openAt(r.x1 + 0.6, z)) {
        addWall(r.x1, z, -QUARTER, false, isHall);
        if (!isHall && rng() < 0.4) torchSpots.push([r.x1 - 0.5, z, -QUARTER]);
      }
    }
  }
  // Corners of the rooms (only where both sides are walls).
  for (const r of ROOMS) {
    for (const [x, z, rot] of [[r.x1, r.z0, 0], [r.x0, r.z0, QUARTER], [r.x1, r.z1, -QUARTER], [r.x0, r.z1, Math.PI]] as [number, number, number][]) {
      kit.instance('wall_corner', x, 0, z, rot);
    }
  }

  // Behind the golden door: the short corridor to walk into.
  for (const z of [doorAt.z - 2, doorAt.z - 6]) {
    kit.instance('floor_tile_large', 0, 0, z, 0, 1, false);
    kit.instance('wall', -2.5, 0, z, QUARTER);
    kit.instance('wall', 2.5, 0, z, -QUARTER);
  }
  const glowEnd = new THREE.Mesh(
    new THREE.PlaneGeometry(4.2, 4.6),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd27a').multiplyScalar(2.2), toneMapped: false }),
  );
  glowEnd.position.set(0, 2.2, doorAt.z - 8.05);
  group.add(glowEnd);

  // Room dressing: each room has its own job and look.
  const solid = (name: string, x: number, z: number, rot = 0, scale = 1) => colliders.addObject(kit.single(name, x, 0, z, rot, scale));
  // Entrance: you fell in through a hole in the ceiling. Moonlight falls on the rubble;
  // old bones and a lost adventurer's things tell you this place is old and dangerous.
  solid('barrel_large', -4.4, 24.2);
  solid('barrel_small_stack', 4.3, 24.4, 0.6);
  kit.instance('rubble_large', 1.8, 0, 24.4, 0.4);
  kit.instance('rubble_half', -1.6, 0, 24.8, 2.2);
  kit.instance('rubble_half', 4.2, 0, 16.4, 0.8);
  kit.instance('sword_shield_broken', -4, 0, 16.6, 0.5);
  kit.instance('hw_skull', -4.6, 0, 19.6, 0.7, 0.45);
  kit.instance('hw_ribcage', -3.6, 0, 20.8, 2.1, 0.55);
  kit.instance('hw_bone_A', 3.8, 0, 21.2, 0.4, 0.6);
  kit.instance('hw_skull_candle', 4.6, 0, 18.4, -0.6, 0.5);
  kit.instance('keyring_hanging', -6, 1.6, 21, QUARTER);
  const moon = new THREE.SpotLight('#b9cdff', 26, 14, 0.42, 0.6, 1.4);
  moon.position.set(0, 10, 20.4);
  moon.target.position.set(0, 0, 20.4);
  group.add(moon, moon.target);
  // Guard room: weapon racks of broken shields, tables, banners.
  solid('table_long_broken', -6.5, -8.4, 0.05);
  solid('table_long_broken', 6.5, -8.4, -0.05);
  kit.instance('chair', -4.6, 0, -7.2, 2.6);
  kit.instance('chair', 4.8, 0, -7.4, -2.6);
  kit.instance('banner_patternA_blue', -6, 0, GUARD.z0, 0);
  kit.instance('banner_patternA_blue', 6, 0, GUARD.z0, 0);
  for (const [x, z] of [[-6, -2], [6, -2]]) colliders.addObject(kit.single('pillar', x, 0, z, 0));
  // Treasure room: gold everywhere.
  kit.instance('coin_stack_large', 24, 0, -8.6, 0.3);
  kit.instance('coin_stack_medium', 28.4, 0, -8.6, 1.1);
  kit.instance('coin_stack_large', 28.2, 0, 0.6, 2.2);
  kit.instance('coin_stack_small', 23.8, 0, 0.8, 0.4);
  kit.instance('banner_thin_yellow', 26, 0, TREASURE.z0, 0);
  // Altar room: tall decorated pillars around the altar, candles.
  for (const [x, z] of [[-6.5, -27], [6.5, -27], [-6.5, -37], [6.5, -37]]) colliders.addObject(kit.single('pillar_decorated', x, 0, z, 0));
  kit.instance('banner_triple_blue', -6, 0, ALTAR_ROOM.z0, 0);
  kit.instance('banner_triple_blue', 6, 0, ALTAR_ROOM.z0, 0);
  kit.instance('rubble_large', 8.2, 0, -24.4, 1.4);

  // Torches: on room walls, plus candles around the altar.
  const torches = new Torches(group, embers);
  const top = (object: THREE.Object3D) => {
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    return new THREE.Vector3(center.x, box.max.y + 0.02, center.z);
  };
  torchSpots.push([-2.0, doorAt.z - 3.5, QUARTER], [2.0, doorAt.z - 5.5, -QUARTER]);
  for (const [x, z, rot] of torchSpots) torches.add(top(kit.single('torch_mounted', x, 2.05, z, rot)));
  const altarAt = new THREE.Vector3(0, 0, -32);
  for (const [dx, dz] of [[-2.6, -2.6], [2.6, -2.6], [-2.6, 2.6], [2.6, 2.6]]) {
    torches.addCandle(top(kit.single('candle_lit', altarAt.x + dx, 0, altarAt.z + dz, rng() * Math.PI)));
  }
  torches.build();
  kit.flush();

  const altar = new Altar(altarAt);
  group.add(altar.group);
  colliders.add(altarAt.x, altarAt.z, 1.55, 1.55);
  if (!doorway) throw new Error('altar room needs a door');
  const door = new GoldenDoor(doorway);

  const runes = new Runes(group);
  const v = (x: number, z: number) => new THREE.Vector2(x, z);
  runes.ring(v(altarAt.x, altarAt.z), 3.05);
  const doorPath = runes.line(v(0, altarAt.z - 3.95), v(0, doorAt.z + 1.1), 0.92, 4);
  runes.line(v(0, altarAt.z + 3.95), v(0, ALTAR_ROOM.z1 - 0.5), 0.92, 4);

  const center = new THREE.Vector3((all.x0 + all.x1) / 2, 0, (all.z0 + all.z1) / 2);
  return {
    group,
    colliders,
    runes,
    doorPath,
    torches,
    altar,
    door,
    heroStart: new THREE.Vector3(0, 0, 20.4),
    dormant: [
      { position: new THREE.Vector3(-5, 0, -29), facing: 0.6 },
      { position: new THREE.Vector3(5, 0, -29.5), facing: -0.6 },
      { position: new THREE.Vector3(-7.5, 0, -33.5), facing: 1.4 },
      { position: new THREE.Vector3(7.5, 0, -34), facing: -1.4 },
    ],
    spawnPoints: [new THREE.Vector3(-6, 0, -25), new THREE.Vector3(6, 0, -25), new THREE.Vector3(-8, 0, -39), new THREE.Vector3(8, 0, -39), new THREE.Vector3(0, 0, -39)],
    theme: themeIndex,
    hazards: [],
    crateSpots: [new THREE.Vector3(-8.4, 0, -0.4), new THREE.Vector3(8.4, 0, 0.2), new THREE.Vector3(23.6, 0, -3.8), new THREE.Vector3(28.6, 0, -4.4), new THREE.Vector3(-4.4, 0, 18.6)],
    chest: { position: new THREE.Vector3(26, 0, -8.6), facing: 0 },
    halfX: (all.x1 - all.x0) / 2,
    halfZ: (all.z1 - all.z0) / 2,
    outdoor: false,
    doorAt,
    center,
    connected: true,
    encounters: DUNGEON_ENCOUNTERS,
  };
}
