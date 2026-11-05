import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Rng } from './rng';

export interface PartOpts { x?: number; y?: number; z?: number; ry?: number; rx?: number; rz?: number; sx?: number; sy?: number; sz?: number; vary?: number }

/** Collects coloured, flat-shaded parts and merges them into one geometry (one draw call per tile). */
export class Parts {
  readonly rng: Rng;
  private list: THREE.BufferGeometry[] = [];
  constructor(rng: Rng) { this.rng = rng; }

  add(
    geom: THREE.BufferGeometry,
    color: number,
    o: PartOpts = {},
  ) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(o.x ?? 0, o.y ?? 0, o.z ?? 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0)),
      new THREE.Vector3(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1),
    );
    let g = geom.index ? geom.toNonIndexed() : geom.clone();
    g.applyMatrix4(m);
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    g.computeVertexNormals();
    const count = g.attributes.position.count;
    const colors = new Float32Array(count * 3);
    const base = new THREE.Color(color);
    const c = new THREE.Color();
    const vary = o.vary ?? 0.05;
    for (let i = 0; i < count; i += 3) {
      // Each triangle gets a slightly different shade: that is the faceted low-poly look.
      const k = 1 + (this.rng() - 0.5) * 2 * vary;
      c.copy(base).multiplyScalar(k);
      for (let j = 0; j < 3; j++) colors.set([c.r, c.g, c.b], (i + j) * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.list.push(g);
    geom.dispose();
    return this;
  }

  merge() {
    const merged = mergeGeometries(this.list, false)!;
    this.list.forEach((g) => g.dispose());
    merged.computeBoundingSphere();
    return merged;
  }
}


export function gableRoof(w: number, d: number, h: number) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(0, h);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  return g;
}

