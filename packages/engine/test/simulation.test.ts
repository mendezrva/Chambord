/** Never stuck: thousands of bot games across every module mix and every draft rule. */
import { describe, expect, it } from 'vitest';
import { buildConfig, DRAFT_RULES, findConflicts, MODULES, PRESETS, type GameOptions } from '../src/config';
import { playBotGame } from '../src/draft';
import { makeRng, pick } from '../src/rng';
import type { GameState } from '../src/game';

function check(s: GameState, opts: GameOptions) {
  expect(s.step).toBe('ended');
  expect(s.winners!.length).toBeGreaterThan(0);
  const total = s.config.deck.reduce((n, d) => n + d.count, 0);
  const placed = Object.keys(s.board).length - 1;
  const actionsHeld = s.players.reduce((n, p) => n + p.actions.length, 0);
  const leftover = s.deck.length + s.market.length + s.hand.length;
  expect(placed + s.discard.length + actionsHeld + leftover).toBe(total);
  // Without an early end, the deck is used up; only unplayable face-up market tiles may remain.
  if (!s.config.end.targetScore && !s.config.end.turnLimit) expect(s.deck.length + s.hand.length).toBe(0);
  for (const p of s.players) {
    expect(p.score).toBeGreaterThanOrEqual(0);
    // Every Wanderer is in hand or on the board.
    const onBoard = s.features.filter((f) => s.parent[f.id] === f.id).flatMap((f) => f.pieces).filter((pc) => pc.player === p.id);
    expect(p.pieces.wanderer + p.pieces.grand + onBoard.length).toBe(s.config.pieces.wanderer + s.config.pieces.grand);
  }
  void opts;
}

describe('simulated games', () => {
  it('finish for every module combination', () => {
    const ids = MODULES.map((m) => m.id);
    for (let mask = 0; mask < 1 << ids.length; mask++) {
      const modules = ids.filter((_, i) => mask & (1 << i));
      for (const players of [2, 5]) {
        const opts = { players, modules };
        check(playBotGame(buildConfig(opts), mask * 10 + players), opts);
      }
    }
  });

  it('finish for every draft rule with every module', () => {
    for (const r of DRAFT_RULES) {
      for (const m of MODULES) {
        if (findConflicts([r.id, m.id]).length) continue;
        const opts = { players: 3, modules: [m.id], rules: [r.id] };
        check(playBotGame(buildConfig(opts), 7), opts);
      }
    }
  });

  it('finish for 2000 random mixes of modules, rules and player counts', () => {
    const rng = makeRng(2024);
    let games = 0, failures = 0;
    for (let i = 0; i < 2000; i++) {
      const modules = MODULES.filter(() => rng() < 0.4).map((m) => m.id);
      const rules: string[] = [];
      const n = Math.floor(rng() * 4);
      for (let k = 0; k < n; k++) {
        const r = pick(rng, DRAFT_RULES).id;
        if (!rules.includes(r) && !findConflicts([...modules, ...rules, r]).length) rules.push(r);
      }
      const players = 2 + Math.floor(rng() * 7);
      const opts = { players, modules, rules };
      try {
        check(playBotGame(buildConfig(opts), i), opts);
        games++;
      } catch (e) {
        failures++;
        throw new Error(`Game ${i} (${JSON.stringify(opts)}) failed: ${(e as Error).message}`);
      }
    }
    expect(games).toBe(2000);
    expect(failures).toBe(0);
  }, 600_000);

  it('presets play to the end', () => {
    for (const p of Object.values(PRESETS)) for (let seed = 1; seed <= 5; seed++) check(playBotGame(buildConfig(p), seed), p);
  });
});
