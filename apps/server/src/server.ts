/**
 * The game server: one Node process serving the built client and a WebSocket at /ws.
 * Accounts, friends, rooms and games all go over the socket as small JSON requests.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { randomInt } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { NAME_RE, NAME_RULES, PROTOCOL_VERSION, type ClientMessage, type FriendsView, type HelloReply, type Request, type ServerMessage, type UserView } from '@glockenfels/protocol';
import { Store } from './db';
import { cleanSettings, Room, type Hub } from './room';

export interface ServerOptions {
  port: number;
  host?: string;
  dbFile: string;
  /** Built client to serve (apps/client/dist). Optional in tests. */
  staticDir?: string;
  botDelayScale?: number;
}

interface Conn { ws: WebSocket; user: UserView | null; token?: string; alive: boolean }

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

export class GameServer implements Hub {
  store: Store;
  botDelayScale: number;
  private conns = new Map<number, Set<Conn>>();
  private lastSeen = new Map<number, number>();
  private userRoom = new Map<number, string>();
  rooms = new Map<string, Room>();
  private http = createServer((req, res) => void this.serveStatic(req, res));
  private wss = new WebSocketServer({ noServer: true, perMessageDeflate: { threshold: 1024 }, maxPayload: 256 * 1024 });
  private gzCache = new Map<string, { body: Buffer; gz: Buffer | null; type: string; immutable: boolean }>();
  private heartbeat: ReturnType<typeof setInterval>;

  constructor(private o: ServerOptions) {
    this.store = new Store(o.dbFile);
    this.botDelayScale = o.botDelayScale ?? 1;
    for (const m of this.store.activeMatches()) {
      try {
        const r = Room.restore(this, m);
        if (r.phase === 'playing') this.rooms.set(r.code, r);
      } catch (e) {
        console.error(`Could not restore match ${m.id}:`, e);
        this.store.abandonMatch(m.id);
      }
    }
    this.http.on('upgrade', (req, socket, head) => {
      if (!req.url?.startsWith('/ws')) { socket.destroy(); return; }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws));
    });
    // Drop sockets that stop answering pings (a phone that went to sleep), so presence stays true.
    this.heartbeat = setInterval(() => {
      for (const set of this.conns.values()) for (const c of set) {
        if (!c.alive) { c.ws.terminate(); continue; }
        c.alive = false;
        c.ws.ping();
      }
    }, 15000);
  }

  listen(): Promise<number> {
    return new Promise((ok) => this.http.listen(this.o.port, this.o.host ?? '0.0.0.0', () => {
      const a = this.http.address();
      ok(typeof a === 'object' && a ? a.port : this.o.port);
    }));
  }

  private closing = false;

  close() {
    this.closing = true;
    clearInterval(this.heartbeat);
    // Rooms stay in the database; a restart restores running games.
    for (const c of this.wss.clients) c.terminate();
    this.wss.close();
    this.http.close();
    this.store.db.close();
  }

  // ---------- Hub ----------

  send(userId: number, msg: ServerMessage) {
    const set = this.conns.get(userId);
    if (!set) return;
    const data = JSON.stringify(msg);
    for (const c of set) if (c.ws.readyState === c.ws.OPEN) c.ws.send(data);
  }
  isOnline(userId: number) { return (this.conns.get(userId)?.size ?? 0) > 0; }
  awayMs(userId: number) { return this.isOnline(userId) ? 0 : Date.now() - (this.lastSeen.get(userId) ?? 0); }
  setUserRoom(userId: number, code: string | null) {
    if (code) this.userRoom.set(userId, code); else this.userRoom.delete(userId);
  }
  roomGone(code: string) {
    this.rooms.delete(code);
    for (const [u, c] of this.userRoom) if (c === code) this.userRoom.delete(u);
  }

  // ---------- connections ----------

  private onConnection(ws: WebSocket) {
    const c: Conn = { ws, user: null, alive: true };
    ws.on('pong', () => { c.alive = true; });
    ws.on('message', (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw));
        if (typeof msg !== 'object' || !msg || typeof msg.t !== 'string') throw new Error();
      } catch {
        return;
      }
      try {
        const data = this.handle(c, msg);
        ws.send(JSON.stringify({ t: 'reply', id: msg.id, ok: true, data } satisfies ServerMessage));
      } catch (e) {
        ws.send(JSON.stringify({ t: 'reply', id: msg.id, ok: false, error: (e as Error).message || 'Something went wrong.' } satisfies ServerMessage));
      }
    });
    ws.on('close', () => { try { this.signOut(c); } catch (e) { console.error(e); } });
  }

  private signIn(c: Conn, user: UserView, token: string) {
    if (c.user) this.signOut(c);
    c.user = user;
    c.token = token;
    let set = this.conns.get(user.id);
    const wasOnline = !!set?.size;
    if (!set) this.conns.set(user.id, (set = new Set()));
    set.add(c);
    if (!wasOnline) this.presence(user.id);
  }

  private signOut(c: Conn) {
    const u = c.user;
    if (!u) return;
    c.user = null;
    const set = this.conns.get(u.id);
    set?.delete(c);
    if (set && !set.size) {
      this.conns.delete(u.id);
      this.lastSeen.set(u.id, Date.now());
      this.presence(u.id);
    }
  }

  /** Tell the room and online friends that someone came or went. */
  private presence(userId: number) {
    if (this.closing) return;
    try {
      const code = this.userRoom.get(userId);
      if (code) this.rooms.get(code)?.presenceChanged();
      for (const f of this.store.friendIds(userId)) this.send(f, { t: 'friends' });
    } catch (e) {
      console.error('Presence update failed:', e);
    }
  }

  private me(c: Conn): UserView {
    if (!c.user) throw new Error('Sign in first.');
    // Refresh rating and counts, which change when games end.
    c.user = this.store.user(c.user.id) ?? c.user;
    return c.user;
  }

  private roomOf(userId: number): Room {
    const code = this.userRoom.get(userId);
    const r = code ? this.rooms.get(code) : undefined;
    if (!r) throw new Error('You’re not in a game.');
    return r;
  }

  private newCode() {
    for (;;) {
      let s = '';
      for (let i = 0; i < 5; i++) s += CODE_LETTERS[randomInt(CODE_LETTERS.length)];
      if (!this.rooms.has(s)) return s;
    }
  }

  private friendsView(id: number): FriendsView {
    const v = this.store.friendsOf(id);
    for (const f of v.friends) {
      f.online = this.isOnline(f.user.id);
      const code = this.userRoom.get(f.user.id);
      const r = code ? this.rooms.get(code) : undefined;
      if (r) { f.roomCode = r.phase === 'lobby' ? r.code : undefined; f.playing = r.phase === 'playing' || r.phase === 'draft'; }
    }
    return v;
  }

  // ---------- requests ----------

  handle(c: Conn, m: Request): unknown {
    switch (m.t) {
      case 'hello': {
        if (m.v !== PROTOCOL_VERSION) throw new Error('The game was updated. Reload the page.');
        const u = typeof m.token === 'string' ? this.store.userForToken(m.token) : null;
        if (!u) return { user: null } satisfies HelloReply;
        this.signIn(c, u, m.token!);
        const code = this.userRoom.get(u.id);
        const r = code ? this.rooms.get(code) : undefined;
        if (r) r.join(u);
        return { user: u, roomCode: r?.code } satisfies HelloReply;
      }
      case 'signup': {
        const name = String(m.name ?? '').trim().replace(/\s+/g, ' ');
        const pass = String(m.pass ?? '');
        if (!NAME_RE.test(name)) throw new Error(`Usernames are ${NAME_RULES}`);
        if (pass.length < 4 || pass.length > 64) throw new Error('Pick a passcode of at least 4 characters.');
        if (this.store.userByName(name)) throw new Error('That username is taken.');
        const u = this.store.createUser(name, pass);
        const token = this.store.newToken(u.id);
        this.signIn(c, u, token);
        return { user: u, token } satisfies HelloReply;
      }
      case 'login': {
        const u = this.store.checkPass(String(m.name ?? ''), String(m.pass ?? ''));
        if (!u) throw new Error('That username and passcode don’t match.');
        const token = this.store.newToken(u.id);
        this.signIn(c, u, token);
        const code = this.userRoom.get(u.id);
        const r = code ? this.rooms.get(code) : undefined;
        if (r) r.join(u);
        return { user: u, token, roomCode: r?.code } satisfies HelloReply;
      }
      case 'logout': {
        if (c.token) this.store.dropToken(c.token);
        this.signOut(c);
        return null;
      }
      case 'me':
        return this.me(c);
      case 'leaderboard':
        return this.store.leaderboard();
      case 'history': {
        const me = this.me(c);
        return this.store.history(typeof m.userId === 'number' ? m.userId : me.id);
      }
      case 'match': {
        this.me(c);
        const r = this.store.match(Number(m.matchId));
        if (!r) throw new Error('No finished game with that number.');
        return r;
      }
      case 'friends':
        return this.friendsView(this.me(c).id);
      case 'friendAdd': {
        const me = this.me(c);
        const other = this.store.userByName(String(m.name ?? ''));
        if (!other) throw new Error('Nobody has that username.');
        if (other.id === me.id) throw new Error('That’s you!');
        const now = this.store.addFriend(me.id, other.id);
        this.send(other.id, { t: 'friends' });
        return { friends: now };
      }
      case 'friendAccept': {
        const me = this.me(c);
        if (!this.store.acceptFriend(me.id, Number(m.userId))) throw new Error('No request from them.');
        this.send(Number(m.userId), { t: 'friends' });
        return null;
      }
      case 'friendRemove': {
        const me = this.me(c);
        this.store.removeFriend(me.id, Number(m.userId));
        this.send(Number(m.userId), { t: 'friends' });
        return null;
      }
      case 'roomCreate': {
        const me = this.me(c);
        this.leaveCurrent(me.id);
        const code = this.newCode();
        const r = new Room(this, code, me.id, cleanSettings(m.settings));
        this.rooms.set(code, r);
        r.join(me);
        return { code };
      }
      case 'roomJoin': {
        const me = this.me(c);
        const code = String(m.code ?? '').trim().toUpperCase();
        const r = this.rooms.get(code);
        if (!r) throw new Error('No game with that code. Check it with whoever invited you.');
        if (this.userRoom.get(me.id) !== code) this.leaveCurrent(me.id);
        r.join(me);
        return { code };
      }
      case 'roomLeave': {
        const me = this.me(c);
        const code = this.userRoom.get(me.id);
        const r = code ? this.rooms.get(code) : undefined;
        if (r && r.phase === 'playing' && r.seatOf(me.id) !== null) return { keep: r.code };
        r?.leave(me.id);
        this.setUserRoom(me.id, null);
        this.send(me.id, { t: 'room', room: null });
        return null;
      }
      case 'roomSettings': return this.roomOf(this.me(c).id).setSettings(c.user!.id, m.settings), null;
      case 'roomBot': return this.roomOf(this.me(c).id).addBot(c.user!.id), null;
      case 'roomRemoveSeat': return this.roomOf(this.me(c).id).removeSeat(c.user!.id, Number(m.seat)), null;
      case 'roomStart': return this.roomOf(this.me(c).id).start(c.user!.id), null;
      case 'invite': {
        const me = this.me(c);
        const r = this.roomOf(me.id);
        const to = Number(m.userId);
        if (!this.store.areFriends(me.id, to)) throw new Error('You can only invite friends this way. Share the link instead.');
        if (!this.isOnline(to)) throw new Error('They’re offline right now. Share the link instead.');
        this.send(to, { t: 'invite', from: me, code: r.code });
        return null;
      }
      case 'draftPick': return this.roomOf(this.me(c).id).draftPick(c.user!.id, String(m.rule)), null;
      case 'draftSettle': return this.roomOf(this.me(c).id).draftSettle(c.user!.id, String(m.keep), String(m.drop)), null;
      case 'draftDrop': return this.roomOf(this.me(c).id).draftDrop(c.user!.id, String(m.rule)), null;
      case 'act': {
        if (!m.action || typeof m.action !== 'object') throw new Error('Bad move.');
        return this.roomOf(this.me(c).id).act(c.user!.id, m.action, Number(m.n)), null;
      }
      case 'undo': return this.roomOf(this.me(c).id).undo(c.user!.id), null;
      case 'takeover': return this.roomOf(this.me(c).id).takeover(c.user!.id, Number(m.seat)), null;
      case 'resign': return this.roomOf(this.me(c).id).resign(c.user!.id), null;
      case 'rematch': return this.roomOf(this.me(c).id).rematch(c.user!.id), null;
      default:
        throw new Error('Unknown request.');
    }
  }

  /** Leaving a lobby to join or start another. A running game must be finished or resigned first. */
  private leaveCurrent(userId: number) {
    const code = this.userRoom.get(userId);
    const r = code ? this.rooms.get(code) : undefined;
    if (!r) return;
    if (r.phase === 'playing' && r.seatOf(userId) !== null && !r.seats[r.seatOf(userId)!].resigned) {
      throw new Error('You’re still in a game. Finish it or resign first.');
    }
    r.leave(userId);
  }

  // ---------- static files ----------

  private async serveStatic(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return; }
    const root = this.o.staticDir;
    if (!root) { res.writeHead(404); res.end('No client build. Run npm run build.'); return; }
    const base = resolve(root);
    let file = normalize(join(base, decodeURIComponent(url.pathname)));
    if (!file.startsWith(base)) { res.writeHead(403); res.end(); return; }
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    } catch {
      file = join(base, 'index.html'); // single-page app: unknown paths get the game
    }
    try {
      let entry = this.gzCache.get(file);
      if (!entry) {
        const body = await readFile(file);
        const type = MIME[extname(file)] ?? 'application/octet-stream';
        const gz = /text|javascript|json|svg/.test(type) && body.length > 1024 ? gzipSync(body) : null;
        entry = { body, gz, type, immutable: file.includes(`${join(base, 'assets')}`) };
        this.gzCache.set(file, entry);
      }
      const useGz = entry.gz && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
      res.writeHead(200, {
        'content-type': entry.type,
        'cache-control': entry.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
        ...(useGz ? { 'content-encoding': 'gzip', vary: 'accept-encoding' } : {}),
      });
      res.end(useGz ? entry.gz : entry.body);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  }
}
