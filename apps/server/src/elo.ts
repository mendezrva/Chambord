/**
 * Multiplayer Elo. Every pair of people in a finished game is treated as one head-to-head:
 * the higher score wins that pair (a tie is half each). Each player's change is the sum of
 * their pair results against what their ratings predicted, scaled by K / (people - 1), so a
 * 2-player game moves ratings exactly like classic Elo and bigger tables don't swing harder.
 * Bots are left out: only people's ratings change, and only against each other.
 */
export const K = 32;

export const expected = (a: number, b: number) => 1 / (1 + 10 ** ((b - a) / 400));

export interface EloEntry { rating: number; /** Higher is better. Resigned players should be ranked last. */ result: number }

export function eloChanges(entries: EloEntry[], k = K): number[] {
  const n = entries.length;
  if (n < 2) return entries.map(() => 0);
  return entries.map((me, i) => {
    let sum = 0;
    entries.forEach((o, j) => {
      if (i === j) return;
      const s = me.result > o.result ? 1 : me.result === o.result ? 0.5 : 0;
      sum += s - expected(me.rating, o.rating);
    });
    return Math.round((k / (n - 1)) * sum);
  });
}

/** Places from scores: 1 for the best, ties share a place (1, 1, 3). */
export function places(scores: number[]): number[] {
  return scores.map((s) => 1 + scores.filter((o) => o > s).length);
}
