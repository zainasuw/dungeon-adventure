import * as THREE from 'three';
import { createRng } from '../core/math';

const GRID = 4;
const GLYPHS = GRID * GRID;

/** Draws 16 rune glyphs (a stave plus branches) into one texture atlas. */
function createAtlas(): THREE.CanvasTexture {
  const cell = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = cell * GRID;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 9;

  // Branch templates in cell-relative coordinates, hanging off a center stave.
  const branches: [number, number, number, number][] = [
    [0.5, 0.22, 0.76, 0.4], [0.5, 0.22, 0.24, 0.4], [0.5, 0.5, 0.76, 0.3], [0.5, 0.5, 0.24, 0.7],
    [0.5, 0.78, 0.76, 0.6], [0.5, 0.78, 0.24, 0.6], [0.5, 0.36, 0.76, 0.56], [0.5, 0.36, 0.24, 0.56],
    [0.24, 0.3, 0.76, 0.7], [0.5, 0.6, 0.72, 0.78],
  ];
  const rng = createRng(7);
  for (let g = 0; g < GLYPHS; g++) {
    const ox = (g % GRID) * cell;
    const oy = Math.floor(g / GRID) * cell;
    const pt = (x: number, y: number): [number, number] => [ox + x * cell, oy + y * cell];
    ctx.beginPath();
    ctx.moveTo(...pt(0.5, 0.16));
    ctx.lineTo(...pt(0.5, 0.84));
    const count = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < count; i++) {
      const [x0, y0, x1, y1] = branches[Math.floor(rng() * branches.length)];
      ctx.moveTo(...pt(x0, y0));
      ctx.lineTo(...pt(x1, y1));
    }
    if (rng() < 0.25) {
      ctx.moveTo(...pt(0.5, 0.3));
      ctx.lineTo(...pt(0.68, 0.45));
      ctx.lineTo(...pt(0.5, 0.6));
      ctx.lineTo(...pt(0.32, 0.45));
      ctx.closePath();
    }
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = 4;
  return texture;
}

const vertexShader = /* glsl */ `
  attribute float aGlyph;
  attribute float aPhase;
  varying vec2 vUv;
  varying float vPhase;
  void main() {
    vec2 cell = vec2( mod( aGlyph, ${GRID}.0 ), ${GRID - 1}.0 - floor( aGlyph / ${GRID}.0 ) );
    vUv = ( uv + cell ) / ${GRID}.0;
    vPhase = aPhase;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4( position, 1.0 );
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform vec3 uColor;
  uniform vec3 uColorAwake;
  uniform float uAwake;
  uniform float uIntensity;
  uniform float uTime;
  varying vec2 vUv;
  varying float vPhase;
  void main() {
    float glyph = texture2D( uAtlas, vUv ).r;
    // A slow breathing glow plus bright waves that travel along the path.
    float breathe = 0.55 + 0.25 * sin( uTime * 1.7 + vPhase * 0.6 );
    float wave = pow( max( 0.0, sin( uTime * 1.6 - vPhase * 0.45 ) ), 12.0 );
    float speed = mix( 1.0, 2.6, uAwake );
    float awakeWave = pow( max( 0.0, sin( uTime * 3.2 * speed - vPhase * 0.7 ) ), 6.0 ) * uAwake;
    vec3 color = mix( uColor, uColorAwake, uAwake );
    float strength = uIntensity * ( breathe + wave * 1.6 + awakeWave * 2.2 );
    gl_FragColor = vec4( color * glyph * strength, glyph );
  }
`;

/** One line or ring of glowing glyphs. */
export interface RunePath {
  mesh: THREE.InstancedMesh;
  uniforms: {
    uColor: { value: THREE.Color };
    uColorAwake: { value: THREE.Color };
    uAwake: { value: number };
    uIntensity: { value: number };
    uTime: { value: number };
  };
}

export class Runes {
  readonly paths: RunePath[] = [];
  private readonly atlas = createAtlas();
  private readonly rng = createRng(31);
  private readonly geometry: THREE.PlaneGeometry;

  constructor(private readonly parent: THREE.Object3D) {
    this.geometry = new THREE.PlaneGeometry(0.64, 0.64);
    this.geometry.rotateX(-Math.PI / 2);
  }

  /** Glyphs from `from` to `to`, about `spacing` apart. Phase grows along the line. */
  line(from: THREE.Vector2, to: THREE.Vector2, spacing = 0.92, phaseStart = 0): RunePath {
    const length = from.distanceTo(to);
    const count = Math.max(1, Math.floor(length / spacing) + 1);
    const angle = Math.atan2(to.x - from.x, to.y - from.y);
    const points: [number, number, number, number][] = [];
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : i / (count - 1);
      points.push([THREE.MathUtils.lerp(from.x, to.x, t), THREE.MathUtils.lerp(from.y, to.y, t), angle, phaseStart + i]);
    }
    return this.build(points);
  }

  ring(center: THREE.Vector2, radius: number, spacing = 0.9): RunePath {
    const count = Math.round((Math.PI * 2 * radius) / spacing);
    const points: [number, number, number, number][] = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      points.push([center.x + Math.sin(a) * radius, center.y + Math.cos(a) * radius, a + Math.PI, i]);
    }
    return this.build(points);
  }

  update(time: number): void {
    for (const path of this.paths) path.uniforms.uTime.value = time;
  }

  setColor(color: THREE.ColorRepresentation, intensity: number): void {
    for (const path of this.paths) {
      path.uniforms.uColor.value.set(color);
      path.uniforms.uIntensity.value = intensity;
    }
  }

  private build(points: [number, number, number, number][]): RunePath {
    const uniforms = {
      uAtlas: { value: this.atlas },
      uColor: { value: new THREE.Color('#33d6ff') },
      uColorAwake: { value: new THREE.Color('#ffc44d') },
      uAwake: { value: 0 },
      uIntensity: { value: 2.4 },
      uTime: { value: 0 },
    };
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    // Each path has its own per-glyph attributes, so it gets its own geometry.
    const geometry = this.geometry.clone();
    const mesh = new THREE.InstancedMesh(geometry, material, points.length);
    const glyphs = new Float32Array(points.length);
    const phases = new Float32Array(points.length);
    const tmp = new THREE.Object3D();
    points.forEach(([x, z, angle, phase], i) => {
      tmp.position.set(x, 0.075, z);
      tmp.rotation.set(0, angle, 0);
      tmp.updateMatrix();
      mesh.setMatrixAt(i, tmp.matrix);
      glyphs[i] = Math.floor(this.rng() * GLYPHS);
      phases[i] = phase;
    });
    geometry.setAttribute('aGlyph', new THREE.InstancedBufferAttribute(glyphs, 1));
    geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    this.parent.add(mesh);
    const path: RunePath = { mesh, uniforms };
    this.paths.push(path);
    return path;
  }
}
