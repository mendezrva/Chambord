import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { botAction, legalActions, type GameState } from '@glockenfels/engine';
import { PROTOCOL_VERSION, type GameView, type RoomView, type ServerMessage } from '@glockenfels/protocol';
import { eloChanges, expected, places } from '../src/elo';
import { GameServer } from '../src/server';

describe('elo', () => {
  it('matches classic Elo for two players', () => {
    expect(expected(1200, 1200)).toBeCloseTo(0.5);
    expect(eloChanges([{ rating: 1200, result: 10 }, { rating: 1200, result: 5 }])).toEqual([16, -16]);
    expect(eloChanges([{ rating: 1200, result: 5 }, { rating: 1200, result: 5 }])).toEqual([0, 0]);
  });
  it('rewards upsets more and stays roughly zero-sum for bigger tables', () => {
    const [under] = eloChanges([{ rating: 1000, result: 9 }, { rating: 1400, result: 1 }]);
    expect(under).toBeGreaterThan(16);
    const d = eloChanges([{ rating: 1300, result: 50 }, { rating: 1200, result: 40 }, { rating: 1100, result: 30 }, { rating: 1250, result: 30 }]);
    expect(Math.abs(d.reduce((a, b) => a + b, 0))).toBeLessThanOrEqual(2);
    expect(d[0]).toBeGreaterThan(0);
    expect(d[2]).toBeLessThan(0);
  });
  it('shares places on ties', () => {
    expect(places([30, 50, 30, 10])).toEqual([2, 1, 2, 4]);
  });
});

// ---------- a tiny test client ----------

class Client {
  ws: WebSocket;
  next = 1;
  waiting = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void }>();
  room: RoomView | null = null;
  game: GameView | null = null;
  pushes: ServerMessage[] = [];
  listeners: (() => void)[] = [];
  open: Promise<void>;

  constructor(port: number) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    this.open = new Promise((ok) => this.ws.once('open', () => ok()));
    this.ws.on('message', (raw) => {
      const m = JSON.parse(String(raw)) as ServerMessage;
      if (m.t === 'reply') {
        const w = this.waiting.get(m.id);
        this.waiting.delete(m.id);
        if (m.ok) w?.ok(m.data); else w?.fail(new Error(m.error));
      } else {
        this.pushes.push(m);
        if (m.t === 'room') this.room = m.room;
        if (m.t === 'game') this.game = m.game;
      }
      for (const l of this.listeners.splice(0)) l();
    });
  }

  async req<T = unknown>(msg: Record<string, unknown>): Promise<T> {
    await this.open;
    const id = this.next++;
    return new Promise<T>((ok, fail) => {
      this.waiting.set(id, { ok: ok as (v: unknown) => void, fail });
      this.ws.send(JSON.stringify({ ...msg, id }));
    });
  }

  /** Resolves once `test` holds, checking after every message. */
  until(test: () => boolean, ms = 20000): Promise<void> {
    if (test()) return Promise.resolve();
    return new Promise((ok, fail) => {
      const t = setTimeout(() => fail(new Error('timed out')), ms);
      const check = () => { if (test()) { clearTimeout(t); ok(); } else this.listeners.push(check); };
      this.listeners.push(check);
    });
  }

  close() { this.ws.close(); }
}

let server: GameServer | null = null;
const clients: Client[] = [];
afterEach(() => {
  for (const c of clients.splice(0)) c.close();
  server?.close();
  server = null;
});

async function start(file = ':memory:') {
  server = new GameServer({ port: 0, host: '127.0.0.1', dbFile: file, botDelayScale: 0 });
  return server.listen();
}
function client(port: number) {
  const c = new Client(port);
  clients.push(c);
  return c;
}

/** Plays the seat's turns with the bot until the game ends. */
async function playOut(c: Client, a: Client) {
  const both = [c, a];
  for (let guard = 0; guard < 3000; guard++) {
    const g = c.game!;
    if (g.state.step === 'ended') return;
    const mover = both.find((x) => x.game && x.room && x.room.mySeat === x.game.state.current && x.game.state.log.length === g.state.log.length);
    if (!mover) { await c.until(() => c.game!.state.log.length !== g.state.log.length || c.game!.state.step === 'ended'); continue; }
    const s = mover.game!.state as GameState;
    const act = botAction(s, guard);
    const n = s.log.length;
    await mover.req({ t: 'act', action: act, n });
    await c.until(() => c.game!.state.log.length > n || c.game!.state.step === 'ended');
    await a.until(() => a.game!.state.log.length > n || a.game!.state.step === 'ended');
  }
  throw new Error('game did not end');
}

describe('server', () => {
  it('signs up, rejects bad names and duplicate names, and resumes with a token', async () => {
    const port = await start();
    const a = client(port);
    await a.req({ t: 'hello', v: PROTOCOL_VERSION });
    await expect(a.req({ t: 'signup', name: 'x', pass: '1234' })).rejects.toThrow(/Usernames/);
    const r = await a.req<{ token: string; user: { name: string; rating: number } }>({ t: 'signup', name: 'Mark', pass: '1234' });
    expect(r.user.rating).toBe(1200);
    const b = client(port);
    await expect(b.req({ t: 'signup', name: 'mark', pass: '9999' })).rejects.toThrow(/taken/);
    await expect(b.req({ t: 'login', name: 'Mark', pass: 'nope' })).rejects.toThrow(/match/);
    const h = await b.req<{ user: { name: string } }>({ t: 'hello', v: PROTOCOL_VERSION, token: r.token });
    expect(h.user.name).toBe('Mark');
  });

  it('plays a full rated game between two people with a bot, validating moves and rating the result', async () => {
    const port = await start();
    const a = client(port), b = client(port);
    await a.req({ t: 'signup', name: 'Mark', pass: '1234' });
    const bu = await b.req<{ user: { id: number } }>({ t: 'signup', name: 'Will', pass: '1234' });

    // Friends: request, accept, then an invite.
    await a.req({ t: 'friendAdd', name: 'will' });
    await b.req({ t: 'friendAccept', userId: (await b.req<{ incoming: { id: number }[] }>({ t: 'friends' })).incoming[0].id });
    const fa = await a.req<{ friends: { online: boolean }[] }>({ t: 'friends' });
    expect(fa.friends[0].online).toBe(true);

    const { code } = await a.req<{ code: string }>({ t: 'roomCreate', settings: { modules: [], rules: ['quickGame'], ruleMode: 'pick', edits: { 'pieces.wanderer': 6, '__proto__.x': 1 }, preset: null } });
    await a.req({ t: 'invite', userId: bu.user.id });
    await b.until(() => b.pushes.some((p) => p.t === 'invite'));
    await expect(b.req({ t: 'roomStart' })).rejects.toThrow(/not in a game/);
    await b.req({ t: 'roomJoin', code });
    await expect(b.req({ t: 'roomBot', add: true })).rejects.toThrow(/host/);
    await a.req({ t: 'roomBot', add: true });
    await a.until(() => a.room?.seats.length === 3);
    expect(a.room!.rated).toBe(true);
    await a.req({ t: 'roomStart' });
    await a.until(() => !!a.game);
    await b.until(() => !!b.game);
    expect(a.game!.state.config.pieces.wanderer).toBe(6);
    expect(({} as Record<string, unknown>).x).toBeUndefined();

    // Hidden information stays hidden.
    expect(a.game!.state.deck.every((t) => t === '?')).toBe(true);
    expect(a.game!.state.seed).toBe(0);

    // Out-of-turn and illegal moves are refused.
    const s = a.game!.state;
    const notMine = a.room!.mySeat === s.current ? b : a;
    await expect(notMine.req({ t: 'act', action: legalActions(s)[0], n: s.log.length })).rejects.toThrow(/not your turn/);
    const mover = notMine === a ? b : a;
    if (s.step === 'place') await expect(mover.req({ t: 'act', action: { type: 'place', hand: 0, x: 50, z: 50, rot: 0 }, n: s.log.length })).rejects.toThrow(/fit/);

    await playOut(a, b);
    await a.until(() => !!a.game?.result && a.room?.phase === 'ended');
    const res = a.game!.result!;
    expect(res).toHaveLength(3);
    expect(a.game!.rated).toBe(true);
    const people = res.filter((r) => r.userId !== undefined);
    expect(people).toHaveLength(2);
    expect(people.reduce((t, r) => t + (r.ratingAfter! - r.ratingBefore!), 0)).toBeLessThanOrEqual(1);

    const hist = await a.req<{ rated: boolean; players: unknown[] }[]>({ t: 'history' });
    expect(hist).toHaveLength(1);
    expect(hist[0].players).toHaveLength(3);
    const lb = await b.req<{ name: string }[]>({ t: 'leaderboard' });
    expect(lb.map((u) => u.name).sort()).toEqual(['Mark', 'Will']);
    const rec = await b.req<{ log: unknown[]; seed: number }>({ t: 'match', matchId: a.game!.matchId });
    expect(rec.log.length).toBe(a.game!.state.log.length);
    expect(rec.seed).not.toBe(0);

    // Mark walks away from the finished table; Will's rematch keeps Will and the bot.
    await a.req({ t: 'roomLeave' });
    await b.until(() => b.room?.hostId === bu.user.id);
    await b.req({ t: 'rematch' });
    await b.until(() => b.room?.phase === 'lobby');
    expect(b.room!.seats.map((x) => x.kind)).toEqual(['human', 'bot']);
    // Mark can host a new game right away.
    await a.req({ t: 'roomCreate', settings: { modules: [], rules: [], ruleMode: 'pick', edits: {}, preset: null } });
  }, 60000);

  it('lets a bot take over for someone who left, gives the seat back when they return, and resumes after a restart', async () => {
    const file = `/tmp/glock-test-${process.pid}-${Date.now()}.db`;
    let port = await start(file);
    const a = client(port), b = client(port);
    await a.req({ t: 'signup', name: 'Anna', pass: '1234' });
    const tb = await b.req<{ token: string }>({ t: 'signup', name: 'Ben', pass: '1234' });
    const { code } = await a.req<{ code: string }>({ t: 'roomCreate', settings: { modules: [], rules: ['quickGame'], ruleMode: 'pick', edits: {}, preset: null } });
    await b.req({ t: 'roomJoin', code });
    await a.req({ t: 'roomStart' });
    await a.until(() => !!a.game);
    const benSeat = 1;
    // Stepping away from a running game keeps the seat and blocks hosting another.
    expect(await b.req({ t: 'roomLeave' })).toEqual({ keep: code });
    await expect(b.req({ t: 'roomCreate', settings: { modules: [], rules: [], ruleMode: 'pick', edits: {}, preset: null } })).rejects.toThrow(/still in a game/);
    // Ben drops off.
    b.close();
    await a.until(() => a.room?.seats[benSeat].online === false);
    await expect(a.req({ t: 'takeover', seat: benSeat })).rejects.toThrow(/Wait/);
    // Pretend he has been gone a while.
    (server as unknown as { lastSeen: Map<number, number> }).lastSeen.set(a.room!.seats[benSeat].userId!, Date.now() - 60000);
    await a.req({ t: 'takeover', seat: benSeat });
    await a.until(() => a.room?.seats[benSeat].botControl === true);
    // Anna makes a move if it's hers, then the bot answers for Ben.
    if (a.game!.state.current === 0) {
      const n = a.game!.state.log.length;
      await a.req({ t: 'act', action: botAction(a.game!.state, 1), n });
    }
    await a.until(() => a.game!.state.current === 0 || a.game!.state.step === 'ended');
    const logLen = a.game!.state.log.length;

    // Restart the server: the game is still there.
    server!.close();
    port = await start(file);
    const a2 = client(port), b2 = client(port);
    await a2.req({ t: 'login', name: 'Anna', pass: '1234' });
    await a2.until(() => !!a2.game);
    expect(a2.game!.state.log.length).toBe(logLen);
    // Ben comes back and has his seat again.
    const h = await b2.req<{ roomCode?: string }>({ t: 'hello', v: PROTOCOL_VERSION, token: tb.token });
    expect(h.roomCode).toBe(code);
    await b2.until(() => b2.room?.seats[benSeat].botControl === false);
    // Ben resigns, and is ranked last.
    await b2.req({ t: 'resign' });
    await a2.until(() => a2.room?.seats[benSeat].resigned === true);
    for (let i = 0; i < 3000 && a2.game!.state.step !== 'ended'; i++) {
      const g = a2.game!.state;
      if (g.current === 0) await a2.req({ t: 'act', action: botAction(g, i), n: g.log.length }).catch(() => undefined);
      await a2.until(() => a2.game!.state.log.length !== g.log.length || a2.game!.state.step === 'ended');
    }
    await a2.until(() => a2.room?.phase === 'ended', 30000);
    const ben = a2.game!.result!.find((r) => r.seat === benSeat)!;
    expect(ben.place).toBe(2);
  }, 60000);

  it('runs a secret draft: picks stay hidden until all are in, clashes go to the host', async () => {
    const port = await start();
    const a = client(port), b = client(port);
    await a.req({ t: 'signup', name: 'Host', pass: '1234' });
    await b.req({ t: 'signup', name: 'Guest', pass: '1234' });
    const { code } = await a.req<{ code: string }>({ t: 'roomCreate', settings: { modules: [], rules: [], ruleMode: 'draft', edits: {}, preset: null } });
    await b.req({ t: 'roomJoin', code });
    await a.req({ t: 'roomStart' });
    await b.until(() => b.room?.phase === 'draft');
    await a.req({ t: 'draftPick', rule: 'bigTowns' });
    await b.until(() => b.room!.draft!.picked[0]);
    expect(b.room!.draft!.reveal).toBeNull();
    await b.req({ t: 'draftPick', rule: 'townTax' });
    await a.until(() => a.room?.draft?.stage === 'conflict');
    await expect(b.req({ t: 'draftSettle', keep: 'townTax', drop: 'bigTowns' })).rejects.toThrow(/host/);
    await a.req({ t: 'draftSettle', keep: 'bigTowns', drop: 'townTax' });
    await b.until(() => b.room?.draft?.stage === 'picking' && b.room.draft.mine === null);
    expect(b.room!.draft!.pool).not.toContain('townTax');
    await b.req({ t: 'draftPick', rule: 'pilgrims' });
    await a.until(() => !!a.game);
    expect(a.game!.drafted).toEqual([{ rule: 'bigTowns', player: 0 }, { rule: 'pilgrims', player: 1 }]);
    expect(a.game!.state.config.scoring.town.perTile).toBe(3);
    expect(a.game!.state.config.scoring.monastery.complete).toBe(12);
  }, 30000);
});
