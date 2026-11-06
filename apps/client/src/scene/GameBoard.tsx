/**
 * The live board: placed tiles with drop and bounce animations, Wanderers that hop on and fly home,
 * glowing spots where the drawn tile fits, the hovering preview tile, and tap targets.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import type { GameState, TileDef } from '@glockenfels/engine';
import { TILE } from '../tiles/buildTile';
import { PLAYER_COLORS } from '../tiles/palette';
import { builtTile, featureSpots, waterfallsAt } from '../game/tiles3d';
import { landMaterial, waterMaterial, waterUniforms } from './materials';
import { wandererGeometry } from './Wanderer';
import { reducedMotion } from './Stage';

const DROP_HEIGHT = 5;
const DROP_TIME = 0.55;
const SETTLE_TIME = 0.35;
/** Taps that move further than this (in pixels) were pans, not taps. */
const TAP_SLOP = 10;

export const playerColor = (p: number) => PLAYER_COLORS[p % PLAYER_COLORS.length];
export const playerCss = (p: number) => `#${playerColor(p).toString(16).padStart(6, '0')}`;

function isTap(e: ThreeEvent<MouseEvent>) {
  e.stopPropagation();
  return e.delta <= TAP_SLOP;
}

// ---------- placed tiles ----------

interface TileItem { key: string; x: number; z: number; def: TileDef; rot: number; falls: number[] }
interface TileAnim { start: number; bounce: number }

export function useTiles(s: GameState, version: number): TileItem[] {
  return useMemo(
    () => Object.values(s.board)
      .sort((a, b) => a.order - b.order)
      .map((t) => {
        const def = s.config.tiles[t.tileId];
        return { key: t.key, x: t.x, z: t.z, def, rot: t.rot, falls: waterfallsAt(s, def, t.rot, t.x, t.z) };
      }),
    [s, version], // eslint-disable-line react-hooks/exhaustive-deps
  );
}

export function BoardTiles({ tiles, bounce, shadows }: {
  tiles: TileItem[];
  /** Tiles to bounce (a completed feature), with a counter so the same set can bounce again. */
  bounce: { keys: string[]; n: number } | null;
  shadows: boolean;
}) {
  const groups = useRef(new Map<string, THREE.Group>());
  const anims = useRef(new Map<string, TileAnim>());
  const known = useRef<Set<string> | null>(null);
  const clock = useRef(0);

  useLayoutEffect(() => {
    const now = clock.current;
    const first = known.current === null;
    const prev = known.current ?? new Set<string>();
    const fresh = tiles.filter((t) => !prev.has(t.key));
    // A resumed game builds its board in a quick ripple; a new tile drops on its own.
    const stagger = first ? (fresh.length > 60 ? 0.012 : 0.05) : 0;
    fresh.forEach((t, i) => {
      anims.current.set(t.key, { start: now + i * stagger, bounce: -1 });
      const g = groups.current.get(t.key);
      if (g) g.visible = false;
    });
    known.current = new Set(tiles.map((t) => t.key));
  }, [tiles]);

  useEffect(() => {
    if (!bounce || reducedMotion) return;
    for (const k of bounce.keys) {
      const a = anims.current.get(k) ?? { start: -10, bounce: -1 };
      a.bounce = clock.current;
      anims.current.set(k, a);
    }
  }, [bounce]);

  useFrame((_, dt) => {
    clock.current += Math.min(dt, 0.05);
    const now = clock.current;
    waterUniforms.uTime.value = now;
    anims.current.forEach((a, key) => {
      const g = groups.current.get(key);
      if (!g) return;
      const t = now - a.start;
      if (t < 0) { g.visible = false; return; }
      g.visible = true;
      let y = 0, sy = 1, sxz = 1;
      if (t < DROP_TIME) {
        const k = t / DROP_TIME;
        y = DROP_HEIGHT * (1 - k * k);
        sy = 1.06; sxz = 0.97;
      } else if (t < DROP_TIME + SETTLE_TIME && !reducedMotion) {
        const k = (t - DROP_TIME) / SETTLE_TIME;
        const squash = Math.sin(k * Math.PI) * (1 - k);
        sy = 1 - 0.22 * squash;
        sxz = 1 + 0.1 * squash;
        y = Math.max(0, Math.sin(k * Math.PI * 2) * 0.12 * (1 - k));
      }
      if (a.bounce >= 0) {
        const b = now - a.bounce;
        if (b < 0.9) y += Math.abs(Math.sin((b / 0.9) * Math.PI * 3)) * 0.35 * (1 - b / 0.9);
        else a.bounce = -1;
      }
      g.position.y = y;
      g.scale.set(sxz, sy, sxz);
      if (t > DROP_TIME + SETTLE_TIME && a.bounce < 0) {
        g.position.y = 0;
        g.scale.set(1, 1, 1);
        anims.current.delete(key);
      }
    });
  });

  return (
    <group>
      {tiles.map((t) => {
        const built = builtTile(t.def, t.rot, t.x, t.z, t.falls);
        return (
          <group
            key={t.key}
            position={[t.x * TILE, 0, t.z * TILE]}
            ref={(g) => { if (g) groups.current.set(t.key, g); else groups.current.delete(t.key); }}
          >
            <mesh geometry={built.geometry} material={landMaterial} castShadow={shadows} receiveShadow={shadows} />
            {built.water && <mesh geometry={built.water} material={waterMaterial} receiveShadow={shadows} />}
          </group>
        );
      })}
    </group>
  );
}

// ---------- Wanderers ----------

export interface PieceItem { id: string; player: number; grand: boolean; x: number; z: number }

/** Every Wanderer on the board, with its world position. */
export function usePieces(s: GameState, version: number): PieceItem[] {
  return useMemo(() => {
    const out: PieceItem[] = [];
    for (const f of s.features) {
      if (s.parent[f.id] !== f.id) continue;
      for (const p of f.pieces) {
        const t = s.board[p.tileKey];
        const def = s.config.tiles[t.tileId];
        const built = builtTile(def, t.rot, t.x, t.z, waterfallsAt(s, def, t.rot, t.x, t.z));
        const spot = featureSpots(def, t.rot, built)[p.local];
        out.push({ id: `${p.tileKey}:${p.local}`, player: p.player, grand: p.type === 'grand', x: t.x * TILE + spot[0], z: t.z * TILE + spot[1] });
      }
    }
    return out;
  }, [s, version]); // eslint-disable-line react-hooks/exhaustive-deps
}

interface Shown extends PieceItem { born: number; leaving: number }

export function Wanderers({ pieces, shadows, onPick, pickable }: {
  pieces: PieceItem[];
  shadows: boolean;
  /** Send Home: tap an opponent's Wanderer. */
  pickable?: (p: PieceItem) => boolean;
  onPick?: (p: PieceItem) => void;
}) {
  const [shown, setShown] = useState<Shown[]>([]);
  const refs = useRef(new Map<string, THREE.Group>());
  const clock = useRef(0);
  const first = useRef(true);

  useLayoutEffect(() => {
    const now = clock.current;
    const ids = new Set(pieces.map((p) => p.id));
    setShown((old) => {
      const byId = new Map(old.map((o) => [o.id, o]));
      const next: Shown[] = pieces.map((p) => {
        const o = byId.get(p.id);
        return o && o.leaving < 0 ? { ...o, ...p } : { ...p, born: first.current ? -10 : now + 0.15, leaving: -1 };
      });
      for (const o of old) if (!ids.has(o.id)) next.push(o.leaving < 0 ? { ...o, leaving: now } : o);
      return next.filter((o) => o.leaving < 0 || now - o.leaving < 1);
    });
    first.current = false;
  }, [pieces]);

  useFrame((_, dt) => {
    clock.current += Math.min(dt, 0.05);
    const now = clock.current;
    let expired = false;
    for (const o of shown) {
      const g = refs.current.get(o.id);
      if (!g) continue;
      const base = o.grand ? 1.45 : 1;
      if (o.leaving >= 0) {
        // Flies up and spins away home.
        const k = (now - o.leaving) / 0.8;
        if (k >= 1) { g.visible = false; expired = true; continue; }
        g.position.y = 0.06 + k * k * 2.4;
        g.rotation.y = k * 9;
        g.scale.setScalar(base * (1 - k * 0.6));
        continue;
      }
      const t = now - o.born;
      g.visible = t >= 0;
      if (t >= 0 && t < 0.5 && !reducedMotion) {
        g.position.y = 0.06 + Math.sin((t / 0.5) * Math.PI) * 0.45;
        g.scale.setScalar(base * (0.7 + 0.3 * Math.min(1, t / 0.25)));
      } else {
        g.position.y = 0.06;
        g.scale.setScalar(base);
      }
    }
    if (expired) setShown((old) => old.filter((o) => o.leaving < 0 || now - o.leaving < 0.8));
  });

  return (
    <group>
      {shown.map((o) => {
        const canPick = !!pickable?.(o) && o.leaving < 0;
        return (
          <group key={o.id} position={[o.x, 0, o.z]}>
            <group ref={(g) => { if (g) refs.current.set(o.id, g); else refs.current.delete(o.id); }}>
              <mesh geometry={wandererGeometry(playerColor(o.player))} material={landMaterial} castShadow={shadows} />
            </group>
            {canPick && (
              <>
                <PulseRing color={0xffffff} radius={0.2} />
                <Html position={[0, 0.75, 0]} center zIndexRange={[20, 0]}>
                  <button type="button" className="board-chip danger" onClick={() => onPick?.(o)}>Send home</button>
                </Html>
              </>
            )}
          </group>
        );
      })}
    </group>
  );
}

// ---------- markers ----------

const ringGeometry = new THREE.RingGeometry(0.82, 1, 32).rotateX(-Math.PI / 2);
const spotGeometry = new THREE.PlaneGeometry(TILE * 0.9, TILE * 0.9).rotateX(-Math.PI / 2);
const spotEdge = new THREE.EdgesGeometry(new THREE.BoxGeometry(TILE * 0.9, 0.001, TILE * 0.9));

function PulseRing({ color, radius }: { color: number; radius: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }), [color]);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const k = (clock.elapsedTime * 1.2) % 1;
    m.scale.setScalar(radius * (1 + k * 0.6));
    mat.opacity = 0.9 * (1 - k);
  });
  return <mesh ref={ref} geometry={ringGeometry} material={mat} position={[0, 0.04, 0]} />;
}

/** Glowing squares on every empty cell where the drawn tile fits. Tap one to hover the tile over it. */
export function SpotMarkers({ cells, selected, color, onPick }: {
  cells: [number, number][];
  selected: [number, number] | null;
  color: number;
  onPick: (x: number, z: number) => void;
}) {
  const fill = useMemo(() => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false }), [color]);
  const line = useMemo(() => new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }), []);
  useFrame(({ clock }) => {
    fill.opacity = 0.22 + 0.16 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 3));
  });
  return (
    <group>
      {cells.map(([x, z]) => {
        const sel = selected && selected[0] === x && selected[1] === z;
        return (
          <group key={`${x},${z}`} position={[x * TILE, -0.02, z * TILE]}>
            <mesh geometry={spotGeometry} material={fill} visible={!sel} onClick={(e) => { if (isTap(e)) onPick(x, z); }} />
            <lineSegments geometry={spotEdge} material={line} />
          </group>
        );
      })}
    </group>
  );
}

/** The drawn tile hovering over its chosen spot; tap it to turn it to the next way it fits. */
export function GhostTile({ def, rot, x, z, s, onTap, color }: {
  def: TileDef; rot: number; x: number; z: number; s: GameState; onTap: () => void; color: number;
}) {
  const ref = useRef<THREE.Group>(null);
  const spin = useRef({ from: rot, at: -1 });
  const built = builtTile(def, rot, x, z, waterfallsAt(s, def, rot, x, z));
  const last = useRef(rot);
  if (last.current !== rot) {
    spin.current = { from: last.current, at: performance.now() };
    last.current = rot;
  }
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    g.position.y = 0.45 + Math.sin(clock.elapsedTime * 2.4) * 0.06;
    // The new rotation is already built; swing into it from the previous angle.
    const k = spin.current.at < 0 || reducedMotion ? 1 : Math.min(1, (performance.now() - spin.current.at) / 220);
    let d = ((rot - spin.current.from) % 4 + 4) % 4;
    if (d === 3) d = -1;
    g.rotation.y = (1 - (1 - (1 - k) * (1 - k))) * d * (Math.PI / 2);
  });
  return (
    <group position={[x * TILE, 0, z * TILE]}>
      <group ref={ref} onClick={(e) => { if (isTap(e)) onTap(); }}>
        <mesh geometry={built.geometry} material={landMaterial} castShadow />
        {built.water && <mesh geometry={built.water} material={waterMaterial} />}
      </group>
      <mesh geometry={spotGeometry} position={[0, -0.02, 0]}>
        <meshBasicMaterial color={color} transparent opacity={0.45} depthWrite={false} />
      </mesh>
    </group>
  );
}

const ghostWandererMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: 0.5, roughness: 0.9 });

/** Claim step: a chip over each feature of the new tile. The chosen one shows a Wanderer. */
export function ClaimSpots({ s, options, selected, color, player, onPick }: {
  s: GameState;
  options: { local: number; label: string }[];
  selected: number | null;
  color: number;
  player: number;
  onPick: (local: number) => void;
}) {
  const t = s.lastPlaced ? s.board[s.lastPlaced] : null;
  const bob = useRef<THREE.Group>(null);
  useFrame(({ clock }) => { if (bob.current) bob.current.position.y = 0.1 + Math.abs(Math.sin(clock.elapsedTime * 3)) * 0.15; });
  if (!t) return null;
  const def = s.config.tiles[t.tileId];
  const spots = featureSpots(def, t.rot, builtTile(def, t.rot, t.x, t.z, waterfallsAt(s, def, t.rot, t.x, t.z)));
  return (
    <group position={[t.x * TILE, 0, t.z * TILE]}>
      {options.map((o) => {
        const [x, z] = spots[o.local];
        const sel = selected === o.local;
        return (
          <group key={o.local} position={[x, 0, z]}>
            {sel ? (
              <group ref={bob}>
                <mesh geometry={wandererGeometry(color)} material={landMaterial} castShadow />
              </group>
            ) : (
              <mesh geometry={wandererGeometry(color)} material={ghostWandererMat} position={[0, 0.06, 0]} onClick={(e) => { if (isTap(e)) onPick(o.local); }} />
            )}
            <PulseRing color={color} radius={0.2} />
            {/* A bigger invisible target so a fingertip can hit the ghost Wanderer. */}
            <mesh position={[0, 0.2, 0]} visible={false} onClick={(e) => { if (isTap(e)) onPick(o.local); }}>
              <cylinderGeometry args={[0.2, 0.2, 0.45, 8]} />
            </mesh>
            {sel && (
              <Html position={[0, 0.95, 0]} center zIndexRange={[20, 0]} pointerEvents="none">
                <span className="board-chip" aria-hidden="true" style={{ '--chip': playerCss(player) } as React.CSSProperties}>{o.label}</span>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}

// ---------- score popups ----------

export interface Popup { id: number; x: number; z: number; text: string; sub: string; player: number; big?: boolean }

export function Popups({ items }: { items: Popup[] }) {
  return (
    <>
      {items.map((p) => (
        <Html key={p.id} position={[p.x, 1.3, p.z]} center zIndexRange={[10, 0]} pointerEvents="none">
          <div className={`score-pop${p.big ? ' big' : ''}`} style={{ '--pop': playerCss(p.player) } as React.CSSProperties}>
            {p.text}<small>{p.sub}</small>
          </div>
        </Html>
      ))}
    </>
  );
}
