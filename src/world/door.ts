import * as THREE from 'three';
import { damp } from '../core/math';

const shaftVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;

const shaftFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    float across = sin( vUv.x * 3.14159 );
    float along = pow( 1.0 - vUv.y, 1.8 );
    float shimmer = 0.8 + 0.2 * sin( vUv.x * 23.0 + uTime * 0.7 );
    float a = across * along * shimmer * uStrength;
    gl_FragColor = vec4( uColor * a, a );
  }
`;

/**
 * The golden exit door. Light leaks around its edges and grows with every
 * awakened pillar; at four it swings open.
 */
export class GoldenDoor {
  /** 0..1, how many pillars are awake out of four. */
  private progress = 0;
  private glow = 0;
  private openAmount = 0;
  private opening = false;
  private readonly door: THREE.Object3D;
  private readonly backlight: THREE.MeshBasicMaterial;
  private readonly shaftMaterial: THREE.ShaderMaterial;
  private readonly light: THREE.PointLight;
  private readonly gold = new THREE.Color('#ffc35a');

  constructor(doorway: THREE.Object3D) {
    const door = doorway.getObjectByName('wall_doorway_door');
    if (!door) throw new Error('wall_doorway has no door');
    this.door = door;
    const goldMaterial = new THREE.MeshStandardMaterial({
      color: '#d4a23c',
      metalness: 0.85,
      roughness: 0.3,
      emissive: '#5a3a08',
      emissiveIntensity: 0.6,
    });
    door.traverse((o) => {
      if (o instanceof THREE.Mesh) o.material = goldMaterial;
    });

    // A bright card just behind the door: light "leaking" through the gaps.
    doorway.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(door);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const local = doorway.worldToLocal(center.clone());
    this.backlight = new THREE.MeshBasicMaterial({ color: this.gold.clone().multiplyScalar(3), toneMapped: false });
    const card = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.backlight);
    card.scale.set(Math.max(size.x, size.z) + 0.2, size.y + 0.15, 1);
    card.position.set(local.x, local.y, local.z - 0.32);
    doorway.add(card);

    this.shaftMaterial = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: this.gold.clone() }, uStrength: { value: 0 }, uTime: { value: 0 } },
      vertexShader: shaftVertex,
      fragmentShader: shaftFragment,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    // Fan of light shafts falling from the doorway onto the floor.
    const shaftGeometry = new THREE.PlaneGeometry(1.4, 7, 1, 1);
    shaftGeometry.translate(0, -3.5, 0);
    for (const [x, tilt, yaw] of [[-0.55, 1.05, 0.22], [0, 1.0, 0], [0.55, 1.05, -0.22]] as const) {
      const shaft = new THREE.Mesh(shaftGeometry, this.shaftMaterial);
      shaft.position.set(local.x + x, size.y * 0.85, local.z + 0.4);
      shaft.rotation.set(-tilt, yaw, 0, 'YXZ');
      shaft.renderOrder = 4;
      doorway.add(shaft);
    }

    this.light = new THREE.PointLight(this.gold, 4, 9, 2);
    this.light.position.set(local.x, 2.2, local.z + 1.2);
    doorway.add(this.light);
  }

  setProgress(pillarsAwake: number): void {
    this.progress = pillarsAwake / 4;
    if (pillarsAwake >= 4) this.opening = true;
  }

  update(time: number, dt: number): void {
    const target = 0.25 + this.progress * 0.75;
    this.glow = damp(this.glow, target, 1.5, dt);
    const pulse = 0.9 + Math.sin(time * 1.8) * 0.1;
    this.backlight.color.copy(this.gold).multiplyScalar((1.2 + this.glow * 4) * pulse);
    this.shaftMaterial.uniforms.uStrength.value = (0.06 + this.glow * 0.22) * pulse;
    this.shaftMaterial.uniforms.uTime.value = time;
    this.light.intensity = (3 + this.glow * 12) * pulse;
    if (this.opening) {
      this.openAmount = damp(this.openAmount, 1, 1.4, dt);
      this.door.rotation.y = -this.openAmount * 1.75;
    }
  }
}
