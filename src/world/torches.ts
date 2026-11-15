import * as THREE from 'three';
import { noise1 } from '../core/math';
import type { Mood } from '../render/moods';
import type { Particles } from './particles';

const vertexShader = /* glsl */ `
  attribute float aSeed;
  attribute float aScale;
  uniform vec2 uSize;
  varying vec2 vUv;
  varying float vSeed;
  void main() {
    vec3 center = ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
    // Cylindrical billboard: faces the camera but stays upright.
    vec3 right = normalize( vec3( viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0] ) );
    vec2 size = uSize * aScale;
    vec3 world = center + right * position.x * size.x + vec3( 0.0, ( position.y + 0.5 ) * size.y, 0.0 );
    gl_Position = projectionMatrix * viewMatrix * vec4( world, 1.0 );
    vUv = uv;
    vSeed = aSeed;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColorCore;
  uniform vec3 uColorEdge;
  uniform float uLit;
  varying vec2 vUv;
  varying float vSeed;
  float hash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
  float vnoise( vec2 p ) {
    vec2 i = floor( p ), f = fract( p );
    vec2 u = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( hash( i ), hash( i + vec2( 1, 0 ) ), u.x ), mix( hash( i + vec2( 0, 1 ) ), hash( i + vec2( 1, 1 ) ), u.x ), u.y );
  }
  void main() {
    vec2 p = vUv;
    float t = uTime * 2.6 + vSeed * 17.0;
    float n = vnoise( vec2( p.x * 4.0, p.y * 3.0 - t ) ) * 0.6 + vnoise( vec2( p.x * 9.0, p.y * 7.0 - t * 1.7 ) ) * 0.4;
    // Teardrop: wide at the base, licking up into a point.
    float sway = ( vnoise( vec2( t * 0.35, vSeed ) ) - 0.5 ) * 0.22 * p.y;
    float width = mix( 0.42, 0.04, pow( p.y, 0.9 ) );
    float body = 1.0 - smoothstep( width * 0.4, width, abs( p.x - 0.5 - sway ) );
    body *= smoothstep( 0.0, 0.12, p.y ) * ( 1.0 - smoothstep( 0.55, 1.0, p.y + n * 0.35 ) );
    float flame = clamp( body * ( 0.75 + n * 0.6 ), 0.0, 1.0 );
    vec3 color = mix( uColorEdge, uColorCore, smoothstep( 0.35, 0.95, flame ) );
    gl_FragColor = vec4( color * flame * 2.3 * uLit, flame * uLit );
  }
`;

interface Torch {
  flame: THREE.Vector3;
  seed: number;
  scale: number;
  /** Candles have no light of their own; the bloom sells them. */
  light: THREE.PointLight | null;
  emberTimer: number;
  on?: boolean;
}

/** Wall torches: flame billboards, one flickering light each, rising embers. */
export class Torches {
  private readonly torches: Torch[] = [];
  private readonly material: THREE.ShaderMaterial;
  private mesh: THREE.InstancedMesh | null = null;
  private baseIntensity = 26;
  private readonly emberColor = new THREE.Color('#ff7a2a');
  private readonly emberHot = new THREE.Color('#ffc46b');

  constructor(
    private readonly parent: THREE.Object3D,
    private readonly embers: Particles,
  ) {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: new THREE.Vector2(0.62, 1.05) },
        uColorCore: { value: new THREE.Color('#ffc46e') },
        uColorEdge: { value: new THREE.Color('#ff4a12') },
        uLit: { value: 1 },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }

  add(flame: THREE.Vector3): void {
    const light = new THREE.PointLight('#ff8a3c', this.baseIntensity, 13, 2);
    light.position.copy(flame).add(new THREE.Vector3(0, 0.35, 0));
    this.parent.add(light);
    this.torches.push({ flame: flame.clone(), seed: Math.random() * 100, scale: 1, light, emberTimer: Math.random() });
  }

  addCandle(flame: THREE.Vector3): void {
    this.torches.push({ flame: flame.clone(), seed: Math.random() * 100, scale: 0.3, light: null, emberTimer: Infinity });
  }

  /** Builds the flame billboards. Call after adding every torch. */
  build(): void {
    const geometry = new THREE.PlaneGeometry(1, 1);
    this.mesh = new THREE.InstancedMesh(geometry, this.material, this.torches.length);
    const seeds = new Float32Array(this.torches.length);
    const scales = new Float32Array(this.torches.length);
    const m = new THREE.Matrix4();
    this.torches.forEach((t, i) => {
      this.mesh!.setMatrixAt(i, m.makeTranslation(t.flame.x, t.flame.y - 0.08 * t.scale, t.flame.z));
      seeds[i] = t.seed;
      scales[i] = t.scale;
    });
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    geometry.setAttribute('aScale', new THREE.InstancedBufferAttribute(scales, 1));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.parent.add(this.mesh);
  }

  applyMood(mood: Mood): void {
    this.baseIntensity = mood.torch.intensity;
    for (const t of this.torches) {
      if (!t.light) continue;
      t.light.color.set(mood.torch.color);
      t.light.distance = mood.torch.distance;
    }
  }

  /** 0 = every torch out (dark hall), 1 = all lit. Torches light one by one as it rises. */
  lit = 1;

  update(time: number, dt: number): void {
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uLit.value = this.lit;
    const n = this.torches.length;
    this.torches.forEach((t, i) => {
      t.on = this.lit >= 1 || i / n < this.lit;
    });
    for (const t of this.torches) {
      if (!t.light) continue;
      const flicker = 0.82 + 0.12 * noise1(time * 7 + t.seed) + 0.06 * noise1(time * 19 + t.seed * 3);
      t.light.intensity = t.on === false ? 0 : this.baseIntensity * flicker;
      if (t.on === false) continue;
      t.light.position.set(
        t.flame.x + noise1(time * 3 + t.seed) * 0.06,
        t.flame.y + 0.35 + noise1(time * 4 + t.seed * 2) * 0.05,
        t.flame.z + noise1(time * 3.4 + t.seed * 5) * 0.06,
      );
      t.emberTimer -= dt;
      if (t.emberTimer <= 0) {
        t.emberTimer = 0.08 + Math.random() * 0.25;
        this.embers.spawn({
          x: t.flame.x + (Math.random() - 0.5) * 0.2,
          y: t.flame.y + 0.3,
          z: t.flame.z + (Math.random() - 0.5) * 0.2,
          vx: (Math.random() - 0.5) * 0.5,
          vy: 0.7 + Math.random() * 0.9,
          vz: (Math.random() - 0.5) * 0.5,
          life: 0.9 + Math.random() * 1.2,
          size: 0.07 + Math.random() * 0.05,
          sizeEnd: 0.02,
          color: Math.random() < 0.3 ? this.emberHot : this.emberColor,
          intensity: 4,
          drag: 0.6,
          gravity: -0.15,
        });
      }
    }
  }
}
