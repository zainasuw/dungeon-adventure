import * as THREE from 'three';
import { damp } from '../core/math';

const beamVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;

const beamFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    float fadeUp = pow( 1.0 - vUv.y, 1.6 );
    float streak = 0.75 + 0.25 * sin( vUv.x * 40.0 + uTime * 3.0 ) * sin( vUv.y * 9.0 - uTime * 5.0 );
    float a = fadeUp * streak * uStrength;
    gl_FragColor = vec4( uColor * a * 2.5, a );
  }
`;

/**
 * One of the four pillar altars: a stepped dais, a pedestal and a floating
 * crystal. Dormant it glows cyan; awakened it turns gold and sends a beam up.
 */
export class Altar {
  readonly group = new THREE.Group();
  /** 0 dormant, 1 awakened. Eases toward `target`. */
  awake = 0;
  private target = 0;
  private charge = 0;
  private readonly crystal: THREE.Mesh;
  private readonly crystalMaterial: THREE.MeshStandardMaterial;
  private readonly shards: THREE.Mesh[] = [];
  private readonly light: THREE.PointLight;
  private readonly beam: THREE.Mesh;
  private readonly beamMaterial: THREE.ShaderMaterial;
  private readonly dormantColor = new THREE.Color('#1fb8ff');
  private readonly awakeColor = new THREE.Color('#ffc247');
  private readonly color = new THREE.Color();

  constructor(position: THREE.Vector3) {
    this.group.position.copy(position);
    const stone = new THREE.MeshStandardMaterial({ color: '#5a6274', roughness: 0.9, flatShading: true });
    const trim = new THREE.MeshStandardMaterial({ color: '#c99a3e', roughness: 0.38, metalness: 0.8, flatShading: true });

    for (const [radius, height, y] of [[2.05, 0.28, 0.14], [1.5, 0.26, 0.41]]) {
      const tier = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.04, height, 8), stone);
      tier.position.y = y;
      tier.rotation.y = Math.PI / 8;
      tier.castShadow = tier.receiveShadow = true;
      this.group.add(tier);
    }
    for (const [radius, y] of [[2.08, 0.29], [1.52, 0.55]]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.045, 4, 8), trim);
      ring.rotation.set(Math.PI / 2, 0, Math.PI / 8);
      ring.position.y = y;
      this.group.add(ring);
    }
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.56, 1.25, 6), stone);
    pedestal.position.y = 1.2;
    pedestal.castShadow = pedestal.receiveShadow = true;
    this.group.add(pedestal);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.36, 0.18, 6), stone);
    cap.position.y = 1.9;
    cap.castShadow = true;
    this.group.add(cap);

    this.crystalMaterial = new THREE.MeshStandardMaterial({
      color: '#0c2a3a',
      emissive: this.dormantColor.clone(),
      emissiveIntensity: 2,
      roughness: 0.25,
      metalness: 0.1,
      flatShading: true,
    });
    // Hexagonal bipyramid: a long point up, a short point down.
    const crystalShape = new THREE.LatheGeometry([new THREE.Vector2(0, -0.55), new THREE.Vector2(0.36, 0), new THREE.Vector2(0, 0.95)], 6);
    this.crystal = new THREE.Mesh(crystalShape, this.crystalMaterial);
    this.crystal.position.y = 2.75;
    this.group.add(this.crystal);
    for (let i = 0; i < 4; i++) {
      const shard = new THREE.Mesh(crystalShape, this.crystalMaterial);
      shard.scale.setScalar(0.28);
      this.shards.push(shard);
      this.group.add(shard);
    }

    this.light = new THREE.PointLight(this.dormantColor, 9, 10, 2);
    this.light.position.y = 2.8;
    this.group.add(this.light);

    this.beamMaterial = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: this.awakeColor.clone() }, uStrength: { value: 0 }, uTime: { value: 0 } },
      vertexShader: beamVertex,
      fragmentShader: beamFragment,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.85, 16, 24, 1, true), this.beamMaterial);
    this.beam.position.y = 2.6 + 8;
    this.beam.visible = false;
    this.group.add(this.beam);
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }

  /** Brightens while the pillar is being defended (0..1). */
  setCharge(value: number): void {
    this.charge = value;
  }

  awaken(): void {
    this.target = 1;
    this.beam.visible = true;
  }

  update(time: number, dt: number): void {
    this.awake = damp(this.awake, this.target, 2.2, dt);
    const bob = Math.sin(time * 1.6) * 0.12;
    this.crystal.position.y = 2.75 + bob;
    this.crystal.rotation.y += dt * (0.6 + this.awake * 1.4 + this.charge * 2);
    this.shards.forEach((shard, i) => {
      const a = time * (0.9 + this.awake) + (i * Math.PI) / 2;
      const r = 0.85 + Math.sin(time * 2 + i) * 0.08 + this.charge * 0.3;
      shard.position.set(Math.cos(a) * r, 2.7 + bob + Math.sin(a * 2) * 0.18, Math.sin(a) * r);
      shard.rotation.y = -a;
    });
    this.color.copy(this.dormantColor).lerp(this.awakeColor, this.awake);
    this.crystalMaterial.emissive.copy(this.color);
    this.crystalMaterial.emissiveIntensity = 1.9 + this.charge * 2.5 + this.awake * 1.2 + Math.sin(time * 3) * 0.3;
    this.light.color.copy(this.color);
    this.light.intensity = 9 + this.charge * 10 + this.awake * 8 + Math.sin(time * 3) * 1.2;
    this.beamMaterial.uniforms.uStrength.value = this.awake * (0.85 + Math.sin(time * 2.4) * 0.15);
    this.beamMaterial.uniforms.uTime.value = time;
  }
}
