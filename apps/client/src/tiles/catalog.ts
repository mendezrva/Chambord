/**
 * Phase 1 tile catalog. In Phase 2 this moves into a content pack (plain data),
 * and the rules engine reads it. Edges are listed clockwise: north, east, south, west.
 */
export type Edge = 'meadow' | 'road' | 'town' | 'river';
export type Center = 'none' | 'abbey' | 'castle' | 'lake' | 'shrine' | 'maypole';

export interface TileType {
  id: string;
  name: string;
  edges: [Edge, Edge, Edge, Edge];
  center: Center;
  /** Town banner: worth bonus points when the town is completed. */
  banner?: boolean;
  /** Relative frequency in the random demo board. */
  weight: number;
}

export const START_TILE: TileType = {
  id: 'castle',
  name: 'Burg Glockenfels',
  edges: ['meadow', 'road', 'meadow', 'road'],
  center: 'castle',
  weight: 0,
};

export const RIVER_TILES: TileType[] = [
  { id: 'river-spring', name: 'Mountain lake', edges: ['meadow', 'meadow', 'meadow', 'river'], center: 'lake', weight: 0 },
  { id: 'river-straight', name: 'River', edges: ['meadow', 'river', 'meadow', 'river'], center: 'none', weight: 3 },
  { id: 'river-bend', name: 'River bend', edges: ['meadow', 'meadow', 'river', 'river'], center: 'none', weight: 2 },
  { id: 'river-bridge', name: 'River with bridge', edges: ['road', 'river', 'road', 'river'], center: 'none', weight: 1 },
];

export const LAND_TILES: TileType[] = [
  { id: 'meadow', name: 'Forest meadow', edges: ['meadow', 'meadow', 'meadow', 'meadow'], center: 'none', weight: 2 },
  { id: 'abbey', name: 'Monastery', edges: ['meadow', 'meadow', 'meadow', 'meadow'], center: 'abbey', weight: 3 },
  { id: 'abbey-road', name: 'Monastery with lane', edges: ['meadow', 'meadow', 'road', 'meadow'], center: 'abbey', weight: 2 },
  { id: 'road', name: 'Road', edges: ['road', 'meadow', 'road', 'meadow'], center: 'none', weight: 7 },
  { id: 'road-bend', name: 'Road bend', edges: ['meadow', 'meadow', 'road', 'road'], center: 'none', weight: 8 },
  { id: 'junction-3', name: 'Junction', edges: ['meadow', 'road', 'road', 'road'], center: 'shrine', weight: 4 },
  { id: 'junction-4', name: 'Crossroads', edges: ['road', 'road', 'road', 'road'], center: 'shrine', weight: 1 },
  { id: 'town-edge', name: 'Town edge', edges: ['town', 'meadow', 'meadow', 'meadow'], center: 'none', weight: 5 },
  { id: 'town-edge-road', name: 'Town edge with road', edges: ['town', 'road', 'meadow', 'road'], center: 'none', weight: 4 },
  { id: 'town-edge-bend', name: 'Town edge with bend', edges: ['town', 'meadow', 'road', 'road'], center: 'none', weight: 3 },
  { id: 'town-corner', name: 'Town corner', edges: ['town', 'meadow', 'meadow', 'town'], center: 'none', weight: 4 },
  { id: 'town-corner-banner', name: 'Town corner with banner', edges: ['town', 'meadow', 'meadow', 'town'], center: 'none', banner: true, weight: 2 },
  { id: 'town-corner-road', name: 'Town corner with road', edges: ['town', 'road', 'road', 'town'], center: 'none', weight: 3 },
  { id: 'town-street', name: 'Town street', edges: ['meadow', 'town', 'meadow', 'town'], center: 'none', weight: 2 },
  { id: 'town-three', name: 'Town square', edges: ['town', 'town', 'meadow', 'town'], center: 'none', weight: 3 },
  { id: 'town-three-gate', name: 'Town gate', edges: ['town', 'town', 'road', 'town'], center: 'none', weight: 2 },
  { id: 'town-full', name: 'Town center with maypole', edges: ['town', 'town', 'town', 'town'], center: 'maypole', banner: true, weight: 1 },
];

/** Rotate edges clockwise by quarter turns. */
export function rotateEdges(edges: readonly Edge[], turns: number): [Edge, Edge, Edge, Edge] {
  const t = ((turns % 4) + 4) % 4;
  return [0, 1, 2, 3].map((i) => edges[(i - t + 4) % 4]) as [Edge, Edge, Edge, Edge];
}
