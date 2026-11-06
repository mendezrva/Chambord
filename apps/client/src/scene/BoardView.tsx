import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { Board, Placement } from '../board/layout';
import { buildTile, TILE, type BuiltTile } from '../tiles/buildTile';
import { seedFor } from '../tiles/rng';
import { PLAYER_COLORS } from '../tiles/palette';
import { landMaterial, waterMaterial, waterUniforms } from './materials';
import { wandererGeometry } from './Wanderer';

const DROP_HEIGHT = 5;
const DROP_TIME = 0.55;
const SETTLE_TIME = 0.35;

/** Built geometry is cached per tile so changing settings never rebuilds the world. */
const geometryCache = new Map<string, BuiltTile>();
function tileGeometry(board: Board, p: Placement) {
  const k = `${p.x},${p.z}`;
  let hit = geometryCache.get(k);
  if (!hit) {
    hit = buildTile({
      edges: p.edges,
      center: p.type.center,
      banner: p.type.banner,
      seed: seedFor(p.x, p.z, 7),
      waterfalls: board.waterfalls(p),
    });
    geometryCache.set(k, hit);
  }
  return hit;
}

/** Which tiles carry a Wanderer in the demo, and where it stands. */
function wandererFor(p: Placement, built: BuiltTile) {
  if (p.order === 0 || p.order % 5 !== 2) return null;
  const spot = built.spots.abbey ?? built.spots.town ?? built.spots.road;
  if (!spot) return null;
  return { spot, color: PLAYER_COLORS[(p.order / 5) % 4 | 0] };
}

interface Anim { start: number; bounce: number }

export function BoardView({
  board,
  visible,
  dropStagger,
  bounceTile,
  shadows,
}: {
  board: Board;
  visible: number;
  /** Seconds between tile drops when many tiles appear at once. */
  dropStagger: number;
  /** Order of a tile to bounce (the celebration), with a counter so it can repeat. */
  bounceTile: { order: number; n: number } | null;
  shadows: boolean;
}) {
  const groups = useRef<(THREE.Group | null)[]>([]);
  const anims = useRef<Map<number, Anim>>(new Map());
  const clock = useRef(0);
  const shown = useRef(0);

  const tiles = board.tiles.slice(0, visible);

  // Schedule drops for tiles that just appeared (before the next frame, so nothing flashes).
  useLayoutEffect(() => {
    const now = clock.current;
    const from = Math.min(shown.current, visible);
    if (visible < shown.current) anims.current.clear();
    const start = visible < shown.current ? 0 : from;
    for (let i = start; i < visible; i++) {
      anims.current.set(i, { start: now + (i - start) * dropStagger, bounce: -1 });
      const g = groups.current[i];
      if (g) g.visible = false;
    }
    shown.current = visible;
  }, [visible, dropStagger]);

  useEffect(() => {
    if (!bounceTile) return;
    const a = anims.current.get(bounceTile.order);
    if (a) a.bounce = clock.current;
  }, [bounceTile]);

  useFrame((_, dt) => {
    clock.current += Math.min(dt, 0.05);
    const now = clock.current;
    waterUniforms.uTime.value = now;
    anims.current.forEach((a, i) => {
      const g = groups.current[i];
      if (!g) return;
      const t = now - a.start;
      if (t < 0) {
        g.visible = false;
        return;
      }
      g.visible = true;
      let y = 0, sy = 1, sxz = 1;
      if (t < DROP_TIME) {
        const k = t / DROP_TIME;
        y = DROP_HEIGHT * (1 - k * k); // accelerate down
        sy = 1.06; sxz = 0.97;
      } else if (t < DROP_TIME + SETTLE_TIME) {
        const k = (t - DROP_TIME) / SETTLE_TIME;
        const squash = Math.sin(k * Math.PI) * (1 - k);
        sy = 1 - 0.22 * squash;
        sxz = 1 + 0.1 * squash;
        y = Math.max(0, Math.sin(k * Math.PI * 2) * 0.12 * (1 - k));
      }
      if (a.bounce >= 0) {
        const b = now - a.bounce;
        if (b < 0.9) {
          const k = b / 0.9;
          y += Math.abs(Math.sin(k * Math.PI * 3)) * 0.35 * (1 - k);
        } else a.bounce = -1;
      }
      g.position.y = y;
      g.scale.set(sxz, sy, sxz);
      // The Wanderer hops in after the tile lands.
      const w = g.getObjectByName('wanderer');
      if (w) {
        const wt = t - DROP_TIME - 0.25;
        w.visible = wt > 0;
        if (wt > 0 && wt < 0.5) w.position.y = 0.06 + Math.sin((wt / 0.5) * Math.PI) * 0.4;
        else if (wt >= 0.5) w.position.y = 0.06;
      }
      if (t > DROP_TIME + SETTLE_TIME + 1 && a.bounce < 0) {
        g.position.y = 0;
        g.scale.set(1, 1, 1);
        if (w) { w.visible = true; w.position.y = 0.06; }
        anims.current.delete(i);
      }
    });
  });

  const items = useMemo(
    () =>
      tiles.map((p) => {
        const built = tileGeometry(board, p);
        return { p, built, wanderer: wandererFor(p, built) };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [board, visible],
  );

  return (
    <group>
      {items.map(({ p, built, wanderer }) => (
        <group
          key={`${p.x},${p.z}`}
          position={[p.x * TILE, 0, p.z * TILE]}
          ref={(g) => { groups.current[p.order] = g; }}
        >
          <mesh geometry={built.geometry} material={landMaterial} castShadow={shadows} receiveShadow={shadows} />
          {built.water && <mesh geometry={built.water} material={waterMaterial} receiveShadow={shadows} />}
          {wanderer && (
            <mesh
              name="wanderer"
              geometry={wandererGeometry(wanderer.color)}
              material={landMaterial}
              position={[wanderer.spot[0], 0.06, wanderer.spot[1]]}
              castShadow={shadows}
            />
          )}
        </group>
      ))}
    </group>
  );
}
