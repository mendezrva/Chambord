import * as THREE from 'three';
import { pick, range, type Rng } from './rng';
import { PALETTE } from './palette';
import { rockShard } from './shards';
import type { Parts } from './parts';

export type V2 = [number, number];

/** Resamples a polyline to roughly even spacing, so ribbons bend smoothly and details space out evenly. */
export function resample(path: V2[], step: number): V2[] {
  const out: V2[] = [path[0]];
  let carry = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const [a, b] = [path[i], path[i + 1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let t = carry;
    while (t < len) {
      out.push([a[0] + ((b[0] - a[0]) * t) / len, a[1] + ((b[1] - a[1]) * t) / len]);
      t += step;
    }
    carry = t - len;
  }
  out.push(path[path.length - 1]);
  return out;
}

/** Unit normal (left side) of the path at point i. */
function normalAt(path: V2[], i: number): V2 {
  const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len = Math.hypot(dx, dz) || 1;
  return [-dz / len, dx / len];
}

export function offsetPath(path: V2[], d: number): V2[] {
  return path.map((p, i) => {
    const n = normalAt(path, i);
    return [p[0] + n[0] * d, p[1] + n[1] * d];
  });
}

/** Extends the first and last point outward a little so ribbons meet the tile edge cleanly. */
function extendEnds(path: V2[], by: number): V2[] {
  const out = path.map((p) => [...p] as V2);
  const push = (i: number, j: number) => {
    const dx = out[i][0] - out[j][0], dz = out[i][1] - out[j][1];
    const len = Math.hypot(dx, dz) || 1;
    out[i] = [out[i][0] + (dx / len) * by, out[i][1] + (dz / len) * by];
  };
  push(0, 1);
  push(out.length - 1, out.length - 2);
  return out;
}

export interface RibbonOpts {
  /** Half width, optionally varying along the path (t from 0 to 1). */
  halfWidth: number | ((t: number) => number);
  y: number;
  /** Strips across the ribbon. */
  across?: number;
  /** Random vertex height, for a faceted surface. */
  jitter?: number;
  rng?: Rng;
  extend?: number;
}

/** A flat strip following a path: the base of rivers, roads and their trims. */
export function ribbon(path: V2[], o: RibbonOpts): THREE.BufferGeometry {
  const pts = extendEnds(path, o.extend ?? 0.03);
  const across = o.across ?? 3;
  const n = pts.length;
  const verts: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const hw = typeof o.halfWidth === 'number' ? o.halfWidth : o.halfWidth(t);
    const nn = normalAt(pts, i);
    for (let j = 0; j <= across; j++) {
      const k = -1 + (2 * j) / across;
      const jy = o.jitter && o.rng && j > 0 && j < across ? range(o.rng, -o.jitter, o.jitter) : 0;
      verts.push(pts[i][0] + nn[0] * hw * k, o.y + jy, pts[i][1] + nn[1] * hw * k);
    }
  }
  const row = across + 1;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < across; j++) {
      const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  return g;
}

/** A wobbly disc for lakes and puddles. */
export function pond(rng: Rng, radius: number, y: number, segments = 12, wobble = 0.1) {
  const shape = new THREE.Shape();
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const r = radius * (1 + range(rng, -wobble, wobble));
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, z); else shape.lineTo(x, z);
  }
  shape.closePath();
  const g = new THREE.ShapeGeometry(shape, 1);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

const wobbleWidth = (base: number, amp: number, phase: number) => (t: number) => base * (1 + amp * Math.sin(t * 9 + phase) + amp * 0.6 * Math.sin(t * 17 + phase * 2));

/**
 * A river: sandy bank, pale shallows, deep water, white flecks on the current.
 * Water parts go into `water` so they can ripple and shine; everything else into `land`.
 */
export function river(land: Parts, water: Parts, rng: Rng, path: V2[]) {
  const pts = resample(path, 0.12);
  const phase = rng() * 6;
  land.add(ribbon(pts, { halfWidth: wobbleWidth(0.36, 0.16, phase), y: 0.015, across: 2, jitter: 0.006, rng }), PALETTE.riverbank, { vary: 0.08 });
  water.add(ribbon(pts, { halfWidth: wobbleWidth(0.29, 0.14, phase), y: 0.035, across: 3, jitter: 0.006, rng }), PALETTE.shallows, { vary: 0.08 });
  water.add(ribbon(pts, { halfWidth: wobbleWidth(0.17, 0.2, phase + 1), y: 0.045, across: 3, jitter: 0.008, rng }), PALETTE.water, { vary: 0.14 });
  // Flecks of foam riding the current.
  for (let i = 1; i < pts.length - 1; i += 2) {
    if (rng() < 0.5) continue;
    const n = normalAt(pts, i);
    const d = range(rng, -0.12, 0.12);
    water.add(new THREE.IcosahedronGeometry(range(rng, 0.012, 0.022), 0), PALETTE.foam, {
      x: pts[i][0] + n[0] * d, y: 0.055, z: pts[i][1] + n[1] * d, sy: 0.35, vary: 0.02,
    });
  }
  // Rocks and reeds along the banks.
  for (let i = 1; i < pts.length - 1; i++) {
    const side = rng() < 0.5 ? -1 : 1;
    const n = normalAt(pts, i);
    const d = side * range(rng, 0.3, 0.42);
    const x = pts[i][0] + n[0] * d, z = pts[i][1] + n[1] * d;
    if (Math.abs(x) > 0.92 || Math.abs(z) > 0.92) continue;
    const r = rng();
    if (r < 0.3) bankRock(land, rng, x, z);
    else if (r < 0.55) reeds(land, rng, x, z);
  }
}

export function lake(land: Parts, water: Parts, rng: Rng, radius: number) {
  land.add(pond(rng, radius * 1.26, 0.015, 14, 0.08), PALETTE.riverbank, { vary: 0.08 });
  water.add(pond(rng, radius * 1.1, 0.035, 14, 0.08), PALETTE.shallows, { vary: 0.08 });
  water.add(pond(rng, radius * 0.8, 0.045, 12, 0.14), PALETTE.water, { vary: 0.14 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + rng() * 0.6;
    const d = radius * range(rng, 1.2, 1.4);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const r = rng();
    if (r < 0.4) bankRock(land, rng, x, z);
    else if (r < 0.75) reeds(land, rng, x, z);
  }
  for (let i = 0; i < 4; i++) {
    const a = rng() * Math.PI * 2, d = radius * range(rng, 0.2, 0.7);
    water.add(new THREE.IcosahedronGeometry(range(rng, 0.012, 0.02), 0), PALETTE.foam, { x: Math.cos(a) * d, y: 0.055, z: Math.sin(a) * d, sy: 0.35, vary: 0.02 });
  }
}

export function bankRock(parts: Parts, rng: Rng, x: number, z: number) {
  const s = range(rng, 0.03, 0.07);
  parts.add(rockShard(rng, s, 0, 0.2), PALETTE.rock, { x, y: s * 0.5, z, ry: rng() * 3, sy: range(rng, 0.7, 1.3), vary: 0.12 });
}

export function reeds(parts: Parts, rng: Rng, x: number, z: number) {
  const n = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const h = range(rng, 0.1, 0.18);
    const px = x + range(rng, -0.04, 0.04), pz = z + range(rng, -0.04, 0.04);
    parts.add(new THREE.ConeGeometry(0.012, h, 3), PALETTE.reed, { x: px, y: h / 2, z: pz, rz: range(rng, -0.15, 0.15), vary: 0.12 });
    if (rng() < 0.5) parts.add(new THREE.CylinderGeometry(0.008, 0.008, 0.03, 4), PALETTE.reedTip, { x: px, y: h * 0.8, z: pz });
  }
}

/** A dirt track: pale verge, packed earth, two wheel ruts, stones on the verges and sometimes a fence. */
export function road(land: Parts, water: Parts, rng: Rng, path: V2[], opts: { fence: boolean; puddle: boolean }) {
  const pts = resample(path, 0.1);
  const phase = rng() * 6;
  land.add(ribbon(pts, { halfWidth: wobbleWidth(0.2, 0.12, phase), y: 0.03, across: 2, jitter: 0.004, rng }), PALETTE.roadEdge, { vary: 0.05 });
  land.add(ribbon(pts, { halfWidth: wobbleWidth(0.13, 0.1, phase + 2), y: 0.045, across: 3, jitter: 0.004, rng }), PALETTE.road, { vary: 0.07 });
  for (const s of [-0.055, 0.055]) {
    land.add(ribbon(offsetPath(pts, s), { halfWidth: 0.014, y: 0.052, across: 1, extend: 0 }), PALETTE.rut, { vary: 0.06 });
  }
  for (let i = 1; i < pts.length - 1; i++) {
    if (rng() < 0.45) continue;
    const n = normalAt(pts, i);
    const d = (rng() < 0.5 ? -1 : 1) * range(rng, 0.2, 0.27);
    const x = pts[i][0] + n[0] * d, z = pts[i][1] + n[1] * d;
    if (Math.abs(x) > 0.92 || Math.abs(z) > 0.92) continue;
    const s = range(rng, 0.018, 0.035);
    land.add(rockShard(rng, s, 0, 0.2), pick(rng, [PALETTE.rock, PALETTE.roadEdge, PALETTE.stone]), { x, y: s * 0.5, z, ry: rng() * 3, vary: 0.12 });
  }
  if (opts.fence) {
    const side = rng() < 0.5 ? -0.29 : 0.29;
    const line = offsetPath(resample(path, 0.2), side);
    for (let i = 0; i < line.length; i++) {
      const [x, z] = line[i];
      if (Math.abs(x) > 0.9 || Math.abs(z) > 0.9) continue;
      land.add(new THREE.BoxGeometry(0.024, 0.14, 0.024), PALETTE.fencePost, { x, y: 0.1, z, ry: rng() * 0.3, vary: 0.1 });
      const q = line[i + 1];
      if (q && Math.abs(q[0]) <= 0.9 && Math.abs(q[1]) <= 0.9) {
        const len = Math.hypot(q[0] - x, q[1] - z);
        land.add(new THREE.BoxGeometry(0.016, 0.02, len), PALETTE.fencePost, { x: (x + q[0]) / 2, y: 0.14, z: (z + q[1]) / 2, ry: Math.atan2(q[0] - x, q[1] - z), vary: 0.1 });
      }
    }
  }
  if (opts.puddle) {
    const p = pts[Math.floor(range(rng, 1, pts.length - 1))];
    water.add(pond(rng, 0.055, 0.053, 7, 0.25), PALETTE.shallows, { x: p[0], z: p[1], sx: 1.5, vary: 0.06 });
  }
}

export interface Patch { x: number; z: number; r: number; color: number; phase: number }

/** Irregular patches of different grass: hay, deep green, lush, scrub. */
export function meadowPatches(rng: Rng): Patch[] {
  const n = 3 + Math.floor(rng() * 3);
  return Array.from({ length: n }, () => ({
    x: range(rng, -0.9, 0.9), z: range(rng, -0.9, 0.9), r: range(rng, 0.22, 0.5), color: pick(rng, PALETTE.meadowPatches), phase: rng() * 6,
  }));
}
export function inPatch(p: Patch, x: number, z: number) {
  const d = Math.hypot(x - p.x, z - p.z);
  const a = Math.atan2(z - p.z, x - p.x);
  return d < p.r * (1 + 0.2 * Math.sin(a * 3 + p.phase) + 0.1 * Math.sin(a * 7 + p.phase * 2));
}

export interface Field { x: number; z: number; w: number; h: number }
export function inField(f: Field, x: number, z: number) {
  return Math.abs(x - f.x) < f.w / 2 && Math.abs(z - f.z) < f.h / 2;
}
/** Ploughed furrows across a bare-earth field. */
export function furrows(land: Parts, f: Field) {
  const along = f.w >= f.h;
  const n = Math.floor((along ? f.h : f.w) / 0.07);
  for (let i = 0; i < n; i++) {
    const k = (i + 0.5) / n - 0.5;
    const x = along ? f.x : f.x + k * f.w, z = along ? f.z + k * f.h : f.z;
    land.add(new THREE.BoxGeometry(along ? f.w - 0.06 : 0.03, 0.025, along ? 0.03 : f.h - 0.06), PALETTE.furrow, { x, y: 0.012, z, vary: 0.1 });
  }
  // A few sprouting rows.
  for (let i = 0; i < n; i += 2) {
    const k = (i + 0.5) / n - 0.5;
    for (let j = 0; j < 4; j++) {
      const m = (j + 0.5) / 4 - 0.5;
      const x = along ? f.x + m * (f.w - 0.1) : f.x + k * f.w, z = along ? f.z + k * f.h : f.z + m * (f.h - 0.1);
      land.add(new THREE.IcosahedronGeometry(0.02, 0), PALETTE.hops, { x, y: 0.035, z, sy: 0.7, vary: 0.14 });
    }
  }
}

/** Wildflowers and tufts of grass scattered where nothing else stands. */
export function flowers(land: Parts, rng: Rng, x: number, z: number) {
  const color = pick(rng, PALETTE.flowers);
  const n = 2 + Math.floor(rng() * 4);
  for (let i = 0; i < n; i++) {
    const px = x + range(rng, -0.07, 0.07), pz = z + range(rng, -0.07, 0.07);
    land.add(new THREE.IcosahedronGeometry(0.016, 0), color, { x: px, y: 0.075, z: pz, sy: 0.6, vary: 0.08 });
  }
}
export function tuft(land: Parts, rng: Rng, x: number, z: number) {
  for (let i = 0; i < 3; i++) {
    const h = range(rng, 0.06, 0.1);
    land.add(new THREE.ConeGeometry(0.014, h, 3), pick(rng, PALETTE.meadowPatches), { x: x + range(rng, -0.025, 0.025), y: h / 2 + 0.03, z: z + range(rng, -0.025, 0.025), rz: range(rng, -0.2, 0.2), vary: 0.12 });
  }
}
/** A hedgerow: a line of bushes with a gap or two. */
export function hedgerow(land: Parts, rng: Rng, a: V2, b: V2) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.floor(len / 0.11);
  for (let i = 0; i <= n; i++) {
    if (rng() < 0.12) continue;
    const t = i / n;
    const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
    const r = range(rng, 0.05, 0.075);
    land.add(rockShard(rng, r, 1, 0.14), pick(rng, PALETTE.leaves), { x: x + range(rng, -0.02, 0.02), y: r * 0.75, z: z + range(rng, -0.02, 0.02), sy: 0.85, vary: 0.16 });
  }
}
