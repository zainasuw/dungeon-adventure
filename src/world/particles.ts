import * as THREE from 'three';

export interface ParticleSpawn {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  life: number;
  size: number;
  /** Size at the end of life; defaults to `size`. */
  sizeEnd?: number;
  color: THREE.Color;
  /** Brightness multiplier; values above 1 feed the bloom. */
  intensity?: number;
  gravity?: number;
  drag?: number;
}

const vertexShader = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aAlpha;
  uniform float uScale;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4( position, 1.0 );
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uScale / -mv.z;
    vColor = aColor;
    vAlpha = aAlpha;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uSoft;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length( gl_PointCoord - 0.5 ) * 2.0;
    float a = 1.0 - smoothstep( uSoft, 1.0, d );
    if ( a <= 0.0 ) discard;
    gl_FragColor = vec4( vColor, a * vAlpha );
  }
`;

/** CPU-simulated point particles. Additive for glow, normal for dust and debris. */
export class Particles {
  readonly points: THREE.Points;
  private readonly max: number;
  private count = 0;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly color: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size0: Float32Array;
  private readonly size1: Float32Array;
  private readonly gravity: Float32Array;
  private readonly drag: Float32Array;
  private readonly material: THREE.ShaderMaterial;

  constructor(max: number, additive: boolean, soft = 0.0) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.color = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.size1 = new Float32Array(max);
    this.gravity = new Float32Array(max);
    this.drag = new Float32Array(max);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 }, uSoft: { value: soft } },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  /** Pixel scale for world-sized points: drawing-buffer height / (2 tan(fov / 2)). */
  setScale(bufferHeight: number, fovDegrees: number): void {
    this.material.uniforms.uScale.value = bufferHeight / (2 * Math.tan(THREE.MathUtils.degToRad(fovDegrees) / 2));
  }

  spawn(p: ParticleSpawn): void {
    if (this.count >= this.max) return;
    const i = this.count++;
    const i3 = i * 3;
    this.pos[i3] = p.x;
    this.pos[i3 + 1] = p.y;
    this.pos[i3 + 2] = p.z;
    this.vel[i3] = p.vx ?? 0;
    this.vel[i3 + 1] = p.vy ?? 0;
    this.vel[i3 + 2] = p.vz ?? 0;
    const k = p.intensity ?? 1;
    this.color[i3] = p.color.r * k;
    this.color[i3 + 1] = p.color.g * k;
    this.color[i3 + 2] = p.color.b * k;
    this.life[i] = p.life;
    this.maxLife[i] = p.life;
    this.size0[i] = p.size;
    this.size1[i] = p.sizeEnd ?? p.size;
    this.gravity[i] = p.gravity ?? 0;
    this.drag[i] = p.drag ?? 0;
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.swapRemove(i);
        continue;
      }
      const i3 = i * 3;
      const drag = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= drag;
      this.vel[i3 + 1] = this.vel[i3 + 1] * drag - this.gravity[i] * dt;
      this.vel[i3 + 2] *= drag;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < 0.05 && this.gravity[i] > 0) {
        this.pos[i3 + 1] = 0.05;
        this.vel[i3 + 1] *= -0.3;
        this.vel[i3] *= 0.6;
        this.vel[i3 + 2] *= 0.6;
      }
      const t = 1 - this.life[i] / this.maxLife[i];
      this.size[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      // Fade in quickly, fade out over the last 60% of life.
      this.alpha[i] = Math.min(1, t * 8) * Math.min(1, (1 - t) / 0.6);
      i++;
    }
    const g = this.points.geometry;
    g.setDrawRange(0, this.count);
    for (const name of ['position', 'aColor', 'aSize', 'aAlpha']) {
      (g.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  private swapRemove(i: number): void {
    const last = --this.count;
    if (i === last) return;
    const a = i * 3;
    const b = last * 3;
    for (let k = 0; k < 3; k++) {
      this.pos[a + k] = this.pos[b + k];
      this.vel[a + k] = this.vel[b + k];
      this.color[a + k] = this.color[b + k];
    }
    this.life[i] = this.life[last];
    this.maxLife[i] = this.maxLife[last];
    this.size0[i] = this.size0[last];
    this.size1[i] = this.size1[last];
    this.gravity[i] = this.gravity[last];
    this.drag[i] = this.drag[last];
  }
}
