import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

export const HERO_MODELS = ['Knight', 'Mage', 'Rogue', 'Rogue_Hooded', 'Barbarian'] as const;
export const SKELETON_MODELS = ['Skeleton_Minion', 'Skeleton_Warrior', 'Skeleton_Rogue', 'Skeleton_Mage'] as const;
export type HeroModel = (typeof HERO_MODELS)[number];
export type SkeletonModel = (typeof SKELETON_MODELS)[number];
export type CharacterModel = HeroModel | SkeletonModel;

/** A placed kit piece: the mesh plus the transform it carries inside the kit file. */
export interface KitMesh {
  mesh: THREE.Mesh;
  local: THREE.Matrix4;
}

/** Loads every model once and hands out cheap clones. */
export class Assets {
  readonly heroClips = new Map<string, THREE.AnimationClip>();
  readonly skeletonClips = new Map<string, THREE.AnimationClip>();
  /** Materials of the dungeon kit (walls, floors, props), patched for see-through. */
  readonly kitMaterials = new Set<THREE.Material>();
  /** Materials of the outdoor kit: see-through, but not tinted like dungeon stone. */
  readonly outdoorMaterials = new Set<THREE.Material>();

  private readonly kit = new Map<string, THREE.Object3D>();
  private readonly weapons = new Map<string, THREE.Object3D>();
  private readonly characters = new Map<CharacterModel, THREE.Object3D>();

  async load(onProgress: (fraction: number) => void): Promise<void> {
    const manager = new THREE.LoadingManager();
    manager.onProgress = (_url, loaded, total) => onProgress(loaded / total);
    const loader = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
    const url = (file: string) => `${import.meta.env.BASE_URL}models/${file}`;
    const names = [...HERO_MODELS, ...SKELETON_MODELS];

    const [kit, outdoor, weapons, heroAnims, skeletonAnims, ...characters] = await Promise.all([
      loader.loadAsync(url('dungeon-kit.glb')),
      loader.loadAsync(url('outdoor-kit.glb')),
      loader.loadAsync(url('weapons.glb')),
      loader.loadAsync(url('hero-anims.glb')),
      loader.loadAsync(url('skeleton-anims.glb')),
      ...names.map((name) => loader.loadAsync(url(`characters/${name}.glb`))),
    ]);

    for (const child of kit.scene.children) this.kit.set(child.name, child);
    kit.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) this.kitMaterials.add(o.material as THREE.Material);
    });
    // Outdoor pieces (graveyard, forest, castle) are named hw_* and hx_*.
    for (const child of outdoor.scene.children) this.kit.set(child.name, child);
    outdoor.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) this.outdoorMaterials.add(o.material as THREE.Material);
    });
    for (const child of weapons.scene.children) this.weapons.set(child.name, child);
    // Everything in the library is shared: a clone of a piece must never dispose it.
    for (const scene of [kit.scene, outdoor.scene, weapons.scene, ...characters.map((c) => c.scene)]) {
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.userData.shared = true;
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.userData.shared = true;
        }
      });
    }
    for (const clip of heroAnims.animations) this.heroClips.set(clip.name, inPlace(clip));
    for (const clip of skeletonAnims.animations) this.skeletonClips.set(clip.name, inPlace(clip));
    names.forEach((name, i) => this.characters.set(name, characters[i].scene));
  }

  /** A clone of a dungeon kit piece. Wrap it in a group to place it. */
  piece(name: string): THREE.Object3D {
    return this.source(this.kit, name).clone(true);
  }

  isSingleMesh(name: string): boolean {
    const node = this.source(this.kit, name);
    return node instanceof THREE.Mesh && node.children.length === 0;
  }

  /** The single mesh of a kit piece, for instancing. */
  pieceMesh(name: string): KitMesh {
    const node = this.source(this.kit, name);
    if (!(node instanceof THREE.Mesh) || node.children.length) throw new Error(`${name} is not a single mesh`);
    node.updateMatrix();
    return { mesh: node, local: node.matrix.clone() };
  }

  weapon(name: string): THREE.Object3D {
    return this.source(this.weapons, name).clone(true);
  }

  /** A fully independent character with its own skeleton and materials. */
  character(name: CharacterModel): THREE.Object3D {
    const model = cloneSkinned(this.source(this.characters, name));
    model.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.castShadow = true;
      o.receiveShadow = true;
      // Skinned bounds don't follow the animation; the characters are always on screen anyway.
      o.frustumCulled = false;
      o.material = (o.material as THREE.Material).clone();
    });
    return model;
  }

  private source<K>(map: Map<K, THREE.Object3D>, name: K): THREE.Object3D {
    const node = map.get(name);
    if (!node) throw new Error(`Missing model: ${String(name)}`);
    return node;
  }
}

/**
 * Pins the horizontal position of the root bones. Movement comes from the
 * game code, so clips like the dodge roll must not drift and snap back.
 */
function inPlace(clip: THREE.AnimationClip): THREE.AnimationClip {
  for (const track of clip.tracks) {
    if (track.name !== 'hips.position' && track.name !== 'root.position') continue;
    const v = track.values;
    for (let i = 3; i < v.length; i += 3) {
      v[i] = v[0];
      v[i + 2] = v[2];
    }
  }
  return clip;
}
