import * as THREE from 'three';
import {
  BloomEffect,
  BrightnessContrastEffect,
  EffectComposer,
  EffectPass,
  HueSaturationEffect,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import type { Mood } from './moods';

/**
 * WebGL renderer plus the post-processing chain:
 * scene → ambient occlusion → bloom → AgX tone mapping → grade → vignette.
 */
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  /** Drawing-buffer size in pixels, for screen-space shader math. */
  readonly bufferSize = new THREE.Vector2();

  private readonly composer: EffectComposer;
  private readonly ao: N8AOPostPass;
  private readonly bloom: BloomEffect;
  private readonly saturation: HueSaturationEffect;
  private readonly contrast: BrightnessContrastEffect;
  private readonly vignette: VignetteEffect;

  constructor(container: HTMLElement, scene: THREE.Scene, private readonly camera: THREE.PerspectiveCamera) {
    this.gl = new THREE.WebGLRenderer({ powerPreference: 'high-performance', antialias: false, stencil: false, depth: false });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.gl.domElement.tabIndex = 0;
    container.appendChild(this.gl.domElement);

    // No MSAA: the AO pass needs a resolved depth buffer. SMAA handles edges instead.
    this.composer = new EffectComposer(this.gl, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.composer.addPass(new RenderPass(scene, camera));

    this.ao = new N8AOPostPass(scene, camera);
    this.ao.configuration.gammaCorrection = false;
    this.ao.configuration.aoRadius = 2.2;
    this.ao.configuration.distanceFalloff = 1.2;
    this.ao.configuration.halfRes = true;
    this.ao.configuration.color = new THREE.Color('#02040a');
    this.ao.setQualityMode('Medium');
    this.ao.enabled = !new URLSearchParams(location.search).has('noao');
    this.composer.addPass(this.ao);

    this.bloom = new BloomEffect({ mipmapBlur: true, radius: 0.72, luminanceSmoothing: 0.22 });
    this.saturation = new HueSaturationEffect();
    this.contrast = new BrightnessContrastEffect();
    this.vignette = new VignetteEffect({ offset: 0.3 });
    const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    this.composer.addPass(new EffectPass(camera, this.bloom, toneMapping, this.saturation, this.contrast, this.vignette));
    this.composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  applyMood(mood: Mood): void {
    this.bloom.intensity = mood.bloom.intensity;
    this.bloom.luminanceMaterial.threshold = mood.bloom.threshold;
    this.saturation.saturation = mood.saturation;
    this.contrast.contrast = mood.contrast;
    this.contrast.brightness = mood.brightness;
    this.vignette.darkness = mood.vignette;
    this.ao.configuration.intensity = mood.ao;
  }

  render(dt: number): void {
    this.composer.render(dt);
  }

  private resize(): void {
    const parent = this.gl.domElement.parentElement!;
    const width = parent.clientWidth;
    const height = parent.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.gl.setSize(width, height);
    this.composer.setSize(width, height);
    this.gl.getDrawingBufferSize(this.bufferSize);
  }
}
