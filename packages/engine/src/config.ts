/**
 * Game configuration. Every number the rules use lives here, so a custom game is just a different config.
 * Modules and draft rules are functions that edit a config, and declare what they conflict with.
 */
import { ACTION_DECK, ALL_TILES, BASE_DECK, BEER_DECK, HOP_DECK, MARKET_DECK, RIVER_DECK, type DeckEntry } from './content/base';
import type { TileDef } from './tiles';

export interface ScoringConfig {
  road: { perTile: number; incompletePerTile: number; /** Roads at least this long score double (0 = off). */ doubleFrom: number };
  town: { perTile: number; perBanner: number; incompletePerTile: number; incompletePerBanner: number; beerGardenPerTile: number };
  monastery: { complete: number; incompletePerTile: number; hopGardenBonus: number };
  /** Fields (meadows): Wanderers lying in a field score per completed town it touches, at game end. */
  meadow: { enabled: boolean; perTown: number };
  market: { enabled: boolean; mostOfGood: number };
}

export interface GameConfig {
  players: number;
  tiles: Record<string, TileDef>;
  deck: DeckEntry[];
  startTile: string;
  /** Pieces per player, by type. Grand Wanderers count double for majority. */
  pieces: { wanderer: number; grand: number };
  scoring: ScoringConfig;
  turn: {
    /** Tiles drawn into the hand each turn (Double Draw = 2). */
    handSize: number;
    /** Face-up tiles to choose from (Open Market = 3). */
    market: number;
    actionHandSize: number;
    /** Turn order flips every N placed tiles (0 = never). */
    reverseEvery: number;
  };
  end: { targetScore: number; turnLimit: number };
  rules: {
    returnPieces: boolean;
    riverFirst: boolean;
    actions: boolean;
  };
  /** Deck size cap and multiplier, applied after modules add their tiles. */
  deckLimit: number;
  deckMultiplier: number;
  actionMultiplier: number;
  modules: string[];
  draftRules: string[];
}

export const DEFAULT_SCORING: ScoringConfig = {
  road: { perTile: 1, incompletePerTile: 1, doubleFrom: 0 },
  town: { perTile: 2, perBanner: 2, incompletePerTile: 1, incompletePerBanner: 1, beerGardenPerTile: 0 },
  monastery: { complete: 9, incompletePerTile: 1, hopGardenBonus: 0 },
  meadow: { enabled: true, perTown: 3 },
  market: { enabled: false, mostOfGood: 10 },
};

export function baseConfig(players: number): GameConfig {
  return {
    players,
    tiles: Object.fromEntries(ALL_TILES.map((t) => [t.id, t])),
    deck: BASE_DECK.map((d) => ({ ...d })),
    startTile: 'castle',
    pieces: { wanderer: 7, grand: 0 },
    scoring: structuredClone(DEFAULT_SCORING),
    turn: { handSize: 1, market: 0, actionHandSize: 2, reverseEvery: 0 },
    end: { targetScore: 0, turnLimit: 0 },
    rules: { returnPieces: true, riverFirst: false, actions: false },
    deckLimit: 0,
    deckMultiplier: 1,
    actionMultiplier: 1,
    modules: [],
    draftRules: [],
  };
}

export interface RuleLike {
  id: string;
  name: string;
  description: string;
  conflicts: string[];
  apply: (c: GameConfig) => void;
}

const addDeck = (c: GameConfig, entries: DeckEntry[]) => entries.forEach((e) => c.deck.push({ ...e }));

export const MODULES: RuleLike[] = [
  { id: 'riverlands', name: 'Riverlands', description: '10 river tiles laid first, starting from the lake.', conflicts: [],
    apply: (c) => { addDeck(c, RIVER_DECK); c.rules.riverFirst = true; } },
  { id: 'hopGardens', name: 'Hop Gardens', description: 'A completed monastery scores +1 per hop garden in its 3 × 3.', conflicts: [],
    apply: (c) => { addDeck(c, HOP_DECK); c.scoring.monastery.hopGardenBonus = 1; } },
  { id: 'beerGardens', name: 'Beer Gardens', description: 'A completed town with a beer garden scores +1 per tile; incomplete ones score 0.', conflicts: [],
    apply: (c) => { addDeck(c, BEER_DECK); c.scoring.town.beerGardenPerTile = 1; } },
  { id: 'grandWanderer', name: 'Grand Wanderer', description: 'One large Wanderer per player that counts as two.', conflicts: [],
    apply: (c) => { c.pieces.grand = 1; } },
  { id: 'marketDay', name: 'Market Day', description: 'Goods on town tiles; most of each good at game end scores +10.', conflicts: [],
    apply: (c) => { addDeck(c, MARKET_DECK); c.scoring.market.enabled = true; } },
  { id: 'actions', name: 'Action tiles', description: 'Skip, Reverse, Draw Two, Lose a Turn, Send Home and Steal tiles in the deck.', conflicts: ['peacefulValley'],
    apply: (c) => { addDeck(c, ACTION_DECK); c.rules.actions = true; } },
];

export const DRAFT_RULES: RuleLike[] = [
  { id: 'bigTowns', name: 'Big Towns', description: 'Completed towns score 3 per tile.', conflicts: ['townTax'], apply: (c) => { c.scoring.town.perTile = 3; } },
  { id: 'townTax', name: 'Town Tax', description: 'Completed towns score 1 per tile.', conflicts: ['bigTowns'], apply: (c) => { c.scoring.town.perTile = 1; } },
  { id: 'longRoads', name: 'Long Roads', description: 'Roads of 5 or more tiles score double.', conflicts: [], apply: (c) => { c.scoring.road.doubleFrom = 5; } },
  { id: 'tollRoads', name: 'Toll Roads', description: 'Roads score 2 per tile, but 0 if incomplete at game end.', conflicts: [],
    apply: (c) => { c.scoring.road.perTile = 2; c.scoring.road.incompletePerTile = 0; } },
  { id: 'pilgrims', name: 'Pilgrims', description: 'Completed monasteries score 12.', conflicts: [], apply: (c) => { c.scoring.monastery.complete = 12; } },
  { id: 'crowdedValley', name: 'Crowded Valley', description: '5 Wanderers per player.', conflicts: ['bigCrew'], apply: (c) => { c.pieces.wanderer = 5; } },
  { id: 'bigCrew', name: 'Big Crew', description: '9 Wanderers per player.', conflicts: ['crowdedValley'], apply: (c) => { c.pieces.wanderer = 9; } },
  { id: 'openMarket', name: 'Open Market', description: 'Three tiles lie face up; take one or draw blind.', conflicts: ['doubleDraw'], apply: (c) => { c.turn.market = 3; } },
  { id: 'doubleDraw', name: 'Double Draw', description: 'Draw two tiles, place one, put the other on the bottom.', conflicts: ['openMarket'], apply: (c) => { c.turn.handSize = 2; } },
  { id: 'homebodies', name: 'Homebodies', description: 'Wanderers stay on scored features instead of returning.', conflicts: [], apply: (c) => { c.rules.returnPieces = false; } },
  { id: 'quickGame', name: 'Quick Game', description: 'Only 40 tiles in the deck.', conflicts: ['marathon'], apply: (c) => { c.deckLimit = 40; } },
  { id: 'marathon', name: 'Marathon', description: 'The deck is doubled.', conflicts: ['quickGame'], apply: (c) => { c.deckMultiplier = 2; } },
  { id: 'firstTo100', name: 'First to 100', description: 'The game ends as soon as someone reaches 100 points.', conflicts: [], apply: (c) => { c.end.targetScore = 100; } },
  { id: 'harvest', name: 'Bumper Harvest', description: 'Fields score 4 per completed town instead of 3.', conflicts: ['noFields'], apply: (c) => { c.scoring.meadow.perTown = 4; } },
  { id: 'noFields', name: 'Town Folk', description: 'No Wanderers in fields; fields never score.', conflicts: ['harvest'], apply: (c) => { c.scoring.meadow.enabled = false; } },
  { id: 'proudBanners', name: 'Proud Banners', description: 'Banners are worth 4.', conflicts: [], apply: (c) => { c.scoring.town.perBanner = 4; } },
  { id: 'chaos', name: 'Chaos', description: 'Action tiles appear twice as often.', conflicts: ['peacefulValley'], apply: (c) => { c.actionMultiplier = 2; } },
  { id: 'peacefulValley', name: 'Peaceful Valley', description: 'No action tiles.', conflicts: ['chaos', 'actions'], apply: (c) => { c.rules.actions = false; } },
  { id: 'turnabout', name: 'Turnabout', description: 'Turn order reverses every 10 tiles.', conflicts: [], apply: (c) => { c.turn.reverseEvery = 10; } },
];

export const findRule = (id: string) => MODULES.find((m) => m.id === id) ?? DRAFT_RULES.find((r) => r.id === id);

export interface Conflict { a: string; b: string; reason: string }

/** Every pair in the selection that conflicts, so the host can pick which one stays. */
export function findConflicts(ids: string[]): Conflict[] {
  const out: Conflict[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = findRule(ids[i]), b = findRule(ids[j]);
      if (!a || !b) continue;
      if (a.conflicts.includes(b.id) || b.conflicts.includes(a.id)) out.push({ a: a.id, b: b.id, reason: `${a.name} and ${b.name} can't both be on.` });
    }
  }
  return out;
}

export interface GameOptions {
  players: number;
  modules?: string[];
  rules?: string[];
  /** Direct edits to the finished config, for the custom game builder. */
  customize?: (c: GameConfig) => void;
}

/** Builds a config from modules, draft rules and custom edits. Throws on conflicts or bad input. */
export function buildConfig(o: GameOptions): GameConfig {
  if (o.players < 2 || o.players > 8) throw new Error('Players must be 2 to 8.');
  const c = baseConfig(o.players);
  const ids = [...(o.modules ?? []), ...(o.rules ?? [])];
  const conflicts = findConflicts(ids);
  if (conflicts.length) throw new Error(conflicts.map((x) => x.reason).join(' '));
  for (const id of ids) {
    const r = findRule(id);
    if (!r) throw new Error(`Unknown rule or module: ${id}`);
    r.apply(c);
  }
  c.modules = o.modules ?? [];
  c.draftRules = o.rules ?? [];
  o.customize?.(c);
  return normalize(c);
}

/** Applies minimums and multipliers so the game can always finish. */
export function normalize(c: GameConfig): GameConfig {
  c.pieces.wanderer = Math.max(1, Math.floor(c.pieces.wanderer));
  c.pieces.grand = Math.max(0, Math.floor(c.pieces.grand));
  // Fields worth nothing are switched off, so nobody can strand a Wanderer in one.
  if (c.scoring.meadow.perTown <= 0) c.scoring.meadow.enabled = false;
  for (const d of c.deck) d.count = Math.max(0, Math.floor(d.count));
  if (!c.rules.actions) c.deck = c.deck.filter((d) => !c.tiles[d.tileId]?.action);
  else for (const d of c.deck) if (c.tiles[d.tileId]?.action) d.count *= c.actionMultiplier;
  if (c.deckMultiplier !== 1) for (const d of c.deck) if (!c.tiles[d.tileId]?.action) d.count *= c.deckMultiplier;
  const landscape = c.deck.filter((d) => !c.tiles[d.tileId]?.action && !isRiver(c, d.tileId)).reduce((s, d) => s + d.count, 0);
  if (landscape < 10) throw new Error('The deck needs at least 10 landscape tiles.');
  if (c.deckLimit && landscape > c.deckLimit) {
    // Trim every tile type in proportion, keeping at least one of each that had any.
    const k = c.deckLimit / landscape;
    for (const d of c.deck) {
      if (c.tiles[d.tileId]?.action || isRiver(c, d.tileId)) continue;
      d.count = d.count ? Math.max(1, Math.round(d.count * k)) : 0;
    }
  }
  if (!Object.values(c.tiles).length || !c.tiles[c.startTile]) throw new Error('Missing start tile.');
  return c;
}

/**
 * Brings a config saved by an older version up to today's rules. Fields are part of every game
 * now, so a game saved before that turns them on, unless a player drafted Town Folk or the
 * builder set them to Off. Adding a scoring option never makes a saved move illegal, so the log still replays.
 */
export function upgradeConfig(c: GameConfig): GameConfig {
  const m = (c.scoring.meadow ??= { ...DEFAULT_SCORING.meadow });
  if (typeof m.perTown !== 'number') m.perTown = DEFAULT_SCORING.meadow.perTown;
  // A builder that set fields to "Off" (0 per town) meant it; anything else plays with fields.
  if (m.perTown > 0 && !(c.draftRules ?? []).includes('noFields')) m.enabled = true;
  return c;
}

export const isRiver = (c: GameConfig, id: string) => c.tiles[id]?.edges.includes('river') ?? false;

export const PRESETS: Record<string, GameOptions & { name: string; description: string }> = {
  classic: { name: 'Classic', description: 'The base set, 7 Wanderers each.', players: 4 },
  quick: { name: 'Quick 20-minute', description: '40 tiles, first to 50 wins.', players: 3, rules: ['quickGame'], customize: (c) => { c.end.targetScore = 50; } },
  bigTable: { name: 'Big table, 8 players', description: 'Doubled deck with the river and hop gardens.', players: 8, modules: ['riverlands', 'hopGardens'], rules: ['marathon'] },
  party: { name: 'Party night', description: 'Action tiles, beer gardens and market day.', players: 4, modules: ['actions', 'beerGardens', 'marketDay'] },
};

// ---------- game specs (plain data, safe to send over the network) ----------

/** A custom game as plain data: what the builder edits and what the server receives. */
export interface GameSpec {
  players: number;
  modules: string[];
  rules: string[];
  /** Sparse edits: 'deck.<tileId>' or a numeric config path such as 'scoring.town.perTile'. */
  edits: Record<string, number>;
}

const EDIT_ROOTS = ['pieces', 'scoring', 'turn', 'end'];
const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/**
 * Applies builder edits to a config. Only existing numeric fields under pieces, scoring, turn
 * and end, and deck counts of known tiles, can change, so a spec from the network can't reach
 * anything else.
 */
export function applyEdits(c: GameConfig, edits: Record<string, number>) {
  for (const [k, raw] of Object.entries(edits ?? {})) {
    const v = Number(raw);
    if (!Number.isFinite(v)) continue;
    const n = Math.max(0, Math.min(1000, Math.round(v)));
    if (k.startsWith('deck.')) {
      const id = k.slice(5);
      if (!Object.prototype.hasOwnProperty.call(c.tiles, id) || id === c.startTile) continue;
      const e = c.deck.find((d) => d.tileId === id);
      if (e) e.count = Math.min(n, 50); else c.deck.push({ tileId: id, count: Math.min(n, 50) });
      continue;
    }
    const ks = k.split('.');
    if (!EDIT_ROOTS.includes(ks[0]) || ks.some((x) => BLOCKED_KEYS.has(x))) continue;
    const last = ks.pop()!;
    let t: any = c; // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const x of ks) { t = Object.prototype.hasOwnProperty.call(t, x) ? t[x] : undefined; if (!t || typeof t !== 'object') break; }
    if (t && typeof t === 'object' && Object.prototype.hasOwnProperty.call(t, last) && typeof t[last] === 'number') t[last] = n;
  }
}

/** Engine options for a spec, with its edits as the custom step. */
export function optionsFromSpec(spec: GameSpec): GameOptions {
  return {
    players: spec.players,
    modules: [...(spec.modules ?? [])],
    rules: [...(spec.rules ?? [])],
    customize: (c) => applyEdits(c, spec.edits ?? {}),
  };
}

/** Builds a config from a spec. Throws on bad input, like `buildConfig`. */
export const configFromSpec = (spec: GameSpec) => buildConfig(optionsFromSpec(spec));
