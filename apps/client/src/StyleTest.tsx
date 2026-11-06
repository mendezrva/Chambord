import { Suspense, useCallback, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { Html, PerformanceMonitor } from '@react-three/drei';
import { generateBoard } from './board/layout';
import { TILE } from './tiles/buildTile';
import { PALETTE } from './tiles/palette';
import { BoardView } from './scene/BoardView';
import { Clouds, Lights, Mountains } from './scene/World';
import { Confetti } from './scene/Confetti';
import { Overlay } from './ui/Overlay';
import { boundsOf, CameraRig, declineQuality, defaultQuality, Effects, Stats, type Quality, type View } from './scene/Stage';

const MAX_TILES = 260;

function ScorePopup({ at }: { at: { x: number; z: number; n: number } | null }) {
  if (!at) return null;
  return (
    <Html key={at.n} position={[at.x, 1.4, at.z]} center zIndexRange={[10, 0]} pointerEvents="none">
      <div className="score-pop">+12<small>Town complete</small></div>
    </Html>
  );
}

export default function StyleTest({ onBack }: { onBack: () => void }) {
  const board = useMemo(() => generateBoard(MAX_TILES), []);
  const [quality, setQuality] = useState<Quality>(defaultQuality);
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
      const r = declineQuality(q);
      if (r.note) setAutoNote(r.note);
      return r.q;
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
          <Effects quality={quality} />
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
        onBack={onBack}
      />
    </div>
  );
}
