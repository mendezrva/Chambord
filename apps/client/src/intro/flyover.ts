/**
 * The intro's camera path: keyframes of camera position and look-at point, joined with
 * centripetal Catmull-Rom curves, and timed with a monotone cubic so the camera never
 * stops or lurches between shots.
 */
import * as THREE from 'three';
import { at } from './board';

export interface Shot { t: number; cam: [number, number, number]; look: [number, number, number]; caption?: string }

const PAIR = at(1, 1, 0, 0.5);
const WAITER = at(4, 3, -0.12, 0.7);

/** Where the two Wanderers share a pint, and where the third waits at the monastery. */
export const SPOTS = { pair: PAIR, waiter: WAITER };

/** The isometric overview the flyover ends on; portrait screens need the camera further back. */
export function overview(aspect: number): [number, number, number] {
  const d = 13 * Math.max(1, 0.95 / aspect);
  return [d * 0.85, d * 0.8, d * 0.85];
}

export const TITLE_AT = 14.6;
export const END_AT = 18.2;

/** Portrait screens are narrow, so close-ups stand further back to keep both Wanderers in frame. */
const pullFor = (aspect: number) => Math.min(1.7, Math.max(1, 0.8 / aspect));

/** Camera position for a close-up: an offset from the subject, stretched on narrow screens. */
function close(subject: [number, number, number], off: [number, number, number], pull: number): [number, number, number] {
  return [subject[0] + off[0] * pull, subject[1] + off[1] * (1 + (pull - 1) * 0.6), subject[2] + off[2] * pull];
}

/** The camera spot that greets the waiting Wanderer; he turns to face it. */
export const WAITER_CAM: [number, number] = [-0.3, 1.25];

export function shots(aspect: number): Shot[] {
  const [px, pz] = PAIR, [wx, wz] = WAITER;
  const pull = pullFor(aspect);
  const pair: [number, number, number] = [px, 0.24, pz];
  const waiter: [number, number, number] = [wx, 0.26, wz];
  return [
    // 1. Close on two Wanderers raising a stein outside the town gate.
    { t: 0, cam: close(pair, [-0.1, 0.05, 0.58], pull), look: pair },
    { t: 3.4, cam: close(pair, [0.12, 0.09, 0.62], pull), look: [px, 0.25, pz] },
    // 2. Pull back down the lane, the gate and the town rooftops behind them.
    { t: 5.2, cam: [px + 0.15, 0.95, pz + 1.7], look: [px, 0.3, pz - 0.2] },
    // 3. Turn east along the road, out of town towards the fields.
    { t: 6.9, cam: [px + 0.6, 1.3, pz + 2.5], look: [px + 2.6, 0.2, pz + 1.9] },
    { t: 8.4, cam: [px + 1.9, 1.8, pz + 2.9], look: [px + 4.1, 0.05, pz + 3.2] },
    // 4. Meet the stream just below the bridge and follow it downstream.
    { t: 10.0, cam: [px + 3.75, 0.85, pz + 2.35], look: [px + 4.0, 0.0, pz + 5.0] },
    // 5. Round the bend.
    { t: 11.6, cam: [px + 3.7, 0.8, pz + 4.4], look: [px + 5.6, 0.05, pz + 5.6] },
    // 6. Arrive at the monastery, where a third Wanderer waits with a stein.
    { t: 13.1, cam: close(waiter, [-0.55, 0.3, 1.1], pull), look: waiter },
    { t: TITLE_AT, cam: close(waiter, [WAITER_CAM[0], 0.32, WAITER_CAM[1]], pull), look: [wx, 0.3, wz - 0.1] },
    // 7. Rise and pull out to the whole valley in isometric view.
    { t: END_AT, cam: overview(aspect), look: [0, -0.4, 0] },
  ];
}

/** Monotone cubic (Fritsch-Carlson) through (t_i, i): smooth progress, flat at both ends. */
function progress(times: number[]) {
  const n = times.length;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push(1 / (times[i + 1] - times[i]));
  const m: number[] = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) m[i] = (d[i - 1] + d[i]) / 2;
  return (t: number) => {
    if (t <= times[0]) return 0;
    if (t >= times[n - 1]) return n - 1;
    let i = 0;
    while (t > times[i + 1]) i++;
    const h = times[i + 1] - times[i];
    const s = (t - times[i]) / h;
    const s2 = s * s, s3 = s2 * s;
    return i * (2 * s3 - 3 * s2 + 1) + h * m[i] * (s3 - 2 * s2 + s) + (i + 1) * (-2 * s3 + 3 * s2) + h * m[i + 1] * (s3 - s2);
  };
}

export class Flyover {
  readonly list: Shot[];
  private camCurve: THREE.CatmullRomCurve3;
  private lookCurve: THREE.CatmullRomCurve3;
  private u: (t: number) => number;
  constructor(aspect: number) {
    this.list = shots(aspect);
    const v = (p: [number, number, number]) => new THREE.Vector3(...p);
    this.camCurve = new THREE.CatmullRomCurve3(this.list.map((s) => v(s.cam)), false, 'centripetal');
    this.lookCurve = new THREE.CatmullRomCurve3(this.list.map((s) => v(s.look)), false, 'centripetal');
    this.u = progress(this.list.map((s) => s.t));
  }
  get end() { return this.list[this.list.length - 1].t; }
  sample(t: number, cam: THREE.Vector3, look: THREE.Vector3) {
    const k = this.u(t) / (this.list.length - 1);
    this.camCurve.getPoint(k, cam);
    this.lookCurve.getPoint(k, look);
  }
}
