// Builds web-ready models from the KayKit source packs.
//
//   node scripts/build-assets.mjs <path-to-kaykit-packs>
//
// Every KayKit character shares one 41-bone rig, so the characters ship without
// animations and the clips live in two shared libraries (heroes and skeletons).
// The dungeon pieces are merged into one kit so their shared texture loads once.

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, meshopt, mergeDocuments, unpartition } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import fs from 'node:fs';
import path from 'node:path';

const packs = process.argv[2];
if (!packs) {
  console.error('usage: node scripts/build-assets.mjs <kaykit-packs-dir>');
  process.exit(1);
}

const ADVENTURERS = path.join(packs, 'KayKit-Character-Pack-Adventures-1.0/addons/kaykit_character_pack_adventures/Characters/gltf');
const SKELETONS = path.join(packs, 'KayKit-Character-Pack-Skeletons-1.0/addons/kaykit_character_pack_skeletons/Characters/gltf');
const ADVENTURER_ITEMS = path.join(packs, 'KayKit-Character-Pack-Adventures-1.0/addons/kaykit_character_pack_adventures/Assets/gltf');
const SKELETON_ITEMS = path.join(packs, 'KayKit-Character-Pack-Skeletons-1.0/addons/kaykit_character_pack_skeletons/Assets/gltf');
const DUNGEON = path.join(packs, 'KayKit-Dungeon-Remastered-1.0/addons/kaykit_dungeon_remastered/Assets/gltf');
const OUT = path.resolve('public/models');

const CHARACTERS = [
  [ADVENTURERS, 'Knight'],
  [ADVENTURERS, 'Mage'],
  [ADVENTURERS, 'Rogue'],
  [ADVENTURERS, 'Rogue_Hooded'],
  [ADVENTURERS, 'Barbarian'],
  [SKELETONS, 'Skeleton_Minion'],
  [SKELETONS, 'Skeleton_Warrior'],
  [SKELETONS, 'Skeleton_Rogue'],
  [SKELETONS, 'Skeleton_Mage'],
];

const HERO_CLIPS = [
  'Idle', 'Running_A', 'Walking_A', 'Dodge_Forward', 'Dodge_Backward',
  '1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Slice_Horizontal', '1H_Melee_Attack_Stab',
  '2H_Melee_Attack_Spin', '2H_Melee_Attack_Spinning', '2H_Melee_Idle',
  'Dualwield_Melee_Attack_Chop', 'Dualwield_Melee_Attack_Slice', 'Dualwield_Melee_Attack_Stab',
  'Spellcast_Shoot', 'Spellcast_Raise', 'Spellcast_Long', 'Spellcasting',
  'Block', 'Blocking', 'Block_Hit', 'Hit_A', 'Hit_B', 'Death_A', 'Death_A_Pose',
  'Cheer', 'Interact', 'Use_Item', 'Throw',
];

const SKELETON_CLIPS = [
  'Idle', 'Idle_B', 'Idle_Combat', 'Walking_D_Skeletons', 'Running_C', 'Taunt',
  'Skeletons_Inactive_Floor_Pose', 'Skeletons_Awaken_Floor', 'Skeletons_Awaken_Floor_Long',
  'Skeleton_Inactive_Standing_Pose', 'Skeletons_Awaken_Standing', 'Spawn_Ground_Skeletons',
  '1H_Melee_Attack_Chop', '1H_Melee_Attack_Jump_Chop', '2H_Melee_Attack_Chop', 'Spellcast_Shoot', '1H_Ranged_Shoot',
  'Hit_A', 'Hit_B', 'Death_C_Skeletons', 'Death_A',
];

// Pieces copied into the dungeon kit. Names match the source files and the node
// names inside them, which is how the game looks them up.
const KIT = [
  'floor_tile_large', 'floor_tile_small', 'floor_tile_small_broken_A', 'floor_tile_small_broken_B',
  'floor_tile_small_decorated', 'floor_tile_small_weeds_A', 'floor_tile_small_weeds_B', 'floor_tile_large_rocks',
  'floor_tile_big_grate', 'floor_tile_grate', 'floor_dirt_large', 'floor_foundation_allsides',
  'wall', 'wall_corner', 'wall_cracked', 'wall_broken', 'wall_arched', 'wall_pillar', 'wall_half',
  'wall_endcap', 'wall_gated', 'wall_shelves', 'wall_window_closed', 'wall_doorway',
  'column', 'pillar', 'pillar_decorated', 'stairs',
  'torch_mounted', 'torch_lit', 'candle_lit', 'candle_triple', 'candle_thin_lit', 'candle_melted',
  'banner_patternA_blue', 'banner_patternC_blue', 'banner_shield_blue', 'banner_thin_yellow', 'banner_triple_blue',
  'barrel_large', 'barrel_small', 'barrel_small_stack', 'box_large', 'box_small', 'box_stacked', 'crates_stacked',
  'rubble_large', 'rubble_half', 'chest_gold', 'chest', 'coin_stack_large', 'coin_stack_medium', 'coin_stack_small',
  'sword_shield_broken', 'keyring_hanging', 'bottle_A_green', 'bottle_B_brown', 'shelf_small_candles',
  'table_long_broken', 'chair', 'floor_tile_big_spikes',
];

await MeshoptEncoder.ready;
// Hand-held items the characters don't carry in their own files.
const WEAPONS = [
  [ADVENTURER_ITEMS, 'staff'],
  [ADVENTURER_ITEMS, 'spellbook_open'],
  [SKELETON_ITEMS, 'Skeleton_Blade'],
  [SKELETON_ITEMS, 'Skeleton_Axe'],
  [SKELETON_ITEMS, 'Skeleton_Staff'],
  [SKELETON_ITEMS, 'Skeleton_Shield_Small_A'],
  [SKELETON_ITEMS, 'Skeleton_Shield_Large_A'],
];

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

fs.mkdirSync(path.join(OUT, 'characters'), { recursive: true });

function kb(file) {
  return `${Math.round(fs.statSync(file).size / 1024)} KB`;
}

async function compress(doc) {
  await doc.transform(dedup(), prune({ keepLeaves: true }), resample(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
}

// Disposing an animation alone leaves its samplers holding their keyframe
// accessors, so prune() keeps them. Dispose the whole tree.
function disposeAnimation(anim) {
  for (const channel of anim.listChannels()) channel.dispose();
  for (const sampler of anim.listSamplers()) sampler.dispose();
  anim.dispose();
}

// Drops channels that hold a bone at its rest pose for the whole clip. The
// three.js mixer blends unanimated properties back to rest, so they add nothing.
function stripRestChannels(doc) {
  let removed = 0;
  for (const anim of doc.getRoot().listAnimations()) {
    for (const channel of anim.listChannels()) {
      const node = channel.getTargetNode();
      const sampler = channel.getSampler();
      const rest = { translation: node.getTranslation(), rotation: node.getRotation(), scale: node.getScale() }[channel.getTargetPath()];
      if (!rest || !holdsValue(sampler.getOutput(), rest)) continue;
      channel.dispose();
      sampler.dispose();
      removed++;
    }
  }
  return removed;
}

function holdsValue(accessor, rest) {
  const size = accessor.getElementSize();
  const el = new Array(size);
  for (let i = 0; i < accessor.getCount(); i++) {
    accessor.getElement(i, el);
    // q and -q are the same rotation.
    const sign = size === 4 && el[0] * rest[0] + el[1] * rest[1] + el[2] * rest[2] + el[3] * rest[3] < 0 ? -1 : 1;
    for (let k = 0; k < size; k++) {
      if (Math.abs(el[k] * sign - rest[k]) > 1e-4) return false;
    }
  }
  return true;
}

for (const [dir, name] of CHARACTERS) {
  const doc = await io.read(path.join(dir, `${name}.glb`));
  for (const anim of doc.getRoot().listAnimations()) disposeAnimation(anim);
  await compress(doc);
  const out = path.join(OUT, 'characters', `${name}.glb`);
  await io.write(out, doc);
  console.log('character', name.padEnd(18), kb(out));
}

async function buildClipLibrary(source, keep, outName) {
  const doc = await io.read(source);
  const root = doc.getRoot();
  const missing = keep.filter((n) => !root.listAnimations().some((a) => a.getName() === n));
  if (missing.length) throw new Error(`${outName}: missing clips ${missing.join(', ')}`);
  for (const anim of root.listAnimations()) {
    if (!keep.includes(anim.getName())) disposeAnimation(anim);
  }
  // Keep the bone hierarchy the clips target; drop every mesh.
  for (const node of root.listNodes()) {
    node.setMesh(null);
    node.setSkin(null);
  }
  for (const skin of root.listSkins()) skin.dispose();
  await doc.transform(resample());
  const removed = stripRestChannels(doc);
  await compress(doc);
  const out = path.join(OUT, outName);
  await io.write(out, doc);
  console.log('clips    ', outName.padEnd(18), kb(out), `${keep.length} clips, ${removed} rest channels dropped`);
}

await buildClipLibrary(path.join(ADVENTURERS, 'Knight.glb'), HERO_CLIPS, 'hero-anims.glb');
await buildClipLibrary(path.join(SKELETONS, 'Skeleton_Minion.glb'), SKELETON_CLIPS, 'skeleton-anims.glb');

await writeMerged('dungeon-kit.glb', KIT.map((name) => [kitSource(name), name]));
await writeMerged('weapons.glb', WEAPONS.map(([dir, name]) => [path.join(dir, `${name}.gltf`), name]));

// Merges single-object files into one scene with one named root node per file.
async function writeMerged(outName, sources) {
  const [first, ...rest] = sources;
  const doc = await io.read(first[0]);
  for (const [file] of rest) mergeDocuments(doc, await io.read(file));
  const root = doc.getRoot();
  const [mainScene, ...extraScenes] = root.listScenes();
  for (const scene of extraScenes) {
    for (const child of scene.listChildren()) mainScene.addChild(child);
    scene.dispose();
  }
  root.setDefaultScene(mainScene);
  await doc.transform(unpartition());
  const names = mainScene.listChildren().map((n) => n.getName());
  const missing = sources.map(([, name]) => name).filter((n) => !names.includes(n));
  if (missing.length) throw new Error(`${outName}: missing nodes ${missing.join(', ')}`);
  // Quantization moves a dequantize transform onto each piece's node, so the
  // game keeps node transforms when it places pieces.
  await compress(doc);
  const out = path.join(OUT, outName);
  await io.write(out, doc);
  console.log('merged   ', outName.padEnd(18), kb(out), `${sources.length} pieces,`, root.listTextures().length, 'texture(s)');
}

function kitSource(name) {
  const single = path.join(DUNGEON, `${name}.gltf.glb`);
  return fs.existsSync(single) ? single : path.join(DUNGEON, `${name}.glb`);
}
