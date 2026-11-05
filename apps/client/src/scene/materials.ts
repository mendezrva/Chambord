import * as THREE from 'three';

/** One shared material for all land: colours live in the geometry, flat shading gives the facets. */
export const landMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  flatShading: true,
  roughness: 0.88,
  metalness: 0,
});

export const waterUniforms = { uTime: { value: 0 } };

/** Glossy water in its own mesh: the vertex shader rolls low ripples across it, flat shading facets them. */
export const waterMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  flatShading: true,
  roughness: 0.3,
  metalness: 0.05,
  transparent: true,
  opacity: 0.92,
});
waterMaterial.onBeforeCompile = (shader) => {
  shader.uniforms.uTime = waterUniforms.uTime;
  shader.vertexShader = `uniform float uTime;\n${shader.vertexShader}`.replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
    transformed.y += sin(uTime * 1.6 + position.x * 7.0 + position.z * 5.0) * 0.012
                   + sin(uTime * 2.3 - position.x * 4.0 + position.z * 9.0) * 0.008;`,
  );
};
