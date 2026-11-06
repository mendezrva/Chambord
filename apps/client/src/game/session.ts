/**
 * A local pass-and-play session: the engine state plus who sits in each seat, saved to the
 * device after every move so a reload (or a closed Safari tab) picks the game back up.
 * A seed plus the action log is the whole game, so saving and undo are both just replays.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { apply, replay, type Action, type GameConfig, type GameEvent, type GameState } from '@glockenfels/engine';

export interface Seat { name: string; bot: boolean }

export interface SavedGame {
  v: 1;
  config: GameConfig;
  seed: number;
  seats: Seat[];
  log: Action[];
  /** Show a "pass the device" screen between human turns. */
  handoff: boolean;
  /** Rules picked in the secret draft, with who picked them, for the rule card. */
  drafted?: { rule: string; player: number }[];
  startedAt: number;
}

const KEY = 'glockenfels.save.v1';

export function loadSave(): SavedGame | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SavedGame;
    if (s.v !== 1 || !s.config || !Array.isArray(s.log)) return null;
    // Make sure it still replays with this version of the engine.
    const g = replay(s.config, s.seed, s.log, s.seats.map((x) => x.name));
    if (g.step === 'ended') return null;
    return s;
  } catch {
    return null;
  }
}

export function writeSave(s: SavedGame | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    // Private browsing or full storage: the game still plays, it just won't resume.
  }
}

export interface Batch { n: number; events: GameEvent[]; player: number }

/** A seat as the game screen sees it. `local` seats are played on this device. */
export interface PlaySeat { name: string; bot: boolean; local: boolean; online?: boolean; awayFor?: number; botControl?: boolean; resigned?: boolean; rating?: number }

/**
 * Everything the game screen needs, whoever holds the real game: this device (pass and play),
 * the server (online) or a finished record (replay).
 */
export interface GameController {
  mode: 'local' | 'online' | 'replay';
  state: GameState;
  version: number;
  batch: Batch | null;
  error: string | null;
  clearError: () => void;
  dispatch: (a: Action) => boolean;
  undo: () => void;
  seats: PlaySeat[];
  seed: number;
  /** Run bot seats on this device. */
  runBots: boolean;
  handoff: boolean;
  drafted?: { rule: string; player: number }[];
}

export function useGame(saved: SavedGame): GameController {
  const names = useMemo(() => saved.seats.map((s) => s.name), [saved]);
  const ref = useRef<GameState | null>(null);
  if (!ref.current) ref.current = replay(saved.config, saved.seed, saved.log, names);
  const [version, setVersion] = useState(0);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const counter = useRef(0);

  const persist = useCallback((s: GameState) => {
    writeSave(s.step === 'ended' ? null : { ...saved, log: s.log });
  }, [saved]);

  const dispatch = useCallback((action: Action) => {
    const s = ref.current!;
    const player = s.current;
    try {
      apply(s, action);
    } catch (e) {
      // apply checks before it changes anything that matters, but replay to be certain.
      ref.current = replay(saved.config, saved.seed, s.log, names);
      setError((e as Error).message);
      setVersion((v) => v + 1);
      return false;
    }
    setError(null);
    setBatch({ n: ++counter.current, events: [...s.events], player });
    setVersion((v) => v + 1);
    persist(s);
    return true;
  }, [saved, names, persist]);

  /** Takes back the last action (used to lift a tile back off the board before claiming). */
  const undo = useCallback(() => {
    const s = ref.current!;
    if (!s.log.length) return;
    ref.current = replay(saved.config, saved.seed, s.log.slice(0, -1), names);
    setBatch(null);
    setVersion((v) => v + 1);
    persist(ref.current);
  }, [saved, names]); // eslint-disable-line react-hooks/exhaustive-deps

  const seats = useMemo(() => saved.seats.map((x) => ({ name: x.name, bot: x.bot, local: !x.bot })), [saved]);
  return {
    mode: 'local', state: ref.current, version, batch, error, dispatch, undo, clearError: () => setError(null),
    seats, seed: saved.seed, runBots: true, handoff: saved.handoff, drafted: saved.drafted,
  } satisfies GameController;
}
