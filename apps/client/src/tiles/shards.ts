import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Rng } from './rng';

/**
 * Turns a smooth primitive into a crystalline shard: shared vertices are welded, then each one
 * is nudged at random, so every face tilts a little differently and catches the light on its own.
 * `amount` is relative to the shape's size; `keepBottom` leaves the base flat so it sits on the ground.
 */
export function shardify(geom: THREE.BufferGeometry, rng: Rng, amount = 0.18, keepBottom = false) {
  geom.deleteAttribute('normal');
  geom.deleteAttribute('uv');
  const g = mergeVertices(geom, 1e-4);
  geom.dispose();
  g.computeBoundingBox();
  const box = g.boundingBox!;
  const size = box.getSize(new THREE.Vector3());
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (keepBottom && y <= box.min.y + 1e-4) continue;
    pos.setXYZ(
      i,
      pos.getX(i) + (rng() - 0.5) * 2 * amount * size.x,
      y + (rng() - 0.5) * 2 * amount * size.y,
      pos.getZ(i) + (rng() - 0.5) * 2 * amount * size.z,
    );
  }
  return g;
}

/** A jagged rock or crystal: an icosahedron (detail 1 = 80 faces) pulled out of shape. */
export function rockShard(rng: Rng, radius: number, detail = 1, amount = 0.14) {
  return shardify(new THREE.IcosahedronGeometry(radius, detail), rng, amount);
}
