import * as THREE from 'three';
import type { Center, Edge } from './catalog';
import { makeRng, pick, range, type Rng } from './rng';
import { PALETTE } from './palette';
import { rockShard, shardify } from './shards';
import { Parts, gableRoof } from './parts';
import * as B from './bavarian';

/** Tile size in world units, and the depth of the soil slab under it. */
export const TILE = 2;
export const HALF = TILE / 2;
export const SLAB = 0.72;
const GAP = 0.035;

type V2 = [number, number];

export interface TileSpec {
  edges: readonly [Edge, Edge, Edge, Edge];
  center: Center;
  banner?: boolean;
  seed: number;
  /** Edge indexes where a river runs off the board and should fall as a waterfall. */
  waterfalls?: number[];
}

// Edge geometry: 0 north (-z), 1 east (+x), 2 south (+z), 3 west (-x).
const MID: V2[] = [[0, -HALF], [HALF, 0], [0, HALF], [-HALF, 0]];
const CORNERS: [V2, V2][] = [
  [[-HALF, -HALF], [HALF, -HALF]],
  [[HALF, -HALF], [HALF, HALF]],
  [[HALF, HALF], [-HALF, HALF]],
  [[-HALF, HALF], [-HALF, -HALF]],
];

// ---------- small geometry helpers ----------

function distToSegment(p: V2, a: V2, b: V2) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz || 1;
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  const x = a[0] + t * dx - p[0], z = a[1] + t * dz - p[1];
  return Math.hypot(x, z);
}
const distToPath = (p: V2, path: V2[]) => {
  let d = Infinity;
  for (let i = 0; i < path.length - 1; i++) d = Math.min(d, distToSegment(p, path[i], path[i + 1]));
  return d;
};
function inTriangle(p: V2, a: V2, b: V2, c: V2) {
  const s = (p1: V2, p2: V2, p3: V2) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  const d1 = s(p, a, b), d2 = s(p, b, c), d3 = s(p, c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}
const lerp2 = (a: V2, b: V2, t: number): V2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Paths for roads or rivers: two ends curve through the centre, otherwise each runs to the centre. */
function buildPaths(dirs: number[], stopShort: number): V2[][] {
  if (dirs.length === 0) return [];
  if (dirs.length === 2) {
    const [a, b] = [MID[dirs[0]], MID[dirs[1]]];
    const pts: V2[] = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      // Quadratic Bezier with the tile centre as the control point.
      const u = 1 - t;
      pts.push([u * u * a[0] + t * t * b[0], u * u * a[1] + t * t * b[1]]);
    }
    return [pts];
  }
  return dirs.map((d) => {
    const m = MID[d];
    const len = Math.hypot(m[0], m[1]);
    const end = lerp2(m, [0, 0], (len - stopShort) / len);
    return [m, end];
  });
}

function stripAlong(parts: Parts, path: V2[], width: number, height: number, y: number, color: number, vary = 0.04) {
  for (let i = 0; i < path.length - 1; i++) {
    const [a, b] = [path[i], path[i + 1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ang = Math.atan2(b[0] - a[0], b[1] - a[1]);
    parts.add(new THREE.BoxGeometry(width, height, len + width * 0.35), color, {
      x: (a[0] + b[0]) / 2, y, z: (a[1] + b[1]) / 2, ry: ang, vary,
    });
  }
}

// ---------- feature builders ----------

function addPine(parts: Parts, rng: Rng, x: number, z: number) {
  const s = range(rng, 0.75, 1.25);
  parts.add(new THREE.CylinderGeometry(0.025 * s, 0.035 * s, 0.12 * s, 5), PALETTE.trunk, { x, y: 0.06 * s, z });
  const green = pick(rng, PALETTE.pines);
  const tier = (r: number, h: number, y: number) =>
    parts.add(shardify(new THREE.ConeGeometry(r * s, h * s, 8, 2), rng, 0.07), green, { x, y: y * s, z, ry: rng() * 3, vary: 0.13 });
  tier(0.17, 0.3, 0.24);
  tier(0.13, 0.25, 0.4);
  tier(0.09, 0.2, 0.53);
  tier(0.05, 0.14, 0.64);
}

function addRoundTree(parts: Parts, rng: Rng, x: number, z: number) {
  const s = range(rng, 0.8, 1.2);
  const lean = range(rng, -0.18, 0.18);
  parts.add(shardify(new THREE.CylinderGeometry(0.022 * s, 0.04 * s, 0.24 * s, 6, 2), rng, 0.08), PALETTE.trunk, { x, y: 0.12 * s, z, rz: lean });
  const leaf = pick(rng, PALETTE.leaves);
  const tx = x - Math.sin(lean) * 0.2 * s;
  const puffs = 3 + Math.floor(rng() * 2);
  for (let i = 0; i < puffs; i++) {
    const a = (i / puffs) * Math.PI * 2 + rng();
    const r = range(rng, 0.08, 0.12) * s;
    parts.add(rockShard(rng, r, 1, 0.12), leaf, {
      x: tx + Math.cos(a) * 0.08 * s, y: range(rng, 0.3, 0.38) * s, z: z + Math.sin(a) * 0.08 * s, vary: 0.16,
    });
  }
  parts.add(rockShard(rng, 0.11 * s, 1, 0.12), leaf, { x: tx, y: 0.42 * s, z, vary: 0.16 });
}

function addRock(parts: Parts, rng: Rng, x: number, z: number) {
  const s = range(rng, 0.06, 0.13);
  parts.add(rockShard(rng, s, 1, 0.16), PALETTE.rock, { x, y: s * 0.45, z, ry: rng() * 3, sy: range(rng, 0.8, 1.6), vary: 0.12 });
  if (rng() < 0.5) {
    const t = s * 0.55;
    parts.add(rockShard(rng, t, 0, 0.2), PALETTE.rock, { x: x + s * 0.9, y: t * 0.4, z: z + s * 0.4, ry: rng() * 3, vary: 0.12 });
  }
}

function addBush(parts: Parts, rng: Rng, x: number, z: number) {
  const leaf = pick(rng, PALETTE.leaves);
  for (let i = 0; i < 3; i++) {
    const r = range(rng, 0.05, 0.08);
    parts.add(rockShard(rng, r, 1, 0.14), leaf, { x: x + range(rng, -0.07, 0.07), y: r * 0.7, z: z + range(rng, -0.07, 0.07), sy: 0.8, vary: 0.16 });
  }
}

function addMonk(parts: Parts, x: number, z: number) {
  parts.add(new THREE.ConeGeometry(0.035, 0.1, 6), PALETTE.habit, { x, y: 0.05, z });
  parts.add(new THREE.IcosahedronGeometry(0.018, 0), PALETTE.skin, { x, y: 0.11, z });
}

function addAbbey(parts: Parts, rng: Rng, offsetZ: number) {
  const z0 = offsetZ;
  // Cloister garden wall.
  parts.add(new THREE.BoxGeometry(0.95, 0.05, 0.85), PALETTE.plaza, { y: 0.025, z: z0, vary: 0.02 });
  parts.add(new THREE.BoxGeometry(0.58, 0.3, 0.32), PALETTE.whitewash, { x: 0.08, y: 0.15, z: z0 - 0.1 });
  parts.add(gableRoof(0.64, 0.38, 0.2), PALETTE.abbeyRoof, { x: 0.08, y: 0.3, z: z0 - 0.1, ry: Math.PI / 2, sx: 0.6, sz: 1.7 });
  // Bell tower with an onion dome.
  const tx = -0.28, tz = z0 - 0.1;
  parts.add(new THREE.BoxGeometry(0.17, 0.62, 0.17), PALETTE.whitewash, { x: tx, y: 0.31, z: tz });
  parts.add(new THREE.BoxGeometry(0.19, 0.03, 0.19), PALETTE.timber, { x: tx, y: 0.5, z: tz });
  parts.add(new THREE.SphereGeometry(0.11, 7, 5), PALETTE.copper, { x: tx, y: 0.72, z: tz, sy: 1.35, vary: 0.06 });
  parts.add(new THREE.ConeGeometry(0.04, 0.12, 5), PALETTE.copper, { x: tx, y: 0.87, z: tz });
  parts.add(new THREE.ConeGeometry(0.012, 0.1, 4), PALETTE.gold, { x: tx, y: 0.97, z: tz });
  // Hop garden: poles with green bines.
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 2; j++) {
      const hx = 0.06 + i * 0.1, hz = z0 + 0.18 + j * 0.13;
      parts.add(new THREE.CylinderGeometry(0.03, 0.04, 0.18, 5), PALETTE.hops, { x: hx, y: 0.1, z: hz, vary: 0.1 });
    }
  }
  addMonk(parts, -0.15, z0 + 0.22);
  if (rng() < 0.7) addMonk(parts, -0.32, z0 + 0.12);
}

function addCastle(parts: Parts, rng: Rng) {
  // Rocky crag.
  parts.add(rockShard(rng, 0.5, 1, 0.1), PALETTE.crag, { y: 0.14, sy: 0.6, ry: 0.4, vary: 0.12 });
  parts.add(rockShard(rng, 0.38, 1, 0.12), PALETTE.crag, { x: 0.12, y: 0.32, z: -0.05, sy: 0.75, ry: 1.2, vary: 0.12 });
  parts.add(rockShard(rng, 0.3, 1, 0.12), PALETTE.crag, { x: -0.18, y: 0.3, z: 0.1, sy: 0.7, ry: 2.1, vary: 0.12 });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rng() * 0.5;
    const r = range(rng, 0.42, 0.56);
    const h = range(rng, 0.25, 0.5);
    parts.add(shardify(new THREE.ConeGeometry(range(rng, 0.08, 0.14), h, 5, 2), rng, 0.12, true), PALETTE.crag, {
      x: Math.cos(a) * r, y: h / 2, z: Math.sin(a) * r, rz: Math.cos(a) * -0.25, rx: Math.sin(a) * 0.25, vary: 0.14,
    });
  }
  const base = 0.5;
  // Keep and curtain walls.
  parts.add(new THREE.BoxGeometry(0.44, 0.34, 0.3), PALETTE.castleWall, { y: base + 0.17, vary: 0.02 });
  parts.add(gableRoof(0.48, 0.34, 0.22), PALETTE.slate, { y: base + 0.34, vary: 0.05 });
  parts.add(new THREE.BoxGeometry(0.6, 0.16, 0.08), PALETTE.castleWall, { y: base + 0.08, z: 0.2 });
  // Slender towers with slate cones.
  const towers: [number, number, number][] = [[-0.27, -0.12, 0.62], [0.27, -0.12, 0.5], [0.3, 0.2, 0.4], [-0.3, 0.2, 0.44], [0.05, -0.2, 0.8]];
  for (const [x, z, h] of towers) {
    parts.add(new THREE.CylinderGeometry(0.06, 0.065, h, 7), PALETTE.castleWall, { x, y: base + h / 2, z, vary: 0.02 });
    parts.add(new THREE.ConeGeometry(0.085, 0.22, 7), PALETTE.slate, { x, y: base + h + 0.11, z, vary: 0.05 });
  }
  // Flag on the tallest tower.
  parts.add(new THREE.CylinderGeometry(0.006, 0.006, 0.16, 4), PALETTE.timber, { x: 0.05, y: base + 0.8 + 0.3, z: -0.2 });
  parts.add(new THREE.BoxGeometry(0.1, 0.06, 0.008), PALETTE.bavariaBlue, { x: 0.1, y: base + 0.8 + 0.34, z: -0.2 });
  void rng;
}

function addShrine(parts: Parts) {
  parts.add(new THREE.CylinderGeometry(0.1, 0.12, 0.05, 6), PALETTE.stone, { y: 0.11 });
  parts.add(new THREE.BoxGeometry(0.04, 0.26, 0.04), PALETTE.timber, { y: 0.24 });
  parts.add(new THREE.BoxGeometry(0.1, 0.09, 0.06), PALETTE.whitewash, { y: 0.39 });
  parts.add(gableRoof(0.15, 0.1, 0.07), PALETTE.roofs[0], { y: 0.435 });
}

function addMaypole(parts: Parts) {
  const h = 1.0;
  for (let i = 0; i < 8; i++) {
    parts.add(new THREE.CylinderGeometry(0.02, 0.02, h / 8, 6), i % 2 ? PALETTE.bavariaBlue : PALETTE.whitewash, {
      y: 0.06 + (h / 8) * (i + 0.5), vary: 0.01,
    });
  }
  parts.add(new THREE.TorusGeometry(0.07, 0.018, 4, 8), PALETTE.leaves[1], { y: h * 0.82, rx: Math.PI / 2 });
  parts.add(new THREE.ConeGeometry(0.03, 0.1, 5), PALETTE.leaves[0], { y: h + 0.1 });
}

function addBanner(parts: Parts, x: number, z: number) {
  parts.add(new THREE.CylinderGeometry(0.008, 0.008, 0.5, 4), PALETTE.timber, { x, y: 0.31, z });
  // Blue and white lozenge pennant.
  parts.add(new THREE.BoxGeometry(0.16, 0.1, 0.008), PALETTE.whitewash, { x: x + 0.085, y: 0.5, z });
  parts.add(new THREE.BoxGeometry(0.07, 0.05, 0.01), PALETTE.bavariaBlue, { x: x + 0.05, y: 0.52, z });
  parts.add(new THREE.BoxGeometry(0.07, 0.05, 0.01), PALETTE.bavariaBlue, { x: x + 0.12, y: 0.48, z });
}

// ---------- the tile ----------

export interface BuiltTile {
  geometry: THREE.BufferGeometry;
  /** Spots where a Wanderer could stand, by feature, for the demo. */
  spots: { town?: V2; road?: V2; abbey?: V2 };
}

export function buildTile(spec: TileSpec): BuiltTile {
  const rng = makeRng(spec.seed);
  const parts = new Parts(rng);
  const dirs = (kind: Edge) => spec.edges.map((e, i) => (e === kind ? i : -1)).filter((i) => i >= 0);
  const roads = dirs('road');
  const rivers = dirs('river');
  const towns = dirs('town');
  const hasCenterFeature = spec.center !== 'none';
  const W = TILE - GAP;

  // Town region: a band for one town edge, otherwise the triangles from the centre to each town edge.
  const townTris: [V2, V2, V2][] = [];
  let townBand: V2[] | null = null;
  if (towns.length === 1) {
    const [a, b] = CORNERS[towns[0]];
    const depth = 0.62;
    townBand = [a, b, lerp2(b, [0, 0], depth * 0.75), lerp2(a, [0, 0], depth * 0.75)];
    townTris.push([townBand[0], townBand[1], townBand[2]], [townBand[0], townBand[2], townBand[3]]);
  } else {
    for (const t of towns) townTris.push([[0, 0], CORNERS[t][0], CORNERS[t][1]]);
  }
  const inTown = (p: V2) => townTris.some(([a, b, c]) => inTriangle(p, a, b, c));

  const roadPaths = buildPaths(roads, hasCenterFeature ? 0.32 : roads.length === 1 ? 0.15 : 0.12);
  const riverPaths = buildPaths(rivers, spec.center === 'lake' ? 0.3 : 0);

  // --- slab: soil and rock sides, a grass rim, and a faceted meadow top ---
  const soil = new THREE.BoxGeometry(W, SLAB, W, 6, 4, 6);
  const pos = soil.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < SLAB / 2 - 0.01) {
      const k = (SLAB / 2 - y) / SLAB; // deeper = more ragged
      pos.setX(i, pos.getX(i) * (1 - k * range(rng, 0, 0.06)));
      pos.setZ(i, pos.getZ(i) * (1 - k * range(rng, 0, 0.06)));
    }
    if (y < -SLAB / 2 + 0.01) pos.setY(i, y - range(rng, 0, 0.16));
  }
  parts.add(soil, PALETTE.soil, { y: -SLAB / 2 - 0.08, vary: 0.12 });
  // Rock shards breaking out of the soil sides.
  for (let i = 0; i < 8; i++) {
    const side = i % 4;
    const along = range(rng, -0.75, 0.75);
    const m = MID[side];
    const px = m[0] !== 0 ? m[0] * 0.97 : along;
    const pz = m[1] !== 0 ? m[1] * 0.97 : along;
    parts.add(rockShard(rng, range(rng, 0.08, 0.16), 0, 0.22), pick(rng, PALETTE.underRock), {
      x: px, y: range(rng, -0.62, -0.25), z: pz, ry: rng() * 3, sx: 0.7, vary: 0.14,
    });
  }
  // Jagged underside: hanging rock shards, like a chunk of land torn out of a hillside.
  for (let i = 0; i < 7; i++) {
    const r = range(rng, 0.25, 0.5);
    const len = range(rng, 0.25, 0.6);
    const px = range(rng, -0.6, 0.6), pz = range(rng, -0.6, 0.6);
    const g = shardify(new THREE.ConeGeometry(r, len, 5, 2), rng, 0.12, false);
    parts.add(g, pick(rng, PALETTE.underRock), {
      x: px, y: -SLAB - 0.08 - len / 2 + 0.05, z: pz, rx: Math.PI, ry: rng() * 3, vary: 0.16,
    });
  }
  // A darker band of rock in the soil.
  parts.add(new THREE.BoxGeometry(W + 0.004, 0.06, W + 0.004, 3, 1, 3), PALETTE.rockBand, { y: -0.4, vary: 0.14 });
  parts.add(new THREE.BoxGeometry(W + 0.006, 0.1, W + 0.006), PALETTE.grassRim, { y: -0.05, vary: 0.05 });

  const top = new THREE.PlaneGeometry(W, W, 12, 12);
  top.rotateX(-Math.PI / 2);
  const tp = top.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i), z = tp.getZ(i);
    const edge = Math.abs(x) > W / 2 - 0.01 || Math.abs(z) > W / 2 - 0.01;
    if (edge) continue;
    const p: V2 = [x, z];
    const nearPath = [...roadPaths, ...riverPaths].some((path) => distToPath(p, path) < 0.38);
    const flat = nearPath || inTown(p) || (hasCenterFeature && Math.hypot(x, z) < 0.55);
    tp.setX(i, x + range(rng, -0.05, 0.05));
    tp.setZ(i, z + range(rng, -0.05, 0.05));
    tp.setY(i, flat ? 0 : range(rng, 0, 0.11));
  }
  parts.add(top, PALETTE.meadow, { vary: 0.11 });

  // --- rivers ---
  for (const path of riverPaths) {
    stripAlong(parts, path, 0.66, 0.05, 0.015, PALETTE.riverbank, 0.06);
    stripAlong(parts, path, 0.48, 0.05, 0.035, PALETTE.water, 0.14);
  }
  if (spec.center === 'lake') {
    parts.add(new THREE.CylinderGeometry(0.6, 0.66, 0.05, 9), PALETTE.riverbank, { y: 0.015, ry: 0.3 });
    parts.add(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 9), PALETTE.water, { y: 0.035, ry: 0.3, vary: 0.08 });
    addRock(parts, rng, 0.45, -0.45);
    addRock(parts, rng, -0.5, 0.38);
  }
  for (const d of spec.waterfalls ?? []) {
    const m = MID[d];
    const out = 1.02;
    const ry = d % 2 === 0 ? 0 : Math.PI / 2;
    parts.add(new THREE.BoxGeometry(0.46, SLAB + 0.12, 0.05), PALETTE.waterfall, {
      x: m[0] * out, y: -SLAB / 2 - 0.02, z: m[1] * out, ry, vary: 0.12,
    });
    for (let i = 0; i < 4; i++) {
      parts.add(new THREE.IcosahedronGeometry(0.07, 0), PALETTE.foam, {
        x: m[0] * 1.08 + (d % 2 === 0 ? range(rng, -0.2, 0.2) : 0),
        y: -SLAB - 0.08,
        z: m[1] * 1.08 + (d % 2 === 1 ? range(rng, -0.2, 0.2) : 0),
        sy: 0.6,
      });
    }
  }

  // --- town ---
  const spots: BuiltTile['spots'] = {};
  if (towns.length) {
    for (const [a, b, c] of townTris) {
      const shape = new THREE.Shape([new THREE.Vector2(a[0], -a[1]), new THREE.Vector2(b[0], -b[1]), new THREE.Vector2(c[0], -c[1])]);
      const g = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false });
      g.rotateX(-Math.PI / 2);
      parts.add(g, PALETTE.plaza, { vary: 0.04 });
    }
    // Town walls where the town meets the meadow, with square towers where walls end.
    const walls: [V2, V2][] = [];
    if (townBand) walls.push([townBand[2], townBand[3]]);
    else {
      for (const t of towns) {
        const [a, b] = CORNERS[t];
        const prev = (t + 3) % 4, next = (t + 1) % 4;
        if (!towns.includes(prev)) walls.push([[0, 0], a]);
        if (!towns.includes(next)) walls.push([[0, 0], b]);
      }
    }
    const towerAt = new Map<string, V2>();
    for (const [a, b] of walls) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const ang = Math.atan2(b[0] - a[0], b[1] - a[1]);
      parts.add(new THREE.BoxGeometry(0.07, 0.16, len, Math.max(1, Math.round(len * 6)), 1, 1), PALETTE.townWall, { x: (a[0] + b[0]) / 2, y: 0.08, z: (a[1] + b[1]) / 2, ry: ang, vary: 0.06 });
      parts.add(new THREE.BoxGeometry(0.08, 0.02, len), PALETTE.roofs[2], { x: (a[0] + b[0]) / 2, y: 0.17, z: (a[1] + b[1]) / 2, ry: ang, vary: 0.06 });
      for (const e of [a, b]) towerAt.set(`${e[0].toFixed(2)},${e[1].toFixed(2)}`, [e[0] * 0.95, e[1] * 0.95]);
    }
    for (const t of towerAt.values()) B.wallTower(parts, t[0], t[1]);

    // Gate towers where a road runs into the town.
    const gates: V2[] = [];
    for (const path of roadPaths) {
      for (let i = 0; i < path.length - 1 && gates.length < 2; i++) {
        let found = false;
        for (let k = 0; k < 8; k++) {
          const q0 = lerp2(path[i], path[i + 1], k / 8), q1 = lerp2(path[i], path[i + 1], (k + 1) / 8);
          if (inTown(q0) !== inTown(q1)) {
            const g = inTown(q1) ? q1 : q0;
            const dir = Math.atan2(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
            B.gateTower(parts, g[0], g[1], dir, pick(rng, ['pyramid', 'onion', 'helmet'] as const));
            gates.push(g);
            found = true;
            break;
          }
        }
        if (found) break;
      }
    }

    // Town square furniture: fountain or maypole, beer garden, flower barrels.
    const placed: V2[] = [...gates];
    const centroid: V2 = townTris.reduce<V2>((acc, [a, b, c]) => [acc[0] + (a[0] + b[0] + c[0]) / 3 / townTris.length, acc[1] + (a[1] + b[1] + c[1]) / 3 / townTris.length], [0, 0]);
    const keepClear = (p: V2, gap = 0.3) =>
      roadPaths.every((path) => distToPath(p, path) > 0.24) &&
      walls.every(([a, b]) => distToSegment(p, a, b) > 0.17) &&
      placed.every((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) > gap) &&
      !(spec.center === 'maypole' && Math.hypot(p[0], p[1]) < 0.3) &&
      Math.abs(p[0]) < HALF - 0.15 && Math.abs(p[1]) < HALF - 0.15;
    const freeSpot = (gap: number, tries = 120): V2 | null => {
      for (let t = 0; t < tries; t++) {
        const p: V2 = [range(rng, -HALF, HALF), range(rng, -HALF, HALF)];
        if (inTown(p) && keepClear(p, gap)) return p;
      }
      return null;
    };
    if (towns.length >= 3 && spec.center !== 'maypole') {
      const f = freeSpot(0.3);
      if (f) { B.fountain(parts, f[0], f[1]); placed.push(f); }
    }
    if (towns.length >= 3 && rng() < 0.7) {
      const g = freeSpot(0.3);
      if (g) { B.beerGarden(parts, g[0], g[1], rng() < 0.5 ? 0 : Math.PI / 2); placed.push(g); }
    }
    // Houses: tall gables turned to face the town square.
    const want = townBand ? 4 : towns.length * 3 + (towns.length === 4 ? 2 : 0);
    for (let tries = 0; tries < 220 && placed.length - gates.length < want + 2; tries++) {
      const p: V2 = [range(rng, -HALF, HALF), range(rng, -HALF, HALF)];
      if (!inTown(p) || !keepClear(p, 0.31)) continue;
      placed.push(p);
      const raw = Math.atan2(centroid[0] - p[0], centroid[1] - p[1]);
      const face = Math.round(raw / (Math.PI / 2)) * (Math.PI / 2) + range(rng, -0.08, 0.08);
      B.house(parts, p[0], p[1], face);
    }
    for (let i = 0; i < 2; i++) {
      const fb = freeSpot(0.14, 60);
      if (fb) { B.flowerBarrel(parts, fb[0], fb[1]); placed.push(fb); }
    }
    // A free spot in the town for a Wanderer.
    for (let tries = 0; tries < 80; tries++) {
      const p: V2 = [range(rng, -0.8, 0.8), range(rng, -0.8, 0.8)];
      if (inTown(p) && placed.every((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.2)) { spots.town = p; break; }
    }
    if (spec.banner) {
      const p = placed[0] ?? [0, 0];
      addBanner(parts, p[0] + 0.12, p[1] + 0.12);
    }
  }

  // --- roads (drawn after towns so they run over the plaza) ---
  for (const path of roadPaths) {
    stripAlong(parts, path, 0.36, 0.05, 0.03, PALETTE.roadEdge, 0.03);
    stripAlong(parts, path, 0.26, 0.05, 0.045, PALETTE.road, 0.06);
    spots.road ??= path[Math.floor(path.length / 2)] ?? path[0];
  }
  // Bridge over the river.
  if (roads.length && rivers.length) {
    const ry = roads[0] % 2 === 0 ? 0 : Math.PI / 2;
    parts.add(new THREE.BoxGeometry(0.42, 0.08, 0.8), PALETTE.bridge, { y: 0.1, ry, vary: 0.05 });
    for (const s of [-1, 1]) {
      const o = { x: ry ? 0 : s * 0.22, z: ry ? s * 0.22 : 0 };
      parts.add(new THREE.BoxGeometry(0.03, 0.1, 0.8), PALETTE.timber, { ...o, y: 0.18, ry });
    }
    B.bridgeHouse(parts, ry === 0);
  }

  // --- centre features ---
  if (spec.center === 'abbey') {
    addAbbey(parts, rng, roads.includes(2) ? -0.25 : 0);
    spots.abbey = [0.3, roads.includes(2) ? 0.2 : 0.4];
  }
  if (spec.center === 'castle') {
    addCastle(parts, rng);
    B.vineyard(parts, -0.78, 0.78, 0.42, 0.9);
  }
  const bareMeadow = spec.center === 'none' && !towns.length && !roads.length && !rivers.length;
  const farm = bareMeadow && rng() < 0.6;
  if (farm) B.farmstead(parts, range(rng, -0.15, 0.15), range(rng, -0.25, -0.05), pick(rng, [0, Math.PI / 2, Math.PI, -Math.PI / 2]));
  if (spec.center === 'shrine') addShrine(parts);
  if (spec.center === 'maypole') addMaypole(parts);

  // --- meadow scenery ---
  const treeCount = farm ? 5 : bareMeadow ? 13 : towns.length > 2 ? 2 : 6;
  const blocked = (p: V2) =>
    (farm && Math.abs(p[0]) < 0.55 && Math.abs(p[1]) < 0.62) ||
    (spec.center === 'castle' && p[1] > 0.35) ||
    [...roadPaths, ...riverPaths].some((path) => distToPath(p, path) < 0.36) ||
    inTown(p) ||
    townTris.some(([a, b, c]) => [a, b, c].some((v) => Math.hypot(p[0] - v[0], p[1] - v[1]) < 0.05)) ||
    (hasCenterFeature && Math.hypot(p[0], p[1]) < (spec.center === 'abbey' ? 0.72 : 0.62));
  const trees: V2[] = [];
  for (let tries = 0; tries < 160 && trees.length < treeCount; tries++) {
    const p: V2 = [range(rng, -0.84, 0.84), range(rng, -0.84, 0.84)];
    if (blocked(p) || trees.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.22)) continue;
    // Keep scenery away from wall lines too.
    if (towns.length && townTris.some(([a, b, c]) => distToSegment(p, a, b) < 0.12 || distToSegment(p, b, c) < 0.12 || distToSegment(p, c, a) < 0.12)) continue;
    trees.push(p);
    const r = rng();
    if (r < 0.5) addPine(parts, rng, p[0], p[1]);
    else if (r < 0.74) addRoundTree(parts, rng, p[0], p[1]);
    else if (r < 0.88) addRock(parts, rng, p[0], p[1]);
    else addBush(parts, rng, p[0], p[1]);
  }

  return { geometry: parts.merge(), spots };
}
