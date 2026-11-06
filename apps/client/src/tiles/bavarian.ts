import * as THREE from 'three';
import { Parts, gableRoof } from './parts';
import { PALETTE } from './palette';
import { pick, range } from './rng';
import { rockShard } from './shards';

/**
 * Bavarian and Franconian town pieces: tall half-timbered gable houses, gate towers,
 * fountains, beer gardens, bridge houses, farmsteads and vineyards.
 * Every builder works in a local frame: +z is the front (the street side).
 */

/** Places parts relative to a point and heading, so builders can think in "front, side, up". */
class Frame {
  constructor(private p: Parts, private x: number, private z: number, private ry: number) {}
  world(lx: number, lz: number): [number, number] {
    const c = Math.cos(this.ry), s = Math.sin(this.ry);
    return [this.x + lx * c + lz * s, this.z - lx * s + lz * c];
  }
  add(g: THREE.BufferGeometry, color: number, lx: number, y: number, lz: number, o: { rx?: number; ry?: number; rz?: number; sy?: number; vary?: number } = {}) {
    const [wx, wz] = this.world(lx, lz);
    this.p.add(g, color, { x: wx, y, z: wz, rx: o.rx, ry: this.ry + (o.ry ?? 0), rz: o.rz, sy: o.sy, vary: o.vary ?? 0.04 });
  }
  box(w: number, h: number, d: number, color: number, lx: number, y: number, lz: number, o: { rz?: number; ry?: number; vary?: number } = {}) {
    this.add(new THREE.BoxGeometry(w, h, d), color, lx, y, lz, o);
  }
}

const pickOther = <T,>(rng: () => number, items: readonly T[], not: T) => {
  const choices = items.filter((i) => i !== not);
  return choices[Math.floor(rng() * choices.length)];
};

/** Timber framing on one face of a storey: posts, sills and diagonal braces. */
function timberFace(f: Frame, w: number, h: number, y: number, z0: number, timber: number, pattern: 'x' | 'k' | 'plain') {
  const t = 0.012;
  for (const lx of [-w / 2, -w / 6, w / 6, w / 2]) f.box(t, h, 0.008, timber, lx, y + h / 2, z0);
  f.box(w + 0.01, t, 0.008, timber, 0, y + t / 2, z0);
  f.box(w + 0.01, t, 0.008, timber, 0, y + h - t / 2, z0);
  if (pattern === 'plain') return;
  const bay = w / 3;
  const len = Math.hypot(bay, h) * 0.95;
  const a = Math.atan2(bay, h);
  for (const side of [-1, 1]) {
    const bx = side * bay;
    if (pattern === 'x') {
      f.box(0.009, len, 0.008, timber, bx, y + h / 2, z0, { rz: a });
      f.box(0.009, len, 0.008, timber, bx, y + h / 2, z0, { rz: -a });
    } else {
      f.box(0.009, len, 0.008, timber, bx, y + h / 2, z0, { rz: side * a });
    }
  }
}

function windowWithTrim(f: Frame, lx: number, y: number, z0: number, shutter: number | null, flowers: boolean) {
  f.box(0.034, 0.048, 0.006, PALETTE.glass, lx, y, z0);
  if (shutter !== null) {
    f.box(0.015, 0.048, 0.006, shutter, lx - 0.026, y, z0);
    f.box(0.015, 0.048, 0.006, shutter, lx + 0.026, y, z0);
  }
  if (flowers) {
    f.box(0.046, 0.012, 0.014, PALETTE.timber, lx, y - 0.03, z0 + 0.004);
    f.box(0.042, 0.014, 0.014, PALETTE.geranium, lx, y - 0.019, z0 + 0.006, { vary: 0.15 });
  }
}

export interface HouseOpts {
  storeys?: number;
  scale?: number;
  facade?: number;
  timber?: number;
  /** Long, low farmhouse with a big roof. */
  rural?: boolean;
}

/** A tall half-timbered gable house facing the street, with jettied upper floors. */
export function house(p: Parts, x: number, z: number, face: number, o: HouseOpts = {}) {
  const rng = p.rng;
  const s = o.scale ?? 1;
  const f = new Frame(p, x, z, face);
  const w = (o.rural ? range(rng, 0.3, 0.36) : range(rng, 0.21, 0.28)) * s;
  const d = (o.rural ? range(rng, 0.42, 0.5) : range(rng, 0.26, 0.33)) * s;
  const storeys = o.storeys ?? (o.rural ? 1 : pick(rng, [2, 2, 3, 3, 4]));
  const sh = 0.11 * s;
  const facade = o.facade ?? pick(rng, PALETTE.facades);
  const timber = o.timber ?? pickOther(rng, PALETTE.timbers, facade);
  const shutter = rng() < 0.55 ? pick(rng, PALETTE.shutters) : null;
  const stoneBase = !o.rural && rng() < 0.4;
  const pattern = pick(rng, ['x', 'k', 'k', 'plain'] as const);
  let y = 0;
  let ww = w, dd = d, front = d / 2;
  for (let i = 0; i < storeys; i++) {
    // Each upper storey juts out a little over the street.
    const jet = i === 0 ? 0 : 0.01 * s;
    ww += jet; dd += jet; front += jet;
    const shift = (dd - d) / 2;
    const base = i === 0 && stoneBase;
    f.box(ww, sh, dd, base ? PALETTE.sandstone : facade, 0, y + sh / 2, shift, { vary: 0.03 });
    const z0 = front + 0.004;
    if (!base) {
      timberFace(f, ww, sh, y, z0, timber, pattern);
      // Side framing: corner posts are shared with the front; add a sill and a brace.
      for (const side of [-1, 1]) {
        f.box(0.008, 0.012, dd, timber, side * (ww / 2 + 0.004), y + sh - 0.006, shift);
        f.box(0.008, Math.hypot(dd / 2, sh) * 0.9, 0.009, timber, side * (ww / 2 + 0.004), y + sh / 2, shift, { ry: Math.PI / 2, rz: Math.atan2(dd / 2, sh) });
      }
    }
    // Windows on the street side: one or two per storey; the ground floor of stone houses gets an arched door.
    if (i === 0 && !o.rural) {
      f.box(0.05, 0.075, 0.006, PALETTE.arch, -ww / 4, 0.0375, z0 + 0.002);
      windowWithTrim(f, ww / 4, y + sh * 0.55, z0 + 0.002, shutter, false);
    } else if (o.rural) {
      windowWithTrim(f, -ww / 4, y + sh * 0.55, z0 + 0.002, shutter, rng() < 0.7);
      windowWithTrim(f, ww / 4, y + sh * 0.55, z0 + 0.002, shutter, rng() < 0.7);
    } else {
      const flowers = rng() < 0.6;
      windowWithTrim(f, -ww / 4.2, y + sh * 0.55, z0 + 0.002, shutter, flowers);
      windowWithTrim(f, ww / 4.2, y + sh * 0.55, z0 + 0.002, shutter, flowers);
    }
    y += sh;
  }
  // Steep roof with the gable to the street.
  const shift = (dd - d) / 2;
  const half = ww / 2 + 0.025 * s;
  const rh = ww * range(rng, o.rural ? 0.75 : 0.85, o.rural ? 0.9 : 1.15);
  const slope = Math.hypot(half, rh);
  const ang = Math.atan2(rh, half);
  const roof = pick(rng, PALETTE.roofs);
  f.add(gableRoof(ww, dd, rh * 0.97), facade, 0, y, shift, { vary: 0.03 });
  for (const side of [-1, 1]) {
    f.box(slope + 0.02, 0.024 * s, dd + 0.06 * s, roof, (side * half) / 2, y + rh / 2, shift, { rz: -side * ang, vary: 0.08 });
  }
  // Gable timbering and an attic window.
  const z0 = front + 0.004;
  f.box(0.012, rh * 0.85, 0.008, timber, 0, y + rh * 0.42, z0 - 0.002);
  f.box(ww * 0.55, 0.012, 0.008, timber, 0, y + rh * 0.42, z0 - 0.002);
  f.box(0.026, 0.034, 0.006, PALETTE.glass, ww * 0.16, y + rh * 0.22, z0);
  f.box(0.026, 0.034, 0.006, PALETTE.glass, -ww * 0.16, y + rh * 0.22, z0);
  if (rng() < 0.65) f.box(0.032, 0.11 * s, 0.032, PALETTE.brick, ww * 0.22, y + rh * 0.62, shift - dd * 0.2);
  return { height: y + rh };
}

export type TowerRoof = 'pyramid' | 'onion' | 'helmet';

/** A town gate tower: arch for the road, a clock, and a red pyramid, onion dome or baroque helmet. */
export function gateTower(p: Parts, x: number, z: number, face: number, roofKind: TowerRoof) {
  const rng = p.rng;
  const f = new Frame(p, x, z, face);
  const w = 0.22, h = range(rng, 0.6, 0.75);
  const wall = pick(rng, [0xf4ecdc, 0xe9c88a, PALETTE.sandstone] as const);
  f.box(w, h, w, wall, 0, h / 2, 0, { vary: 0.03 });
  // Stone quoins at the corners.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.box(0.025, h, 0.025, PALETTE.sandstone, sx * (w / 2 - 0.008), h / 2, sz * (w / 2 - 0.008), { vary: 0.06 });
  // The arch the road runs through.
  f.box(0.11, 0.15, w + 0.01, PALETTE.arch, 0, 0.075, 0);
  f.add(new THREE.CylinderGeometry(0.055, 0.055, w + 0.01, 8, 1, false, 0, Math.PI), PALETTE.arch, 0, 0.15, 0, { rx: Math.PI / 2, rz: Math.PI / 2 });
  // Clock faces front and back.
  for (const side of [-1, 1]) {
    f.add(new THREE.CylinderGeometry(0.042, 0.042, 0.008, 12), 0xfaf7ef, 0, h * 0.72, side * (w / 2 + 0.004), { rx: Math.PI / 2 });
    f.add(new THREE.CylinderGeometry(0.046, 0.046, 0.005, 12), PALETTE.bavariaBlue, 0, h * 0.72, side * (w / 2 + 0.002), { rx: Math.PI / 2 });
    f.box(0.006, 0.03, 0.004, PALETTE.arch, 0.006, h * 0.72 + 0.01, side * (w / 2 + 0.01), { rz: -0.5 });
    f.box(0.03, 0.026, 0.006, PALETTE.glass, 0, h * 0.45, side * (w / 2 + 0.003));
  }
  if (roofKind === 'pyramid') {
    f.add(new THREE.ConeGeometry(w * 0.82, 0.3, 4), pick(rng, PALETTE.roofs), 0, h + 0.15, 0, { ry: Math.PI / 4, vary: 0.08 });
    if (rng() < 0.5) {
      // A stork's nest on top.
      f.add(new THREE.CylinderGeometry(0.05, 0.04, 0.03, 7), PALETTE.trunk, 0, h + 0.31, 0, { vary: 0.15 });
      f.add(new THREE.IcosahedronGeometry(0.02, 0), 0xffffff, 0.01, h + 0.345, 0);
    }
  } else {
    // Onion dome or baroque helmet with a lantern.
    const copper = roofKind === 'onion' ? PALETTE.copper : PALETTE.darkCopper;
    f.box(w + 0.03, 0.03, w + 0.03, PALETTE.sandstone, 0, h + 0.015, 0);
    f.add(new THREE.SphereGeometry(0.12, 8, 6), copper, 0, h + 0.1, 0, { sy: roofKind === 'onion' ? 1.3 : 0.8, vary: 0.07 });
    f.add(new THREE.CylinderGeometry(0.035, 0.04, 0.07, 8), roofKind === 'onion' ? 0xf4ecdc : PALETTE.roofs[0], 0, h + 0.25, 0);
    f.add(new THREE.SphereGeometry(0.045, 8, 5), copper, 0, h + 0.3, 0, { sy: 1.3 });
    f.add(new THREE.ConeGeometry(0.012, 0.09, 5), PALETTE.gold, 0, h + 0.38, 0);
  }
}

/** A small square wall tower with a red pyramid roof. */
export function wallTower(p: Parts, x: number, z: number) {
  const f = new Frame(p, x, z, 0);
  f.box(0.12, 0.28, 0.12, PALETTE.townWall, 0, 0.14, 0, { vary: 0.04 });
  f.box(0.02, 0.04, 0.005, PALETTE.arch, 0, 0.2, 0.063);
  f.add(new THREE.ConeGeometry(0.1, 0.16, 4), pick(p.rng, PALETTE.roofs), 0, 0.36, 0, { ry: Math.PI / 4, vary: 0.08 });
}

/** Market fountain: octagonal basin, column and a gilded figure, with geraniums. */
export function fountain(p: Parts, x: number, z: number) {
  const f = new Frame(p, x, z, 0);
  f.add(new THREE.CylinderGeometry(0.12, 0.13, 0.07, 8), PALETTE.sandstone, 0, 0.085, 0, { vary: 0.05 });
  f.add(new THREE.CylinderGeometry(0.104, 0.104, 0.01, 8), PALETTE.water, 0, 0.118, 0);
  f.add(new THREE.CylinderGeometry(0.016, 0.02, 0.22, 7), PALETTE.sandstone, 0, 0.23, 0);
  f.add(new THREE.CylinderGeometry(0.03, 0.02, 0.025, 7), PALETTE.sandstone, 0, 0.35, 0);
  f.add(rockShard(p.rng, 0.022, 0, 0.1), PALETTE.gold, 0, 0.385, 0, { sy: 1.6 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    f.add(rockShard(p.rng, 0.03, 0, 0.2), i % 2 ? PALETTE.geranium : 0xe26b8f, Math.cos(a) * 0.14, 0.13, Math.sin(a) * 0.14, { vary: 0.15 });
  }
}

/** Beer garden set: long table, two benches and a blue-and-white umbrella. */
export function beerGarden(p: Parts, x: number, z: number, face: number) {
  const f = new Frame(p, x, z, face);
  f.box(0.22, 0.012, 0.055, PALETTE.benchWood, 0, 0.065, 0, { vary: 0.06 });
  f.box(0.2, 0.05, 0.01, PALETTE.trestle, 0, 0.035, 0);
  for (const side of [-1, 1]) f.box(0.22, 0.01, 0.026, PALETTE.benchWood, 0, 0.04, side * 0.055, { vary: 0.06 });
  f.add(new THREE.CylinderGeometry(0.005, 0.005, 0.22, 4), PALETTE.timber, 0, 0.13, 0);
  f.add(new THREE.ConeGeometry(0.12, 0.05, 8), 0xf7f5ef, 0, 0.255, 0, { vary: 0.03 });
  f.add(new THREE.CylinderGeometry(0.121, 0.121, 0.014, 8), PALETTE.bavariaBlue, 0, 0.226, 0);
}

/** Wooden barrel planted with red geraniums. */
export function flowerBarrel(p: Parts, x: number, z: number) {
  const f = new Frame(p, x, z, 0);
  f.add(new THREE.CylinderGeometry(0.03, 0.026, 0.05, 8), PALETTE.bridge, 0, 0.05, 0, { vary: 0.08 });
  f.add(rockShard(p.rng, 0.034, 1, 0.15), PALETTE.leaves[1], 0, 0.085, 0, { sy: 0.7, vary: 0.12 });
  for (let i = 0; i < 3; i++) f.add(rockShard(p.rng, 0.014, 0, 0.2), PALETTE.geranium, (i - 1) * 0.02, 0.1, (i % 2) * 0.012, { vary: 0.12 });
}

/** A farmstead: long farmhouse, picket fence and a rain barrel. */
export function farmstead(p: Parts, x: number, z: number, face: number) {
  const rng = p.rng;
  house(p, x, z, face, { rural: true, storeys: rng() < 0.5 ? 1 : 2, facade: pick(rng, [0xf0d9a0, 0xe9c88a, 0xf4e7c8] as const), timber: 0x5e3b26 });
  const f = new Frame(p, x, z, face);
  const fw = 0.62, fd = 0.78, fz = 0.06;
  // Rails around the yard, with pickets.
  for (const [lx, lz, len, rot] of [
    [0, fz + fd / 2, fw, 0], [0, fz - fd / 2, fw, 0], [-fw / 2, fz, fd, Math.PI / 2], [fw / 2, fz, fd, Math.PI / 2],
  ] as [number, number, number, number][]) {
    f.box(len, 0.01, 0.008, PALETTE.picket, lx, 0.06, lz, { ry: rot, vary: 0.08 });
    const n = Math.round(len / 0.05);
    for (let i = 0; i <= n; i++) {
      const t = -len / 2 + (i / n) * len;
      const px = rot ? lx : lx + t, pz = rot ? lz + t : lz;
      if (rot === 0 && lz > fz && Math.abs(t) < 0.06) continue; // gate gap
      f.box(0.012, 0.085, 0.008, PALETTE.picket, px, 0.0425, pz, { ry: rot, vary: 0.12 });
    }
  }
  f.add(new THREE.CylinderGeometry(0.035, 0.03, 0.07, 8), PALETTE.bridge, 0.2, 0.035, fz + 0.3, { vary: 0.08 });
  flowerBarrel(p, ...f.world(-0.22, fz + 0.3));
}

/** A bridge house on a river crossing, with a baroque tower beside it. */
export function bridgeHouse(p: Parts, roadAxisZ: boolean) {
  const face = roadAxisZ ? 0 : Math.PI / 2;
  // Sandstone island base in the river.
  const f = new Frame(p, 0, 0, face);
  f.add(rockShard(p.rng, 0.26, 1, 0.08), PALETTE.sandstone, 0, 0.02, 0, { sy: 0.35, vary: 0.08 });
  house(p, 0, 0.02, face + Math.PI / 2, { storeys: 3, facade: 0xf7f3ea, timber: 0xc0862e, scale: 1.05 });
  const [tx, tz] = f.world(0, -0.2);
  const t = new Frame(p, tx, tz, face);
  t.box(0.16, 0.62, 0.16, 0xe3c17f, 0, 0.31, 0, { vary: 0.04 });
  t.box(0.02, 0.03, 0.006, PALETTE.glass, 0, 0.45, 0.083);
  t.box(0.19, 0.03, 0.19, PALETTE.slate, 0, 0.635, 0);
  t.add(new THREE.SphereGeometry(0.09, 8, 6), PALETTE.slate, 0, 0.7, 0, { sy: 0.8 });
  t.add(new THREE.CylinderGeometry(0.03, 0.035, 0.08, 8), 0xb9432e, 0, 0.8, 0);
  t.add(new THREE.SphereGeometry(0.035, 8, 5), PALETTE.slate, 0, 0.86, 0, { sy: 1.3 });
  t.add(new THREE.ConeGeometry(0.01, 0.08, 5), PALETTE.gold, 0, 0.93, 0);
}

/** Rows of vines on the slope below the castle. */
export function vineyard(p: Parts, x0: number, x1: number, z0: number, z1: number) {
  const rows = Math.max(2, Math.round((z1 - z0) / 0.075));
  for (let r = 0; r < rows; r++) {
    const z = z0 + (r + 0.5) * ((z1 - z0) / rows);
    p.add(new THREE.BoxGeometry(x1 - x0, 0.05, 0.03, 6, 1, 1), PALETTE.vine, { x: (x0 + x1) / 2, y: 0.03, z, vary: 0.18 });
  }
}
