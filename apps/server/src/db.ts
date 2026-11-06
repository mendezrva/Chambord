/**
 * Storage: one SQLite file (Node's built-in driver) holding accounts, sign-in tokens, friends,
 * matches with their full action logs, and each player's result and rating change.
 * Every move is written straight away, so a restart picks running games back up.
 */
import { createRequire } from 'node:module';
import type { DatabaseSync as DB } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Action, GameConfig } from '@glockenfels/engine';
import type { FriendsView, HistoryRow, MatchRecord, ResultRow, UserView } from '@glockenfels/protocol';

// Loaded with require so test bundlers leave Node's built-in sqlite module alone.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

export const START_RATING = 1200;

interface UserRow { id: number; name: string; pass: string; rating: number; games: number; wins: number; created: number }

export interface StoredSeat { name: string; bot: boolean; userId?: number; botControl?: boolean; resigned?: boolean }

export interface ActiveMatch {
  id: number;
  code: string;
  hostId: number;
  config: GameConfig;
  seed: number;
  log: Action[];
  seats: StoredSeat[];
  drafted?: { rule: string; player: number }[];
  settings: string;
}

export class Store {
  db: DB;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        pass TEXT NOT NULL,
        rating INTEGER NOT NULL DEFAULT ${START_RATING},
        games INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0,
        created INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tokens (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS friends (
        a INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        b INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        accepted INTEGER NOT NULL DEFAULT 0,
        created INTEGER NOT NULL,
        PRIMARY KEY (a, b)
      );
      CREATE TABLE IF NOT EXISTS matches (
        id INTEGER PRIMARY KEY,
        code TEXT NOT NULL,
        host_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        config TEXT NOT NULL,
        seed INTEGER NOT NULL,
        log TEXT NOT NULL,
        seats TEXT NOT NULL,
        drafted TEXT,
        settings TEXT NOT NULL,
        rated INTEGER NOT NULL DEFAULT 0,
        tiles INTEGER NOT NULL DEFAULT 0,
        started INTEGER NOT NULL,
        ended INTEGER
      );
      CREATE TABLE IF NOT EXISTS results (
        match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        seat INTEGER NOT NULL,
        user_id INTEGER,
        name TEXT NOT NULL,
        score INTEGER NOT NULL,
        place INTEGER NOT NULL,
        rating_before INTEGER,
        rating_after INTEGER,
        PRIMARY KEY (match_id, seat)
      );
      CREATE INDEX IF NOT EXISTS results_user ON results(user_id);
    `);
  }

  // ---------- accounts ----------

  private view(u: UserRow): UserView {
    return { id: u.id, name: u.name, rating: u.rating, games: u.games, wins: u.wins };
  }

  user(id: number): UserView | null {
    const u = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return u ? this.view(u) : null;
  }

  userByName(name: string): UserView | null {
    const u = this.db.prepare('SELECT * FROM users WHERE name = ?').get(name.trim()) as UserRow | undefined;
    return u ? this.view(u) : null;
  }

  createUser(name: string, pass: string): UserView {
    const salt = randomBytes(12).toString('hex');
    const hash = scryptSync(pass, salt, 32).toString('hex');
    const r = this.db.prepare('INSERT INTO users (name, pass, created) VALUES (?, ?, ?)').run(name.trim(), `${salt}:${hash}`, Date.now());
    return this.user(Number(r.lastInsertRowid))!;
  }

  checkPass(name: string, pass: string): UserView | null {
    const u = this.db.prepare('SELECT * FROM users WHERE name = ?').get(name.trim()) as UserRow | undefined;
    if (!u) return null;
    const [salt, hash] = u.pass.split(':');
    const got = scryptSync(pass, salt, 32);
    return timingSafeEqual(got, Buffer.from(hash, 'hex')) ? this.view(u) : null;
  }

  newToken(userId: number): string {
    const token = randomBytes(24).toString('base64url');
    this.db.prepare('INSERT INTO tokens (token, user_id, created) VALUES (?, ?, ?)').run(token, userId, Date.now());
    return token;
  }

  userForToken(token: string): UserView | null {
    const r = this.db.prepare('SELECT user_id FROM tokens WHERE token = ?').get(token) as { user_id: number } | undefined;
    return r ? this.user(r.user_id) : null;
  }

  dropToken(token: string) {
    this.db.prepare('DELETE FROM tokens WHERE token = ?').run(token);
  }

  leaderboard(limit = 50): UserView[] {
    return (this.db.prepare('SELECT * FROM users WHERE games > 0 ORDER BY rating DESC, wins DESC, name LIMIT ?').all(limit) as unknown as UserRow[]).map((u) => this.view(u));
  }

  // ---------- friends ----------
  // A row (a, b) is a request from a to b; accepted = 1 makes them friends both ways.

  friendsOf(id: number): FriendsView {
    const rows = this.db.prepare('SELECT a, b, accepted FROM friends WHERE a = ? OR b = ?').all(id, id) as { a: number; b: number; accepted: number }[];
    const out: FriendsView = { friends: [], incoming: [], outgoing: [] };
    for (const r of rows) {
      const other = this.user(r.a === id ? r.b : r.a);
      if (!other) continue;
      if (r.accepted) out.friends.push({ user: other, online: false });
      else if (r.b === id) out.incoming.push(other);
      else out.outgoing.push(other);
    }
    out.friends.sort((x, y) => x.user.name.localeCompare(y.user.name));
    return out;
  }

  friendIds(id: number): number[] {
    return (this.db.prepare('SELECT a, b FROM friends WHERE (a = ? OR b = ?) AND accepted = 1').all(id, id) as { a: number; b: number }[])
      .map((r) => (r.a === id ? r.b : r.a));
  }

  /** Sends a request, or accepts theirs if they already asked. Returns true when now friends. */
  addFriend(from: number, to: number): boolean {
    const theirs = this.db.prepare('SELECT accepted FROM friends WHERE a = ? AND b = ?').get(to, from) as { accepted: number } | undefined;
    if (theirs) {
      this.db.prepare('UPDATE friends SET accepted = 1 WHERE a = ? AND b = ?').run(to, from);
      return true;
    }
    this.db.prepare('INSERT OR IGNORE INTO friends (a, b, created) VALUES (?, ?, ?)').run(from, to, Date.now());
    const mine = this.db.prepare('SELECT accepted FROM friends WHERE a = ? AND b = ?').get(from, to) as { accepted: number };
    return !!mine.accepted;
  }

  acceptFriend(me: number, from: number): boolean {
    return Number(this.db.prepare('UPDATE friends SET accepted = 1 WHERE a = ? AND b = ?').run(from, me).changes) > 0;
  }

  removeFriend(me: number, other: number) {
    this.db.prepare('DELETE FROM friends WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)').run(me, other, other, me);
  }

  areFriends(a: number, b: number) {
    return !!this.db.prepare('SELECT 1 FROM friends WHERE ((a = ? AND b = ?) OR (a = ? AND b = ?)) AND accepted = 1').get(a, b, b, a);
  }

  // ---------- matches ----------

  createMatch(m: Omit<ActiveMatch, 'id'>): number {
    const r = this.db.prepare(`INSERT INTO matches (code, host_id, status, config, seed, log, seats, drafted, settings, started)
      VALUES (?, ?, 'playing', ?, ?, ?, ?, ?, ?, ?)`).run(
      m.code, m.hostId, JSON.stringify(m.config), m.seed, JSON.stringify(m.log), JSON.stringify(m.seats),
      m.drafted ? JSON.stringify(m.drafted) : null, m.settings, Date.now(),
    );
    return Number(r.lastInsertRowid);
  }

  saveProgress(id: number, log: Action[], seats: StoredSeat[], tiles: number) {
    this.db.prepare('UPDATE matches SET log = ?, seats = ?, tiles = ? WHERE id = ?').run(JSON.stringify(log), JSON.stringify(seats), tiles, id);
  }

  activeMatches(): ActiveMatch[] {
    const rows = this.db.prepare("SELECT * FROM matches WHERE status = 'playing'").all() as Record<string, string | number | null>[];
    return rows.map((r) => ({
      id: r.id as number, code: r.code as string, hostId: r.host_id as number,
      config: JSON.parse(r.config as string), seed: r.seed as number, log: JSON.parse(r.log as string),
      seats: JSON.parse(r.seats as string), drafted: r.drafted ? JSON.parse(r.drafted as string) : undefined,
      settings: r.settings as string,
    }));
  }

  /** Stores the final result and applies rating changes in one transaction. */
  finishMatch(id: number, rows: ResultRow[], rated: boolean, tiles: number) {
    this.db.exec('BEGIN');
    try {
      this.db.prepare("UPDATE matches SET status = 'ended', ended = ?, rated = ?, tiles = ? WHERE id = ?").run(Date.now(), rated ? 1 : 0, tiles, id);
      const ins = this.db.prepare('INSERT OR REPLACE INTO results (match_id, seat, user_id, name, score, place, rating_before, rating_after) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      for (const r of rows) {
        ins.run(id, r.seat, r.userId ?? null, r.name, r.score, r.place, r.ratingBefore ?? null, r.ratingAfter ?? null);
        if (r.userId === undefined) continue;
        this.db.prepare('UPDATE users SET games = games + 1, wins = wins + ?, rating = COALESCE(?, rating) WHERE id = ?')
          .run(r.place === 1 ? 1 : 0, rated && r.ratingAfter !== undefined ? r.ratingAfter : null, r.userId);
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  abandonMatch(id: number) {
    this.db.prepare("UPDATE matches SET status = 'abandoned', ended = ? WHERE id = ?").run(Date.now(), id);
  }

  history(userId: number, limit = 30): HistoryRow[] {
    const mine = this.db.prepare(`SELECT r.*, m.ended, m.rated, m.tiles FROM results r JOIN matches m ON m.id = r.match_id
      WHERE r.user_id = ? AND m.status = 'ended' ORDER BY m.ended DESC LIMIT ?`).all(userId, limit) as Record<string, number | string | null>[];
    return mine.map((r) => {
      const all = this.db.prepare('SELECT * FROM results WHERE match_id = ? ORDER BY place, seat').all(r.match_id) as Record<string, number | string | null>[];
      return {
        matchId: r.match_id as number,
        endedAt: r.ended as number,
        rated: !!r.rated,
        place: r.place as number,
        score: r.score as number,
        ratingDelta: r.rating_after !== null && r.rating_before !== null && r.rated ? (r.rating_after as number) - (r.rating_before as number) : null,
        tiles: r.tiles as number,
        players: all.map((p) => ({ name: p.name as string, score: p.score as number, place: p.place as number, userId: (p.user_id as number | null) ?? undefined, bot: p.user_id === null })),
      };
    });
  }

  match(id: number): MatchRecord | null {
    const r = this.db.prepare("SELECT * FROM matches WHERE id = ? AND status = 'ended'").get(id) as Record<string, string | number | null> | undefined;
    if (!r) return null;
    const results = this.db.prepare('SELECT * FROM results WHERE match_id = ? ORDER BY seat').all(id) as Record<string, number | string | null>[];
    return {
      matchId: id,
      config: JSON.parse(r.config as string),
      seed: r.seed as number,
      log: JSON.parse(r.log as string),
      seats: (JSON.parse(r.seats as string) as StoredSeat[]).map((s) => ({ name: s.name, bot: s.bot, userId: s.userId })),
      drafted: r.drafted ? JSON.parse(r.drafted as string) : undefined,
      result: results.map((x) => ({
        seat: x.seat as number, name: x.name as string, userId: (x.user_id as number | null) ?? undefined, score: x.score as number, place: x.place as number,
        ratingBefore: (x.rating_before as number | null) ?? undefined, ratingAfter: (x.rating_after as number | null) ?? undefined,
      })),
    };
  }
}
