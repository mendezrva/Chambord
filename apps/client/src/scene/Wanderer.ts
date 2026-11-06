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

const baseCache = new Map<number, THREE.BufferGeometry>();
/** A chunky stepped plinth under a placed Wanderer: a white rim and a disc in the player's colour, so it reads from any angle. */
export function wandererBaseGeometry(color: number) {
  const hit = baseCache.get(color);
  if (hit) return hit;
  const g = mergeGeometries([
    part(new THREE.CylinderGeometry(0.2, 0.22, 0.05, 10), 0xfffaf0, 0, 0.025, 0),
    part(new THREE.CylinderGeometry(0.16, 0.18, 0.04, 10), color, 0, 0.06, 0),
  ])!;
  baseCache.set(color, g);
  return g;
}

/** A faceted gem that floats over each Wanderer, so a piece hidden between houses can still be found. */
export const markerGeometry = (() => {
  const g = new THREE.OctahedronGeometry(0.14, 0);
  g.scale(1, 1.5, 1);
  return g;
})();

const markerMats = new Map<number, THREE.MeshStandardMaterial>();
export function markerMaterial(color: number) {
  let m = markerMats.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, flatShading: true, roughness: 0.35, metalness: 0.1 });
    markerMats.set(color, m);
  }
  return m;
}

/** A white back-face shell around the gem, so a red marker still stands out against red roofs. */
export const markerOutlineMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide });

// ---------- sonar rings ----------

/** Outer reach of the sonar rings, in world units (a tile is 2 across). */
export const SONAR_RADIUS = 1.35;

/** A flat disc that a shader fills with rings, so every placed Wanderer costs one quad and no textures. */
export const sonarGeometry = new THREE.PlaneGeometry(SONAR_RADIUS * 2, SONAR_RADIUS * 2).rotateX(-Math.PI / 2);

/** Shared clock for every sonar material; the board ticks it once a frame. */
export const sonarUniforms = { uTime: { value: 0 } };

const sonarMats = new Map<number, THREE.ShaderMaterial>();
/**
 * Rings in the player's colour that leave the plinth and fade as they spread, like a sonar ping.
 * Each Wanderer starts its pings at a phase taken from its world position, so a crowd doesn't pulse in step.
 */
export function sonarMaterial(color: number) {
  let m = sonarMats.get(color);
  if (!m) {
    m = new THREE.ShaderMaterial({
      uniforms: { uTime: sonarUniforms.uTime, uColor: { value: new THREE.Color(color) } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying float vSeed;
        void main() {
          vUv = uv * 2.0 - 1.0;
          vec3 o = modelMatrix[3].xyz;
          vSeed = fract(sin(dot(o.xz, vec2(12.9898, 78.233))) * 43758.5453);
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uColor;
        varying vec2 vUv;
        varying float vSeed;
        void main() {
          float r = length(vUv);
          if (r > 1.0) discard;
          float a = 0.0;
          // Two pings a cycle, each a crisp band with a soft trail behind it.
          for (int i = 0; i < 2; i++) {
            float k = fract(uTime * 0.5 + vSeed + float(i) * 0.5);
            float front = mix(0.16, 1.0, k);
            float d = front - r;
            float band = smoothstep(0.0, 0.02, d) * (1.0 - smoothstep(0.06, 0.13, d));
            float trail = step(0.0, d) * (1.0 - smoothstep(0.0, 0.35, d)) * 0.4;
            a += (band + trail) * (1.0 - k * k);
          }
          // A steady glow pooled under the plinth.
          a += (1.0 - smoothstep(0.1, 0.26, r)) * 0.5;
          a = clamp(a, 0.0, 1.0);
          vec3 c = mix(uColor, vec3(1.0), 0.12);
          gl_FragColor = vec4(c, a);
        }`,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    sonarMats.set(color, m);
  }
  return m;
}
