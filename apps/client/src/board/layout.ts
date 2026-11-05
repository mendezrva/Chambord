import { LAND_TILES, RIVER_TILES, START_TILE, rotateEdges, type Edge, type TileType } from '../tiles/catalog';
import { makeRng, type Rng } from '../tiles/rng';

/**
 * Builds a demo board by placing tiles one at a time with matching edges.
 * This is a stand-in for the Phase 2 rules engine: it only checks edge matching.
 */
export interface Placement {
  x: number;
  z: number;
  type: TileType;
  edges: [Edge, Edge, Edge, Edge];
  /** Order the tile was placed in; used for the drop animation. */
  order: number;
}

const DIRS: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const key = (x: number, z: number) => `${x},${z}`;

export class Board {
  readonly tiles: Placement[] = [];
  private byPos = new Map<string, Placement>();

  get(x: number, z: number) {
    return this.byPos.get(key(x, z));
  }

  fits(x: number, z: number, edges: readonly Edge[]) {
    if (this.get(x, z)) return false;
    let neighbours = 0;
    for (let d = 0; d < 4; d++) {
      const n = this.get(x + DIRS[d][0], z + DIRS[d][1]);
      if (!n) continue;
      neighbours++;
      if (n.edges[(d + 2) % 4] !== edges[d]) return false;
    }
    return neighbours > 0 || this.tiles.length === 0;
  }

  place(x: number, z: number, type: TileType, edges: [Edge, Edge, Edge, Edge]) {
    const p: Placement = { x, z, type, edges, order: this.tiles.length };
    this.tiles.push(p);
    this.byPos.set(key(x, z), p);
    return p;
  }

  /** Edges where a river leaves the board with no tile beyond it. */
  waterfalls(p: Placement) {
    const out: number[] = [];
    p.edges.forEach((e, d) => {
      if (e === 'river' && !this.get(p.x + DIRS[d][0], p.z + DIRS[d][1])) out.push(d);
    });
    return out;
  }

  frontier() {
    const spots = new Map<string, [number, number]>();
    for (const t of this.tiles) {
      for (const [dx, dz] of DIRS) {
        const x = t.x + dx, z = t.z + dz;
        if (!this.get(x, z)) spots.set(key(x, z), [x, z]);
      }
    }
    return [...spots.values()];
  }
}

function weighted(rng: Rng, tiles: TileType[]) {
  const total = tiles.reduce((s, t) => s + t.weight, 0);
  let r = rng() * total;
  for (const t of tiles) {
    r -= t.weight;
    if (r <= 0) return t;
  }
  return tiles[tiles.length - 1];
}

/** Places the castle, a short river from a mountain lake, then random land tiles up to `count`. */
export function generateBoard(count: number, seed = 1871): Board {
  const rng = makeRng(seed);
  const board = new Board();
  board.place(0, 0, START_TILE, [...START_TILE.edges]);

  // River: a lake two tiles north-west of the castle, flowing away and off the board.
  const river: [number, number, TileType][] = [];
  const lakeAt: [number, number] = [-1, -2];
  board.place(lakeAt[0], lakeAt[1], RIVER_TILES[0], rotateEdges(RIVER_TILES[0].edges, 2)); // river leaves east
  let cur = { x: lakeAt[0], z: lakeAt[1], out: 1 };
  for (let i = 0; i < 5; i++) {
    const nx = cur.x + DIRS[cur.out][0], nz = cur.z + DIRS[cur.out][1];
    const options: [TileType, number][] = [];
    for (const t of RIVER_TILES.slice(1)) {
      for (let r = 0; r < 4; r++) {
        const e = rotateEdges(t.edges, r);
        if (board.fits(nx, nz, e)) for (let w = 0; w < t.weight; w++) options.push([t, r]);
      }
    }
    if (!options.length) break;
    const [t, r] = options[Math.floor(rng() * options.length)];
    const edges = rotateEdges(t.edges, r);
    board.place(nx, nz, t, edges);
    const inDir = (cur.out + 2) % 4;
    const outDir = edges.findIndex((e, d) => e === 'river' && d !== inDir);
    cur = { x: nx, z: nz, out: outDir };
    river.push([nx, nz, t]);
  }

  // Land tiles: prefer spots with more neighbours close to the castle, so the board grows compactly.
  let guard = 0;
  while (board.tiles.length < count && guard++ < count * 40) {
    const spots = board.frontier()
      .map(([x, z]) => {
        let n = 0;
        for (const [dx, dz] of DIRS) if (board.get(x + dx, z + dz)) n++;
        return { x, z, score: n * 2 - Math.hypot(x, z) * 0.35 + rng() * 2.2 };
      })
      .sort((a, b) => b.score - a.score);
    let placed = false;
    for (const s of spots.slice(0, 6)) {
      for (let attempt = 0; attempt < 14 && !placed; attempt++) {
        const t = weighted(rng, LAND_TILES);
        const r0 = Math.floor(rng() * 4);
        for (let k = 0; k < 4; k++) {
          const e = rotateEdges(t.edges, r0 + k);
          if (board.fits(s.x, s.z, e)) {
            board.place(s.x, s.z, t, e);
            placed = true;
            break;
          }
        }
      }
      if (placed) break;
    }
  }
  return board;
}
