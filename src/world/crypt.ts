import * as THREE from 'three';
import type { Assets } from '../core/assets';
import { createRng, pick } from '../core/math';
import { Altar } from './altar';
import { GoldenDoor } from './door';
import type { Particles } from './particles';
import { Runes, type RunePath } from './runes';
import { Colliders, KitPlacer } from './static-world';
import { Torches } from './torches';

/** Interior half extents. Walls sit on the boundary, one unit thick. */
export const ROOM = { halfX: 16, halfZ: 12 };

export interface Crypt {
  group: THREE.Group;
  colliders: Colliders;
  runes: Runes;
  /** The rune line that leads from the altar to the door. */
  doorPath: RunePath;
  torches: Torches;
  altar: Altar;
  door: GoldenDoor;
  heroStart: THREE.Vector3;
  /** Skeletons lying on the floor until the pillar wakes them. */
  dormant: { position: THREE.Vector3; facing: number }[];
  /** Where reinforcements climb out of the ground. */
  spawnPoints: THREE.Vector3[];
  /** Which hall layout this is (index into LEVELS). */
  theme: number;
  /** Spike traps: squares on the floor that hurt the hero. */
  hazards: { x: number; z: number; half: number }[];
  /** Where smashable barrels and crates stand. */
  crateSpots: THREE.Vector3[];
  /** Where the hall's treasure chest stands, and which way it faces. */
  chest: { position: THREE.Vector3; facing: number };
}

const QUARTER = Math.PI / 2;

interface Theme {
  /** Chance per 4x4 floor slot of a plain large tile, rocky tile, dirt, or small mixed tiles. */
  floor: { large: number; rocks: number; dirt: number; small: string[] };
  north: string[];
  west: string[];
  east: string[];
  banners: boolean;
  pillar: string;
  pillars: [number, number][];
  /** Pillars that carry a wall torch on their camera side. */
  pillarTorches: boolean;
  dormant: { position: [number, number]; facing: number }[];
  spawns: [number, number][];
  props(
    kit: KitPlacer,
    solid: (name: string, x: number, z: number, rot?: number, scale?: number) => void,
    torches: Torches,
    top: (o: THREE.Object3D) => THREE.Vector3,
    block: (o: THREE.Object3D) => void,
  ): void;
  hazards: [number, number][];
  crates: [number, number][];
  chest: [number, number, number];
  /** The boss room has no altar in the middle: it's an open arena. */
  noAltar?: boolean;
}

const SMALL_PLAIN = ['floor_tile_small', 'floor_tile_small', 'floor_tile_small', 'floor_tile_small_broken_A', 'floor_tile_small_broken_B', 'floor_tile_small_weeds_A', 'floor_tile_small_decorated'];

/** The four halls. Same size and the same altar and door, but each its own place. */
const THEMES: Theme[] = [
  // 1. The Torchlit Hall: the original crypt.
  {
    floor: { large: 0.7, rocks: 0.1, dirt: 0, small: SMALL_PLAIN },
    north: ['wall_cracked', 'wall', 'wall', 'DOOR', 'wall', 'wall', 'wall_cracked'],
    west: ['wall', 'wall_shelves', 'wall', 'wall_cracked', 'wall'],
    east: ['wall', 'wall_cracked', 'wall', 'wall_gated', 'wall'],
    banners: true,
    pillar: 'pillar',
    pillars: [[-8, -4.5], [8, -4.5], [-8, 4.5], [8, 4.5]],
    pillarTorches: true,
    dormant: [
      { position: [-6.4, -5.8], facing: 0.6 },
      { position: [6.2, -6.3], facing: -2.4 },
      { position: [-11.2, 1.9], facing: 1.3 },
      { position: [10.6, 2.4], facing: -1.1 },
    ],
    spawns: [[-4.6, 5.4], [4.8, 5.6], [0, -6.8], [-11.5, -2.8], [11.4, -3.2]],
    hazards: [],
    crates: [[-13.5, -3], [13.5, -6], [-6.5, 9.8], [6.8, 9.6], [-13.6, 5.5], [9.5, -10.2]],
    chest: [-5.4, -10.1, 0.12],
    props(kit, solid) {
      solid('barrel_large', -14, -10);
      solid('barrel_small', -12.5, -10.5, 0.4);
      solid('box_stacked', -14.1, -8.2, 0.3);
      solid('crates_stacked', 13.9, -9.9, -0.2);
      solid('box_large', 12.2, -10.4, 0.1);
      solid('table_long_broken', -12.6, 9.6, 0.08);
      solid('barrel_large', 14, 10);
      solid('barrel_small_stack', 12.4, 10.3, 0.5);
      kit.instance('rubble_half', 13.7, 0, -7.6, 0.6);
      kit.instance('rubble_half', -10.4, 0, 6.6, 2.1);
      kit.instance('rubble_large', 11.2, 0, 7.6, 1.1);
      kit.instance('coin_stack_large', -6.7, 0, -10.0, 0.3);
      kit.instance('coin_stack_medium', -5.9, 0, -9.0, 1.2);
      kit.instance('coin_stack_small', -4.1, 0, -9.8, 0.7);
      kit.instance('candle_triple', 4.6, 0, -10.8, 0.4);
      kit.instance('candle_melted', 5.1, 0, -9.9, 0);
      kit.instance('sword_shield_broken', -12.4, 0, 2.6, 0.9);
      kit.instance('sword_shield_broken', 6.6, 0, -9.7, -0.6);
      kit.instance('chair', -10.7, 0, 8.6, 2.3);
    },
  },
  // 2. The Overgrown Hall: an old garden court, dirt and weeds, walls caved in.
  {
    floor: { large: 0.25, rocks: 0.25, dirt: 0.35, small: ['floor_tile_small_weeds_A', 'floor_tile_small_weeds_B', 'floor_tile_small_broken_A', 'floor_tile_small_broken_B'] },
    north: ['wall_broken', 'wall_cracked', 'wall', 'DOOR', 'wall_arched', 'wall_broken', 'wall_cracked'],
    west: ['wall_broken', 'wall_cracked', 'wall_arched', 'wall_broken', 'wall_cracked'],
    east: ['wall_cracked', 'wall_broken', 'wall_arched', 'wall_cracked', 'wall_broken'],
    banners: false,
    pillar: 'column',
    pillars: [[-10.5, -5.5], [6.5, -7], [-6, 6.5], [11, 4]],
    pillarTorches: false,
    dormant: [
      { position: [-4.5, -7.2], facing: 0.4 },
      { position: [9.5, -3.5], facing: -1.9 },
      { position: [-11.5, 2.5], facing: 1.4 },
      { position: [6.5, 4.8], facing: -2.6 },
    ],
    spawns: [[-3, 6.5], [3.5, 7], [-8.5, -1], [9, 0.5], [2.5, -8]],
    hazards: [],
    crates: [[-13.6, -6.6], [13.4, -2], [-6.5, -9.8], [9.5, 7.5], [-13.6, 8], [0.5, 10]],
    chest: [-3.8, -10, 0],
    props(kit, solid, torches, top) {
      solid('rubble_large', -13.6, -9.4, 0.4);
      solid('rubble_large', 13.2, -9.8, 2.2);
      solid('rubble_large', 13.6, 9.6, 1.1);
      solid('rubble_half', -13.8, 9.8, 0.3);
      solid('crates_stacked', -12.8, 6.6, 0.9);
      solid('barrel_small_stack', 9.8, 9.9, 0.2);
      solid('table_long_broken', 2.8, -10.2, 0.1);
      kit.instance('rubble_half', -8.2, 0, -9.9, 1.2);
      kit.instance('rubble_half', 12.2, 0, -3.6, 0.5);
      kit.instance('rubble_half', -2.4, 0, 9.4, 2.4);
      kit.instance('sword_shield_broken', 8.8, 0, -9.6, 0.4);
      kit.instance('sword_shield_broken', -9.4, 0, 9.4, 2.4);
      kit.instance('chair', 4.4, 0, -9.0, 1.4);
      kit.instance('coin_stack_small', -11.6, 0, -8.4, 0.5);
      for (const [x, z] of [[-14.2, -3], [14.2, -6.5], [-14.2, 5.5], [14.2, 2]]) {
        torches.add(top(kit.single('torch_lit', x, 0, z, 0)));
      }
    },
  },
  // 3. The Frozen Library: walls of books, rows of shelves making aisles, reading tables.
  {
    floor: { large: 0.55, rocks: 0.05, dirt: 0, small: ['floor_tile_small_decorated', 'floor_tile_small_decorated', 'floor_tile_small', 'floor_tile_small_broken_A'] },
    north: ['wall_shelves', 'wall_window_closed', 'wall_shelves', 'DOOR', 'wall_shelves', 'wall_window_closed', 'wall_shelves'],
    west: ['wall_shelves', 'wall_shelves', 'wall_window_closed', 'wall_shelves', 'wall_shelves'],
    east: ['wall_shelves', 'wall_shelves', 'wall_window_closed', 'wall_shelves', 'wall_shelves'],
    banners: true,
    pillar: 'pillar',
    pillars: [[-5.5, -8.2], [5.5, -8.2]],
    pillarTorches: true,
    dormant: [
      { position: [-6.5, -4.2], facing: 0.8 },
      { position: [6.5, -4.5], facing: -0.8 },
      { position: [-12.5, 0.5], facing: 1.6 },
      { position: [12.5, 0.2], facing: -1.6 },
    ],
    spawns: [[-4.5, 6.5], [4.5, 6.5], [-12.5, 6.5], [12.5, 6.5], [0, -7]],
    hazards: [],
    crates: [[-13.4, -6.5], [13.4, -6.5], [-2.6, 9.8], [2.6, 9.8], [-13.4, 3.6], [13.4, 3.6]],
    chest: [-8.6, -9.9, 0],
    props(kit, solid, torches, _top, block) {
      // Free-standing bookshelves make two aisles on each side.
      for (const [x, z] of [[-10, -4.5], [10, -4.5], [-10, 4], [10, 4]]) {
        const shelf = kit.single('wall_shelves', x, 0, z, 0, 0.8);
        block(shelf);
      }
      solid('table_long_broken', -6, 6.8, 0);
      solid('table_long_broken', 6, 6.8, Math.PI);
      kit.instance('chair', -7.6, 0, 7.8, 0.3);
      kit.instance('chair', 7.4, 0, 7.6, -0.4);
      solid('shelf_small_candles', -14.4, -9.6, QUARTER);
      solid('shelf_small_candles', 14.4, 9.6, -QUARTER);
      kit.instance('candle_triple', -2.6, 0, -10.6, 0.2);
      kit.instance('candle_triple', 2.6, 0, -10.6, -0.2);
      kit.instance('candle_melted', -13.6, 0, 9.8, 0);
      kit.instance('candle_melted', 13.4, 0, -9.8, 0);
      kit.instance('coin_stack_medium', 13.4, 0, 8.4, 0.4);
      for (const [x, z] of [[-6, 6.8], [6, 6.8]]) torches.addCandle(new THREE.Vector3(x, 1.25, z));
    },
  },
  // 4. The Ember Deep: a forge. Grated floor, a ring of carved pillars, braziers and spike traps.
  {
    floor: { large: 0.35, rocks: 0.15, dirt: 0, small: ['floor_tile_small_broken_A', 'floor_tile_small_broken_B', 'floor_tile_small'] },
    north: ['wall_pillar', 'wall_gated', 'wall', 'DOOR', 'wall', 'wall_gated', 'wall_pillar'],
    west: ['wall_gated', 'wall_pillar', 'wall', 'wall_pillar', 'wall_gated'],
    east: ['wall_gated', 'wall_pillar', 'wall', 'wall_pillar', 'wall_gated'],
    banners: false,
    pillar: 'pillar_decorated',
    pillars: [[-7, -5], [7, -5], [-9, 1.5], [9, 1.5], [-5.5, 6.5], [5.5, 6.5]],
    pillarTorches: true,
    dormant: [
      { position: [-3.8, -6.6], facing: 0.4 },
      { position: [3.8, -6.6], facing: -0.4 },
      { position: [-12.5, -2.5], facing: 1.6 },
      { position: [12.5, -2.5], facing: -1.6 },
    ],
    spawns: [[-12.5, 6.5], [12.5, 6.5], [0, -7.5], [-12, -8], [12, -8]],
    hazards: [[-12, -6], [12, -6], [-12, 3.5], [12, 3.5]],
    crates: [[-9.5, 9.6], [9.5, 9.6], [-14, -1], [14, -1], [-6, -9.8], [6, -9.8]],
    chest: [0, 9.6, Math.PI],
    props(kit, solid, torches, top) {
      solid('barrel_large', -14, 10);
      solid('barrel_large', 14, 10);
      solid('barrel_small_stack', -13.6, -10, 0.4);
      solid('box_stacked', 13.8, -10, -0.3);
      kit.instance('sword_shield_broken', -9.6, 0, -9.8, 0.2);
      kit.instance('sword_shield_broken', 9.6, 0, -9.8, -0.4);
      kit.instance('coin_stack_large', -1.4, 0, 9.9, 0.4);
      kit.instance('coin_stack_small', 1.5, 0, 10.1, 1.1);
      // Braziers: free-standing fires at the corners of the altar ring.
      for (const [x, z] of [[-4.6, -3.6], [4.6, -3.6], [-4.6, 3.8], [4.6, 3.8]]) {
        torches.add(top(kit.single('torch_lit', x, 0, z, 0)));
      }
    },
  },
  // 5. The Throne of Bones: an open arena for the Skeleton King.
  {
    floor: { large: 0.6, rocks: 0.1, dirt: 0, small: ['floor_tile_small_decorated', 'floor_tile_small', 'floor_tile_small_broken_A'] },
    north: ['wall_pillar', 'wall_arched', 'wall_pillar', 'DOOR', 'wall_pillar', 'wall_arched', 'wall_pillar'],
    west: ['wall_pillar', 'wall_arched', 'wall_pillar', 'wall_arched', 'wall_pillar'],
    east: ['wall_pillar', 'wall_arched', 'wall_pillar', 'wall_arched', 'wall_pillar'],
    banners: true,
    pillar: 'pillar_decorated',
    pillars: [[-11, -6], [11, -6], [-11, 5], [11, 5]],
    pillarTorches: true,
    dormant: [],
    spawns: [[-7, 6], [7, 6], [-9, -2], [9, -2], [0, 7]],
    hazards: [],
    crates: [[-14, -9.5], [14, -9.5], [-14, 9.5], [14, 9.5]],
    chest: [-6.5, -10.1, 0],
    noAltar: true,
    props(kit, solid, torches, top) {
      kit.instance('banner_triple_blue', -4, 0, -ROOM.halfZ, 0);
      kit.instance('banner_triple_blue', 4, 0, -ROOM.halfZ, 0);
      kit.instance('coin_stack_large', 6.4, 0, -10.2, 0.4);
      kit.instance('coin_stack_medium', 7.6, 0, -9.6, 1.1);
      kit.instance('sword_shield_broken', -13.4, 0, 0, 1.2);
      kit.instance('sword_shield_broken', 13.4, 0, 1.2, -0.8);
      solid('rubble_half', -13.6, 3, 0.3);
      for (const [x, z] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) torches.add(top(kit.single('torch_lit', x, 0, z, 0)));
    },
  },
];

/** Builds one of the four halls. */
export function buildCrypt(assets: Assets, embers: Particles, themeIndex = 0): Crypt {
  const theme = THEMES[themeIndex] ?? THEMES[0];
  const group = new THREE.Group();
  group.name = 'crypt';
  const rng = createRng(1337 + themeIndex * 101);
  const kit = new KitPlacer(assets, group);
  const wallInset = 0.5;
  const colliders = new Colliders({
    minX: -ROOM.halfX + wallInset,
    maxX: ROOM.halfX - wallInset,
    minZ: -ROOM.halfZ + wallInset,
    maxZ: ROOM.halfZ - wallInset,
  });

  const hazards = theme.hazards.map(([x, z]) => ({ x, z, half: 1.7 }));
  const isHazard = (x: number, z: number) => hazards.some((h) => Math.abs(h.x - x) < 1 && Math.abs(h.z - z) < 1);

  // Floor: 4x4 tiles in the hall's own mix.
  const f = theme.floor;
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 6; j++) {
      const x = -14 + i * 4;
      const z = -10 + j * 4;
      const r = rng();
      const rot = Math.floor(rng() * 4) * QUARTER;
      if (isHazard(x, z)) kit.instance('floor_tile_big_spikes', x, 0, z, 0, 1, false);
      else if (themeIndex === 3 && (i + j) % 3 === 0) kit.instance('floor_tile_big_grate', x, 0, z, rot, 1, false);
      else if (r < f.large) kit.instance('floor_tile_large', x, 0, z, rot, 1, false);
      else if (r < f.large + f.rocks) kit.instance('floor_tile_large_rocks', x, 0, z, rot, 1, false);
      else if (r < f.large + f.rocks + f.dirt) kit.instance('floor_dirt_large', x, 0, z, rot, 1, false);
      else {
        for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          kit.instance(pick(rng, f.small), x + dx, 0, z + dz, Math.floor(rng() * 4) * QUARTER, 1, false);
        }
      }
    }
  }

  // Walls: front faces point into the room. The near wall is a low ledge so it never hides the hero.
  let doorway: THREE.Group | null = null;
  theme.north.forEach((name, i) => {
    const x = -12 + i * 4;
    if (name === 'DOOR') doorway = kit.single('wall_doorway', x, 0, -ROOM.halfZ, 0);
    else kit.instance(name, x, 0, -ROOM.halfZ, 0);
  });
  for (let i = 0; i < 7; i++) kit.instance('wall_half', -12 + i * 4, 0, ROOM.halfZ, Math.PI);
  theme.west.forEach((name, i) => kit.instance(name, -ROOM.halfX, 0, -8 + i * 4, QUARTER));
  theme.east.forEach((name, i) => kit.instance(name, ROOM.halfX, 0, -8 + i * 4, -QUARTER));
  kit.instance('wall_corner', ROOM.halfX, 0, -ROOM.halfZ, 0);
  kit.instance('wall_corner', -ROOM.halfX, 0, -ROOM.halfZ, QUARTER);
  kit.instance('wall_corner', ROOM.halfX, 0, ROOM.halfZ, -QUARTER);
  kit.instance('wall_corner', -ROOM.halfX, 0, ROOM.halfZ, Math.PI);

  if (theme.banners) {
    kit.instance(themeIndex === 2 ? 'banner_triple_blue' : 'banner_patternA_blue', -8, 0, -ROOM.halfZ, 0);
    kit.instance(themeIndex === 2 ? 'banner_triple_blue' : 'banner_patternA_blue', 8, 0, -ROOM.halfZ, 0);
    kit.instance('banner_shield_blue', -ROOM.halfX, 0, 0, QUARTER);
    kit.instance('banner_shield_blue', ROOM.halfX, 0, 0, -QUARTER);
  }

  const pillars: THREE.Group[] = [];
  for (const [x, z] of theme.pillars) {
    const pillar = kit.single(theme.pillar, x, 0, z, 0);
    colliders.addObject(pillar, 0.05);
    pillars.push(pillar);
  }

  const torches = new Torches(group, embers);
  const top = (object: THREE.Object3D) => {
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    return new THREE.Vector3(center.x, box.max.y + 0.02, center.z);
  };
  const solid = (name: string, x: number, z: number, rot = 0, scale = 1) => colliders.addObject(kit.single(name, x, 0, z, rot, scale));
  theme.props(kit, solid, torches, top, (o) => colliders.addObject(o));

  // Wall torches on the walls that face the camera.
  const torchSpots: [number, number, number][] = [
    [-3.3, -ROOM.halfZ + 0.5, 0], [3.3, -ROOM.halfZ + 0.5, 0],
    [-ROOM.halfX + 0.5, -4, QUARTER], [-ROOM.halfX + 0.5, 4, QUARTER],
    [ROOM.halfX - 0.5, -4, -QUARTER], [ROOM.halfX - 0.5, 4, -QUARTER],
  ];
  if (theme.pillarTorches) {
    for (const pillar of pillars) {
      const box = new THREE.Box3().setFromObject(pillar);
      torchSpots.push([pillar.position.x, box.max.z, 0]);
    }
  }
  for (const [x, z, rot] of torchSpots) torches.add(top(kit.single('torch_mounted', x, 2.05, z, rot)));
  for (const [x, z] of [[-2.6, -2.6], [2.6, -2.6], [-2.6, 2.6], [2.6, 2.6]]) {
    torches.addCandle(top(kit.single('candle_lit', x, 0, z, rng() * Math.PI)));
  }
  torches.build();
  kit.flush();

  const altar = new Altar(new THREE.Vector3(0, 0, 0));
  group.add(altar.group);
  if (theme.noAltar) altar.group.visible = false;
  else colliders.add(0, 0, 1.55, 1.55);

  if (!doorway) throw new Error('north wall needs a door');
  const door = new GoldenDoor(doorway);

  // Rune paths radiate from a ring around the altar along the tile seams.
  const runes = new Runes(group);
  const v = (x: number, z: number) => new THREE.Vector2(x, z);
  runes.ring(v(0, 0), 3.05);
  const doorPath = runes.line(v(0, -3.95), v(0, -10.9), 0.92, 4);
  runes.line(v(0, 3.95), v(0, 10.7), 0.92, 4);
  runes.line(v(3.95, 0), v(15.1, 0), 0.92, 4);
  runes.line(v(-3.95, 0), v(-15.1, 0), 0.92, 4);

  // Keep sleepers and spawn spots off props (nudge toward the middle if needed).
  const free = (x: number, z: number) => {
    const p = new THREE.Vector3(x, 0, z);
    for (let i = 0; i < 20 && colliders.hits(p.x, p.z, 0.7); i++) p.multiplyScalar(0.92);
    return p;
  };

  return {
    group,
    colliders,
    runes,
    doorPath,
    torches,
    altar,
    door,
    heroStart: new THREE.Vector3(0, 0, 7.5),
    dormant: theme.dormant.map((d) => ({ position: free(...d.position), facing: d.facing })),
    spawnPoints: theme.spawns.map(([x, z]) => free(x, z)),
    theme: themeIndex,
    hazards,
    crateSpots: theme.crates.map(([x, z]) => free(x, z)),
    chest: { position: new THREE.Vector3(theme.chest[0], 0, theme.chest[1]), facing: theme.chest[2] },
  };
}
