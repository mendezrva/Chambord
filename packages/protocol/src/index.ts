/**
 * The online protocol: every message between the browser and the game server, as plain JSON
 * over one WebSocket. Requests carry an `id` and get a `reply` with the same id; the server
 * also pushes `room`, `game`, `invite` and `friends` messages on its own.
 */
import type { Action, GameEvent, GameSpec, GameState } from '@glockenfels/engine';

export const PROTOCOL_VERSION = 1;

export interface UserView {
  id: number;
  name: string;
  rating: number;
  games: number;
  wins: number;
}

export interface RoomSettings {
  modules: string[];
  rules: string[];
  ruleMode: 'pick' | 'draft';
  edits: GameSpec['edits'];
  preset: string | null;
}

export interface SeatView {
  kind: 'human' | 'bot';
  name: string;
  userId?: number;
  rating?: number;
  /** Has the game open right now. Bots are always online. */
  online: boolean;
  /** A bot is playing this human seat (they left, dropped or resigned). */
  botControl?: boolean;
  resigned?: boolean;
  /** Seconds since this human was last connected, when offline. */
  awayFor?: number;
}

export interface DraftView {
  stage: 'picking' | 'conflict' | 'stuck';
  /** Who has locked in a pick (picks stay secret until everyone has). */
  picked: boolean[];
  /** My pick, and the rules I may pick from. */
  mine: string | null;
  pool: string[];
  /** Everyone's picks, once all are in. */
  reveal: (string | null)[] | null;
  conflict?: { a: string; b: string };
  modules: string[];
}

export interface RoomView {
  code: string;
  hostId: number;
  phase: 'lobby' | 'draft' | 'playing' | 'ended';
  seats: SeatView[];
  settings: RoomSettings;
  mySeat: number | null;
  draft?: DraftView;
  matchId?: number;
  /** The game counts for Elo: two or more different people sat down. */
  rated: boolean;
}

export interface ResultRow {
  seat: number;
  name: string;
  userId?: number;
  score: number;
  place: number;
  ratingBefore?: number;
  ratingAfter?: number;
}

export interface GameView {
  matchId: number;
  /** The engine state with hidden information removed (deck order, other hands, the random seed). */
  state: GameState;
  /** What the last action did, for animations. */
  events: GameEvent[];
  /** Seat that made the last action, or null for a fresh snapshot. */
  actor: number | null;
  drafted?: { rule: string; player: number }[];
  result?: ResultRow[];
  rated: boolean;
}

export interface FriendRow { user: UserView; online: boolean; roomCode?: string; playing?: boolean }
export interface FriendsView { friends: FriendRow[]; incoming: UserView[]; outgoing: UserView[] }

export interface HistoryRow {
  matchId: number;
  endedAt: number;
  rated: boolean;
  place: number;
  score: number;
  ratingDelta: number | null;
  players: { name: string; score: number; place: number; userId?: number; bot: boolean }[];
  tiles: number;
}

export interface MatchRecord {
  matchId: number;
  config: GameState['config'];
  seed: number;
  log: Action[];
  seats: { name: string; bot: boolean; userId?: number }[];
  drafted?: { rule: string; player: number }[];
  result?: ResultRow[];
}

/** Requests the client sends. Each gets one `reply`. */
export type Request =
  | { t: 'hello'; v: number; token?: string }
  | { t: 'signup'; name: string; pass: string }
  | { t: 'login'; name: string; pass: string }
  | { t: 'logout' }
  | { t: 'me' }
  | { t: 'leaderboard' }
  | { t: 'history'; userId?: number }
  | { t: 'match'; matchId: number }
  | { t: 'friends' }
  | { t: 'friendAdd'; name: string }
  | { t: 'friendAccept'; userId: number }
  | { t: 'friendRemove'; userId: number }
  | { t: 'roomCreate'; settings: RoomSettings }
  | { t: 'roomJoin'; code: string }
  | { t: 'roomLeave' }
  | { t: 'roomSettings'; settings: RoomSettings }
  | { t: 'roomBot'; add: true }
  | { t: 'roomRemoveSeat'; seat: number }
  | { t: 'roomStart' }
  | { t: 'invite'; userId: number }
  | { t: 'draftPick'; rule: string }
  | { t: 'draftSettle'; keep: string; drop: string }
  | { t: 'draftDrop'; rule: string }
  | { t: 'act'; action: Action; n: number }
  | { t: 'undo' }
  | { t: 'takeover'; seat: number }
  | { t: 'resign' }
  | { t: 'rematch' };

export type RequestType = Request['t'];

export interface HelloReply { user: UserView | null; token?: string; roomCode?: string }

export type ClientMessage = Request & { id: number };

export type ServerMessage =
  | { t: 'reply'; id: number; ok: true; data?: unknown }
  | { t: 'reply'; id: number; ok: false; error: string }
  | { t: 'room'; room: RoomView | null }
  | { t: 'game'; game: GameView }
  | { t: 'invite'; from: UserView; code: string }
  | { t: 'friends' };

/** How long a person must be gone on their turn before others can let a bot play for them. */
export const TAKEOVER_AFTER_S = 30;

export const NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_ .-]{1,14}[A-Za-z0-9_.]$/;
export const NAME_RULES = '3 to 16 letters, numbers, spaces, dots, dashes or underscores.';
