import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { EffectComposer, TiltShift2 } from '@react-three/postprocessing';
import './intro.css';
import { PALETTE, PLAYER_COLORS } from '../tiles/palette';
import { landMaterial, waterMaterial, waterUniforms } from '../scene/materials';
import { Clouds, Lights, Mountains } from '../scene/World';
import { isTouch, reducedMotion } from '../scene/Stage';
import { BOARD_EXTENT, buildIntroBoard, disposeIntroBoard } from './board';
import { barrelTable, makeHero, poseDrinker, poseWaver } from './characters';
import { END_AT, Flyover, SPOTS, TITLE_AT, WAITER_CAM } from './flyover';

/** Captions that run under the flyover, in seconds. */
const CAPTIONS: { from: number; to: number; text: string; big?: boolean }[] = [
  { from: 0.9, to: 3.6, text: 'Prost!', big: true },
  { from: 5.4, to: 8.3, text: 'Lay a road out of town,' },
  { from: 8.7, to: 11.5, text: 'follow the river past the fields,' },
  { from: 11.9, to: 14.3, text: 'and a friend is always waiting.' },
];

type Phase = { caption: number; title: boolean; buttons: boolean };

/** Shared clock for the scene and the overlay; Skip and Watch again move it. */
interface Clock { t: number; started: boolean; frames: number }

function Valley({ clock }: { clock: React.MutableRefObject<Clock> }) {
  const tiles = useMemo(buildIntroBoard, []);
  useEffect(() => () => disposeIntroBoard(tiles), [tiles]);

  const cast = useMemo(() => {
    const [px, pz] = SPOTS.pair, [wx, wz] = SPOTS.waiter;
    // Facing each other across a barrel: A looks east (+x), B looks west, both arms on the camera side.
    const a = makeHero(PLAYER_COLORS[0], -1, true, 101);
    a.root.position.set(px - 0.115, 0, pz);
    a.root.rotation.y = Math.PI / 2;
    const b = makeHero(PLAYER_COLORS[1], 1, true, 202);
    b.root.position.set(px + 0.115, 0, pz);
    b.root.rotation.y = -Math.PI / 2;
    const table = barrelTable();
    table.position.set(px, 0, pz - 0.015);
    const w = makeHero(PLAYER_COLORS[2], 1, true, 303);
    w.root.position.set(wx, 0, wz);
    w.root.rotation.y = Math.atan2(WAITER_CAM[0], WAITER_CAM[1]); // faces the arriving camera
    const group = new THREE.Group();
    group.add(a.root, b.root, table, w.root);
    return { a, b, w, group, baseY: [a, b, w].map((h) => h.root.position.y) };
  }, []);

  useFrame(() => {
    const t = clock.current.t;
    waterUniforms.uTime.value = t;
    poseDrinker(cast.a, t, 0);
    poseDrinker(cast.b, t, 0.04);
    // The waiter perks up as the camera rounds the bend.
    const excited = THREE.MathUtils.smoothstep(t, 11.2, 12.6);
    poseWaver(cast.w, t, excited);
  });

  return (
    <group>
      {tiles.map((tile, i) => (
        <group key={i} position={[tile.x, 0, tile.z]}>
          <mesh geometry={tile.built.geometry} material={landMaterial} castShadow receiveShadow />
          {tile.built.water && <mesh geometry={tile.built.water} material={waterMaterial} receiveShadow />}
        </group>
      ))}
      <primitive object={cast.group} />
    </group>
  );
}

/** Drives the camera along the flyover, then turns slowly around the valley behind the title. */
function FlyCamera({ clock, onPhase, still }: { clock: React.MutableRefObject<Clock>; onPhase: (p: Phase) => void; still: boolean }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  const fly = useMemo(() => new Flyover(aspect), [aspect]);
  const cam = useMemo(() => new THREE.Vector3(), []);
  const look = useMemo(() => new THREE.Vector3(), []);
  const last = useRef('');

  useFrame((_, dt) => {
    const c = clock.current;
    // Let the first frames compile shaders before the clock starts, so the opening shot doesn't stutter.
    if (!c.started) { c.frames++; if (c.frames > 3) c.started = true; }
    else c.t += Math.min(dt, 1 / 20);
    const t = c.t;
    fly.sample(Math.min(t, fly.end), cam, look);
    if (t > fly.end && !still) {
      // Ease into a slow turntable around the valley.
      const spin = t - fly.end;
      const angle = 0.045 * (spin - 2 * (1 - Math.exp(-spin / 2)));
      const r = Math.hypot(cam.x, cam.z), base = Math.atan2(cam.z, cam.x);
      cam.set(Math.cos(base - angle) * r, cam.y, Math.sin(base - angle) * r);
    }
    camera.position.copy(cam);
    camera.lookAt(look);
    // Close-ups get a wider lens feel; the overview a slightly narrower one, like a toy on a table.
    const k = THREE.MathUtils.smoothstep(t, TITLE_AT, END_AT);
    const fov = 46 - 10 * k;
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }

    const caption = CAPTIONS.findIndex((x) => t >= x.from && t < x.to);
    const phase: Phase = { caption, title: t >= TITLE_AT + 0.4, buttons: t >= TITLE_AT + 1.6 };
    const key = `${phase.caption}/${phase.title}/${phase.buttons}`;
    if (key !== last.current) { last.current = key; onPhase(phase); }
  });
  return null;
}

export function Intro({ onDone }: { onDone: () => void }) {
  const clock = useRef<Clock>({ t: reducedMotion ? END_AT : 0, started: false, frames: 0 });
  const [phase, setPhase] = useState<Phase>({ caption: -1, title: false, buttons: false });
  const [leaving, setLeaving] = useState(false);
  const [flash, setFlash] = useState(0);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  // Debug hook for automated screenshots: window.__introSeek(seconds).
  useEffect(() => {
    (window as unknown as { __introSeek?: (t: number) => void }).__introSeek = (t: number) => { clock.current.t = t; };
  }, []);

  const skip = () => { clock.current.t = Math.max(clock.current.t, END_AT); setFlash((n) => n + 1); };
  const replay = () => { clock.current.t = 0; setFlash((n) => n + 1); };
  const play = () => { setLeaving(true); setTimeout(onDone, 380); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') skip();
      if (e.key === 'Enter' && phase.buttons) play();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const caption = phase.caption >= 0 ? CAPTIONS[phase.caption] : null;

  return (
    <div className={`intro${leaving ? ' leaving' : ''}`}>
      <Canvas
        className="scene"
        shadows="soft"
        dpr={dpr}
        flat
        gl={{ antialias: false, powerPreference: 'high-performance' }}
        camera={{ fov: 46, near: 0.03, far: 200, position: [0, 1, 4] }}
        onCreated={({ scene }) => {
          scene.background = new THREE.Color(PALETTE.sky);
          scene.fog = new THREE.Fog(PALETTE.sky, 30, 85);
        }}
      >
        <Lights extent={BOARD_EXTENT} shadows />
        <Mountains />
        <Clouds extent={BOARD_EXTENT} />
        <Valley clock={clock} />
        <FlyCamera clock={clock} onPhase={setPhase} still={reducedMotion} />
        <EffectComposer multisampling={0}>
          <TiltShift2 blur={isTouch ? 0.1 : 0.13} taper={0.55} />
        </EffectComposer>
      </Canvas>

      <div className="intro-veil" key={flash} />

      <div className="intro-caption" aria-live="polite">
        {caption && <p key={caption.text} className={caption.big ? 'big' : ''}>{caption.text}</p>}
      </div>

      <header className={`intro-title${phase.title ? ' shown' : ''}`} aria-hidden={!phase.title}>
        <span className="intro-kicker">Welcome to</span>
        <h1>Glockenfels</h1>
        <div className="intro-rauten" aria-hidden />
        <p>Lay the land. Claim the valley.</p>
      </header>

      <div className="intro-actions">
        {phase.buttons ? (
          <>
            <button className="intro-play" onClick={play} autoFocus>Play</button>
            <button className="intro-link" onClick={replay}>Watch again</button>
          </>
        ) : (
          !phase.title && <button className="intro-skip" onClick={skip}>Skip</button>
        )}
      </div>
    </div>
  );
}
