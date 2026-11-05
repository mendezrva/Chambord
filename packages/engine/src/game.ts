/**
 * The rules engine: board, feature graph, turn flow, scoring and action tiles.
 * State is plain data (JSON-safe) and every change goes through `apply`, so a seed plus the
 * action log replays any game exactly.
 */
import type { GameConfig } from './config';
import { isRiver } from './config';
import { analyze, DX, DZ, OPPOSITE, oppositeSlot, type ActionKind, type FeatureKind, type Good, type TileAnalysis } from './tiles';

export type PieceType = 'wanderer' | 'grand';
export const GOODS: Good[] = ['pretzels', 'hops', 'timber'];

export interface PlacedTile {
  key: string;
  x: number;
  z: number;
  tileId: string;
  rot: number;
  order: number;
  placedBy: number;
  /** Global feature id for each local feature of the tile. */
  featureIds: number[];
}

export interface Piece { player: number; type: PieceType; strength: number; tileKey: string; local: number }

export interface Feature {
  id: number;
  kind: FeatureKind;
  tiles: string[];
  /** Road and town: edge ends not yet joined to a neighbour. Complete at 0. */
  open: number;
  banner: number;
  beerGarden: boolean;
  goods: Good[];
  pieces: Piece[];
  scored: boolean;
  /** Meadow: ids of towns it touches (resolve with `find`). */
  touchesTowns: number[];
}

export interface Player {
  id: number;
  name: string;
  score: number;
  pieces: Record<PieceType, number>;
  actions: ActionKind[];
  goods: Record<Good, number>;
  skip: boolean;
  justSkipped: boolean;
  drawTwo: boolean;
}

export type Step = 'action' | 'draw' | 'place' | 'claim' | 'ended';

export type Action =
  | { type: 'pass' }
  | { type: 'playAction'; action: ActionKind; target?: number; piece?: { tileKey: string; local: number } }
  | { type: 'draw'; market?: number }
  | { type: 'place'; hand: number; x: number; z: number; rot: number }
  | { type: 'claim'; local: number; piece: PieceType };

export type GameEvent =
  | { type: 'placed'; tileKey: string; player: number }
  | { type: 'discarded'; tileId: string; reason: 'unplayable' | 'handFull' }
  | { type: 'claimed'; tileKey: string; local: number; player: number; piece: PieceType }
  | { type: 'scored'; featureId: number; kind: FeatureKind; players: number[]; points: number; complete: boolean; tiles: string[] }
  | { type: 'returned'; piece: Piece }
  | { type: 'action'; player: number; action: ActionKind; target?: number }
  | { type: 'skipped'; player: number }
  | { type: 'goods'; player: number; good: Good }
  | { type: 'ended'; winners: number[] };

export interface GameState {
  config: GameConfig;
  seed: number;
  rngA: number;
  board: Record<string, PlacedTile>;
  features: Feature[];
  parent: number[];
  deck: string[];
  discard: string[];
  market: string[];
  players: Player[];
  current: number;
  direction: 1 | -1;
  turn: number;
  placedCount: number;
  step: Step;
  hand: string[];
  mustPlace: number;
  noClaim: boolean;
  lastPlaced: string | null;
  river: { head: { x: number; z: number; edge: number } | null; lastBend: number; done: boolean };
  log: Action[];
  events: GameEvent[];
  winners: number[] | null;
}

export const keyOf = (x: number, z: number) => `${x},${z}`;

// ---------- random ----------

function rand(s: GameState) {
  s.rngA = (s.rngA + 0x6d2b79f5) >>> 0;
  let t = s.rngA;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function shuffleInPlace<T>(s: GameState, a: T[]) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- feature graph (union-find) ----------

export function find(s: GameState, id: number): number {
  let r = id;
  while (s.parent[r] !== r) r = s.parent[r];
  while (s.parent[id] !== r) { const n = s.parent[id]; s.parent[id] = r; id = n; }
  return r;
}
export const featureOf = (s: GameState, id: number) => s.features[find(s, id)];

function union(s: GameState, a: number, b: number) {
  const ra = find(s, a), rb = find(s, b);
  if (ra === rb) return ra;
  const [keep, drop] = s.features[ra].tiles.length >= s.features[rb].tiles.length ? [ra, rb] : [rb, ra];
  const K = s.features[keep], D = s.features[drop];
  s.parent[drop] = keep;
  for (const t of D.tiles) if (!K.tiles.includes(t)) K.tiles.push(t);
  K.open += D.open;
  K.banner += D.banner;
  K.beerGarden ||= D.beerGarden;
  K.goods.push(...D.goods);
  K.pieces.push(...D.pieces);
  K.scored &&= D.scored;
  K.touchesTowns.push(...D.touchesTowns);
  return keep;
}

export const tileAnalysis = (s: GameState, t: PlacedTile): TileAnalysis => analyze(s.config.tiles[t.tileId], t.rot);
export const tileAt = (s: GameState, x: number, z: number) => s.board[keyOf(x, z)];

// ---------- setup ----------

export function createGame(config: GameConfig, seed: number, names?: string[]): GameState {
  const s: GameState = {
    config, seed, rngA: seed >>> 0,
    board: {}, features: [], parent: [],
    deck: [], discard: [], market: [],
    players: Array.from({ length: config.players }, (_, i) => ({
      id: i, name: names?.[i] ?? `Player ${i + 1}`, score: 0,
      pieces: { wanderer: config.pieces.wanderer, grand: config.pieces.grand },
      actions: [], goods: { pretzels: 0, hops: 0, timber: 0 }, skip: false, justSkipped: false, drawTwo: false,
    })),
    current: 0, direction: 1, turn: 0, placedCount: 0,
    step: 'place', hand: [], mustPlace: 1, noClaim: false, lastPlaced: null,
    river: { head: null, lastBend: 0, done: !config.rules.riverFirst },
    log: [], events: [], winners: null,
  };
  // Deck: the river first (lake on top), then everything else shuffled.
  const rivers: string[] = [], rest: string[] = [];
  for (const d of config.deck) for (let i = 0; i < d.count; i++) (isRiver(config, d.tileId) ? rivers : rest).push(d.tileId);
  const lakeIdx = rivers.indexOf('lake');
  const lake = lakeIdx >= 0 ? rivers.splice(lakeIdx, 1) : [];
  shuffleInPlace(s, rivers);
  shuffleInPlace(s, rest);
  // Drawing pops from the end, so the top of the deck is the last element.
  s.deck = [...rest, ...rivers, ...lake];
  placeTile(s, config.startTile, 0, 0, 0, -1);
  fillMarket(s);
  beginTurn(s);
  return s;
}

// ---------- placement ----------

export interface Placement { x: number; z: number; rot: number }

function riverCheck(s: GameState, a: TileAnalysis, x: number, z: number): boolean {
  const riverEdges = [0, 1, 2, 3].filter((e) => a.edges[e] === 'river');
  if (!riverEdges.length) return true;
  const head = s.river.head;
  if (!head) {
    // The lake starts the river: anywhere legal, as long as the river's exit points at an empty cell.
    return riverEdges.every((e) => !tileAt(s, x + DX[e], z + DZ[e]));
  }
  if (x !== head.x + DX[head.edge] || z !== head.z + DZ[head.edge]) return false;
  const entry = OPPOSITE[head.edge];
  if (a.edges[entry] !== 'river') return false;
  const exit = riverEdges.find((e) => e !== entry);
  if (exit === undefined) return true;
  if (tileAt(s, x + DX[exit], z + DZ[exit])) return false;
  const bend = exit === OPPOSITE[entry] ? 0 : (exit - entry + 4) % 4 === 1 ? 1 : -1;
  return !(bend !== 0 && bend === s.river.lastBend);
}

export function isLegal(s: GameState, tileId: string, x: number, z: number, rot: number): boolean {
  if (tileAt(s, x, z)) return false;
  const def = s.config.tiles[tileId];
  if (!def || def.action) return false;
  const a = analyze(def, rot);
  let neighbours = 0;
  for (let e = 0; e < 4; e++) {
    const n = tileAt(s, x + DX[e], z + DZ[e]);
    if (!n) continue;
    neighbours++;
    if (tileAnalysis(s, n).edges[OPPOSITE[e]] !== a.edges[e]) return false;
  }
  if (!neighbours) return false;
  return riverCheck(s, a, x, z);
}

/** Empty cells next to the board. */
export function frontier(s: GameState): [number, number][] {
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (const t of Object.values(s.board)) {
    for (let e = 0; e < 4; e++) {
      const x = t.x + DX[e], z = t.z + DZ[e], k = keyOf(x, z);
      if (s.board[k] || seen.has(k)) continue;
      seen.add(k);
      out.push([x, z]);
    }
  }
  return out;
}

export function legalPlacements(s: GameState, tileId: string): Placement[] {
  const out: Placement[] = [];
  const def = s.config.tiles[tileId];
  if (!def || def.action) return out;
  // Symmetric tiles need fewer rotations.
  const seen = new Set<string>();
  const rots: number[] = [];
  for (let r = 0; r < 4; r++) {
    const k = analyze(def, r).edges.join();
    if (seen.has(k)) continue;
    seen.add(k);
    rots.push(r);
  }
  for (const [x, z] of frontier(s)) for (const rot of rots) if (isLegal(s, tileId, x, z, rot)) out.push({ x, z, rot });
  return out;
}

function placeTile(s: GameState, tileId: string, x: number, z: number, rot: number, player: number) {
  const key = keyOf(x, z);
  const a = analyze(s.config.tiles[tileId], rot);
  const def = s.config.tiles[tileId];
  const tile: PlacedTile = { key, x, z, tileId, rot, order: Object.keys(s.board).length, placedBy: player, featureIds: [] };
  for (const f of a.features) {
    const id = s.features.length;
    s.parent.push(id);
    s.features.push({
      id, kind: f.kind, tiles: [key], open: f.edges.length, banner: f.banner,
      beerGarden: f.kind === 'town' && !!def.beerGarden, goods: f.kind === 'town' && def.goods ? [def.goods] : [],
      pieces: [], scored: false, touchesTowns: [],
    });
    tile.featureIds.push(id);
  }
  for (const [i, f] of a.features.entries()) if (f.kind === 'meadow') s.features[tile.featureIds[i]].touchesTowns = f.touchesTowns.map((t) => tile.featureIds[t]);
  s.board[key] = tile;
  // Join roads, towns and meadows across each edge.
  for (let e = 0; e < 4; e++) {
    const n = tileAt(s, x + DX[e], z + DZ[e]);
    if (!n) continue;
    const na = tileAnalysis(s, n);
    const li = a.byEdge[e], ni = na.byEdge[OPPOSITE[e]];
    if (li >= 0 && ni >= 0) {
      const r = union(s, tile.featureIds[li], n.featureIds[ni]);
      s.features[r].open -= 2;
    }
    for (const half of [0, 1]) {
      const slot = 2 * e + half;
      const ms = a.bySlot[slot], ns = na.bySlot[oppositeSlot(slot)];
      if (ms >= 0 && ns >= 0) union(s, tile.featureIds[ms], n.featureIds[ns]);
    }
  }
  // River bookkeeping.
  const riverEdges = [0, 1, 2, 3].filter((e) => a.edges[e] === 'river');
  if (riverEdges.length) {
    const head = s.river.head;
    const entry: number = head ? OPPOSITE[head.edge] : -1;
    const exit = riverEdges.find((e) => e !== entry);
    if (exit !== undefined) {
      if (head) s.river.lastBend = exit === OPPOSITE[entry as 0 | 1 | 2 | 3] ? 0 : (exit - entry + 4) % 4 === 1 ? 1 : -1;
      s.river.head = { x, z, edge: exit };
    } else s.river.head = null;
  }
  s.lastPlaced = key;
  s.events.push({ type: 'placed', tileKey: key, player });
  return tile;
}

// ---------- scoring ----------

export const neighbourCount = (s: GameState, t: PlacedTile) => {
  let n = 0;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if ((dx || dz) && tileAt(s, t.x + dx, t.z + dz)) n++;
  return n;
};
const hopGardensAround = (s: GameState, t: PlacedTile) => {
  let n = 0;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const o = tileAt(s, t.x + dx, t.z + dz);
    if (o && s.config.tiles[o.tileId].hopGarden) n++;
  }
  return n;
};

export const isComplete = (s: GameState, f: Feature) =>
  f.kind === 'monastery' ? neighbourCount(s, s.board[f.tiles[0]]) === 8 : f.kind === 'meadow' ? false : f.open === 0;

/** Points a feature is worth now, complete or not. */
export function featureValue(s: GameState, f: Feature, complete: boolean): number {
  const sc = s.config.scoring;
  const n = f.tiles.length;
  switch (f.kind) {
    case 'road': {
      let v = n * (complete ? sc.road.perTile : sc.road.incompletePerTile);
      if (complete && sc.road.doubleFrom && n >= sc.road.doubleFrom) v *= 2;
      return v;
    }
    case 'town': {
      if (complete) return n * (sc.town.perTile + (f.beerGarden ? sc.town.beerGardenPerTile : 0)) + f.banner * sc.town.perBanner;
      if (f.beerGarden && sc.town.beerGardenPerTile) return 0;
      return n * sc.town.incompletePerTile + f.banner * sc.town.incompletePerBanner;
    }
    case 'monastery': {
      const t = s.board[f.tiles[0]];
      if (complete) return sc.monastery.complete + sc.monastery.hopGardenBonus * hopGardensAround(s, t);
      return (neighbourCount(s, t) + 1) * sc.monastery.incompletePerTile;
    }
    case 'meadow': {
      const towns = new Set(f.touchesTowns.map((id) => find(s, id)));
      let done = 0;
      for (const id of towns) if (s.features[id].open === 0) done++;
      return done * sc.meadow.perTown;
    }
  }
}

/** Players holding the majority on a feature (ties all win). */
export function majority(f: Feature): number[] {
  const strength = new Map<number, number>();
  for (const p of f.pieces) strength.set(p.player, (strength.get(p.player) ?? 0) + p.strength);
  let best = 0;
  for (const v of strength.values()) best = Math.max(best, v);
  return best ? [...strength.entries()].filter(([, v]) => v === best).map(([p]) => p).sort() : [];
}

function scoreFeature(s: GameState, f: Feature, complete: boolean) {
  if (f.scored) return;
  f.scored = true;
  const winners = majority(f);
  const points = featureValue(s, f, complete);
  if (winners.length && points) for (const p of winners) s.players[p].score += points;
  if (winners.length) s.events.push({ type: 'scored', featureId: f.id, kind: f.kind, players: winners, points, complete, tiles: f.tiles });
  if (complete && s.config.rules.returnPieces) {
    for (const piece of f.pieces) {
      s.players[piece.player].pieces[piece.type]++;
      s.events.push({ type: 'returned', piece });
    }
    f.pieces = [];
  }
}

function scoreCompleted(s: GameState, placed: PlacedTile) {
  const roots = new Set(placed.featureIds.map((id) => find(s, id)));
  for (const id of roots) {
    const f = s.features[id];
    if ((f.kind === 'road' || f.kind === 'town') && f.open === 0 && !f.scored) {
      if (f.kind === 'town' && s.config.scoring.market.enabled) {
        for (const g of f.goods) { s.players[placed.placedBy].goods[g]++; s.events.push({ type: 'goods', player: placed.placedBy, good: g }); }
      }
      scoreFeature(s, f, true);
    }
  }
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const t = tileAt(s, placed.x + dx, placed.z + dz);
    if (!t) continue;
    const mi = tileAnalysis(s, t).monastery;
    if (mi < 0) continue;
    const f = featureOf(s, t.featureIds[mi]);
    if (!f.scored && neighbourCount(s, t) === 8) scoreFeature(s, f, true);
  }
}

function endGame(s: GameState) {
  if (s.step === 'ended') return;
  s.step = 'ended';
  for (const f of s.features) {
    if (s.parent[f.id] !== f.id || f.scored || !f.pieces.length) continue;
    if (f.kind === 'meadow' && !s.config.scoring.meadow.enabled) continue;
    scoreFeature(s, f, false);
  }
  if (s.config.scoring.market.enabled) {
    for (const g of GOODS) {
      const best = Math.max(...s.players.map((p) => p.goods[g]));
      if (best > 0) for (const p of s.players) if (p.goods[g] === best) p.score += s.config.scoring.market.mostOfGood;
    }
  }
  const top = Math.max(...s.players.map((p) => p.score));
  s.winners = s.players.filter((p) => p.score === top).map((p) => p.id);
  s.events.push({ type: 'ended', winners: s.winners });
}

// ---------- turn flow ----------

const nextPlayer = (s: GameState, from = s.current, steps = 1) => (((from + s.direction * steps) % s.players.length) + s.players.length) % s.players.length;

function beginTurn(s: GameState) {
  if (s.step === 'ended') return;
  // Skips: a skipped player never loses two turns in a row, so a skip chain always ends.
  for (let guard = 0; guard < s.players.length; guard++) {
    const p = s.players[s.current];
    if (!p.skip) break;
    p.skip = false;
    p.justSkipped = true;
    s.events.push({ type: 'skipped', player: p.id });
    s.current = nextPlayer(s);
  }
  const p = s.players[s.current];
  p.justSkipped = false;
  s.mustPlace = p.drawTwo ? 2 : 1;
  s.noClaim = p.drawTwo;
  p.drawTwo = false;
  s.turn++;
  if (s.config.rules.actions && p.actions.length) s.step = 'action';
  else startDraw(s);
}

function startDraw(s: GameState) {
  if (s.config.turn.market > 0) {
    fillMarket(s);
    const playable = s.market.some((t) => legalPlacements(s, t).length);
    if (!s.deck.length && !playable) return endGame(s);
    s.step = 'draw';
  } else autoDraw(s);
}

function fillMarket(s: GameState) {
  while (s.market.length < s.config.turn.market && s.deck.length) {
    const top = s.deck[s.deck.length - 1];
    // The river stays in order, and action tiles are never face up.
    if (isRiver(s.config, top) || s.config.tiles[top].action) break;
    s.market.push(s.deck.pop()!);
  }
}

/** Draws until a playable landscape tile turns up. Action tiles go to the hand. */
function drawOne(s: GameState): string | null {
  while (s.deck.length) {
    const id = s.deck.pop()!;
    const def = s.config.tiles[id];
    if (def.action) {
      const p = s.players[s.current];
      if (p.actions.length < s.config.turn.actionHandSize) p.actions.push(def.action);
      else { s.discard.push(id); s.events.push({ type: 'discarded', tileId: id, reason: 'handFull' }); }
      continue;
    }
    if (!legalPlacements(s, id).length) {
      s.discard.push(id);
      s.events.push({ type: 'discarded', tileId: id, reason: 'unplayable' });
      continue;
    }
    return id;
  }
  return null;
}

function autoDraw(s: GameState) {
  s.hand = [];
  while (s.hand.length < s.config.turn.handSize) {
    const id = drawOne(s);
    if (!id) break;
    s.hand.push(id);
  }
  if (!s.hand.length) return endGame(s);
  s.step = 'place';
}

function finishPlacement(s: GameState) {
  const placed = s.board[s.lastPlaced!];
  scoreCompleted(s, placed);
  if (s.config.end.targetScore && s.players.some((p) => p.score >= s.config.end.targetScore)) return endGame(s);
  s.mustPlace--;
  if (s.mustPlace > 0) return autoDraw(s);
  endTurn(s);
}

function endTurn(s: GameState) {
  if (s.config.end.turnLimit && s.turn >= s.config.end.turnLimit) return endGame(s);
  if (!s.deck.length && !s.market.length) return endGame(s);
  s.current = nextPlayer(s);
  beginTurn(s);
}

/** Local features of the last placed tile the current player could claim. */
export function claimable(s: GameState): number[] {
  if (!s.lastPlaced) return [];
  const t = s.board[s.lastPlaced];
  const out: number[] = [];
  tileAnalysis(s, t).features.forEach((f, i) => {
    if (f.kind === 'meadow' && !s.config.scoring.meadow.enabled) return;
    const g = featureOf(s, t.featureIds[i]);
    if (g.pieces.length || g.scored) return;
    out.push(i);
  });
  return out;
}

const actionTileId = (s: GameState, kind: ActionKind) => Object.values(s.config.tiles).find((t) => t.action === kind)!.id;

function applyActionTile(s: GameState, a: Extract<Action, { type: 'playAction' }>) {
  const p = s.players[s.current];
  const i = p.actions.indexOf(a.action);
  if (i < 0) throw new Error(`You don't hold ${a.action}.`);
  const canSkip = (q: Player) => !q.skip && !q.justSkipped && q.id !== p.id;
  switch (a.action) {
    case 'skip': { const q = s.players[nextPlayer(s)]; if (canSkip(q)) q.skip = true; break; }
    case 'reverse': s.direction = s.direction === 1 ? -1 : 1; break;
    case 'drawTwo': s.players[nextPlayer(s)].drawTwo = true; break;
    case 'loseTurn': {
      const q = s.players[a.target ?? -1];
      if (!q) throw new Error('Pick a player.');
      if (canSkip(q)) q.skip = true;
      break;
    }
    case 'sendHome': {
      if (!a.piece) throw new Error('Pick a Wanderer.');
      const t = s.board[a.piece.tileKey];
      const f = t && featureOf(s, t.featureIds[a.piece.local]);
      const idx = f ? f.pieces.findIndex((pc) => pc.tileKey === a.piece!.tileKey && pc.local === a.piece!.local && pc.player !== p.id) : -1;
      if (idx < 0) throw new Error('No opponent Wanderer there.');
      const [piece] = f.pieces.splice(idx, 1);
      s.players[piece.player].pieces[piece.type]++;
      s.events.push({ type: 'returned', piece });
      break;
    }
    case 'steal': {
      const q = s.players[a.target ?? -1];
      if (!q || q.id === p.id || !q.actions.length) throw new Error('Pick a player holding an action tile.');
      const j = Math.floor(rand(s) * q.actions.length);
      const [stolen] = q.actions.splice(j, 1);
      if (p.actions.length < s.config.turn.actionHandSize) p.actions.push(stolen);
      else s.discard.push(actionTileId(s, stolen));
      break;
    }
  }
  p.actions.splice(i, 1);
  s.discard.push(actionTileId(s, a.action));
  s.events.push({ type: 'action', player: p.id, action: a.action, target: a.target });
}

/** Applies one action for the current player. Throws on an illegal action; the state is unchanged then. */
export function apply(s: GameState, action: Action): GameState {
  s.events = [];
  if (s.step === 'ended') throw new Error('The game is over.');
  switch (s.step) {
    case 'action':
      if (action.type === 'playAction') applyActionTile(s, action);
      else if (action.type !== 'pass') throw new Error('Play an action tile or pass.');
      s.log.push(action);
      startDraw(s);
      return s;
    case 'draw': {
      if (action.type !== 'draw') throw new Error('Draw a tile.');
      let id: string | null;
      if (action.market !== undefined) {
        id = s.market[action.market];
        if (!id) throw new Error('No such market tile.');
        if (!legalPlacements(s, id).length) throw new Error('That tile fits nowhere.');
        s.market.splice(action.market, 1);
      } else {
        if (!s.deck.length) throw new Error('The deck is empty.');
        id = drawOne(s);
      }
      s.log.push(action);
      if (!id) { endGame(s); return s; }
      s.hand = [id];
      s.step = 'place';
      return s;
    }
    case 'place': {
      if (action.type !== 'place') throw new Error('Place a tile.');
      const id = s.hand[action.hand];
      if (!id) throw new Error('No such tile in hand.');
      if (!isLegal(s, id, action.x, action.z, action.rot)) throw new Error('That tile does not fit there.');
      s.log.push(action);
      placeTile(s, id, action.x, action.z, action.rot, s.current);
      // Other hand tiles go to the bottom of the deck.
      s.hand.forEach((t, i) => { if (i !== action.hand) s.deck.unshift(t); });
      s.hand = [];
      s.placedCount++;
      if (s.config.turn.reverseEvery && s.placedCount % s.config.turn.reverseEvery === 0) s.direction = s.direction === 1 ? -1 : 1;
      const p = s.players[s.current];
      const canClaim = !s.noClaim && (p.pieces.wanderer > 0 || p.pieces.grand > 0) && claimable(s).length > 0;
      if (canClaim) s.step = 'claim';
      else finishPlacement(s);
      return s;
    }
    case 'claim': {
      if (action.type === 'claim') {
        const p = s.players[s.current];
        if (p.pieces[action.piece] <= 0) throw new Error(`No ${action.piece} left.`);
        if (!claimable(s).includes(action.local)) throw new Error('That feature cannot be claimed.');
        const t = s.board[s.lastPlaced!];
        const f = featureOf(s, t.featureIds[action.local]);
        p.pieces[action.piece]--;
        f.pieces.push({ player: p.id, type: action.piece, strength: action.piece === 'grand' ? 2 : 1, tileKey: t.key, local: action.local });
        s.events.push({ type: 'claimed', tileKey: t.key, local: action.local, player: p.id, piece: action.piece });
      } else if (action.type !== 'pass') throw new Error('Claim a feature or pass.');
      s.log.push(action);
      finishPlacement(s);
      return s;
    }
  }
  return s;
}

/** Every action the current player may take now. Placements are expanded per hand tile. */
export function legalActions(s: GameState): Action[] {
  const p = s.players[s.current];
  switch (s.step) {
    case 'ended': return [];
    case 'action': {
      const out: Action[] = [{ type: 'pass' }];
      for (const a of new Set(p.actions)) {
        if (a === 'skip' || a === 'reverse' || a === 'drawTwo') out.push({ type: 'playAction', action: a });
        if (a === 'loseTurn') for (const q of s.players) if (q.id !== p.id) out.push({ type: 'playAction', action: a, target: q.id });
        if (a === 'steal') for (const q of s.players) if (q.id !== p.id && q.actions.length) out.push({ type: 'playAction', action: a, target: q.id });
        if (a === 'sendHome') {
          for (const f of s.features) if (s.parent[f.id] === f.id) for (const pc of f.pieces) if (pc.player !== p.id) out.push({ type: 'playAction', action: a, piece: { tileKey: pc.tileKey, local: pc.local } });
        }
      }
      return out;
    }
    case 'draw': {
      const out: Action[] = [];
      s.market.forEach((t, i) => { if (legalPlacements(s, t).length) out.push({ type: 'draw', market: i }); });
      if (s.deck.length) out.push({ type: 'draw' });
      return out;
    }
    case 'place': {
      const out: Action[] = [];
      s.hand.forEach((t, hand) => { for (const pl of legalPlacements(s, t)) out.push({ type: 'place', hand, ...pl }); });
      return out;
    }
    case 'claim': {
      const out: Action[] = [{ type: 'pass' }];
      for (const local of claimable(s)) for (const piece of ['wanderer', 'grand'] as PieceType[]) if (p.pieces[piece] > 0) out.push({ type: 'claim', local, piece });
      return out;
    }
  }
}

/** Rebuilds a game from its seed and log: replays, undo, spectating and bug reports. */
export function replay(config: GameConfig, seed: number, log: Action[], names?: string[]): GameState {
  const s = createGame(config, seed, names);
  for (const a of log) apply(s, a);
  return s;
}
