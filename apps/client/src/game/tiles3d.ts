/**
 * Bridges engine tiles to 3D tiles: maps a placed engine tile to the client's TileSpec,
 * caches the built geometry, and finds where a Wanderer stands on each local feature.
 */
import { analyze, DX, DZ, rotateEdges, type GameState, type TileDef } from '@glockenfels/engine';
import { buildTile, HALF, TILE, type BuiltTile, type TileSpec } from '../tiles/buildTile';
import type { Center } from '../tiles/catalog';
import { seedFor } from '../tiles/rng';

type V2 = [number, number];

const CENTER: Record<TileDef['center'], Center> = {
  none: 'none', monastery: 'abbey', castle: 'castle', shrine: 'shrine', maypole: 'maypole', lake: 'lake',
};

export function specFor(def: TileDef, rot: number, x: number, z: number, waterfalls: number[] = []): TileSpec {
  return {
    edges: rotateEdges(def.edges, rot),
    center: CENTER[def.center],
    banner: (def.banner ?? 0) > 0,
    seed: seedFor(x, z, 7),
    waterfalls,
    hopGarden: def.hopGarden,
    beerGarden: def.beerGarden,
    goods: def.goods,
  };
}

/** River edges of a placed tile with nothing beyond them: drawn as waterfalls over the slab edge. */
export function waterfallsAt(s: GameState, def: TileDef, rot: number, x: number, z: number): number[] {
  const edges = rotateEdges(def.edges, rot);
  const out: number[] = [];
  edges.forEach((e, d) => { if (e === 'river' && !s.board[`${x + DX[d]},${z + DZ[d]}`]) out.push(d); });
  return out;
}

const cache = new Map<string, BuiltTile>();
/** Built geometry, cached by tile, rotation, cell and waterfalls, so a preview and the placed tile share it. */
export function builtTile(def: TileDef, rot: number, x: number, z: number, waterfalls: number[] = []): BuiltTile {
  const k = `${def.id}/${rot}/${x},${z}/${waterfalls.join('')}`;
  let hit = cache.get(k);
  if (!hit) {
    hit = buildTile(specFor(def, rot, x, z, waterfalls));
    if (cache.size > 900) cache.clear();
    cache.set(k, hit);
  }
  return hit;
}

// Edge geometry, matching buildTile: 0 north (-z), 1 east (+x), 2 south (+z), 3 west (-x).
const MID: V2[] = [[0, -HALF], [HALF, 0], [0, HALF], [-HALF, 0]];
const CORNERS: [V2, V2][] = [
  [[-HALF, -HALF], [HALF, -HALF]],
  [[HALF, -HALF], [HALF, HALF]],
  [[HALF, HALF], [-HALF, HALF]],
  [[-HALF, HALF], [-HALF, -HALF]],
];

/** A point just inside the tile on half `slot` of the ring (slot 2e is the first half of edge e, clockwise). */
function slotPoint(slot: number): V2 {
  const e = Math.floor(slot / 2), half = slot % 2;
  const [a, b] = CORNERS[e];
  const t = half ? 0.76 : 0.24;
  const p: V2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const m = MID[e];
  return [p[0] - m[0] * 0.3, p[1] - m[1] * 0.3];
}

/** Where a Wanderer stands on each local feature of a tile, in tile-local units (same order as analyze().features). */
export function featureSpots(def: TileDef, rot: number, built: BuiltTile): V2[] {
  const a = analyze(def, rot);
  return a.features.map((f) => {
    switch (f.kind) {
      case 'monastery':
        return built.spots.abbey ?? [0.3, 0.35];
      case 'town': {
        if (built.spots.town) return built.spots.town;
        const c = f.edges.reduce<V2>((acc, e) => [acc[0] + MID[e][0] / f.edges.length, acc[1] + MID[e][1] / f.edges.length], [0, 0]);
        return [c[0] * 0.6, c[1] * 0.6];
      }
      case 'road': {
        if (f.edges.length === 2) {
          const [p, q] = [MID[f.edges[0]], MID[f.edges[1]]];
          return [(p[0] + q[0]) * 0.25, (p[1] + q[1]) * 0.25];
        }
        const m = MID[f.edges[0]];
        return [m[0] * 0.62, m[1] * 0.62];
      }
      case 'meadow': {
        // The slot point nearest the region's middle keeps the Wanderer inside its own meadow.
        const pts = f.slots.map(slotPoint);
        const c = pts.reduce<V2>((acc, p) => [acc[0] + p[0] / pts.length, acc[1] + p[1] / pts.length], [0, 0]);
        let best = pts[0], bd = Infinity;
        for (const p of pts) {
          const d = Math.hypot(p[0] - c[0], p[1] - c[1]);
          if (d < bd) { bd = d; best = p; }
        }
        return best;
      }
    }
  });
}

/** World position of a tile cell. */
export const cellToWorld = (x: number, z: number): V2 => [x * TILE, z * TILE];

const LABEL: Record<string, string> = { road: 'Road', town: 'Town', monastery: 'Monastery', meadow: 'Meadow' };
export const featureLabel = (kind: string) => LABEL[kind] ?? kind;
