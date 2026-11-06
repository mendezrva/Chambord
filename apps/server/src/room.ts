/**
 * A room: the lobby where people gather, the optional secret rule draft, and the game itself.
 * The server holds the only real game state. Every move is checked by the engine here, bots
 * play here, and each player is sent a copy of the state with hidden information removed.
 */
import {
  apply, botAction, configFromSpec, DRAFT_RULES, findConflicts, MODULES, optionsFromSpec, replay, resolveDraft, upgradeConfig,
  type Action, type ActionKind, type GameConfig, type GameState, type GameSpec,
} from '@glockenfels/engine';
import { TAKEOVER_AFTER_S, type GameView, type ResultRow, type RoomSettings, type RoomView, type ServerMessage, type UserView } from '@glockenfels/protocol';
import { eloChanges, places } from './elo';
import type { ActiveMatch, Store, StoredSeat } from './db';

export interface Hub {
  store: Store;
  send(userId: number, msg: ServerMessage): void;
  isOnline(userId: number): boolean;
  /** Milliseconds since the user was last connected (0 when online). */
  awayMs(userId: number): number;
  setUserRoom(userId: number, code: string | null): void;
  roomGone(code: string): void;
  /** Multiplies bot thinking delays (tests use 0). */
  botDelayScale: number;
}

export const MAX_SEATS = 8;
const BOT_NAMES = ['Anna', 'Ben', 'Clara', 'Dieter', 'Eva', 'Franz', 'Greta', 'Hans', 'Ida', 'Jakob'];
const BOT_DELAY: Record<string, number> = { action: 700, draw: 700, place: 1000, claim: 650 };

interface Seat extends StoredSeat { kind: 'human' | 'bot' }

interface DraftState {
  picks: (string | null)[];
  banned: string[][];
  stage: 'picking' | 'conflict' | 'stuck';
  conflict?: { a: string; b: string };
  modules: string[];
}

interface Game {
  matchId: number;
  config: GameConfig;
  seed: number;
  state: GameState;
  events: GameState['events'];
  actor: number | null;
  drafted?: { rule: string; player: number }[];
  result?: ResultRow[];
  rated: boolean;
}

export const defaultSettings = (): RoomSettings => ({ modules: [], rules: [], ruleMode: 'pick', edits: {}, preset: 'classic' });

/** Keeps only fields the builder can produce, so a room never stores junk from the network. */
export function cleanSettings(x: Partial<RoomSettings> | undefined): RoomSettings {
  const ids = (a: unknown, pool: { id: string }[]) => (Array.isArray(a) ? [...new Set(a.filter((v): v is string => typeof v === 'string' && pool.some((p) => p.id === v)))] : []);
  const edits: Record<string, number> = {};
  if (x?.edits && typeof x.edits === 'object') {
    for (const [k, v] of Object.entries(x.edits).slice(0, 200)) if (typeof k === 'string' && k.length < 64 && Number.isFinite(Number(v))) edits[k] = Number(v);
  }
  return {
    modules: ids(x?.modules, MODULES),
    rules: ids(x?.rules, DRAFT_RULES),
    ruleMode: x?.ruleMode === 'draft' ? 'draft' : 'pick',
    edits,
    preset: typeof x?.preset === 'string' ? x.preset.slice(0, 32) : null,
  };
}

/** What one seat may see: no deck order, no random seed, no one else's action tiles. */
export function redact(s: GameState, seat: number | null): GameState {
  return {
    ...s,
    seed: 0,
    rngA: 0,
    deck: s.deck.map(() => '?'),
    players: s.players.map((p) => (p.id === seat ? p : { ...p, actions: p.actions.map(() => 'hidden' as ActionKind) })),
  };
}

export class Room {
  phase: RoomView['phase'] = 'lobby';
  seats: Seat[] = [];
  draft?: DraftState;
  game?: Game;
  /** People who walked away from a finished game; they keep their seat in the record but get no more updates. */
  left = new Set<number>();
  private botTimer: ReturnType<typeof setTimeout> | null = null;
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private hub: Hub, public code: string, public hostId: number, public settings: RoomSettings) {}

  // ---------- views ----------

  seatOf(userId: number) {
    const i = this.seats.findIndex((s) => s.kind === 'human' && s.userId === userId);
    return i < 0 ? null : i;
  }

  humans() {
    return this.seats.filter((s) => s.kind === 'human' && s.userId !== undefined).map((s) => s.userId!);
  }

  get rated() {
    return new Set(this.humans()).size >= 2;
  }

  view(userId: number): RoomView {
    const me = this.seatOf(userId);
    const v: RoomView = {
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      settings: this.settings,
      mySeat: me,
      rated: this.game ? this.game.rated : this.rated,
      matchId: this.game?.matchId,
      seats: this.seats.map((s) => {
        if (s.kind === 'bot') return { kind: 'bot', name: s.name, online: true };
        const online = this.hub.isOnline(s.userId!);
        const u = this.hub.store.user(s.userId!);
        return {
          kind: 'human', name: s.name, userId: s.userId, rating: u?.rating, online,
          botControl: s.botControl, resigned: s.resigned,
          awayFor: online ? undefined : Math.floor(this.hub.awayMs(s.userId!) / 1000),
        };
      }),
    };
    if (this.phase === 'draft' && this.draft) {
      const d = this.draft;
      const all = d.picks.every((p) => p !== null);
      v.draft = {
        stage: d.stage,
        picked: d.picks.map((p) => p !== null),
        mine: me === null ? null : d.picks[me],
        pool: me === null ? [] : this.pool(me).map((r) => r.id),
        reveal: all || d.stage !== 'picking' ? d.picks.map((p) => p || null) : null,
        conflict: d.conflict,
        modules: d.modules,
      };
    }
    return v;
  }

  gameView(userId: number): GameView | null {
    const g = this.game;
    if (!g) return null;
    return {
      matchId: g.matchId,
      state: redact(g.state, this.seatOf(userId)),
      events: g.events,
      actor: g.actor,
      drafted: g.drafted,
      result: g.result,
      rated: g.rated,
    };
  }

  /** People following the room right now. */
  members() {
    return [...new Set(this.humans())].filter((id) => !this.left.has(id));
  }

  broadcastRoom() {
    for (const id of this.members()) this.hub.send(id, { t: 'room', room: this.view(id) });
  }

  broadcastGame() {
    for (const id of this.members()) {
      const game = this.gameView(id);
      if (game) this.hub.send(id, { t: 'game', game });
    }
  }

  /** Sends one user everything they need to show this room. */
  sync(userId: number) {
    this.hub.send(userId, { t: 'room', room: this.view(userId) });
    const game = this.gameView(userId);
    if (game) this.hub.send(userId, { t: 'game', game: { ...game, events: [], actor: null } });
  }

  // ---------- lobby ----------

  private requireHost(userId: number) {
    if (userId !== this.hostId) throw new Error('Only the host can do that.');
  }
  private requireLobby() {
    if (this.phase !== 'lobby') throw new Error('The game has already started.');
  }

  join(user: UserView) {
    if (this.seatOf(user.id) !== null) {
      this.left.delete(user.id);
      // Coming back: take your seat back from the bot, unless you resigned.
      const s = this.seats[this.seatOf(user.id)!];
      if (s.botControl && !s.resigned) { s.botControl = false; this.persist(); }
      this.hub.setUserRoom(user.id, this.code);
      this.broadcastRoom();
      this.sync(user.id);
      this.scheduleBot();
      return;
    }
    if (this.phase !== 'lobby') throw new Error('That game has already started.');
    if (this.seats.length >= MAX_SEATS) throw new Error('That table is full.');
    this.seats.push({ kind: 'human', name: user.name, userId: user.id, bot: false });
    this.hub.setUserRoom(user.id, this.code);
    this.broadcastRoom();
  }

  leave(userId: number) {
    const i = this.seatOf(userId);
    // Stepping away from a running game keeps you at the table (come back any time, or resign).
    if (i !== null && this.phase === 'playing') return;
    this.hub.setUserRoom(userId, null);
    if (i === null) return;
    if (this.phase === 'lobby' || this.phase === 'ended') {
      if (this.phase === 'lobby') this.seats.splice(i, 1);
      else this.left.add(userId);
      if (!this.members().length) {
        this.close();
        return;
      }
      if (this.hostId === userId) this.hostId = this.members()[0];
      this.broadcastRoom();
      return;
    }
    if (this.phase === 'draft') {
      // Leaving the draft cancels it; everyone goes back to the lobby.
      this.seats.splice(i, 1);
      this.phase = 'lobby';
      this.draft = undefined;
      if (!this.humans().length) return this.close();
      if (this.hostId === userId) this.hostId = this.humans()[0];
      this.broadcastRoom();
      return;
    }
  }

  close() {
    if (this.botTimer) clearTimeout(this.botTimer);
    if (this.presenceTimer) clearTimeout(this.presenceTimer);
    for (const id of this.members()) this.hub.send(id, { t: 'room', room: null });
    this.hub.roomGone(this.code);
  }

  setSettings(userId: number, settings: RoomSettings) {
    this.requireHost(userId);
    this.requireLobby();
    this.settings = cleanSettings(settings);
    this.broadcastRoom();
  }

  addBot(userId: number) {
    this.requireHost(userId);
    this.requireLobby();
    if (this.seats.length >= MAX_SEATS) throw new Error('The table is full (8 seats).');
    const used = new Set(this.seats.map((s) => s.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${this.seats.length + 1}`;
    this.seats.push({ kind: 'bot', name, bot: true });
    this.broadcastRoom();
  }

  removeSeat(userId: number, seat: number) {
    this.requireHost(userId);
    this.requireLobby();
    const s = this.seats[seat];
    if (!s) throw new Error('No such seat.');
    if (s.userId === this.hostId) throw new Error('The host can’t remove themselves. Leave instead.');
    this.seats.splice(seat, 1);
    if (s.kind === 'human' && s.userId !== undefined) {
      this.hub.setUserRoom(s.userId, null);
      this.hub.send(s.userId, { t: 'room', room: null });
    }
    this.broadcastRoom();
  }

  private spec(rules: string[], modules = this.settings.modules): GameSpec {
    return { players: this.seats.length, modules, rules, edits: this.settings.edits };
  }

  start(userId: number) {
    this.requireHost(userId);
    this.requireLobby();
    if (this.seats.length < 2) throw new Error('You need at least 2 players. Invite a friend or add a bot.');
    if (this.settings.ruleMode === 'draft') {
      // Check the base game builds before anyone picks.
      configFromSpec(this.spec([]));
      this.phase = 'draft';
      this.draft = { picks: this.seats.map(() => null), banned: this.seats.map(() => []), stage: 'picking', modules: [...this.settings.modules] };
      this.botPicks();
      this.afterPick();
      return;
    }
    const config = configFromSpec(this.spec(this.settings.rules));
    this.begin(config);
  }

  // ---------- secret rule draft ----------

  /** Rules a seat may pick: not banned for it, no clash with the modules; bots also avoid clashing with picks. */
  pool(seat: number) {
    const d = this.draft!;
    return DRAFT_RULES.filter((r) => {
      if (d.banned[seat]?.includes(r.id)) return false;
      if (findConflicts([...d.modules, r.id]).length) return false;
      if (this.seats[seat].kind === 'bot') return !d.picks.some((p, i) => i !== seat && p && findConflicts([p, r.id]).length);
      return true;
    });
  }

  private botPicks() {
    const d = this.draft!;
    this.seats.forEach((s, i) => {
      if (s.kind !== 'bot' || d.picks[i] !== null) return;
      const pool = this.pool(i);
      d.picks[i] = pool.length ? pool[Math.floor(Math.random() * pool.length)].id : '';
    });
  }

  private afterPick() {
    const d = this.draft!;
    if (d.picks.some((p) => p === null)) { d.stage = 'picking'; this.broadcastRoom(); return; }
    const chosen = d.picks.filter((p): p is string => !!p);
    const r = resolveDraft(optionsFromSpec(this.spec([], d.modules)), chosen, 3);
    if (r.conflicts.length) {
      d.stage = 'conflict';
      d.conflict = { a: r.conflicts[0].a, b: r.conflicts[0].b };
      this.broadcastRoom();
    } else if (r.stuck.length || !r.config) {
      d.stage = 'stuck';
      d.conflict = undefined;
      this.broadcastRoom();
    } else {
      this.settings = { ...this.settings, modules: d.modules };
      this.begin(r.config, d.picks.flatMap((rule, player) => (rule ? [{ rule, player }] : [])));
    }
  }

  draftPick(userId: number, rule: string) {
    const d = this.draft;
    const seat = this.seatOf(userId);
    if (this.phase !== 'draft' || !d || seat === null) throw new Error('There is no draft right now.');
    if (d.stage !== 'picking' || d.picks[seat] !== null) throw new Error('You have already picked.');
    if (!this.pool(seat).some((r) => r.id === rule)) throw new Error('You can’t pick that rule.');
    d.picks[seat] = rule;
    this.afterPick();
  }

  /** The host keeps one of two clashing rules; whoever picked the other picks again (or the module goes). */
  draftSettle(userId: number, keep: string, drop: string) {
    this.requireHost(userId);
    const d = this.draft;
    if (this.phase !== 'draft' || !d || d.stage !== 'conflict' || !d.conflict) throw new Error('Nothing to settle.');
    const pair = [d.conflict.a, d.conflict.b];
    if (!pair.includes(keep) || !pair.includes(drop) || keep === drop) throw new Error('Pick one of the two rules.');
    d.conflict = undefined;
    if (MODULES.some((m) => m.id === drop)) d.modules = d.modules.filter((m) => m !== drop);
    else d.picks.forEach((p, i) => { if (p === drop) { d.picks[i] = null; d.banned[i].push(drop, keep); } });
    this.botPicks();
    this.afterPick();
  }

  draftDrop(userId: number, rule: string) {
    this.requireHost(userId);
    const d = this.draft;
    if (this.phase !== 'draft' || !d || d.stage !== 'stuck') throw new Error('Nothing to drop.');
    if (!d.picks.includes(rule)) throw new Error('Nobody picked that.');
    d.picks.forEach((p, i) => { if (p === rule) { d.picks[i] = null; d.banned[i].push(rule); } });
    this.botPicks();
    this.afterPick();
  }

  // ---------- the game ----------

  private begin(config: GameConfig, drafted?: { rule: string; player: number }[]) {
    const seed = (Math.random() * 2 ** 31) >>> 0;
    const names = this.seats.map((s) => s.name);
    const state = replay(config, seed, [], names);
    const rated = this.rated;
    const matchId = this.hub.store.createMatch({
      code: this.code, hostId: this.hostId, config, seed, log: [], seats: this.seats, drafted, settings: JSON.stringify(this.settings),
    });
    this.game = { matchId, config, seed, state, events: [], actor: null, drafted, rated };
    this.draft = undefined;
    this.phase = 'playing';
    for (const s of this.seats) { s.botControl = false; s.resigned = false; }
    this.broadcastRoom();
    this.broadcastGame();
    this.scheduleBot();
  }

  /** Rebuilds a running game after a server restart. */
  static restore(hub: Hub, m: ActiveMatch): Room {
    let settings = defaultSettings();
    try { settings = cleanSettings(JSON.parse(m.settings)); } catch { /* keep defaults */ }
    const r = new Room(hub, m.code, m.hostId, settings);
    r.seats = m.seats.map((s) => ({ ...s, kind: s.bot ? 'bot' : 'human' }));
    const humans = new Set(r.humans());
    upgradeConfig(m.config);
    const state = replay(m.config, m.seed, m.log, r.seats.map((s) => s.name));
    r.game = { matchId: m.id, config: m.config, seed: m.seed, state, events: [], actor: null, drafted: m.drafted, rated: humans.size >= 2 };
    r.phase = 'playing';
    for (const id of humans) hub.setUserRoom(id, m.code);
    if (state.step === 'ended') r.finish();
    else r.scheduleBot();
    return r;
  }

  private persist() {
    const g = this.game;
    if (!g || this.phase !== 'playing') return;
    this.hub.store.saveProgress(g.matchId, g.state.log, this.seats, Object.keys(g.state.board).length);
  }

  private requireTurn(userId: number) {
    const g = this.game;
    const seat = this.seatOf(userId);
    if (!g || this.phase !== 'playing') throw new Error('No game is running.');
    if (seat === null) throw new Error('You’re not playing in this game.');
    if (g.state.current !== seat) throw new Error('It’s not your turn.');
    if (this.seats[seat].botControl) throw new Error('A bot is playing your seat. Rejoin to take it back.');
    return { g, seat };
  }

  private run(action: Action, seat: number) {
    const g = this.game!;
    try {
      apply(g.state, action);
    } catch (e) {
      // apply validates before it changes anything that matters, but rebuild to be certain.
      g.state = replay(g.config, g.seed, g.state.log, this.seats.map((s) => s.name));
      throw e;
    }
    g.events = [...g.state.events];
    g.actor = seat;
    if (g.state.step === 'ended') this.finish();
    else this.persist();
    this.broadcastGame();
    if (this.phase === 'ended') this.broadcastRoom();
    this.scheduleBot();
  }

  act(userId: number, action: Action, n: number) {
    const { g, seat } = this.requireTurn(userId);
    if (n !== g.state.log.length) {
      this.sync(userId);
      throw new Error('Your board was out of date. It has been refreshed.');
    }
    this.run(action, seat);
  }

  /** Lifts the tile you just placed back up, before you decide on a Wanderer. */
  undo(userId: number) {
    const { g } = this.requireTurn(userId);
    const last = g.state.log[g.state.log.length - 1];
    if (g.state.step !== 'claim' || last?.type !== 'place') throw new Error('Nothing to undo.');
    g.state = replay(g.config, g.seed, g.state.log.slice(0, -1), this.seats.map((s) => s.name));
    g.events = [];
    g.actor = null;
    this.persist();
    this.broadcastGame();
  }

  /** Someone has been gone too long on their turn: a bot plays their seat until they come back. */
  takeover(userId: number, seat: number) {
    const g = this.game;
    if (!g || this.phase !== 'playing') throw new Error('No game is running.');
    if (this.seatOf(userId) === null) throw new Error('You’re not playing in this game.');
    const s = this.seats[seat];
    if (!s || s.kind !== 'human' || s.userId === userId) throw new Error('Pick another player’s seat.');
    if (s.botControl) return;
    if (this.hub.isOnline(s.userId!) || this.hub.awayMs(s.userId!) < TAKEOVER_AFTER_S * 1000) throw new Error(`Wait until ${s.name} has been away ${TAKEOVER_AFTER_S} seconds.`);
    s.botControl = true;
    this.persist();
    this.broadcastRoom();
    this.scheduleBot();
  }

  resign(userId: number) {
    const seat = this.seatOf(userId);
    if (!this.game || this.phase !== 'playing' || seat === null) throw new Error('No game to resign.');
    const s = this.seats[seat];
    s.resigned = true;
    s.botControl = true;
    this.persist();
    this.broadcastRoom();
    this.scheduleBot();
    // If nobody is left playing, the bots finish it straight away.
    if (this.seats.every((x) => x.kind === 'bot' || x.botControl)) this.fastFinish();
  }

  private fastFinish() {
    const g = this.game!;
    let guard = 0;
    while (g.state.step !== 'ended' && guard++ < 10000) apply(g.state, botAction(g.state, g.seed + g.state.log.length));
    g.events = [];
    g.actor = null;
    this.finish();
    this.broadcastGame();
    this.broadcastRoom();
  }

  private scheduleBot() {
    if (this.botTimer) { clearTimeout(this.botTimer); this.botTimer = null; }
    const g = this.game;
    if (!g || this.phase !== 'playing' || g.state.step === 'ended') return;
    const seat = this.seats[g.state.current];
    if (!(seat.kind === 'bot' || seat.botControl)) return;
    const allBots = this.seats.every((x) => x.kind === 'bot' || x.botControl);
    const delay = (BOT_DELAY[g.state.step] ?? 700) * (allBots ? 0.4 : 1) * this.hub.botDelayScale;
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      if (!this.game || this.phase !== 'playing') return;
      const s = this.game.state;
      const cur = this.seats[s.current];
      if (!(cur.kind === 'bot' || cur.botControl)) return;
      try {
        this.run(botAction(s, this.game.seed + s.log.length), s.current);
      } catch (e) {
        console.error(`Bot move failed in room ${this.code}:`, e);
      }
    }, delay);
  }

  /** Scores the result, rates the people at the table and records the match. */
  private finish() {
    const g = this.game!;
    const s = g.state;
    const scores = s.players.map((p) => p.score);
    // Resigned players rank below everyone who stayed, whatever their score.
    const ranking = s.players.map((p, i) => (this.seats[i].resigned ? p.score - 1e6 : p.score));
    const pl = places(ranking);
    const humanSeats = this.seats.map((x, i) => ({ x, i })).filter(({ x }) => x.kind === 'human' && x.userId !== undefined);
    const rated = g.rated && new Set(humanSeats.map(({ x }) => x.userId)).size >= 2;
    const before = humanSeats.map(({ x }) => this.hub.store.user(x.userId!)?.rating ?? 1200);
    const deltas = rated ? eloChanges(humanSeats.map(({ i }, k) => ({ rating: before[k], result: ranking[i] }))) : humanSeats.map(() => 0);
    const rows: ResultRow[] = this.seats.map((x, i) => {
      const k = humanSeats.findIndex((h) => h.i === i);
      return {
        seat: i, name: x.name, userId: x.kind === 'human' ? x.userId : undefined, score: scores[i], place: pl[i],
        ratingBefore: k >= 0 ? before[k] : undefined, ratingAfter: k >= 0 ? before[k] + deltas[k] : undefined,
      };
    });
    this.hub.store.saveProgress(g.matchId, s.log, this.seats, Object.keys(s.board).length);
    this.hub.store.finishMatch(g.matchId, rows, rated, Object.keys(s.board).length);
    g.result = rows;
    g.rated = rated;
    this.phase = 'ended';
    if (this.botTimer) { clearTimeout(this.botTimer); this.botTimer = null; }
  }

  /** Back to the lobby with the same table and settings. */
  rematch(userId: number) {
    if (this.phase !== 'ended') throw new Error('The game isn’t over yet.');
    if (this.seatOf(userId) === null) throw new Error('You’re not at this table.');
    this.seats = this.seats.filter((x) => x.kind === 'bot' || (x.userId !== undefined && !this.left.has(x.userId) && this.hub.isOnline(x.userId)));
    this.left.clear();
    for (const x of this.seats) { x.botControl = false; x.resigned = false; }
    if (!this.humans().includes(this.hostId)) this.hostId = userId;
    this.game = undefined;
    this.phase = 'lobby';
    for (const id of this.humans()) this.hub.setUserRoom(id, this.code);
    this.broadcastRoom();
  }

  /** Someone connected or dropped: refresh seat dots, and again once a takeover becomes possible. */
  presenceChanged() {
    this.broadcastRoom();
    if (this.presenceTimer) clearTimeout(this.presenceTimer);
    if (this.phase !== 'playing') return;
    this.presenceTimer = setTimeout(() => { this.presenceTimer = null; this.broadcastRoom(); }, (TAKEOVER_AFTER_S + 1) * 1000);
  }
}
