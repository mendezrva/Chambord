/**
 * The intro's hand-laid valley: a 6 x 6 diorama built from the same tile generator as the game,
 * laid out so the flyover tells a story: a town gate, a road out to the fields, a stream that
 * bends past a monastery, and Burg Glockenfels on its crag.
 */
import type { Center, Edge } from '../tiles/catalog';
import { buildTile, TILE, type BuiltTile } from '../tiles/buildTile';
import { makeRng, seedFor } from '../tiles/rng';

type Spec = { x: number; z: number; e: string; center?: Center; banner?: boolean; beerGarden?: boolean; hopGarden?: boolean; waterfalls?: number[]; field?: boolean };

const E: Record<string, Edge> = { m: 'meadow', t: 'town', r: 'road', w: 'river' };

// Edges are north, east, south, west (one letter each: meadow, town, road, water).
const LAYOUT: Spec[] = [
  { x: 0, z: 0, e: 'mttm' }, { x: 1, z: 0, e: 'mttt' }, { x: 2, z: 0, e: 'mmtt' },
  { x: 3, z: 0, e: 'mmwm', center: 'lake' }, { x: 4, z: 0, e: 'mmmm' }, { x: 5, z: 0, e: 'mmtm' },
  { x: 0, z: 1, e: 'ttmm' }, { x: 1, z: 1, e: 'ttrt', beerGarden: true }, { x: 2, z: 1, e: 'tmmt', banner: true },
  { x: 3, z: 1, e: 'wmwm' }, { x: 4, z: 1, e: 'mmmm' }, { x: 5, z: 1, e: 'tmrm' },
  { x: 0, z: 2, e: 'mmmm' }, { x: 1, z: 2, e: 'rrrm', center: 'shrine' }, { x: 2, z: 2, e: 'mrmr' },
  { x: 3, z: 2, e: 'wrwr' }, { x: 4, z: 2, e: 'mrrr', center: 'shrine' }, { x: 5, z: 2, e: 'rmmr' },
  { x: 0, z: 3, e: 'mmmm', field: true }, { x: 1, z: 3, e: 'rmrm' }, { x: 2, z: 3, e: 'mmmm', field: true },
  { x: 3, z: 3, e: 'wmwm' }, { x: 4, z: 3, e: 'rmmm', center: 'abbey' }, { x: 5, z: 3, e: 'mmmm' },
  { x: 0, z: 4, e: 'mrmr', center: 'castle' }, { x: 1, z: 4, e: 'rmmr' }, { x: 2, z: 4, e: 'mmmm', field: true },
  { x: 3, z: 4, e: 'wwmm' }, { x: 4, z: 4, e: 'mwmw' }, { x: 5, z: 4, e: 'mwmw', waterfalls: [1] },
  { x: 0, z: 5, e: 'mmmm' }, { x: 1, z: 5, e: 'mmmm', field: true }, { x: 2, z: 5, e: 'mmmm' },
  { x: 3, z: 5, e: 'mmmm' }, { x: 4, z: 5, e: 'mmmm', hopGarden: true }, { x: 5, z: 5, e: 'mmmm' },
];

export const GRID = 6;
/** World position of a point inside a cell: the board is centred on the origin. */
export const at = (cx: number, cz: number, lx = 0, lz = 0): [number, number] => [
  (cx - (GRID - 1) / 2) * TILE + lx,
  (cz - (GRID - 1) / 2) * TILE + lz,
];

/** A bare meadow becomes a farm when the generator's first roll is under 0.6; pick a seed that does. */
function seedWithFarm(x: number, z: number) {
  for (let salt = 7; salt < 200; salt++) {
    const s = seedFor(x, z, salt);
    if (makeRng(s)() < 0.6) return s;
  }
  return seedFor(x, z, 7);
}
function seedWithoutFarm(x: number, z: number) {
  for (let salt = 7; salt < 200; salt++) {
    const s = seedFor(x, z, salt);
    if (makeRng(s)() >= 0.6) return s;
  }
  return seedFor(x, z, 7);
}

export interface IntroTile { x: number; z: number; built: BuiltTile; order: number }

export function buildIntroBoard(): IntroTile[] {
  return LAYOUT.map((s) => {
    const edges = [...s.e].map((c) => E[c]) as [Edge, Edge, Edge, Edge];
    const bare = s.e === 'mmmm' && !s.center && !s.hopGarden;
    const seed = bare ? (s.field ? seedWithFarm(s.x, s.z) : seedWithoutFarm(s.x, s.z)) : seedFor(s.x, s.z, 11);
    const built = buildTile({
      edges, center: s.center ?? 'none', banner: s.banner, seed,
      waterfalls: s.waterfalls, beerGarden: s.beerGarden, hopGarden: s.hopGarden,
    });
    const [wx, wz] = at(s.x, s.z);
    // Tiles nearer the start of the story settle first when the overview builds.
    return { x: wx, z: wz, built, order: s.x + s.z };
  });
}

export function disposeIntroBoard(tiles: IntroTile[]) {
  for (const t of tiles) {
    t.built.geometry.dispose();
    t.built.water?.dispose();
  }
}

export const BOARD_EXTENT = (GRID * TILE) / 2;
