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
}

const QUARTER = Math.PI / 2;

/** The look-test room: the hall of the first pillar. */
export function buildCrypt(assets: Assets, embers: Particles): Crypt {
  const group = new THREE.Group();
  group.name = 'crypt';
  const rng = createRng(1337);
  const kit = new KitPlacer(assets, group);
  const wallInset = 0.5;
  const colliders = new Colliders({
    minX: -ROOM.halfX + wallInset,
    maxX: ROOM.halfX - wallInset,
    minZ: -ROOM.halfZ + wallInset,
    maxZ: ROOM.halfZ - wallInset,
  });

  // Floor: 4x4 tiles, some broken up into small cracked or weedy tiles.
  const smallTiles = [
    'floor_tile_small', 'floor_tile_small', 'floor_tile_small', 'floor_tile_small_broken_A',
    'floor_tile_small_broken_B', 'floor_tile_small_weeds_A', 'floor_tile_small_decorated',
  ];
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 6; j++) {
      const x = -14 + i * 4;
      const z = -10 + j * 4;
      const r = rng();
      const rot = Math.floor(rng() * 4) * QUARTER;
      if (r < 0.7) kit.instance('floor_tile_large', x, 0, z, rot, 1, false);
      else if (r < 0.8) kit.instance('floor_tile_large_rocks', x, 0, z, rot, 1, false);
      else {
        for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          kit.instance(pick(rng, smallTiles), x + dx, 0, z + dz, Math.floor(rng() * 4) * QUARTER, 1, false);
        }
      }
    }
  }

  // Walls: front faces point into the room.
  const north = ['wall_cracked', 'wall', 'wall', 'DOOR', 'wall', 'wall', 'wall_cracked'];
  const south = ['wall', 'wall_cracked', 'wall', 'wall_arched', 'wall', 'wall_broken', 'wall'];
  const west = ['wall', 'wall_shelves', 'wall', 'wall_cracked', 'wall'];
  const east = ['wall', 'wall_cracked', 'wall', 'wall_gated', 'wall'];
  let doorway: THREE.Group | null = null;
  north.forEach((name, i) => {
    const x = -12 + i * 4;
    if (name === 'DOOR') doorway = kit.single('wall_doorway', x, 0, -ROOM.halfZ, 0);
    else kit.instance(name, x, 0, -ROOM.halfZ, 0);
  });
  south.forEach((name, i) => kit.instance(name, -12 + i * 4, 0, ROOM.halfZ, Math.PI));
  west.forEach((name, i) => kit.instance(name, -ROOM.halfX, 0, -8 + i * 4, QUARTER));
  east.forEach((name, i) => kit.instance(name, ROOM.halfX, 0, -8 + i * 4, -QUARTER));
  kit.instance('wall_corner', ROOM.halfX, 0, -ROOM.halfZ, 0);
  kit.instance('wall_corner', -ROOM.halfX, 0, -ROOM.halfZ, QUARTER);
  kit.instance('wall_corner', ROOM.halfX, 0, ROOM.halfZ, -QUARTER);
  kit.instance('wall_corner', -ROOM.halfX, 0, ROOM.halfZ, Math.PI);

  // Banners hang from the wall's center line.
  kit.instance('banner_patternA_blue', -8, 0, -ROOM.halfZ, 0);
  kit.instance('banner_patternA_blue', 8, 0, -ROOM.halfZ, 0);
  kit.instance('banner_shield_blue', -ROOM.halfX, 0, 0, QUARTER);
  kit.instance('banner_shield_blue', ROOM.halfX, 0, 0, -QUARTER);

  // Free-standing pillars, each with a torch on the side facing the camera so
  // the middle of the room gets warm pools of light.
  const pillars: THREE.Group[] = [];
  for (const [x, z] of [[-8, -4.5], [8, -4.5], [-8, 4.5], [8, 4.5]]) {
    const pillar = kit.single('pillar', x, 0, z, 0);
    colliders.addObject(pillar, 0.05);
    pillars.push(pillar);
  }

  // Props. Big ones block movement; small ones are decoration.
  const solid = (name: string, x: number, z: number, rot = 0, scale = 1) =>
    colliders.addObject(kit.single(name, x, 0, z, rot, scale));
  solid('barrel_large', -14, -10);
  solid('barrel_small', -12.5, -10.5, 0.4);
  solid('box_stacked', -14.1, -8.2, 0.3);
  solid('crates_stacked', 13.9, -9.9, -0.2);
  solid('box_large', 12.2, -10.4, 0.1);
  solid('chest_gold', -5.4, -10.3, 0.12);
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
  kit.instance('bottle_A_green', -13.6, 0, 8.4, 0);
  kit.instance('bottle_B_brown', -11.6, 0, 10.7, 0);
  // Wall torches on the walls that face the camera. (The south wall shows its
  // back to the camera, so torches there would only light the void.)
  const torches = new Torches(group, embers);
  const top = (object: THREE.Object3D) => {
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    return new THREE.Vector3(center.x, box.max.y + 0.02, center.z);
  };
  const torchSpots: [number, number, number][] = [
    [-3.3, -ROOM.halfZ + 0.5, 0], [3.3, -ROOM.halfZ + 0.5, 0],
    [-ROOM.halfX + 0.5, -4, QUARTER], [-ROOM.halfX + 0.5, 4, QUARTER],
    [ROOM.halfX - 0.5, -4, -QUARTER], [ROOM.halfX - 0.5, 4, -QUARTER],
  ];
  for (const pillar of pillars) {
    const box = new THREE.Box3().setFromObject(pillar);
    torchSpots.push([pillar.position.x, box.max.z, 0]);
  }
  for (const [x, z, rot] of torchSpots) torches.add(top(kit.single('torch_mounted', x, 2.05, z, rot)));
  for (const [x, z] of [[-2.6, -2.6], [2.6, -2.6], [-2.6, 2.6], [2.6, 2.6]]) {
    torches.addCandle(top(kit.single('candle_lit', x, 0, z, rng() * Math.PI)));
  }
  torches.addCandle(top(kit.single('candle_thin_lit', 5.7, 0, -10.5, 0)));
  torches.build();
  kit.flush();

  const altar = new Altar(new THREE.Vector3(0, 0, 0));
  group.add(altar.group);
  colliders.add(0, 0, 1.55, 1.55);

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

  return {
    group,
    colliders,
    runes,
    doorPath,
    torches,
    altar,
    door,
    heroStart: new THREE.Vector3(0, 0, 7.5),
    dormant: [
      { position: new THREE.Vector3(-6.4, 0, -5.8), facing: 0.6 },
      { position: new THREE.Vector3(6.2, 0, -6.3), facing: -2.4 },
      { position: new THREE.Vector3(-11.2, 0, 1.9), facing: 1.3 },
      { position: new THREE.Vector3(10.6, 0, 2.4), facing: -1.1 },
    ],
    spawnPoints: [
      new THREE.Vector3(-4.6, 0, 5.4),
      new THREE.Vector3(4.8, 0, 5.6),
      new THREE.Vector3(0, 0, -6.8),
      new THREE.Vector3(-11.5, 0, -2.8),
      new THREE.Vector3(11.4, 0, -3.2),
    ],
  };
}
