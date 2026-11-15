import * as THREE from 'three';
import type { Assets } from '../core/assets';
import { createRng, pick } from '../core/math';
import { Altar } from './altar';
import { GoldenDoor } from './door';
import type { Particles } from './particles';
import { Runes, type RunePath } from './runes';
import { Colliders, KitPlacer } from './static-world';
import { Torches } from './torches';
import { buildDungeon, type Encounter } from './dungeon';
import { buildApproach } from './approach';
import type { EnemyKind } from '../actors/enemy';

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
  /** Half the room's width (x) and depth (z). */
  halfX: number;
  halfZ: number;
  outdoor: boolean;
  /** Where the golden door stands (the hero leaves through it). */
  doorAt: THREE.Vector3;
  /** The middle of the whole level. */
  center: THREE.Vector3;
  /** Several rooms joined by corridors (the camera roams freely). */
  connected: boolean;
  /** Rooms whose monsters wake when the hero walks in. */
  encounters: Encounter[];
}

const QUARTER = Math.PI / 2;
/** The scene index of the connected dungeon (see dungeon.ts). */
export const DUNGEON_SCENE = 7;

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
  /** Half width and depth. Width must be 12, 16 or 20 so the door sits in the middle. */
  half?: [number, number];
  /** Outside: a grass or dirt ground instead of tiles, and fences or trees instead of side walls. */
  outdoor?: { ground: string; edge: 'fence' | 'trees'; dirt: string[]; dirtChance: number };
  /** The way in: an entrance room, a corridor to the hall and a side room with guards (see approach.ts). */
  approach?: { side: 1 | -1; guards: EnemyKind[]; shout: string };
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
    approach: { side: -1, guards: ['runt', 'skeleton'], shout: 'Skeletons in the old potting shed!' },
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
  // 3. The Frozen Library: long and narrow, walls of books, shelves making aisles down the room.
  {
    approach: { side: 1, guards: ['skeleton', 'runt'], shout: 'The reading room has guards!' },
    half: [12, 16],
    floor: { large: 0.55, rocks: 0.05, dirt: 0, small: ['floor_tile_small_decorated', 'floor_tile_small_decorated', 'floor_tile_small', 'floor_tile_small_broken_A'] },
    north: ['wall_shelves', 'wall_window_closed'],
    west: ['wall_shelves', 'wall_shelves', 'wall_window_closed'],
    east: ['wall_shelves', 'wall_window_closed', 'wall_shelves'],
    banners: true,
    pillar: 'pillar',
    pillars: [[-5.5, -11], [5.5, -11]],
    pillarTorches: true,
    dormant: [
      { position: [-4.5, -6], facing: 0.8 },
      { position: [4.5, -6.5], facing: -0.8 },
      { position: [-9.5, 3], facing: 1.6 },
      { position: [9.5, 3.5], facing: -1.6 },
    ],
    spawns: [[-4, 11], [4, 11], [-9.5, -11], [9.5, -11], [0, -12]],
    hazards: [],
    crates: [[-10, -14], [10, -14], [-10, 13.6], [10, 13.6], [-10, -3], [10, 9]],
    chest: [-8, -14.1, 0],
    props(kit, solid, torches, _top, block) {
      // Free-standing bookshelves along both sides make aisles down the long room.
      for (const x of [-7.4, 7.4]) {
        for (const z of [-7, 0, 7]) block(kit.single('wall_shelves', x, 0, z, x < 0 ? QUARTER : -QUARTER, 0.8));
      }
      solid('table_long_broken', -2.6, 12.6, QUARTER);
      solid('table_long_broken', 2.6, 12.6, QUARTER);
      kit.instance('chair', -4, 0, 13.4, 0.3);
      kit.instance('chair', 4, 0, 13.2, -0.4);
      solid('shelf_small_candles', -10.4, -13.6, QUARTER);
      solid('shelf_small_candles', 10.4, 13.6, -QUARTER);
      kit.instance('candle_triple', -2.6, 0, -14.6, 0.2);
      kit.instance('candle_triple', 2.6, 0, -14.6, -0.2);
      kit.instance('candle_melted', -10, 0, 9.8, 0);
      kit.instance('coin_stack_medium', 9.8, 0, -9.4, 0.4);
      for (const [x, z] of [[-2.6, 12.6], [2.6, 12.6]]) torches.addCandle(new THREE.Vector3(x, 1.25, z));
    },
  },
  // 4. The Ember Deep: a forge. Grated floor, a ring of carved pillars, braziers and spike traps.
  {
    approach: { side: -1, guards: ['runt', 'skeleton'], shout: 'Skeletons guard the forge store!' },
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
    crates: [[-9, 9.6], [9, 9.6], [-14.4, -1], [14.4, -1], [-6, -10.2], [6, -10.2]],
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
      // Rubble heaps close off the corners: the forge floor becomes a rough circle.
      for (const [x, z] of [[-13.2, -8.8], [13.2, -8.8], [-13.2, 8.8], [13.2, 8.8], [-10.6, -10.2], [10.6, -10.2], [-14.4, -6.2], [14.4, -6.2]]) {
        solid('rubble_large', x, z, (x * z) % 3);
      }
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
  // 6. The Moonlit Graveyard: outside under the moon, rows of graves, dead trees, a crypt.
  {
    approach: { side: 1, guards: ['runt', 'runt'], shout: 'The graves are stirring!' },
    half: [20, 14],
    outdoor: { ground: '#25301f', edge: 'fence', dirt: ['hw_path_A', 'hw_path_B', 'hw_path_C'], dirtChance: 0.14 },
    floor: { large: 0, rocks: 0, dirt: 0, small: [] },
    north: ['wall_cracked', 'wall', 'wall_broken', 'wall_arched'],
    west: [],
    east: [],
    banners: false,
    pillar: '',
    pillars: [],
    pillarTorches: false,
    dormant: [
      { position: [-8, -4.5], facing: 0.5 },
      { position: [8, -5], facing: -0.5 },
      { position: [-12, 3.2], facing: 1.4 },
      { position: [12, 3.6], facing: -1.4 },
    ],
    spawns: [[-8, 8.5], [8, 8.5], [-16, 0], [16, 0], [0, -8]],
    hazards: [],
    crates: [[-18, -4], [18, 4], [-18, 10.5], [-6, 11.5], [6, 11.5]],
    chest: [-6, -12.1, 0],
    props(kit, solid, torches, top, block) {
      // Rows of graves on both sides; the middle stays open.
      const graves = ['hw_gravestone', 'hw_grave_A', 'hw_grave_B', 'hw_gravemarker_A', 'hw_grave_A_destroyed', 'hw_gravemarker_B'];
      let g = 0;
      for (const x of [-15, -11, 11, 15]) {
        for (const z of [-7, -1.5, 4, 9]) {
          if ((x === 15 && z < 0) || (x === -15 && z === 9)) continue;
          solid(graves[g++ % graves.length], x, z, (g % 3) * 0.12 - 0.12);
        }
      }
      block(kit.single('hw_crypt', 15.8, 0, -9.2, -QUARTER, 0.75));
      for (const [x, z, n] of [[-18.2, -11.5, 'hw_tree_dead_large_decorated'], [-18.4, 6, 'hw_tree_dead_large'], [18.2, 11, 'hw_tree_dead_medium'], [-4.5, -10.8, 'hw_tree_dead_small']] as [number, number, string][]) {
        solid(n, x, z, x * 0.3);
      }
      solid('hw_coffin_decorated', -15, 12, QUARTER);
      solid('hw_shrine_candles', 6, -12.4, 0);
      for (const [x, z, n] of [[-3.4, 3.4, 'hw_pumpkin_orange_jackolantern'], [3.4, -3.4, 'hw_pumpkin_yellow_jackolantern'], [-17, -2, 'hw_pumpkin_orange'], [17.4, 7, 'hw_pumpkin_yellow'], [9, 12.4, 'hw_skull_candle'], [-9, -12.6, 'hw_ribcage'], [-12.8, 11.2, 'hw_bone_A']] as [number, number, string][]) {
        kit.instance(n, x, 0, z, x);
      }
      // Lanterns light the paths.
      for (const [x, z] of [[-4.2, -4.2], [4.2, 4.2], [-7, 6.5], [7, -8.5]]) torches.add(top(kit.single('hw_lantern_standing', x, 0, z, 0)));
    },
  },
  // 7. The Forest Clearing: a sunny clearing ringed by trees, a camp, rocks, and the castle wall with the door.
  {
    approach: { side: -1, guards: ['runt', 'skeleton'], shout: 'Skeleton bandits at the old camp!' },
    half: [16, 14],
    outdoor: { ground: '#4a6b34', edge: 'trees', dirt: ['hw_path_A', 'hw_path_B'], dirtChance: 0.1 },
    floor: { large: 0, rocks: 0, dirt: 0, small: [] },
    north: ['wall', 'wall_pillar', 'wall_cracked'],
    west: [],
    east: [],
    banners: true,
    pillar: '',
    pillars: [],
    pillarTorches: false,
    dormant: [
      { position: [-6, -5], facing: 0.5 },
      { position: [6.5, -5.5], facing: -0.5 },
      { position: [-11.5, 0.5], facing: 1.4 },
      { position: [11.5, 1], facing: -1.4 },
    ],
    spawns: [[-5, 8.5], [5, 8.5], [-13, -9], [13, -9], [0, -9.5]],
    hazards: [],
    crates: [[-14, -11.6], [14, -11.6], [-14, 11.4], [14, 11.4], [3.2, 11.6]],
    chest: [8, -12.1, 0],
    props(kit, solid, torches, top) {
      // Clumps of trees inside the clearing.
      for (const [x, z, n, r] of [[-10, -6.5, 'hx_trees_B_large', 0.4], [10.5, -6.5, 'hx_trees_A_large', 1.8], [-13.5, 5.5, 'hx_trees_A_medium', 2.4], [13.5, 4.5, 'hx_trees_B_medium', 0.9]] as [number, number, string, number][]) {
        solid(n, x, z, r, 3.2);
      }
      for (const [x, z, n, sc] of [[-5.5, 6.2, 'hx_rock_single_A', 2.6], [6.4, 7, 'hx_rock_single_C', 2.4], [-2.6, -8.8, 'hx_rock_single_E', 2.2], [12.8, -1.6, 'hx_rock_single_B', 2.4], [-12.8, -1.4, 'hx_rock_single_D', 2.4]] as [number, number, string, number][]) {
        solid(n, x, z, x, sc);
      }
      // A little camp.
      solid('hx_tent', -9.5, 9.8, 0.5, 2.6);
      solid('hx_building_well_blue', 9.6, 9.6, 0.3, 2.4);
      solid('hx_weaponrack', -14, -4, QUARTER, 2.4);
      kit.instance('hx_flag_red', -7.6, 0, -11.6, 0, 2.6);
      kit.instance('hx_flag_blue', 7.6, 0, -11.6, 0, 2.6);
      kit.instance('hx_sack', -11.2, 0, 11.6, 0.4, 2.4);
      kit.instance('hx_wheelbarrow', 12.2, 0, 7.2, 2.2, 2.4);
      torches.add(top(kit.single('torch_lit', -6.6, 0, 9.6, 0)));
      torches.add(top(kit.single('torch_lit', 6.6, 0, 9.6, 0)));
    },
  },
];

/** Builds one of the four halls. */
export function buildCrypt(assets: Assets, embers: Particles, themeIndex = 0): Crypt {
  // Scene 7 is a connected dungeon of several rooms, built separately.
  if (themeIndex === DUNGEON_SCENE) return buildDungeon(assets, embers, themeIndex);
  const theme = THEMES[themeIndex] ?? THEMES[0];
  const hx = theme.half?.[0] ?? ROOM.halfX;
  const hz = theme.half?.[1] ?? ROOM.halfZ;
  const group = new THREE.Group();
  group.name = 'crypt';
  const rng = createRng(1337 + themeIndex * 101);
  const kit = new KitPlacer(assets, group);
  const wallInset = 0.5;
  const ap = theme.approach;
  const colliders = ap
    ? new Colliders({ minX: -24, maxX: 24, minZ: -hz - 10, maxZ: hz + 22 })
    : new Colliders({
        minX: -hx + wallInset,
        maxX: hx - wallInset,
        minZ: -hz + wallInset,
        maxZ: hz - wallInset,
      });

  const hazards = theme.hazards.map(([x, z]) => ({ x, z, half: 1.7 }));
  const isHazard = (x: number, z: number) => hazards.some((h) => Math.abs(h.x - x) < 1 && Math.abs(h.z - z) < 1);

  // Floor: 4x4 tiles in the hall's own mix.
  const f = theme.floor;
  const out = theme.outdoor;
  if (out) {
    // Outside: one big ground under everything, with patches of dirt and paths.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(hx * 2 + 60, hz * 2 + 60), new THREE.MeshStandardMaterial({ color: out.ground, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    group.add(ground);
  }
  const floorAt = (x: number, z: number, grate: boolean): void => {
    if (out) {
      if (rng() < out.dirtChance) kit.instance(pick(rng, out.dirt), x, 0, z, Math.floor(rng() * 4) * QUARTER, 1, false);
      return;
    }
    const r = rng();
    const rot = Math.floor(rng() * 4) * QUARTER;
    if (isHazard(x, z)) kit.instance('floor_tile_big_spikes', x, 0, z, 0, 1, false);
    else if (grate) kit.instance('floor_tile_big_grate', x, 0, z, rot, 1, false);
    else if (r < f.large) kit.instance('floor_tile_large', x, 0, z, rot, 1, false);
    else if (r < f.large + f.rocks) kit.instance('floor_tile_large_rocks', x, 0, z, rot, 1, false);
    else if (r < f.large + f.rocks + f.dirt) kit.instance('floor_dirt_large', x, 0, z, rot, 1, false);
    else {
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        kit.instance(pick(rng, f.small), x + dx, 0, z + dz, Math.floor(rng() * 4) * QUARTER, 1, false);
      }
    }
  };
  for (let i = 0; i < hx / 2; i++) {
    for (let j = 0; j < hz / 2; j++) floorAt(-hx + 2 + i * 4, -hz + 2 + j * 4, themeIndex === 3 && (i + j) % 3 === 0);
  }

  // Walls: front faces point into the room. The near wall is a low ledge so it never hides the hero.
  let doorway: THREE.Group | null = null;
  const across = hx / 2 - 1;
  const along = hz / 2 - 1;
  const palette = (list: string[], i: number) => list.filter((n) => n !== 'DOOR')[i % Math.max(1, list.filter((n) => n !== 'DOOR').length)];
  for (let i = 0; i < across; i++) {
    const x = -hx + 4 + i * 4;
    if (x === 0) doorway = kit.single('wall_doorway', x, 0, -hz, 0);
    else kit.instance(palette(theme.north, i), x, 0, -hz, 0);
  }
  kit.instance('wall_corner', hx, 0, -hz, 0);
  kit.instance('wall_corner', -hx, 0, -hz, QUARTER);
  if (!out) {
    for (let i = 0; i < across; i++) {
      const x = -hx + 4 + i * 4;
      // Full walls, so first person feels like a real room. The title room keeps a low
      // ledge: the menu camera looks in over it.
      if (!(ap && x === 0)) kit.instance(themeIndex === 0 ? 'wall_half' : 'wall', x, 0, hz, Math.PI);
    }
    for (let i = 0; i < along; i++) {
      kit.instance(palette(theme.west, i), -hx, 0, -hz + 4 + i * 4, QUARTER);
      kit.instance(palette(theme.east, i), hx, 0, -hz + 4 + i * 4, -QUARTER);
    }
    kit.instance('wall_corner', hx, 0, hz, -QUARTER);
    kit.instance('wall_corner', -hx, 0, hz, Math.PI);
  } else if (out.edge === 'fence') {
    // An old iron fence on three sides, with dead trees beyond it.
    for (let i = 0; i < along; i++) {
      kit.instance(i % 3 === 1 ? 'hw_fence_broken' : 'hw_fence', -hx, 0, -hz + 4 + i * 4, QUARTER);
      kit.instance(i % 3 === 2 ? 'hw_fence_broken' : 'hw_fence', hx, 0, -hz + 4 + i * 4, -QUARTER);
    }
    for (let i = 0; i < across; i++) {
      const x = -hx + 4 + i * 4;
      if (ap && x === 0) continue;
      kit.instance(i === Math.floor(across / 2) ? 'hw_fence_gate' : 'hw_fence', x, 0, hz, Math.PI);
    }
    for (const [x, z] of [[-hx, hz], [hx, hz], [-hx, -hz + 2], [hx, -hz + 2]]) kit.instance('hw_fence_pillar', x, 0, z, 0);
    for (let k = 0; k < 10; k++) {
      const side = k % 2 ? 1 : -1;
      kit.instance(k % 3 ? 'hw_tree_dead_medium' : 'hw_tree_dead_large', side * (hx + 3 + rng() * 4), 0, -hz + 2 + k * (hz * 2 / 10), rng() * 6);
    }
  } else {
    // A wall of trees on both sides; low rocks along the front so the camera sees in.
    const trees = ['hx_trees_A_large', 'hx_trees_B_large', 'hx_trees_A_medium', 'hx_trees_B_medium'];
    for (let z = -hz + 1.5; z <= hz; z += 3.6) {
      for (const side of [-1, 1]) kit.instance(pick(rng, trees), side * (hx + 1.6 + rng() * 1.2), 0, z, rng() * 6, 3.4 + rng() * 0.8);
    }
    for (let x = -hx + 2; x <= hx - 2; x += 4.2) if (!(ap && Math.abs(x) < 3)) kit.instance(pick(rng, ['hx_rock_single_A', 'hx_rock_single_B', 'hx_rock_single_C']), x + rng(), 0, hz + 1 + rng(), rng() * 6, 2 + rng());
  }

  // A short corridor behind the golden door, for walking through to the next hall.
  for (const z of [-hz - 2, -hz - 6]) {
    kit.instance('floor_tile_large', 0, 0, z, 0, 1, false);
    kit.instance(z === -hz - 2 ? 'wall' : 'wall_cracked', -2.5, 0, z, QUARTER);
    kit.instance(z === -hz - 2 ? 'wall_cracked' : 'wall', 2.5, 0, z, -QUARTER);
  }
  const glowEnd = new THREE.Mesh(
    new THREE.PlaneGeometry(4.2, 4.6),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd27a').multiplyScalar(2.2), toneMapped: false }),
  );
  glowEnd.position.set(0, 2.2, -hz - 8.05);
  group.add(glowEnd);

  if (theme.banners) {
    kit.instance(themeIndex === 2 ? 'banner_triple_blue' : 'banner_patternA_blue', -8, 0, -hz, 0);
    kit.instance(themeIndex === 2 ? 'banner_triple_blue' : 'banner_patternA_blue', 8, 0, -hz, 0);
    kit.instance('banner_shield_blue', -hx, 0, 0, QUARTER);
    kit.instance('banner_shield_blue', hx, 0, 0, -QUARTER);
  }

  const pillars: THREE.Group[] = [];
  for (const [x, z] of theme.pillar ? theme.pillars : []) {
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
  const way = ap
    ? buildApproach({
        kit,
        colliders,
        rng,
        hx,
        hz,
        style: out ? (out.edge === 'fence' ? 'fence' : 'trees') : 'stone',
        side: ap.side,
        floor: (x, z) => floorAt(x, z, false),
        torches,
        top,
        guards: ap.guards,
        shout: ap.shout,
      })
    : null;
  if (way) colliders.areas = way.areas;

  // Wall torches on the walls that face the camera.
  const torchSpots: [number, number, number][] = [
    [-2.0, -hz - 3.5, QUARTER], [2.0, -hz - 5.5, -QUARTER],
    [-3.3, -hz + 0.5, 0], [3.3, -hz + 0.5, 0],
    ...(out ? [] : ([
      [-hx + 0.5, -4, QUARTER], [-hx + 0.5, 4, QUARTER],
      [hx - 0.5, -4, -QUARTER], [hx - 0.5, 4, -QUARTER],
    ] as [number, number, number][])),
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
  const doorPath = runes.line(v(0, -3.95), v(0, -hz + 1.1), 0.92, 4);
  runes.line(v(0, 3.95), v(0, hz - 1.3), 0.92, 4);
  if (!out) {
    runes.line(v(3.95, 0), v(hx - 0.9, 0), 0.92, 4);
    runes.line(v(-3.95, 0), v(-hx + 0.9, 0), 0.92, 4);
  }

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
    heroStart: way ? way.heroStart : new THREE.Vector3(0, 0, hz - 6.6),
    dormant: theme.dormant.map((d) => ({ position: free(...d.position), facing: d.facing })),
    spawnPoints: theme.spawns.map(([x, z]) => free(x, z)),
    theme: themeIndex,
    hazards,
    crateSpots: [...theme.crates.map(([x, z]) => free(x, z)), ...(way ? way.crateSpots : [])],
    chest: way ? way.chest : { position: new THREE.Vector3(theme.chest[0], 0, theme.chest[1]), facing: theme.chest[2] },
    halfX: way ? (way.all.x1 - way.all.x0) / 2 : hx,
    halfZ: way ? (way.all.z1 - way.all.z0) / 2 : hz,
    outdoor: !!out,
    doorAt: new THREE.Vector3(0, 0, -hz),
    center: way ? new THREE.Vector3((way.all.x0 + way.all.x1) / 2, 0, (way.all.z0 + way.all.z1) / 2) : new THREE.Vector3(),
    connected: !!way,
    encounters: way ? [way.encounter] : [],
  };
}
