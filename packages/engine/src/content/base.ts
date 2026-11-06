import type { TileDef } from '../tiles';

export interface DeckEntry { tileId: string; count: number }

const t = (id: string, name: string, edges: TileDef['edges'], center: TileDef['center'] = 'none', extra: Partial<TileDef> = {}): TileDef =>
  ({ id, name, edges, center, ...extra });

/** The Glockenfels base set, from docs/rules-spec.md. */
export const BASE_TILES: TileDef[] = [
  t('castle', 'Burg Glockenfels', ['meadow', 'road', 'meadow', 'road'], 'castle'),
  t('meadow', 'Forest meadow', ['meadow', 'meadow', 'meadow', 'meadow']),
  t('monastery', 'Monastery', ['meadow', 'meadow', 'meadow', 'meadow'], 'monastery'),
  t('monastery-lane', 'Monastery with lane', ['meadow', 'meadow', 'road', 'meadow'], 'monastery'),
  t('road', 'Road', ['road', 'meadow', 'road', 'meadow']),
  t('road-bend', 'Road bend', ['meadow', 'meadow', 'road', 'road']),
  t('junction', 'Junction', ['meadow', 'road', 'road', 'road'], 'shrine'),
  t('crossroads', 'Crossroads', ['road', 'road', 'road', 'road'], 'shrine'),
  t('town-edge', 'Town edge', ['town', 'meadow', 'meadow', 'meadow']),
  t('town-edge-road', 'Town edge with road', ['town', 'road', 'meadow', 'road']),
  t('town-edge-bend', 'Town edge with bend', ['town', 'meadow', 'road', 'road']),
  t('town-corner', 'Town corner', ['town', 'meadow', 'meadow', 'town']),
  t('town-corner-banner', 'Town corner with banner', ['town', 'meadow', 'meadow', 'town'], 'none', { banner: 1 }),
  t('town-corner-road', 'Town corner with road', ['town', 'road', 'road', 'town']),
  t('town-street', 'Town street', ['meadow', 'town', 'meadow', 'town']),
  t('town-street-banner', 'Town street with banner', ['meadow', 'town', 'meadow', 'town'], 'none', { banner: 1 }),
  t('town-square', 'Town square', ['town', 'town', 'meadow', 'town']),
  t('town-square-banner', 'Town square with banner', ['town', 'town', 'meadow', 'town'], 'none', { banner: 1 }),
  t('town-gate', 'Town gate', ['town', 'town', 'road', 'town']),
  t('town-gate-banner', 'Town gate with banner', ['town', 'town', 'road', 'town'], 'none', { banner: 1 }),
  t('town-centre', 'Town centre with maypole', ['town', 'town', 'town', 'town'], 'maypole', { banner: 1 }),
];

export const BASE_DECK: DeckEntry[] = [
  { tileId: 'meadow', count: 3 },
  { tileId: 'monastery', count: 4 },
  { tileId: 'monastery-lane', count: 2 },
  { tileId: 'road', count: 8 },
  { tileId: 'road-bend', count: 9 },
  { tileId: 'junction', count: 4 },
  { tileId: 'crossroads', count: 1 },
  { tileId: 'town-edge', count: 5 },
  { tileId: 'town-edge-road', count: 4 },
  { tileId: 'town-edge-bend', count: 3 },
  { tileId: 'town-corner', count: 3 },
  { tileId: 'town-corner-banner', count: 2 },
  { tileId: 'town-corner-road', count: 3 },
  { tileId: 'town-street', count: 3 },
  { tileId: 'town-street-banner', count: 1 },
  { tileId: 'town-square', count: 3 },
  { tileId: 'town-square-banner', count: 1 },
  { tileId: 'town-gate', count: 2 },
  { tileId: 'town-gate-banner', count: 1 },
  { tileId: 'town-centre', count: 1 },
];

/** Riverlands module: the river is laid first, starting at the lake. */
export const RIVER_TILES: TileDef[] = [
  t('lake', 'Lake', ['meadow', 'meadow', 'river', 'meadow'], 'lake'),
  t('river', 'River', ['river', 'meadow', 'river', 'meadow']),
  t('river-bend', 'River bend', ['meadow', 'meadow', 'river', 'river']),
  t('river-bridge', 'River bridge', ['river', 'road', 'river', 'road']),
  t('river-town', 'Riverside town', ['town', 'river', 'meadow', 'river']),
  t('river-monastery', 'Riverside monastery', ['river', 'meadow', 'river', 'meadow'], 'monastery'),
];
export const RIVER_DECK: DeckEntry[] = [
  { tileId: 'lake', count: 1 },
  { tileId: 'river', count: 3 },
  { tileId: 'river-bend', count: 3 },
  { tileId: 'river-bridge', count: 1 },
  { tileId: 'river-town', count: 1 },
  { tileId: 'river-monastery', count: 1 },
];

export const HOP_TILES: TileDef[] = [
  t('hop-meadow', 'Hop garden', ['meadow', 'meadow', 'meadow', 'meadow'], 'none', { hopGarden: true }),
  t('hop-road', 'Hop garden by the road', ['road', 'meadow', 'road', 'meadow'], 'none', { hopGarden: true }),
];
export const HOP_DECK: DeckEntry[] = [
  { tileId: 'hop-meadow', count: 4 },
  { tileId: 'hop-road', count: 2 },
];

export const BEER_TILES: TileDef[] = [
  t('beer-edge', 'Town edge with beer garden', ['town', 'meadow', 'meadow', 'meadow'], 'none', { beerGarden: true }),
  t('beer-corner', 'Town corner with beer garden', ['town', 'meadow', 'meadow', 'town'], 'none', { beerGarden: true }),
  t('beer-square', 'Town square with beer garden', ['town', 'town', 'meadow', 'town'], 'none', { beerGarden: true }),
];
export const BEER_DECK: DeckEntry[] = [
  { tileId: 'beer-edge', count: 3 },
  { tileId: 'beer-corner', count: 2 },
  { tileId: 'beer-square', count: 1 },
];

export const MARKET_TILES: TileDef[] = [
  t('market-pretzels', 'Town edge, pretzels', ['town', 'meadow', 'meadow', 'meadow'], 'none', { goods: 'pretzels' }),
  t('market-hops', 'Town corner, hops', ['town', 'meadow', 'meadow', 'town'], 'none', { goods: 'hops' }),
  t('market-timber', 'Town street, timber', ['meadow', 'town', 'meadow', 'town'], 'none', { goods: 'timber' }),
  t('market-pretzels-road', 'Town edge with road, pretzels', ['town', 'road', 'meadow', 'road'], 'none', { goods: 'pretzels' }),
];
export const MARKET_DECK: DeckEntry[] = [
  { tileId: 'market-pretzels', count: 3 },
  { tileId: 'market-hops', count: 3 },
  { tileId: 'market-timber', count: 3 },
  { tileId: 'market-pretzels-road', count: 3 },
];

export const ACTION_TILES: TileDef[] = [
  t('action-skip', 'Skip', ['meadow', 'meadow', 'meadow', 'meadow'], 'none', { action: 'skip' }),
  t('action-reverse', 'Reverse', ['meadow', 'meadow', 'meadow', 'meadow'], 'none', { action: 'reverse' }),
  t('action-draw-two', 'Draw Two', ['meadow', 'meadow', 'meadow', 'meadow'], 'none', { action: 'drawTwo' }),
  t('action-lose-turn', 'Lose a Turn', ['meadow', 'meadow', 'meadow', 'meadow'], 'none', { action: 'loseTurn' }),
  t('action-send-home', 'Send Home', ['meadow', 'meadow', 'meadow', 'meadow'], 'none', { action: 'sendHome' }),
  t('action-steal', 'Steal', ['meadow', 'meadow', 'meadow', 'meadow'], 'none', { action: 'steal' }),
];
export const ACTION_DECK: DeckEntry[] = [
  { tileId: 'action-skip', count: 3 },
  { tileId: 'action-reverse', count: 3 },
  { tileId: 'action-draw-two', count: 2 },
  { tileId: 'action-lose-turn', count: 2 },
  { tileId: 'action-send-home', count: 2 },
  { tileId: 'action-steal', count: 2 },
];

export const ALL_TILES: TileDef[] = [...BASE_TILES, ...RIVER_TILES, ...HOP_TILES, ...BEER_TILES, ...MARKET_TILES, ...ACTION_TILES];
