/**
 * The secret rule draft: each player picks one rule, the picks are revealed together,
 * conflicts go to the host, and a few quick bot games prove the mix is playable.
 */
import { buildConfig, findConflicts, type Conflict, type GameConfig, type GameOptions } from './config';
import { botAction } from './bot';
import { apply, createGame, type GameState } from './game';

export interface DraftResult {
  /** Rules that survived, in pick order. */
  rules: string[];
  /** Pairs the host must break: keep one, the other player picks again. */
  conflicts: Conflict[];
  /** Rules whose combination made a bot game stall; the host drops one. */
  stuck: string[];
  config: GameConfig | null;
}

/** Plays a full bot game. Returns the finished state, or throws if the engine stalls. */
export function playBotGame(config: GameConfig, seed: number, maxActions = 5000): GameState {
  const s = createGame(config, seed);
  let n = 0;
  while (s.step !== 'ended') {
    if (++n > maxActions) throw new Error(`Game did not finish after ${maxActions} actions.`);
    apply(s, botAction(s, seed + n));
  }
  return s;
}

/**
 * Checks a set of picks. Conflicting pairs are reported for the host; if none, the engine
 * builds the config and plays `trials` bot games to be sure the game can finish.
 */
export function resolveDraft(base: GameOptions, picks: string[], trials = 3): DraftResult {
  const rules = [...new Set(picks)];
  const conflicts = findConflicts([...(base.modules ?? []), ...rules]);
  if (conflicts.length) return { rules, conflicts, stuck: [], config: null };
  let config: GameConfig;
  try {
    config = buildConfig({ ...base, rules: [...(base.rules ?? []), ...rules] });
  } catch (e) {
    return { rules, conflicts: [], stuck: rules, config: null };
  }
  for (let i = 0; i < trials; i++) {
    try {
      playBotGame(config, 1000 + i, 3000);
    } catch {
      return { rules, conflicts: [], stuck: rules, config: null };
    }
  }
  return { rules, conflicts: [], stuck: [], config };
}
