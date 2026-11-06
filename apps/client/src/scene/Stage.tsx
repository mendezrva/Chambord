import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { CameraControls } from '@react-three/drei';
import CameraControlsImpl from 'camera-controls';
import { EffectComposer, N8AO, TiltShift2 } from '@react-three/postprocessing';
import { TILE } from '../tiles/buildTile';

export type View = 'overhead' | 'isometric' | 'closeup';
export interface Quality {
  tiles: 40 | 200;
  shadows: boolean;
  ao: boolean;
  tiltShift: boolean;
  dpr: number;
  auto: boolean;
}

export const isTouch = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
export const reducedMotion = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export const defaultQuality = (): Quality => ({
  tiles: 40,
  shadows: true,
  ao: !isTouch,
  tiltShift: true,
  dpr: Math.min(window.devicePixelRatio || 1, 2),
  auto: true,
});

export function boundsOf(tiles: { x: number; z: number }[]) {
  let minX = 0, maxX = 0, minZ = 0, maxZ = 0;
  for (const t of tiles) {
    minX = Math.min(minX, t.x); maxX = Math.max(maxX, t.x);
    minZ = Math.min(minZ, t.z); maxZ = Math.max(maxZ, t.z);
  }
  const cx = ((minX + maxX) / 2) * TILE, cz = ((minZ + maxZ) / 2) * TILE;
  const extent = (Math.max(maxX - minX, maxZ - minZ) + 1) * TILE * 0.5;
  return { cx, cz, extent };
}
export type Bounds = ReturnType<typeof boundsOf>;

/** Polar angle of the overhead view: a hair off vertical, so the heading stays defined while it spins. */
const OVERHEAD_POLAR = 0.0001;

/** Camera with touch-first controls and smooth moves between the three preset views. */
export function CameraRig({ view, viewKey = 0, bounds, focus, closeTarget, minDistance = 9, keepVisible }: {
  view: View;
  /** Bump to re-apply the same view (a second tap on the view button). */
  viewKey?: number;
  bounds: Bounds;
  focus: { x: number; z: number; n: number } | null;
  /** Where the close-up view looks; defaults to the start tile. */
  closeTarget?: { x: number; z: number };
  /** Closest the preset views come, so a small board doesn't fill the screen. */
  minDistance?: number;
  /** World points that must be on screen (where the drawn tile fits); the camera backs off to show them. */
  keepVisible?: { points: [number, number][]; n: number } | null;
}) {
  const ref = useRef<CameraControls>(null);
  const first = useRef(true);
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const A = CameraControlsImpl.ACTION;
    c.touches.one = A.TOUCH_TRUCK; // one finger pans across the board
    c.touches.two = A.TOUCH_DOLLY_ROTATE; // pinch to zoom, twist and drag to rotate and tilt
    c.touches.three = A.TOUCH_TRUCK;
    c.mouseButtons.left = A.ROTATE;
    c.mouseButtons.right = A.TRUCK;
    c.mouseButtons.wheel = A.DOLLY;
    c.dollyToCursor = true;
    c.smoothTime = 0.35;
    // Debug hook for automated screenshots: window.__camera.setLookAt(px, py, pz, tx, ty, tz).
    (window as unknown as { __camera?: CameraControls }).__camera = c;
  }, []);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const { cx, cz, extent } = bounds;
    // Portrait phones need the camera further back so the whole board fits across.
    const d = Math.max(minDistance, extent * 2.1) * Math.max(1, 0.95 / aspect);
    const animate = !first.current;
    first.current = false;
    // Overhead looks straight down and only spins; the other views can tilt again.
    const top = view === 'overhead';
    c.minPolarAngle = top ? 0 : 0.05;
    c.maxPolarAngle = top ? OVERHEAD_POLAR : 1.38;
    if (top) {
      // Keep the current heading, so switching to overhead doesn't also spin the board.
      c.setTarget(cx, 0, cz, animate);
      c.rotatePolarTo(OVERHEAD_POLAR, animate);
      c.dollyTo(d * 1.55, animate);
    }
    if (view === 'isometric') c.setLookAt(cx + d * 0.85, d * 0.8, cz + d * 0.85, cx, 0, cz, animate);
    if (view === 'closeup') {
      const t = closeTarget ?? { x: 0, z: 0 };
      c.setLookAt(t.x + 2.6, 2.1, t.z + 3.6, t.x, 0.3, t.z, animate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, viewKey]);

  // "Follow the action": glide to a newly placed tile.
  useEffect(() => {
    if (focus) ref.current?.moveTo(focus.x, 0, focus.z, true);
  }, [focus]);

  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  useEffect(() => {
    const c = ref.current;
    if (!c || !keepVisible || !keepVisible.points.length) return;
    // Wait for any "follow the action" glide to settle first.
    const timer = setTimeout(() => fit(c, keepVisible.points), 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keepVisible]);

  function fit(c: CameraControls, points: [number, number][]) {
    camera.updateMatrixWorld();
    // Leave room for the score bar at the top and the turn dock at the bottom.
    const fits = (cam: THREE.Camera) => points.every(([x, z]) => {
      const v = new THREE.Vector3(x, 0, z).project(cam);
      return Math.abs(v.x) < 0.86 && v.y < 0.68 && v.y > -0.42 && v.z < 1;
    });
    if (fits(camera)) return;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of points) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    const target = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    // Keep the current angle; find the closest distance that shows every point.
    const dir = camera.position.clone().sub(c.getTarget(new THREE.Vector3())).normalize();
    const probe = camera.clone();
    let d = minDistance * 0.8;
    for (; d < 70; d *= 1.08) {
      probe.position.copy(target).addScaledVector(dir, d);
      probe.lookAt(target);
      probe.updateMatrixWorld();
      if (fits(probe)) break;
    }
    // Move and back off without changing heading or tilt (setLookAt would lose the heading when looking straight down).
    c.moveTo(target.x, target.y, target.z, true);
    c.dollyTo(d, true);
  }

  return <CameraControls ref={ref} makeDefault minDistance={1.5} maxDistance={80} minPolarAngle={view === 'overhead' ? 0 : 0.05} maxPolarAngle={view === 'overhead' ? OVERHEAD_POLAR : 1.38} />;
}

/** Debug hook for automated tests: window.__project(x, y, z) gives the screen point of a world point. */
export function ProjectHook() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  useEffect(() => {
    (window as unknown as { __project?: unknown }).__project = (x: number, y: number, z: number) => {
      const v = new THREE.Vector3(x, y, z).project(camera);
      return { x: (v.x * 0.5 + 0.5) * size.width, y: (-v.y * 0.5 + 0.5) * size.height };
    };
  }, [camera, size]);
  return null;
}

/** Writes frame rate, draw calls and triangle count straight into an element, without React re-renders. */
export function Stats({ target }: { target: React.RefObject<HTMLSpanElement> }) {
  const gl = useThree((s) => s.gl);
  const acc = useRef({ frames: 0, time: 0 });
  const last = useRef({ calls: 0, triangles: 0 });
  useEffect(() => {
    // Count every render pass in a frame (shadows, effects), not just the last one.
    gl.info.autoReset = false;
    return () => { gl.info.autoReset = true; };
  }, [gl]);
  useFrame((_, dt) => {
    last.current = { calls: gl.info.render.calls, triangles: gl.info.render.triangles };
    gl.info.reset();
    acc.current.frames++;
    acc.current.time += dt;
    if (acc.current.time >= 0.5 && target.current) {
      const fps = Math.round(acc.current.frames / acc.current.time);
      const info = last.current;
      target.current.textContent = `${fps} fps · ${info.calls} draws · ${(info.triangles / 1000).toFixed(0)}k tris`;
      target.current.dataset.level = fps >= 55 ? 'good' : fps >= 40 ? 'ok' : 'low';
      acc.current = { frames: 0, time: 0 };
    }
  });
  return null;
}

export function Effects({ quality }: { quality: Quality }) {
  if (!quality.ao && !quality.tiltShift) return null;
  return (
    <EffectComposer multisampling={0} key={`${quality.ao}-${quality.tiltShift}`}>
      {[
        quality.ao ? <N8AO key="ao" halfRes aoRadius={0.9} intensity={2.2} distanceFalloff={0.6} /> : null,
        quality.tiltShift ? <TiltShift2 key="ts" blur={0.12} taper={0.6} /> : null,
      ].filter((e): e is JSX.Element => e !== null)}
    </EffectComposer>
  );
}

/** Auto quality: when the frame rate drops, switch off the most expensive effects first. */
export function declineQuality(q: Quality): { q: Quality; note: string | null } {
  if (!q.auto) return { q, note: null };
  if (q.ao) return { q: { ...q, ao: false }, note: 'Turned off ambient occlusion to keep things smooth' };
  if (q.dpr > 1.5) return { q: { ...q, dpr: 1.5 }, note: 'Lowered resolution to keep things smooth' };
  if (q.tiltShift) return { q: { ...q, tiltShift: false }, note: 'Turned off tilt-shift to keep things smooth' };
  if (q.dpr > 1) return { q: { ...q, dpr: 1 }, note: 'Lowered resolution to keep things smooth' };
  return { q, note: null };
}
