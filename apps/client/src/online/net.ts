/**
 * The connection to the game server: one WebSocket that reconnects on its own, signs back in
 * with the saved token, and keeps the latest room and game the server pushed. Components read
 * it through `useNet()`, which re-renders them whenever anything here changes.
 */
import { useSyncExternalStore } from 'react';
import { PROTOCOL_VERSION, type GameView, type HelloReply, type Request, type RoomView, type ServerMessage, type UserView } from '@glockenfels/protocol';

const TOKEN_KEY = 'glockenfels.token.v1';
const SERVER_KEY = 'glockenfels.server.v1';

const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string | null) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } },
};

/** The server's WebSocket address: ?server=… (remembered), a build-time setting, or this site. */
export function serverUrl(): string {
  const q = new URLSearchParams(location.search).get('server');
  if (q) store.set(SERVER_KEY, q);
  const base = q || store.get(SERVER_KEY) || (import.meta.env.VITE_SERVER as string | undefined) || '';
  if (base) {
    const u = new URL(base.includes('://') ? base : `https://${base}`);
    u.protocol = u.protocol === 'http:' || u.protocol === 'ws:' ? 'ws:' : 'wss:';
    u.pathname = '/ws';
    return u.toString();
  }
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

/** Link a friend can open to join a room. */
export function inviteLink(code: string) {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('join', code);
  const custom = store.get(SERVER_KEY);
  if (custom) u.searchParams.set('server', custom);
  return u.toString();
}

export interface Invite { from: UserView; code: string; at: number }

type Pending = { ok: (v: unknown) => void; fail: (e: Error) => void };

class Net {
  status: 'idle' | 'connecting' | 'open' | 'offline' = 'idle';
  /** True once the first hello has answered, so we know whether we're signed in. */
  ready = false;
  user: UserView | null = null;
  room: RoomView | null = null;
  game: GameView | null = null;
  /** Counts game pushes, so screens can tell a new state from the same one. */
  gameN = 0;
  invites: Invite[] = [];
  /** A running game I stepped away from: the server still sends it, but I'm looking at the home screen. */
  awayFrom: string | null = null;
  friendsTick = 0;
  version = 0;

  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private listeners = new Set<() => void>();
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private wanted = false;

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private emit() { this.version++; for (const l of this.listeners) l(); }

  connect() {
    this.wanted = true;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    this.status = 'connecting';
    this.emit();
    let ws: WebSocket;
    try {
      ws = new WebSocket(serverUrl());
    } catch {
      this.status = 'offline';
      this.emit();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.status = 'open';
      this.send<HelloReply>({ t: 'hello', v: PROTOCOL_VERSION, token: store.get(TOKEN_KEY) ?? undefined })
        .then((r) => {
          this.user = r.user;
          if (!r.user) store.set(TOKEN_KEY, null);
          if (!r.roomCode) { this.room = null; this.game = null; }
          this.ready = true;
          this.emit();
        })
        .catch(() => { this.ready = true; this.emit(); });
      this.emit();
    };
    ws.onmessage = (e) => this.onMessage(JSON.parse(String(e.data)) as ServerMessage);
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      for (const p of this.pending.values()) p.fail(new Error('Lost the connection. Reconnecting…'));
      this.pending.clear();
      this.status = 'offline';
      this.emit();
      if (this.wanted) {
        const wait = Math.min(15000, 500 * 2 ** this.retry++);
        this.retryTimer = setTimeout(() => this.connect(), wait);
      }
    };
  }

  /** Reconnect now (after the phone wakes up, or from a Retry button). */
  reconnect() {
    this.retry = 0;
    if (this.status !== 'open') { this.ws?.close(); this.ws = null; this.connect(); }
  }

  private onMessage(m: ServerMessage) {
    switch (m.t) {
      case 'reply': {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.ok) p?.ok(m.data); else p?.fail(new Error(m.error));
        return;
      }
      case 'room':
        this.room = m.room;
        if (!m.room || m.room.phase === 'lobby' || m.room.phase === 'draft') this.game = null;
        break;
      case 'game':
        this.game = m.game;
        this.gameN++;
        break;
      case 'invite':
        this.invites = [...this.invites.filter((i) => i.code !== m.code), { from: m.from, code: m.code, at: Date.now() }];
        break;
      case 'friends':
        this.friendsTick++;
        break;
    }
    this.emit();
  }

  send<T = unknown>(req: Request): Promise<T> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Not connected to the server.'));
    const id = this.nextId++;
    return new Promise<T>((ok, fail) => {
      this.pending.set(id, { ok: ok as (v: unknown) => void, fail });
      ws.send(JSON.stringify({ ...req, id }));
    });
  }

  async signIn(kind: 'signup' | 'login', name: string, pass: string) {
    const r = await this.send<HelloReply>({ t: kind, name, pass });
    store.set(TOKEN_KEY, r.token ?? null);
    this.user = r.user;
    this.emit();
  }

  async signOut() {
    await this.send({ t: 'logout' }).catch(() => undefined);
    store.set(TOKEN_KEY, null);
    this.user = null;
    this.room = null;
    this.game = null;
    this.emit();
  }

  /** Refreshes my rating and record. */
  async refreshMe() {
    const u = await this.send<UserView>({ t: 'me' }).catch(() => null);
    if (u) { this.user = u; this.emit(); }
  }

  /** Step away from the room on screen. A running game keeps my seat; anything else is left for good. */
  async leaveRoom() {
    const r = await this.send<{ keep?: string } | null>({ t: 'roomLeave' });
    this.awayFrom = r?.keep ?? null;
    this.emit();
  }

  returnToGame() {
    this.awayFrom = null;
    this.emit();
  }

  dismissInvite(code: string) {
    this.invites = this.invites.filter((i) => i.code !== code);
    this.emit();
  }
}

export const net = new Net();

if (typeof document !== 'undefined') {
  // Phones drop sockets while asleep; reconnect as soon as the page is visible again.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && net.status === 'offline') net.reconnect(); });
  window.addEventListener('online', () => { if (net.status === 'offline') net.reconnect(); });
}

export function useNet() {
  useSyncExternalStore(net.subscribe, () => net.version);
  return net;
}
