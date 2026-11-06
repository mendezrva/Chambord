import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { CameraControls, Html, PerformanceMonitor } from '@react-three/drei';
import CameraControlsImpl from 'camera-controls';
import { EffectComposer, N8AO, TiltShift2 } from '@react-three/postprocessing';
import { generateBoard } from './board/layout';
import { TILE } from './tiles/buildTile';
import { PALETTE } from './tiles/palette';
import { BoardView } from './scene/BoardView';
import { Clouds, Lights, Mountains } from './scene/World';
import { Confetti } from './scene/Confetti';
import { Overlay, type Quality, type View } from './ui/Overlay';

const MAX_TILES = 260;
const isTouch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

function boundsOf(tiles: { x: number; z: number }[]) {
  let minX = 0, maxX = 0, minZ = 0, maxZ = 0;
  for (const t of tiles) {
    minX = Math.min(minX, t.x); maxX = Math.max(maxX, t.x);
    minZ = Math.min(minZ, t.z); maxZ = Math.max(maxZ, t.z);
  }
  const cx = ((minX + maxX) / 2) * TILE, cz = ((minZ + maxZ) / 2) * TILE;
  const extent = (Math.max(maxX - minX, maxZ - minZ) + 1) * TILE * 0.5;
  return { cx, cz, extent };
}

/** Camera with touch-first controls and smooth moves between the three preset views. */
function CameraRig({ view, bounds, focus }: { view: View; bounds: ReturnType<typeof boundsOf>; focus: { x: number; z: number; n: number } | null }) {
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
    const d = Math.max(9, extent * 2.1) * Math.max(1, 0.95 / aspect);
    const animate = !first.current;
    first.current = false;
    if (view === 'overhead') c.setLookAt(cx, d * 1.55, cz + 0.6, cx, 0, cz, animate);
    if (view === 'isometric') c.setLookAt(cx + d * 0.85, d * 0.8, cz + d * 0.85, cx, 0, cz, animate);
    if (view === 'closeup') c.setLookAt(2.6, 1.1, 3.6, 0, 0.45, 0, animate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // "Follow the action": glide to a newly placed tile.
  useEffect(() => {
    if (focus) ref.current?.moveTo(focus.x, 0, focus.z, true);
  }, [focus]);

  return (
    <CameraControls
      ref={ref}
      makeDefault
      minDistance={1.5}
      maxDistance={80}
      minPolarAngle={0.05}
      maxPolarAngle={1.38}
    />
  );
}

/** Writes frame rate, draw calls and triangle count straight into the overlay, without React re-renders. */
function Stats({ target }: { target: React.RefObject<HTMLSpanElement> }) {
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

function ScorePopup({ at }: { at: { x: number; z: number; n: number } | null }) {
  if (!at) return null;
  return (
    <Html key={at.n} position={[at.x, 1.4, at.z]} center zIndexRange={[10, 0]} pointerEvents="none">
      <div className="score-pop">+12<small>Town complete</small></div>
    </Html>
  );
}

export default function App() {
  const board = useMemo(() => generateBoard(MAX_TILES), []);
  const [quality, setQuality] = useState<Quality>({
    tiles: 40,
    shadows: true,
    ao: !isTouch,
    tiltShift: true,
    dpr: Math.min(window.devicePixelRatio || 1, 2),
    auto: true,
  });
  const [visible, setVisible] = useState<number>(quality.tiles);
  const [stagger, setStagger] = useState(0.07);
  const [view, setView] = useState<View>('isometric');
  const [focus, setFocus] = useState<{ x: number; z: number; n: number } | null>(null);
  const [party, setParty] = useState<{ x: number; z: number; n: number } | null>(null);
  const [bounce, setBounce] = useState<{ order: number; n: number } | null>(null);
  const [autoNote, setAutoNote] = useState<string | null>(null);
  const statsRef = useRef<HTMLSpanElement>(null);

  const tiles = board.tiles.slice(0, visible);
  const bounds = useMemo(() => boundsOf(tiles), [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const rebuild = useCallback((count: number) => {
    setStagger(count > 60 ? 0.012 : 0.07);
    setVisible(0);
    requestAnimationFrame(() => setVisible(count));
  }, []);

  const dropOne = useCallback(() => {
    if (visible >= board.tiles.length) return;
    const p = board.tiles[visible];
    setStagger(0);
    setVisible(visible + 1);
    setFocus({ x: p.x * TILE, z: p.z * TILE, n: Date.now() });
  }, [visible, board]);

  const celebrate = useCallback(() => {
    // Demo of the town-completion moment; real scoring arrives with the Phase 2 rules engine.
    const shown = board.tiles.slice(0, visible);
    const town = [...shown].reverse().find((t) => t.edges.includes('town')) ?? shown[0];
    const n = Date.now();
    setParty({ x: town.x * TILE, z: town.z * TILE, n });
    setBounce({ order: town.order, n });
    setFocus({ x: town.x * TILE, z: town.z * TILE, n });
  }, [board, visible]);

  const updateQuality = (q: Partial<Quality>) => {
    setQuality((old) => {
      const next = { ...old, ...q };
      if (q.tiles && q.tiles !== old.tiles) rebuild(q.tiles);
      return next;
    });
  };

  // Auto quality: when the frame rate drops, switch off the most expensive effects first.
  const onDecline = useCallback(() => {
    setQuality((q) => {
      if (!q.auto) return q;
      if (q.ao) { setAutoNote('Turned off ambient occlusion to keep things smooth'); return { ...q, ao: false }; }
      if (q.dpr > 1.5) { setAutoNote('Lowered resolution to keep things smooth'); return { ...q, dpr: 1.5 }; }
      if (q.tiltShift) { setAutoNote('Turned off tilt-shift to keep things smooth'); return { ...q, tiltShift: false }; }
      if (q.dpr > 1) { setAutoNote('Lowered resolution to keep things smooth'); return { ...q, dpr: 1 }; }
      return q;
    });
  }, []);

  const effects = quality.ao || quality.tiltShift;

  return (
    <div className="app">
      <Canvas
        className="scene"
        shadows={quality.shadows ? 'soft' : false}
        dpr={quality.dpr}
        flat
        gl={{ antialias: !effects, powerPreference: 'high-performance' }}
        camera={{ fov: 38, near: 0.1, far: 220, position: [20, 18, 20] }}
        onCreated={({ scene }) => {
          scene.background = new THREE.Color(PALETTE.sky);
          scene.fog = new THREE.Fog(PALETTE.sky, 38, 90);
        }}
      >
        <PerformanceMonitor onDecline={onDecline} flipflops={6} />
        <Suspense fallback={null}>
          <Lights extent={bounds.extent} shadows={quality.shadows} />
          <Mountains />
          <Clouds extent={bounds.extent} />
          <BoardView board={board} visible={visible} dropStagger={stagger} bounceTile={bounce} shadows={quality.shadows} />
          <Confetti at={party} />
          <ScorePopup at={party} />
          <CameraRig view={view} bounds={bounds} focus={focus} />
          {effects && (
            <EffectComposer multisampling={0} key={`${quality.ao}-${quality.tiltShift}`}>
              {[
                quality.ao ? <N8AO key="ao" halfRes aoRadius={0.9} intensity={2.2} distanceFalloff={0.6} /> : null,
                quality.tiltShift ? <TiltShift2 key="ts" blur={0.12} taper={0.6} /> : null,
              ].filter((e): e is JSX.Element => e !== null)}
            </EffectComposer>
          )}
        </Suspense>
        <Stats target={statsRef} />
      </Canvas>
      <Overlay
        statsRef={statsRef}
        view={view}
        onView={setView}
        quality={quality}
        onQuality={updateQuality}
        onDrop={dropOne}
        onRebuild={() => rebuild(quality.tiles)}
        onCelebrate={celebrate}
        tileCount={visible}
        autoNote={autoNote}
      />
    </div>
  );
}
