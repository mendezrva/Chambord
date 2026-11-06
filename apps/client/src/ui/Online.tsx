/**
 * Online play: sign in with a username, the home screen (friends, invites, leaderboard, match
 * history), the room lobby with its invite link, the secret rule draft on everyone's own device,
 * and the game itself, which the server runs and checks move by move.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DRAFT_RULES, findRule, MODULES, PRESETS, replay, type Action, type GameState } from '@glockenfels/engine';
import { NAME_RULES, TAKEOVER_AFTER_S, type FriendsView, type HistoryRow, type MatchRecord, type RoomSettings, type RoomView, type UserView } from '@glockenfels/protocol';
import { inviteLink, net, useNet } from '../online/net';
import type { Batch, GameController, PlaySeat } from '../game/session';
import { playerCss } from '../scene/GameBoard';
import { GameScreen } from './GameScreen';
import { builderFromSettings, Setup } from './Setup';

const ruleName = (id: string) => findRule(id)?.name ?? id;
const errText = (e: unknown) => (e as Error)?.message ?? 'Something went wrong.';

/** Runs a server request, showing its error in a toast-like line. */
function useAction() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(f: () => Promise<T>) => {
    setBusy(true);
    setError(null);
    try { return await f(); } catch (e) { setError(errText(e)); return undefined; } finally { setBusy(false); }
  }, []);
  return { error, setError, busy, run };
}

export function Online({ onBack, joinCode }: { onBack: () => void; joinCode?: string | null }) {
  const n = useNet();
  const [pendingJoin, setPendingJoin] = useState(joinCode ?? null);
  const [view, setView] = useState<{ kind: 'home' } | { kind: 'rules' } | { kind: 'replay'; rec: MatchRecord }>({ kind: 'home' });
  const { error, setError, run } = useAction();

  useEffect(() => { net.connect(); }, []);

  // Opened from an invite link: join as soon as we're signed in.
  useEffect(() => {
    if (!pendingJoin || !n.user || n.status !== 'open') return;
    const code = pendingJoin;
    setPendingJoin(null);
    if (n.room?.code === code) return;
    void run(() => net.send({ t: 'roomJoin', code }));
    const u = new URL(location.href);
    u.searchParams.delete('join');
    history.replaceState(null, '', u);
  }, [pendingJoin, n.user, n.status, n.room, run]);

  if (!n.ready) {
    return (
      <Shell onBack={onBack}>
        {n.status === 'offline' ? (
          <section className="card open"><div className="card-body">
            <p><b>Can’t reach the game server.</b></p>
            <p className="note">Check your connection. If you’re running it yourself, start it with <code>npm run online</code>.</p>
            <button type="button" className="primary" onClick={() => net.reconnect()}>Try again</button>
          </div></section>
        ) : <div className="center-note"><div className="spinner" aria-hidden="true" /><p>Connecting…</p></div>}
      </Shell>
    );
  }

  if (!n.user) return <Shell onBack={onBack}><SignIn joining={!!pendingJoin} /></Shell>;

  if (view.kind === 'replay') return <ReplayGame rec={view.rec} onClose={() => setView({ kind: 'home' })} />;

  const room = n.room && n.room.code !== n.awayFrom ? n.room : null;
  if (room && (room.phase === 'playing' || room.phase === 'ended') && n.game) return <OnlineGame room={room} />;

  if (room && view.kind === 'rules' && room.hostId === n.user.id && room.phase === 'lobby') {
    return (
      <Setup
        online={{ initial: builderFromSettings(room.settings, room.seats.length), onCancel: () => setView({ kind: 'home' }) }}
        onStart={(b) => {
          const settings: RoomSettings = { modules: b.modules, rules: b.rules, ruleMode: b.ruleMode, edits: b.edits, preset: b.preset };
          void run(() => net.send({ t: 'roomSettings', settings })).then(() => setView({ kind: 'home' }));
        }}
      />
    );
  }

  return (
    <Shell onBack={room ? undefined : onBack} status={n.status}>
      <Invites />
      {error && <p className="error" role="alert" onClick={() => setError(null)}>{error}</p>}
      {room?.phase === 'draft' ? <OnlineDraft room={room} me={n.user} />
        : room ? <Lobby room={room} me={n.user} onRules={() => setView({ kind: 'rules' })} />
        : <Home me={n.user} onReplay={(rec) => setView({ kind: 'replay', rec })} />}
    </Shell>
  );
}

function Shell({ children, onBack, status }: { children: React.ReactNode; onBack?: () => void; status?: string }) {
  return (
    <div className="setup online">
      <div className="setup-inner">
        <header className="online-head">
          {onBack ? <button type="button" className="link" onClick={onBack}>‹ Back</button> : <span />}
          <h1>Glockenfels <small>online</small></h1>
          {status && status !== 'open' ? <span className="chip warn">Reconnecting…</span> : <span />}
        </header>
        {children}
      </div>
    </div>
  );
}

// ---------- sign in ----------

function SignIn({ joining }: { joining: boolean }) {
  const [mode, setMode] = useState<'signup' | 'login'>('signup');
  const [name, setName] = useState('');
  const [pass, setPass] = useState('');
  const { error, busy, run } = useAction();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void run(() => net.signIn(mode, name, pass));
  };
  return (
    <form className="card open signin" onSubmit={submit}>
      <div className="card-head static"><span>{joining ? 'Sign in to join the game' : mode === 'signup' ? 'Pick a username' : 'Welcome back'}</span></div>
      <div className="card-body">
        <div className="seg">
          <button type="button" aria-pressed={mode === 'signup'} onClick={() => setMode('signup')}>New player</button>
          <button type="button" aria-pressed={mode === 'login'} onClick={() => setMode('login')}>I have an account</button>
        </div>
        <label className="field"><span>Username</span>
          <input autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={16} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. mark" />
        </label>
        <label className="field"><span>Passcode</span>
          <input type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} maxLength={64} value={pass} onChange={(e) => setPass(e.target.value)} placeholder="4 or more characters" />
        </label>
        <p className="note">{mode === 'signup' ? `${NAME_RULES} No email needed: the passcode lets you sign in on your other devices.` : 'Use the same username and passcode as on your other device.'}</p>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="primary wide" disabled={busy || name.trim().length < 3 || pass.length < 4}>{mode === 'signup' ? 'Create account' : 'Sign in'}</button>
      </div>
    </form>
  );
}

// ---------- invites ----------

function Invites() {
  const n = useNet();
  if (!n.invites.length) return null;
  return (
    <div className="invites">
      {n.invites.map((i) => (
        <div key={i.code} className="invite" role="alert">
          <span><b>{i.from.name}</b> invited you to a game</span>
          <button type="button" onClick={() => net.dismissInvite(i.code)}>Not now</button>
          <button type="button" className="primary" onClick={() => { net.dismissInvite(i.code); void net.send({ t: 'roomJoin', code: i.code }).catch((e) => alert(errText(e))); }}>Join</button>
        </div>
      ))}
    </div>
  );
}

// ---------- home ----------

function useFriends() {
  const n = useNet();
  const [v, setV] = useState<FriendsView | null>(null);
  useEffect(() => {
    if (n.status !== 'open' || !n.user) return;
    let live = true;
    void net.send<FriendsView>({ t: 'friends' }).then((x) => { if (live) setV(x); }).catch(() => undefined);
    return () => { live = false; };
  }, [n.friendsTick, n.status, n.user, n.room?.code]);
  return v;
}

function Rating({ u }: { u: UserView }) {
  return <span className="rating" title="Elo rating">{u.rating}</span>;
}

function Home({ me, onReplay }: { me: UserView; onReplay: (r: MatchRecord) => void }) {
  const n = useNet();
  const [code, setCode] = useState('');
  const { error, busy, run } = useAction();
  const friends = useFriends();
  const [tab, setTab] = useState<'friends' | 'leaders' | 'history'>('friends');
  useEffect(() => { void net.refreshMe(); }, []);

  const host = () => run(() => net.send({ t: 'roomCreate', settings: { modules: [], rules: [], ruleMode: 'pick', edits: {}, preset: 'classic' } }));
  const join = (c = code) => run(() => net.send({ t: 'roomJoin', code: c }));

  const away = n.room && n.awayFrom === n.room.code && n.room.phase === 'playing' ? n.room : null;
  return (
    <>
      {away && (
        <div className="invite">
          <span>Your game <b>{away.code}</b> is still going.</span>
          <button type="button" className="primary" onClick={() => net.returnToGame()}>Back to the game</button>
        </div>
      )}
      <section className="card open profile">
        <div className="card-body">
          <div className="me-row">
            <span className="avatar" aria-hidden="true">{me.name.slice(0, 1).toUpperCase()}</span>
            <div>
              <b className="me-name">{me.name}</b>
              <small>{me.games ? `${me.games} game${me.games === 1 ? '' : 's'} · ${me.wins} win${me.wins === 1 ? '' : 's'}` : 'No games yet'}</small>
            </div>
            <Rating u={me} />
          </div>
          <button type="button" className="primary wide" disabled={busy} onClick={() => void host()}>Host a game</button>
          <form className="join-row" onSubmit={(e) => { e.preventDefault(); void join(); }}>
            <input aria-label="Game code" placeholder="Game code" autoCapitalize="characters" autoCorrect="off" spellCheck={false} maxLength={5} value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
            <button type="submit" disabled={busy || code.length < 5}>Join</button>
          </form>
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      </section>

      <div className="seg tabs">
        <button type="button" aria-pressed={tab === 'friends'} onClick={() => setTab('friends')}>Friends{friends?.incoming.length ? ` (${friends.incoming.length})` : ''}</button>
        <button type="button" aria-pressed={tab === 'leaders'} onClick={() => setTab('leaders')}>Leaderboard</button>
        <button type="button" aria-pressed={tab === 'history'} onClick={() => setTab('history')}>My games</button>
      </div>
      {tab === 'friends' && <Friends v={friends} onJoin={(c) => void join(c)} />}
      {tab === 'leaders' && <Leaderboard me={me} />}
      {tab === 'history' && <History me={me} onReplay={onReplay} />}

      <button type="button" className="link" onClick={() => { if (confirm('Sign out on this device?')) void net.signOut(); }}>Sign out</button>
    </>
  );
}

function Friends({ v, onJoin, onInvite, room }: { v: FriendsView | null; onJoin?: (code: string) => void; onInvite?: (id: number) => void; room?: RoomView }) {
  const [name, setName] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const { error, busy, run } = useAction();
  const [invited, setInvited] = useState<Set<number>>(new Set());
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await run(() => net.send<{ friends: boolean }>({ t: 'friendAdd', name }));
    if (r) { setNote(r.friends ? `You and ${name} are now friends.` : `Request sent to ${name}.`); setName(''); }
  };
  if (!v) return <section className="card open"><div className="card-body"><p className="note">Loading friends…</p></div></section>;
  const seated = new Set(room?.seats.map((s) => s.userId).filter(Boolean));
  return (
    <section className="card open">
      <div className="card-body">
        {v.incoming.map((u) => (
          <div className="row friend" key={u.id}>
            <span className="fname"><b>{u.name}</b> wants to be friends</span>
            <button type="button" onClick={() => void run(() => net.send({ t: 'friendRemove', userId: u.id }))}>Decline</button>
            <button type="button" className="primary" onClick={() => void run(() => net.send({ t: 'friendAccept', userId: u.id }))}>Accept</button>
          </div>
        ))}
        {v.friends.length === 0 && !v.incoming.length && <p className="note">No friends yet. Add someone by their username, or share a game link with them.</p>}
        {v.friends.map((f) => (
          <div className="row friend" key={f.user.id}>
            <span className={`presence${f.online ? ' on' : ''}`} aria-label={f.online ? 'Online' : 'Offline'} />
            <span className="fname"><b>{f.user.name}</b><small>{f.online ? (f.playing ? 'Playing' : f.roomCode ? 'In a lobby' : 'Online') : 'Offline'}</small></span>
            <Rating u={f.user} />
            {onInvite && f.online && !seated.has(f.user.id) && (
              <button type="button" disabled={invited.has(f.user.id)} onClick={() => { onInvite(f.user.id); setInvited(new Set([...invited, f.user.id])); }}>{invited.has(f.user.id) ? 'Invited' : 'Invite'}</button>
            )}
            {onJoin && f.roomCode && <button type="button" onClick={() => onJoin(f.roomCode!)}>Join</button>}
          </div>
        ))}
        {v.outgoing.length > 0 && <p className="note">Waiting on: {v.outgoing.map((u) => u.name).join(', ')}</p>}
        <form className="join-row" onSubmit={(e) => void add(e)}>
          <input aria-label="Friend’s username" placeholder="Add a friend by username" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={16} value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit" disabled={busy || name.trim().length < 3}>Add</button>
        </form>
        {note && <p className="note">{note}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </section>
  );
}

function Leaderboard({ me }: { me: UserView }) {
  const [rows, setRows] = useState<UserView[] | null>(null);
  useEffect(() => { void net.send<UserView[]>({ t: 'leaderboard' }).then(setRows).catch(() => setRows([])); }, []);
  return (
    <section className="card open">
      <div className="card-body">
        {!rows ? <p className="note">Loading…</p> : !rows.length ? <p className="note">No rated games yet. Ratings start at 1200 and move after games with two or more people.</p> : (
          <ol className="board-list">
            {rows.map((u, i) => (
              <li key={u.id} className={u.id === me.id ? 'me' : ''}>
                <span className="rank">{i + 1}</span>
                <span className="fname"><b>{u.name}</b><small>{u.games} games · {u.wins} wins</small></span>
                <Rating u={u} />
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function History({ me, onReplay }: { me: UserView; onReplay: (r: MatchRecord) => void }) {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const { error, run } = useAction();
  useEffect(() => { void net.send<HistoryRow[]>({ t: 'history' }).then(setRows).catch(() => setRows([])); }, []);
  return (
    <section className="card open">
      <div className="card-body">
        {!rows ? <p className="note">Loading…</p> : !rows.length ? <p className="note">Your finished online games show up here.</p> : (
          <ul className="history">
            {rows.map((h) => (
              <li key={h.matchId}>
                <div className="h-top">
                  <b className={h.place === 1 ? 'win' : ''}>{h.place === 1 ? 'Won' : `${ordinal(h.place)} place`}</b>
                  <span>{h.score} pts</span>
                  {h.ratingDelta !== null && <span className={`elo ${h.ratingDelta > 0 ? 'up' : h.ratingDelta < 0 ? 'down' : ''}`}>{h.ratingDelta >= 0 ? '+' : ''}{h.ratingDelta}</span>}
                  {!h.rated && <span className="note">unrated</span>}
                  <small>{new Date(h.endedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small>
                </div>
                <p className="h-players">{h.players.map((p) => `${p.name}${p.bot ? ' (bot)' : ''} ${p.score}`).join(' · ')}</p>
                <button type="button" onClick={() => void run(async () => onReplay(await net.send<MatchRecord>({ t: 'match', matchId: h.matchId })))}>Replay</button>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="error">{error}</p>}
        <p className="note">Signed in as {me.name}.</p>
      </div>
    </section>
  );
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

// ---------- lobby ----------

function settingsSummary(st: RoomSettings) {
  // A preset untouched since it was picked is described by its name alone.
  if (st.preset && PRESETS[st.preset]) return [PRESETS[st.preset].name, PRESETS[st.preset].description, ...(st.ruleMode === 'draft' ? ['Secret rule draft'] : [])];
  const bits = [
    'Custom game',
    ...st.modules.map(ruleName),
    ...(st.ruleMode === 'draft' ? ['Secret rule draft'] : st.rules.map(ruleName)),
  ];
  if (Object.keys(st.edits).length) bits.push(`${Object.keys(st.edits).length} custom setting${Object.keys(st.edits).length === 1 ? '' : 's'}`);
  return bits;
}

function Lobby({ room, me, onRules }: { room: RoomView; me: UserView; onRules: () => void }) {
  const isHost = room.hostId === me.id;
  const { error, busy, run } = useAction();
  const friends = useFriends();
  const [copied, setCopied] = useState(false);
  const link = inviteLink(room.code);
  const share = async () => {
    const data = { title: 'Glockenfels', text: `Join my Glockenfels game (code ${room.code})`, url: link };
    if (navigator.share) { try { await navigator.share(data); return; } catch { /* cancelled; fall back to copying */ } }
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { prompt('Copy this link', link); }
  };

  return (
    <>
      <section className="card open room-code">
        <div className="card-body">
          <p className="note">Game code</p>
          <p className="code" aria-label={`Game code ${room.code.split('').join(' ')}`}>{room.code}</p>
          <button type="button" className="primary wide" onClick={() => void share()}>{copied ? 'Link copied' : 'Share invite link'}</button>
        </div>
      </section>

      <section className="card open">
        <div className="card-head static"><span>Table</span><small>{room.seats.length} of 8 · {room.rated ? 'rated' : 'unrated until a second person joins'}</small></div>
        <div className="card-body">
          {room.seats.map((s, i) => (
            <div className="row seat" key={i} style={{ '--pc': playerCss(i) } as React.CSSProperties}>
              <span className="dot" />
              <span className="fname">
                <b>{s.name}{s.userId === me.id ? ' (you)' : ''}</b>
                <small>{s.kind === 'bot' ? 'Bot' : `${s.userId === room.hostId ? 'Host · ' : ''}${s.online ? 'here' : 'connecting…'}`}</small>
              </span>
              {s.rating !== undefined && <span className="rating">{s.rating}</span>}
              {isHost && s.userId !== me.id && <button type="button" className="icon" aria-label={`Remove ${s.name}`} onClick={() => void run(() => net.send({ t: 'roomRemoveSeat', seat: i }))}>×</button>}
            </div>
          ))}
          {isHost && <button type="button" disabled={room.seats.length >= 8} onClick={() => void run(() => net.send({ t: 'roomBot', add: true }))}>+ Add a bot</button>}
        </div>
      </section>

      <section className="card open">
        <div className="card-head static"><span>Rules</span>{isHost && <button type="button" onClick={onRules}>Change</button>}</div>
        <div className="card-body">
          <p className="rules-line">{settingsSummary(room.settings).join(' · ')}</p>
          {!isHost && <p className="note">The host picks the rules.</p>}
        </div>
      </section>

      <section className="card open">
        <div className="card-head static"><span>Invite friends</span></div>
        <Friends v={friends} room={room} onInvite={(id) => void run(() => net.send({ t: 'invite', userId: id }))} />
      </section>

      {error && <p className="error" role="alert">{error}</p>}
      <div className="start-bar">
        <button type="button" className="link" onClick={() => void run(() => net.leaveRoom())}>Leave</button>
        {isHost ? (
          <button type="button" className="primary wide" disabled={busy || room.seats.length < 2} onClick={() => void run(() => net.send({ t: 'roomStart' }))}>
            {room.seats.length < 2 ? 'Waiting for players' : room.settings.ruleMode === 'draft' ? 'Start the rule draft' : 'Start game'}
          </button>
        ) : <p className="hint wide-hint">Waiting for {room.seats.find((s) => s.userId === room.hostId)?.name ?? 'the host'} to start…</p>}
      </div>
    </>
  );
}

// ---------- online secret draft ----------

function OnlineDraft({ room, me }: { room: RoomView; me: UserView }) {
  const d = room.draft!;
  const isHost = room.hostId === me.id;
  const hostName = room.seats.find((s) => s.userId === room.hostId)?.name ?? 'The host';
  const [choice, setChoice] = useState<string | null>(null);
  const { error, busy, run } = useAction();
  useEffect(() => { setChoice(null); }, [d.mine, d.stage]);

  const reveal = d.reveal && (
    <ul className="reveal">
      {d.reveal.map((rule, player) => (
        <li key={player} className="flip" style={{ '--pc': playerCss(player), transitionDelay: `${player * 120}ms` } as React.CSSProperties}>
          <span className="dot" /> <span className="pname">{room.seats[player]?.name}</span>
          <b>{rule ? ruleName(rule) : 'No rule'}</b>
          {rule && <small>{findRule(rule)?.description}</small>}
        </li>
      ))}
    </ul>
  );

  if (d.stage === 'picking' && d.mine === null && room.mySeat !== null) {
    const pool = DRAFT_RULES.filter((r) => d.pool.includes(r.id));
    return (
      <>
        <header className="title small" style={{ '--pc': playerCss(room.mySeat) } as React.CSSProperties}>
          <h1><span className="dot" /> Pick a secret rule</h1>
          <p>Nobody sees it until everyone has picked.</p>
        </header>
        <div className="rule-grid">
          {pool.map((r) => (
            <button key={r.id} type="button" className="rule" aria-pressed={choice === r.id} onClick={() => setChoice(r.id)}>
              <b>{r.name}</b><small>{r.description}</small>
            </button>
          ))}
        </div>
        {error && <p className="error">{error}</p>}
        <div className="start-bar">
          <button type="button" className="primary wide" disabled={!choice || busy} onClick={() => void run(() => net.send({ t: 'draftPick', rule: choice! }))}>
            {choice ? `Lock in ${ruleName(choice)}` : 'Pick a rule'}
          </button>
        </div>
      </>
    );
  }

  return (
    <section className="card open draft-online">
      <div className="card-body">
        {d.stage === 'picking' && (
          <>
            <h2>Waiting for picks</h2>
            <ul className="picked">
              {room.seats.map((s, i) => (
                <li key={i} style={{ '--pc': playerCss(i) } as React.CSSProperties}><span className="dot" /> {s.name} <b>{d.picked[i] ? 'locked in' : 'choosing…'}</b></li>
              ))}
            </ul>
            {d.mine && <p className="note">You picked <b>{ruleName(d.mine)}</b>.</p>}
          </>
        )}
        {d.stage === 'conflict' && d.conflict && (
          <>
            <h2>{ruleName(d.conflict.a)} and {ruleName(d.conflict.b)} clash</h2>
            {reveal}
            {isHost ? (
              <>
                <p>You’re the host: keep one. {MODULES.some((m) => m.id === d.conflict!.a || m.id === d.conflict!.b) ? 'Dropping a module turns it off for this game.' : 'Whoever picked the other one picks again.'}</p>
                <div className="panel-row">
                  <button type="button" disabled={busy} onClick={() => void run(() => net.send({ t: 'draftSettle', keep: d.conflict!.a, drop: d.conflict!.b }))}>Keep {ruleName(d.conflict.a)}</button>
                  <button type="button" disabled={busy} onClick={() => void run(() => net.send({ t: 'draftSettle', keep: d.conflict!.b, drop: d.conflict!.a }))}>Keep {ruleName(d.conflict.b)}</button>
                </div>
              </>
            ) : <p className="note">{hostName} is deciding which one stays.</p>}
          </>
        )}
        {d.stage === 'stuck' && (
          <>
            <h2>This mix could get stuck</h2>
            {reveal}
            {isHost ? (
              <div className="panel-row wrap">
                {[...new Set((d.reveal ?? []).filter((p): p is string => !!p))].map((r) => <button key={r} type="button" onClick={() => void run(() => net.send({ t: 'draftDrop', rule: r }))}>Drop {ruleName(r)}</button>)}
              </div>
            ) : <p className="note">{hostName} is dropping one rule.</p>}
          </>
        )}
        {d.modules.length > 0 && <p className="note">Modules: {d.modules.map(ruleName).join(', ')}</p>}
        {error && <p className="error">{error}</p>}
        <button type="button" className="link" onClick={() => { if (confirm('Leave? The draft is cancelled for everyone.')) void run(() => net.leaveRoom()); }}>Leave</button>
      </div>
    </section>
  );
}

// ---------- the online game ----------

function seatsFor(room: RoomView): PlaySeat[] {
  return room.seats.map((s, i) => ({
    name: s.name,
    bot: s.kind === 'bot' || !!s.botControl,
    local: i === room.mySeat && !s.botControl,
    online: s.online,
    awayFor: s.awayFor,
    botControl: s.botControl,
    resigned: s.resigned,
    rating: s.rating,
  }));
}

function useOnlineGame(room: RoomView): GameController {
  const n = useNet();
  const g = n.game!;
  const [error, setError] = useState<string | null>(null);
  const batchN = useRef(0);
  const lastN = useRef(-1);
  const batchRef = useRef<Batch | null>(null);
  if (lastN.current !== n.gameN) {
    // A fresh push: animate what the last action did (but not a snapshot on join or undo).
    lastN.current = n.gameN;
    batchRef.current = g.actor !== null && g.events.length ? { n: ++batchN.current, events: g.events, player: g.actor } : null;
  }
  const seats = useMemo(() => seatsFor(room), [room]);
  const state = g.state;
  const dispatch = useCallback((action: Action) => {
    net.send({ t: 'act', action, n: state.log.length }).catch((e) => setError(errText(e)));
    return true;
  }, [state]);
  const undo = useCallback(() => { net.send({ t: 'undo' }).catch((e) => setError(errText(e))); }, []);
  return {
    mode: 'online', state, version: n.gameN, batch: batchRef.current, error, clearError: () => setError(null),
    dispatch, undo, seats, seed: 0, runBots: false, handoff: false, drafted: g.drafted,
  };
}

function OnlineGame({ room }: { room: RoomView }) {
  const game = useOnlineGame(room);
  const n = useNet();
  const ended = room.phase === 'ended';
  // Show the rule card reveal once at the start of a drafted game.
  return (
    <>
      <GameScreen
        key={n.game!.matchId}
        game={game}
        online={{
          result: n.game!.result,
          rated: n.game!.rated,
          takeoverAfter: TAKEOVER_AFTER_S,
          onTakeover: (seat) => { net.send({ t: 'takeover', seat }).catch((e) => alert(errText(e))); },
          onResign: () => { net.send({ t: 'resign' }).catch((e) => alert(errText(e))); },
        }}
        quitLabel={ended ? 'Leave table' : 'Leave (keeps your seat)'}
        onQuit={() => { void net.leaveRoom(); }}
        rematchLabel="Rematch"
        onRematch={ended ? () => { net.send({ t: 'rematch' }).catch((e) => alert(errText(e))); } : undefined}
      />
      {n.status !== 'open' && <div className="net-banner" role="status">Reconnecting to the server…</div>}
    </>
  );
}

// ---------- replay of a finished game ----------

function ReplayGame({ rec, onClose }: { rec: MatchRecord; onClose: () => void }) {
  const names = rec.seats.map((s) => s.name);
  const total = rec.log.length;
  const [at, setAt] = useState(total);
  const state = useMemo<GameState>(() => replay(rec.config, rec.seed, rec.log.slice(0, at), names), [rec, at]); // eslint-disable-line react-hooks/exhaustive-deps
  const game: GameController = {
    mode: 'replay', state, version: at, batch: null, error: null, clearError: () => undefined,
    dispatch: () => false, undo: () => undefined,
    seats: rec.seats.map((s) => ({ name: s.name, bot: s.bot, local: false })),
    seed: rec.seed, runBots: false, handoff: false, drafted: rec.drafted,
  };
  return (
    <>
      <GameScreen key={rec.matchId} game={game} onQuit={onClose} quitLabel="Close replay" online={{ result: rec.result, rated: !!rec.result?.some((r) => r.ratingAfter !== r.ratingBefore), takeoverAfter: 1e9, onTakeover: () => undefined, onResign: () => undefined }} />
      <div className="replay-bar">
        <button type="button" onClick={() => setAt(0)} aria-label="Start">⏮</button>
        <button type="button" onClick={() => setAt(Math.max(0, at - 1))} aria-label="Back one move">◀</button>
        <input type="range" min={0} max={total} value={at} onChange={(e) => setAt(Number(e.target.value))} aria-label="Move" />
        <button type="button" onClick={() => setAt(Math.min(total, at + 1))} aria-label="Forward one move">▶</button>
        <button type="button" onClick={onClose}>Close</button>
      </div>
    </>
  );
}
