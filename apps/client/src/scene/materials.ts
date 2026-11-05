import * as THREE from 'three';

/** One shared material for all land: colours live in the geometry, flat shading gives the facets. */
export const landMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  flatShading: true,
  roughness: 0.88,
  metalness: 0,
});
