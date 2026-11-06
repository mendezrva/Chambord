/**
 * A simple bot: it takes the legal move that scores the most right now, with a little
 * look-ahead for claims. Good enough for testing and solo play.
 */
import { makeRng, pick, type Rng } from './rng';
import { analyze, DX, DZ, OPPOSITE, oppositeSlot } from './tiles';
import { claimable, featureOf, featureValue, find, legalActions, majority, neighbourCount, tileAnalysis, tileAt, type Action, type GameState } from './game';

/** Estimates what a placement scores for the player, without changing the state. */
export function evaluatePlacement(s: GameState, tileId: string, x: number, z: number, rot: number, player: number): number {
  const a = analyze(s.config.tiles[tileId], rot);
  let score = 0;
  let neighbours = 0;
  for (let e = 0; e < 4; e++) if (tileAt(s, x + DX[e], z + DZ[e])) neighbours++;
  score += neighbours * 0.3; // compact boards leave fewer holes
  a.features.forEach((f, li) => {
    if (f.kind === 'monastery') {
      let n = 0;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if ((dx || dz) && tileAt(s, x + dx, z + dz)) n++;
      score += 0.5 + n * 0.3; // a claimable monastery with neighbours already in place
      return;
    }
    if (f.kind === 'meadow') return;
    // Groups this feature would join, and how many open ends the merged feature would have.
    const groups = new Set<number>();
    let joined = 0;
    for (const e of f.edges) {
      const n = tileAt(s, x + DX[e], z + DZ[e]);
      if (!n) continue;
      const ni = tileAnalysis(s, n).byEdge[OPPOSITE[e]];
      if (ni < 0) continue;
      groups.add(find(s, n.featureIds[ni]));
      joined++;
    }
    let open = f.edges.length - joined;
    let tiles = 1, banner = f.banner;
    const pieces: { player: number; strength: number }[] = [];
    for (const g of groups) {
      const F = s.features[g];
      open += F.open;
      tiles += F.tiles.length;
      banner += F.banner;
      pieces.push(...F.pieces);
    }
    open -= joined;
    const mine = pieces.filter((p) => p.player === player).reduce((t, p) => t + p.strength, 0);
    const theirs = Math.max(0, ...pieces.filter((p) => p.player !== player).map((p) => p.strength));
    const sc = s.config.scoring;
    const complete = open === 0;
    const per = f.kind === 'road' ? sc.road.perTile : sc.town.perTile;
    const value = tiles * per + banner * (f.kind === 'town' ? sc.town.perBanner : 0);
    if (pieces.length === 0) {
      // Unclaimed: worth claiming now (complete = instant points), discounted by how open it is.
      score += complete ? value : Math.min(value, 4) * 0.4;
    } else if (mine > theirs) score += complete ? value : value * 0.15;
    else if (mine === theirs && mine > 0) score += complete ? value * 0.6 : 0;
    else score -= complete ? value * 0.5 : value * 0.1; // helping an opponent
    void li;
  });
  // Monasteries nearby that this tile helps complete.
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const t = tileAt(s, x + dx, z + dz);
    if (!t) continue;
    const mi = tileAnalysis(s, t).monastery;
    if (mi < 0) continue;
    const F = featureOf(s, t.featureIds[mi]);
    if (F.scored || !F.pieces.length) continue;
    const owners = majority(F);
    const done = neighbourCount(s, t) + 1 === 8;
    const v = done ? featureValue(s, F, true) : 1;
    score += owners.includes(player) ? v : -v * 0.5;
  }
  return score;
}

function chooseClaim(s: GameState, rng: Rng): Action {
  const p = s.players[s.current];
  const t = s.board[s.lastPlaced!];
  const a = tileAnalysis(s, t);
  let best: Action = { type: 'pass' };
  let bestValue = 0;
  const left = p.pieces.wanderer + p.pieces.grand;
  for (const local of claimable(s)) {
    const f = a.features[local];
    const F = featureOf(s, t.featureIds[local]);
    let v: number;
    if (f.kind === 'monastery') v = 3 + neighbourCount(s, t) * 0.7;
    else if (f.kind === 'meadow') v = featureValue(s, F, false) * 0.8 + 0.5;
    else {
      const complete = F.open === 0;
      v = complete ? featureValue(s, F, true) : featureValue(s, F, true) * 0.5 + (F.open <= 1 ? 1.5 : 0);
      if (!complete && F.open >= 3) v *= 0.6;
    }
    // Keep a piece or two in reserve unless the payoff is immediate.
    if (left <= 2 && !(F.open === 0 && f.kind !== 'meadow')) v -= 2;
    v += rng() * 0.3;
    if (v > bestValue) { bestValue = v; best = { type: 'claim', local, piece: p.pieces.wanderer > 0 ? 'wanderer' : 'grand' }; }
  }
  if (best.type === 'claim' && p.pieces.grand > 0 && bestValue >= 6) best = { ...best, piece: 'grand' };
  return best;
}

function chooseAction(s: GameState, rng: Rng): Action {
  const options = legalActions(s);
  const p = s.players[s.current];
  // Play an action tile most of the time, preferring ones that hit the leader.
  const leader = [...s.players].filter((q) => q.id !== p.id).sort((a, b) => b.score - a.score)[0];
  const plays = options.filter((o) => o.type === 'playAction');
  if (!plays.length || rng() < 0.25) return { type: 'pass' };
  const targeted = plays.filter((o) => o.type === 'playAction' && (o.target === leader?.id || (o.piece && pieceOwner(s, o.piece) === leader?.id)));
  return pick(rng, targeted.length ? targeted : plays);
}
const pieceOwner = (s: GameState, ref: { tileKey: string; local: number }) => {
  const t = s.board[ref.tileKey];
  const f = t && featureOf(s, t.featureIds[ref.local]);
  return f?.pieces.find((pc) => pc.tileKey === ref.tileKey && pc.local === ref.local)?.player;
};

/** Picks the bot's action for the current step. `seed` keeps the bot deterministic. */
export function botAction(s: GameState, seed = 1): Action {
  const rng = makeRng(seed ^ (s.turn * 7919) ^ s.placedCount);
  switch (s.step) {
    case 'action': return chooseAction(s, rng);
    case 'draw': {
      const options = legalActions(s);
      // Prefer a face-up tile that scores well; otherwise draw blind.
      let best = options.find((o) => o.type === 'draw' && o.market === undefined) ?? options[0];
      let bestV = -Infinity;
      for (const o of options) {
        if (o.type !== 'draw' || o.market === undefined) continue;
        const id = s.market[o.market];
        let v = -Infinity;
        for (const pl of legalActions({ ...s, hand: [id], step: 'place' })) if (pl.type === 'place') v = Math.max(v, evaluatePlacement(s, id, pl.x, pl.z, pl.rot, s.current));
        if (v > bestV) { bestV = v; best = o; }
      }
      return bestV > 1 ? best : (options.find((o) => o.type === 'draw' && o.market === undefined) ?? best);
    }
    case 'place': {
      const options = legalActions(s).filter((o): o is Extract<Action, { type: 'place' }> => o.type === 'place');
      let best = options[0];
      let bestV = -Infinity;
      for (const o of options) {
        const v = evaluatePlacement(s, s.hand[o.hand], o.x, o.z, o.rot, s.current) + rng() * 0.5;
        if (v > bestV) { bestV = v; best = o; }
      }
      return best;
    }
    case 'claim': return chooseClaim(s, rng);
    default: throw new Error('Game over.');
  }
}

// Re-exported so the client can preview merges the same way the bot does.
export { oppositeSlot };
