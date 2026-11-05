import { buildConfig, type GameOptions } from '../src/config';
import { apply, createGame, type GameState } from '../src/game';

export function newGame(opts: Partial<GameOptions> = {}, seed = 1) {
  return createGame(buildConfig({ players: 2, ...opts }), seed);
}

/** Puts a chosen tile in the current player's hand and places it, skipping the claim unless asked. */
export function force(s: GameState, tileId: string, x: number, z: number, rot: number, claim?: { local: number; piece?: 'wanderer' | 'grand' }) {
  s.hand = [tileId];
  s.step = 'place';
  apply(s, { type: 'place', hand: 0, x, z, rot });
  if ((s.step as string) === 'claim') {
    if (claim) apply(s, { type: 'claim', local: claim.local, piece: claim.piece ?? 'wanderer' });
    else apply(s, { type: 'pass' });
  }
  return s;
}
