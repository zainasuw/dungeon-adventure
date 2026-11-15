import * as THREE from 'three';

/**
 * Things a hall's job asks you to deal with: lost books to pick up and cursed
 * crystals to smash. (Lanterns use the graveyard kit's own lantern.) Built
 * from simple shapes in the same low-poly style as the kit.
 */

/** A floating spell book with a glowing cover gem. */
export function makeBook(cover: string): THREE.Group {
  const book = new THREE.Group();
  const coverMat = new THREE.MeshStandardMaterial({ color: cover, roughness: 0.6 });
  const pageMat = new THREE.MeshStandardMaterial({ color: '#f3e6c4', roughness: 0.9 });
  const gemMat = new THREE.MeshStandardMaterial({ color: '#ffe08a', emissive: '#ffc35a', emissiveIntensity: 2.2 });
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.06, 0.82), coverMat);
  const front = back.clone();
  front.position.y = 0.2;
  const pages = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.15, 0.76), pageMat);
  pages.position.set(0.02, 0.1, 0);
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.26, 0.82), coverMat);
  spine.position.set(-0.3, 0.1, 0);
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.09), gemMat);
  gem.position.set(0.04, 0.25, 0);
  book.add(back, front, pages, spine, gem);
  book.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  // Tilted a little, as if held open by magic.
  book.rotation.z = 0.25;
  return book;
}

/** A tall cursed crystal that takes a few hits to break. */
export function makeCrystal(color: string): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.4, roughness: 0.25, metalness: 0.1, flatShading: true });
  const main = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), mat);
  main.scale.set(0.8, 1.9, 0.8);
  main.position.y = 1.35;
  main.name = 'core';
  group.add(main);
  // Smaller shards around the base.
  for (let i = 0; i < 4; i++) {
    const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), mat);
    const a = (i / 4) * Math.PI * 2 + 0.4;
    shard.scale.set(0.8, 1.8, 0.8);
    shard.position.set(Math.cos(a) * 0.65, 0.35, Math.sin(a) * 0.65);
    shard.rotation.set(Math.cos(a) * 0.5, 0, Math.sin(a) * -0.5);
    group.add(shard);
  }
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  return group;
}
