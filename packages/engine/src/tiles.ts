/**
 * Tile definitions and the analysis that turns a tile's edges and centre into local features:
 * the road segments, the town, the monastery and the meadow regions, with the edges they are open on.
 */

export type EdgeKind = 'meadow' | 'road' | 'town' | 'river';
export type CenterKind = 'none' | 'monastery' | 'castle' | 'shrine' | 'maypole' | 'lake';
export type Good = 'pretzels' | 'hops' | 'timber';

export interface TileDef {
  id: string;
  name: string;
  /** North, east, south, west. */
  edges: readonly [EdgeKind, EdgeKind, EdgeKind, EdgeKind];
  center: CenterKind;
  /** Banners on the town (scores extra). */
  banner?: number;
  /** Module flags. */
  beerGarden?: boolean;
  hopGarden?: boolean;
  goods?: Good;
  /** Action tiles have no landscape; they go to the player's hand. */
  action?: ActionKind;
}

export type ActionKind = 'skip' | 'reverse' | 'drawTwo' | 'loseTurn' | 'sendHome' | 'steal';

export type FeatureKind = 'road' | 'town' | 'monastery' | 'meadow';

export interface LocalFeature {
  kind: FeatureKind;
  /** Edges (0-3) where this feature is open to a neighbouring tile. Monasteries have none. */
  edges: number[];
  /** Meadow only: ring slots (0-7) where it meets a neighbour. Slot 2i and 2i+1 are the two halves of edge i, clockwise. */
  slots: number[];
  /** Meadow only: local indexes of towns this meadow touches. */
  touchesTowns: number[];
  banner: number;
}

export interface TileAnalysis {
  edges: readonly [EdgeKind, EdgeKind, EdgeKind, EdgeKind];
  features: LocalFeature[];
  /** Local feature index by edge, for roads and towns (-1 if none). */
  byEdge: number[];
  /** Local meadow feature index by ring slot (-1 if none). */
  bySlot: number[];
  monastery: number;
}

export const OPPOSITE = [2, 3, 0, 1] as const;
export const DX = [0, 1, 0, -1] as const;
export const DZ = [-1, 0, 1, 0] as const;

/** Rotates edges by `rot` quarter turns clockwise. */
export function rotateEdges(edges: readonly EdgeKind[], rot: number): [EdgeKind, EdgeKind, EdgeKind, EdgeKind] {
  const r = ((rot % 4) + 4) % 4;
  return [0, 1, 2, 3].map((i) => edges[(i - r + 4) % 4]) as [EdgeKind, EdgeKind, EdgeKind, EdgeKind];
}

/** Centres where roads stop rather than run through. */
const JUNCTIONS = new Set<CenterKind>(['shrine', 'castle', 'maypole', 'lake']);

const cache = new Map<string, TileAnalysis>();

export function analyze(def: TileDef, rot: number): TileAnalysis {
  const key = `${def.id}/${((rot % 4) + 4) % 4}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const edges = rotateEdges(def.edges, rot);
  const features: LocalFeature[] = [];
  const byEdge = [-1, -1, -1, -1];
  const bySlot = Array(8).fill(-1) as number[];
  const mk = (kind: FeatureKind, e: number[] = []): LocalFeature => ({ kind, edges: e, slots: [], touchesTowns: [], banner: 0 });

  // Roads: two roads with no junction centre join; otherwise each edge is its own segment.
  const roadEdges = [0, 1, 2, 3].filter((i) => edges[i] === 'road');
  if (roadEdges.length === 2 && !JUNCTIONS.has(def.center)) {
    byEdge[roadEdges[0]] = byEdge[roadEdges[1]] = features.length;
    features.push(mk('road', roadEdges));
  } else {
    for (const e of roadEdges) {
      byEdge[e] = features.length;
      features.push(mk('road', [e]));
    }
  }
  // Town: every town edge on a tile is one town.
  const townEdges = [0, 1, 2, 3].filter((i) => edges[i] === 'town');
  let townIdx = -1;
  if (townEdges.length) {
    townIdx = features.length;
    for (const e of townEdges) byEdge[e] = townIdx;
    const t = mk('town', townEdges);
    t.banner = def.banner ?? 0;
    features.push(t);
  }
  let monastery = -1;
  if (def.center === 'monastery') {
    monastery = features.length;
    features.push(mk('monastery'));
  }
  // Meadows: roads and rivers cut the ring of eight half-edges into regions.
  const cuts = [0, 1, 2, 3].filter((i) => edges[i] === 'road' || edges[i] === 'river');
  const regions: { slots: number[]; coveredEdges: number[] }[] = [];
  if (cuts.length < 2) {
    regions.push({ slots: [0, 1, 2, 3, 4, 5, 6, 7], coveredEdges: [0, 1, 2, 3] });
  } else {
    for (let k = 0; k < cuts.length; k++) {
      const a = cuts[k], b = cuts[(k + 1) % cuts.length];
      const slots: number[] = [];
      const covered: number[] = [];
      let s = 2 * a + 1;
      const end = 2 * b;
      for (let guard = 0; guard < 9; guard++) {
        slots.push(s);
        if (s === end) break;
        s = (s + 1) % 8;
      }
      for (let e = a; ; e = (e + 1) % 4) {
        covered.push(e);
        if (e === b) break;
      }
      regions.push({ slots, coveredEdges: covered });
    }
  }
  for (const r of regions) {
    const slots = r.slots.filter((s) => edges[Math.floor(s / 2)] !== 'town');
    const touches = townIdx >= 0 && r.coveredEdges.some((e) => edges[e] === 'town') ? [townIdx] : [];
    if (!slots.length) continue;
    const m = mk('meadow');
    m.slots = slots;
    m.touchesTowns = touches;
    for (const s of slots) bySlot[s] = features.length;
    features.push(m);
  }
  const out: TileAnalysis = { edges, features, byEdge, bySlot, monastery };
  cache.set(key, out);
  return out;
}

/** The neighbouring slot that touches slot `s` across the tile edge. */
export function oppositeSlot(s: number) {
  const edge = Math.floor(s / 2);
  const half = s % 2;
  return 2 * OPPOSITE[edge] + (1 - half);
}
