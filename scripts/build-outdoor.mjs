// Builds the outdoor kit (graveyard, forest and castle pieces) from two more
// KayKit packs, both CC0:
//
//   node scripts/build-outdoor.mjs <dir-with-the-two-packs>
//
// <dir>/halloween = KayKit-Halloween-Bits-1.0
// <dir>/hexagon   = KayKit-Medieval-Hexagon-Pack-1.0
//
// Piece names get a prefix (hw_ / hx_) so they never clash with the dungeon kit.

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, meshopt, mergeDocuments, unpartition } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node scripts/build-outdoor.mjs <dir-with-halloween-and-hexagon>');
  process.exit(1);
}

const HALLOWEEN = path.join(dir, 'halloween/addons/kaykit_halloween_bits/Assets/gltf');
const HEX = path.join(dir, 'hexagon/addons/kaykit_medieval_hexagon_pack/Assets/gltf');

const PIECES = [
  ...[
    'arch', 'arch_gate', 'bench', 'bone_A', 'coffin', 'coffin_decorated', 'crypt',
    'fence', 'fence_broken', 'fence_gate', 'fence_pillar', 'fence_seperate', 'fence_seperate_broken',
    'floor_dirt', 'floor_dirt_grave', 'floor_dirt_small', 'grave_A', 'grave_A_destroyed', 'grave_B',
    'gravemarker_A', 'gravemarker_B', 'gravestone', 'lantern_standing', 'path_A', 'path_B', 'path_C', 'path_D',
    'post_lantern', 'post_skull', 'pumpkin_orange', 'pumpkin_orange_jackolantern', 'pumpkin_yellow',
    'pumpkin_yellow_jackolantern', 'ribcage', 'shrine', 'shrine_candles', 'skull', 'skull_candle',
    'tree_dead_large', 'tree_dead_large_decorated', 'tree_dead_medium', 'tree_dead_small',
    'tree_pine_orange_large', 'tree_pine_orange_medium', 'tree_pine_yellow_large', 'tree_pine_yellow_medium',
  ].map((n) => [path.join(HALLOWEEN, `${n}.gltf`), `hw_${n}`]),
  ...[
    'trees_A_large', 'trees_A_medium', 'trees_B_large', 'trees_B_medium', 'tree_single_A', 'tree_single_B',
    'rock_single_A', 'rock_single_B', 'rock_single_C', 'rock_single_D', 'rock_single_E', 'hill_single_A', 'hill_single_B',
    'waterlily_A', 'waterplant_A', 'waterplant_B',
  ].map((n) => [path.join(HEX, 'decoration/nature', `${n}.gltf`), `hx_${n}`]),
  ...[
    'barrel', 'crate_A_big', 'crate_B_small', 'flag_blue', 'flag_red', 'tent', 'weaponrack', 'wheelbarrow', 'target', 'sack',
  ].map((n) => [path.join(HEX, 'decoration/props', `${n}.gltf`), `hx_${n}`]),
  ...[
    'wall_straight', 'wall_straight_gate', 'wall_corner_A_inside', 'wall_corner_A_outside', 'fence_stone_straight', 'fence_wood_straight',
  ].map((n) => [path.join(HEX, 'buildings/neutral', `${n}.gltf`), `hx_${n}`]),
  ...[
    'building_tower_A_blue', 'building_well_blue', 'building_home_A_blue', 'building_home_B_blue', 'building_church_blue', 'building_market_blue',
  ].map((n) => [path.join(HEX, 'buildings/blue', `${n}.gltf`), `hx_${n}`]),
];

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

// Read each piece, rename its root node to the prefixed name, merge into one scene.
async function readNamed(file, name) {
  const doc = await io.read(file);
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const roots = scene.listChildren();
  if (roots.length !== 1) {
    // Wrap several roots in one named node so the game can find the piece.
    const wrapper = doc.createNode(name);
    for (const r of roots) {
      scene.removeChild(r);
      wrapper.addChild(r);
    }
    scene.addChild(wrapper);
  } else {
    roots[0].setName(name);
  }
  return doc;
}

const [first, ...rest] = PIECES;
const doc = await readNamed(...first);
for (const [file, name] of rest) mergeDocuments(doc, await readNamed(file, name));
const root = doc.getRoot();
const [main, ...extra] = root.listScenes();
for (const scene of extra) {
  for (const child of scene.listChildren()) main.addChild(child);
  scene.dispose();
}
root.setDefaultScene(main);
await doc.transform(unpartition());
const names = main.listChildren().map((n) => n.getName());
const missing = PIECES.map(([, n]) => n).filter((n) => !names.includes(n));
if (missing.length) throw new Error(`missing nodes ${missing.join(', ')}`);
await doc.transform(dedup(), prune({ keepLeaves: true }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
const out = path.resolve('public/models/outdoor-kit.glb');
await io.write(out, doc);
console.log('outdoor kit', `${Math.round(fs.statSync(out).size / 1024)} KB`, `${PIECES.length} pieces,`, root.listTextures().length, 'texture(s)');
