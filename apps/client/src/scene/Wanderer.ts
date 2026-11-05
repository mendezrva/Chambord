import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE } from '../tiles/palette';

/** A Wanderer: the player piece. Body in the player's colour, felt hat with a feather. */
const cache = new Map<number, THREE.BufferGeometry>();

function part(g: THREE.BufferGeometry, color: number, x: number, y: number, z: number, rz = 0) {
  const ng = g.index ? g.toNonIndexed() : g.clone();
  ng.deleteAttribute('uv');
  ng.applyMatrix4(new THREE.Matrix4().makeRotationZ(rz));
  ng.translate(x, y, z);
  ng.computeVertexNormals();
  const c = new THREE.Color(color);
  const arr = new Float32Array(ng.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) arr.set([c.r, c.g, c.b], i);
  ng.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return ng;
}

export function wandererGeometry(color: number) {
  const hit = cache.get(color);
  if (hit) return hit;
  const g = mergeGeometries([
    part(new THREE.CylinderGeometry(0.055, 0.09, 0.2, 7), color, 0, 0.1, 0),
    part(new THREE.CylinderGeometry(0.045, 0.06, 0.05, 7), color, 0, 0.215, 0),
    part(new THREE.IcosahedronGeometry(0.055, 0), PALETTE.skin, 0, 0.28, 0),
    part(new THREE.CylinderGeometry(0.085, 0.085, 0.012, 8), 0x2e4a33, 0, 0.325, 0),
    part(new THREE.CylinderGeometry(0.035, 0.05, 0.06, 7), 0x2e4a33, 0, 0.36, 0),
    part(new THREE.BoxGeometry(0.008, 0.08, 0.016), 0xffffff, 0.04, 0.38, 0, -0.5),
  ])!;
  cache.set(color, g);
  return g;
}
