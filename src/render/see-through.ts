import * as THREE from 'three';

/**
 * Walls and props between the camera and the hero dissolve in a dithered
 * circle around the hero, so the hero is never hidden. The game updates these
 * uniforms every frame; every patched material shares them.
 */
export const seeThrough = {
  /** Hero position in drawing-buffer pixels. */
  center: { value: new THREE.Vector2() },
  /** Circle radius in drawing-buffer pixels. */
  radius: { value: 220 },
  /** Hero distance along the camera's view direction. */
  depth: { value: 0 },
  /** 0 disables the effect, 1 removes most of the occluder. */
  strength: { value: 0.88 },
};

export function applySeeThrough(material: THREE.Material): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSeeCenter = seeThrough.center;
    shader.uniforms.uSeeRadius = seeThrough.radius;
    shader.uniforms.uSeeDepth = seeThrough.depth;
    shader.uniforms.uSeeStrength = seeThrough.strength;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vSeeWorldY;\nvarying float vSeeDepth;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 seeWorld = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          seeWorld = instanceMatrix * seeWorld;
        #endif
        seeWorld = modelMatrix * seeWorld;
        vSeeWorldY = seeWorld.y;
        vSeeDepth = -mvPosition.z;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec2 uSeeCenter;
        uniform float uSeeRadius;
        uniform float uSeeDepth;
        uniform float uSeeStrength;
        varying float vSeeWorldY;
        varying float vSeeDepth;
        float seeBayer( vec2 p ) {
          const float m[16] = float[16]( 0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5. );
          ivec2 i = ivec2( mod( p, 4.0 ) );
          return ( m[ i.x + i.y * 4 ] + 0.5 ) / 16.0;
        }`,
      )
      .replace(
        'void main() {',
        `void main() {
        // Only things above the floor and in front of the hero dissolve.
        if ( uSeeStrength > 0.0 && vSeeWorldY > 0.35 && vSeeDepth < uSeeDepth - 0.6 ) {
          float d = length( gl_FragCoord.xy - uSeeCenter ) / uSeeRadius;
          float fade = ( 1.0 - smoothstep( 0.55, 1.0, d ) ) * uSeeStrength;
          if ( fade > seeBayer( gl_FragCoord.xy ) ) discard;
        }`,
      );
  };
  material.customProgramCacheKey = () => 'see-through';
}
