/**
 * Glockenfels palette. Every colour in the world comes from here, so the look stays consistent.
 * Low-poly shading adds a small random variation per triangle on top of these.
 */
export const PALETTE = {
  meadow: 0x6aa84f,
  grassRim: 0x4f8a3c,
  soil: 0x7a5236,
  rockBand: 0x8d7360,
  water: 0x3fa7bd,
  waterfall: 0x7cc9d8,
  foam: 0xf2f7f8,
  riverbank: 0xb59c6d,
  road: 0xe0cfa4,
  roadEdge: 0xb89c6c,
  bridge: 0x9a6a42,
  plaza: 0xd7ccb4,
  townWall: 0xece6d8,
  whitewash: 0xf5f1e6,
  facades: [0xf5f1e6, 0xf5f1e6, 0xf2e3b3, 0xf0d6c8, 0xdcebd6, 0xe4e0f0] as const,
  roofs: [0xc0472f, 0xb03f2a, 0xc95a33, 0x8a4c35, 0x4f6a8a] as const,
  timber: 0x4a3222,
  stone: 0xb8b2a6,
  abbeyRoof: 0x9b3b2a,
  copper: 0x4e9e82,
  gold: 0xe0b84a,
  hops: 0x7fbf4d,
  habit: 0x6b4a33,
  skin: 0xf0cfae,
  crag: 0xc9c0ae,
  castleWall: 0xf7f4ec,
  slate: 0x4b6283,
  bavariaBlue: 0x2f74c0,
  trunk: 0x6b4630,
  pines: [0x2f7d4a, 0x2a6e43, 0x3a8a52] as const,
  leaves: [0x6fb54a, 0x5aa143, 0x8cc456] as const,
  rock: 0xb9b6ad,
  sky: 0xdde9f3,
  mountain: 0x9fb0c0,
  snow: 0xf4f7fa,
  cloud: 0xffffff,
} as const;

/** Player colours: distinct in hue and lightness so they stay readable for colour-blind players. */
export const PLAYER_COLORS = [0x2f74c0, 0xd9482b, 0xf2b630, 0x2e9b6b, 0x8a52c4, 0x222831, 0xf2f2f2, 0xe27fb0] as const;
