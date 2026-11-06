/**
 * Intro-only Wanderers with an arm that moves, so they can raise a stein, clink and wave.
 * Same felt hat, feather and peg body as the game piece, built from faceted parts.
 */
import * as THREE from 'three';
import { Parts } from '../tiles/parts';
import { PALETTE } from '../tiles/palette';
import { makeRng } from '../tiles/rng';
import { landMaterial } from '../scene/materials';

const HAT = 0x2e4a33;
const BEER = 0xe9a126;
const FOAM = 0xfff8e8;

function bodyGeometry(color: number, seed: number) {
  const p = new Parts(makeRng(seed));
  p.add(new THREE.CylinderGeometry(0.055, 0.09, 0.2, 7), color, { y: 0.1, vary: 0.08 });
  p.add(new THREE.CylinderGeometry(0.045, 0.06, 0.05, 7), color, { y: 0.215, vary: 0.08 });
  // Lederhosen-style belt and braces so the close-up has some detail.
  p.add(new THREE.CylinderGeometry(0.068, 0.072, 0.025, 7), 0x5b3b25, { y: 0.15, vary: 0.05 });
  return p.merge();
}

function headGeometry(seed: number) {
  const p = new Parts(makeRng(seed));
  p.add(new THREE.IcosahedronGeometry(0.055, 0), PALETTE.skin, { y: 0, vary: 0.06 });
  // Rosy cheeks and a nose facing forward (+z).
  p.add(new THREE.IcosahedronGeometry(0.012, 0), 0xe7a58a, { z: 0.052, y: -0.005 });
  p.add(new THREE.CylinderGeometry(0.085, 0.085, 0.012, 8), HAT, { y: 0.045, vary: 0.06 });
  p.add(new THREE.CylinderGeometry(0.035, 0.05, 0.06, 7), HAT, { y: 0.08, vary: 0.06 });
  p.add(new THREE.CylinderGeometry(0.052, 0.052, 0.01, 7), 0x7a2e22, { y: 0.058 });
  p.add(new THREE.BoxGeometry(0.008, 0.08, 0.016), 0xffffff, { x: 0.04, y: 0.1, rz: -0.5 });
  return p.merge();
}

function armGeometry(color: number, seed: number) {
  const p = new Parts(makeRng(seed));
  // Hangs down from the shoulder pivot, hand at the bottom.
  p.add(new THREE.CylinderGeometry(0.018, 0.016, 0.11, 6), color, { y: -0.055, vary: 0.08 });
  p.add(new THREE.IcosahedronGeometry(0.019, 0), PALETTE.skin, { y: -0.115 });
  return p.merge();
}

function steinGeometry(seed: number) {
  const p = new Parts(makeRng(seed));
  p.add(new THREE.CylinderGeometry(0.026, 0.024, 0.06, 8), BEER, { y: 0.03, vary: 0.06 });
  p.add(new THREE.CylinderGeometry(0.029, 0.027, 0.018, 8), FOAM, { y: 0.066, vary: 0.04 });
  p.add(new THREE.IcosahedronGeometry(0.016, 0), FOAM, { y: 0.077, x: 0.008, vary: 0.04 });
  p.add(new THREE.TorusGeometry(0.016, 0.005, 4, 6, Math.PI), 0xf2e6c4, { x: 0.026, y: 0.03, rz: -Math.PI / 2 });
  return p.merge();
}

export interface Hero {
  root: THREE.Group;
  head: THREE.Object3D;
  arm: THREE.Group;
  stein: THREE.Object3D | null;
  /** Which side the moving arm is on: +1 is local +x. */
  side: number;
}

/** Builds a Wanderer facing local +z, with its moving arm on `side`, optionally holding a stein. */
export function makeHero(color: number, side: 1 | -1, withStein: boolean, seed: number): Hero {
  const root = new THREE.Group();
  const mesh = (g: THREE.BufferGeometry) => {
    const m = new THREE.Mesh(g, landMaterial);
    m.castShadow = true;
    return m;
  };
  root.add(mesh(bodyGeometry(color, seed)));
  const head = new THREE.Group();
  head.position.y = 0.28;
  head.add(mesh(headGeometry(seed + 1)));
  root.add(head);
  // The resting arm on the other side.
  const rest = mesh(armGeometry(color, seed + 2));
  rest.position.set(-side * 0.068, 0.215, 0);
  rest.rotation.z = side * 0.18;
  root.add(rest);
  const arm = new THREE.Group();
  arm.position.set(side * 0.068, 0.215, 0.01);
  arm.add(mesh(armGeometry(color, seed + 3)));
  root.add(arm);
  let stein: THREE.Object3D | null = null;
  if (withStein) {
    const holder = new THREE.Group();
    holder.rotation.order = 'ZYX'; // undoes the arm's XYZ swing exactly, so the stein stays upright
    holder.position.y = -0.115;
    const s = mesh(steinGeometry(seed + 4));
    s.position.set(side * 0.01, -0.02, 0.0);
    holder.add(s);
    arm.add(holder);
    stein = holder;
  }
  return { root, head, arm, stein, side };
}

/** A small standing barrel-table for the two Wanderers sharing a pint. */
export function barrelTable() {
  const p = new Parts(makeRng(77));
  p.add(new THREE.CylinderGeometry(0.05, 0.045, 0.16, 9), PALETTE.bridge, { y: 0.08, vary: 0.08 });
  p.add(new THREE.CylinderGeometry(0.053, 0.053, 0.012, 9), PALETTE.timber, { y: 0.04 });
  p.add(new THREE.CylinderGeometry(0.053, 0.053, 0.012, 9), PALETTE.timber, { y: 0.125 });
  p.add(new THREE.CylinderGeometry(0.075, 0.075, 0.012, 10), PALETTE.benchWood, { y: 0.166, vary: 0.05 });
  const m = new THREE.Mesh(p.merge(), landMaterial);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

const smooth = (a: number, b: number, t: number) => {
  const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/**
 * Pose for the two drinkers at time t (seconds): raise, clink, drink, repeat every 4.2 s.
 * Angles are the arm's swing forward (0 = hanging, PI/2 = straight out).
 */
export function poseDrinker(h: Hero, t: number, phase: number) {
  const c = (t + phase) % 4.2;
  const raise = smooth(0.2, 0.9, c) * (1 - smooth(3.4, 4.1, c));
  const clink = smooth(0.9, 1.15, c) * (1 - smooth(1.3, 1.6, c));
  const drink = smooth(1.7, 2.2, c) * (1 - smooth(2.9, 3.4, c));
  const swing = 0.35 + raise * 2.0 - clink * 0.3 + drink * 0.3;
  h.arm.rotation.x = -swing;
  h.arm.rotation.z = -h.side * (0.12 + clink * 0.1 + drink * 0.25);
  if (h.stein) {
    // Keep the stein upright while the arm moves, then tip it to drink.
    h.stein.rotation.x = swing - drink * 1.35;
    h.stein.rotation.z = -h.arm.rotation.z;
  }
  h.head.rotation.x = -drink * 0.35;
  h.root.position.y = Math.abs(Math.sin(c * Math.PI * 0.95)) * 0.004 + clink * 0.006;
  return clink;
}

/** The Wanderer waiting at the monastery: waves, with a little hop now and then. */
export function poseWaver(h: Hero, t: number, excited: number) {
  const wave = Math.sin(t * 9) * 0.35;
  h.arm.rotation.x = -0.25;
  h.arm.rotation.z = h.side * (0.3 + excited * (2.3 + wave));
  if (h.stein) {
    h.stein.rotation.z = -h.arm.rotation.z;
    h.stein.rotation.x = 0.25;
  }
  const hop = (t % 1.6) / 1.6;
  h.root.position.y = excited * Math.max(0, Math.sin(hop * Math.PI * 2)) * 0.035;
  h.head.rotation.z = Math.sin(t * 2) * 0.08 * excited;
}
