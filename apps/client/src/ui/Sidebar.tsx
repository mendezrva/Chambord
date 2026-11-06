/**
 * The optional side panel: a play log, a score breakdown and the tiles still to come.
 * Local games rebuild the log by replaying the seed and action log, so it survives reloads and
 * undo. Online games collect the server's event batches as they arrive.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  apply, createGame, featureValue, majority, isRiver,
  type Action, type FeatureKind, type GameEvent, type GameState, type TileDef,
} from '@glockenfels/engine';
import type { GameController } from '../game/session';
import { FeatureIcon, playerCss } from '../scene/GameBoard';
import { featureLabel } from '../game/tiles3d';
import { ACTION_INFO, TileCard } from './TileCard';

export interface LogEntry { n: number; player: number; events: GameEvent[]; action?: Action }

/** Every move of the game so far, with the events it caused. */
export interface History { entries: LogEntry[]; partial: boolean }

/** Every move of the game so far, with the events it caused. Local games only replay while `enabled`. */
export function useHistory(game: GameController, enabled: boolean): History {
  const s = game.state;
  const [live, setLive] = useState<LogEntry[]>([]);
  // Online: the server's batches are the only record, so keep every one, even while the panel is shut.
  useEffect(() => {
    if (game.mode !== 'online' || !game.batch) return;
    const b = game.batch;
    setLive((old) => (old.some((e) => e.n === b.n) ? old : [...old, { n: b.n, player: b.player, events: b.events }]));
  }, [game.batch, game.mode]);
  const logLen = s.log.length;
  const local = useMemo(() => {
    if (game.mode === 'online' || !enabled) return null;
    try {
      const r = createGame(structuredClone(s.config), game.seed, s.players.map((p) => p.name));
      const out: LogEntry[] = [];
      s.log.forEach((a, i) => {
        const player = r.current;
        apply(r, a);
        out.push({ n: i, player, events: [...r.events], action: a });
      });
      return out;
    } catch {
      return null;
    }
  }, [enabled, logLen, game.mode, game.version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (game.mode === 'online') return { entries: live, partial: live.length < logLen };
  return { entries: local ?? [], partial: !local && enabled };
}

type Cat = FeatureKind | 'other';
const CATS: { id: Cat; label: string; color: string }[] = [
  { id: 'road', label: 'Roads', color: '#c9a86a' },
  { id: 'town', label: 'Towns', color: '#c0472f' },
  { id: 'monastery', label: 'Monasteries', color: '#4e9e82' },
  { id: 'meadow', label: 'Fields', color: '#7fbf4d' },
  { id: 'other', label: 'Other', color: '#8b8fa8' },
];

function Line({ player, children, s }: { player?: number; children: React.ReactNode; s: GameState }) {
  return (
    <li className="log-line">
      {player !== undefined && <span className="dot" style={{ background: playerCss(player) }} title={s.players[player]?.name} />}
      <span>{children}</span>
    </li>
  );
}

function entryLines(e: LogEntry, s: GameState) {
  const name = (p: number) => s.players[p]?.name ?? `Player ${p + 1}`;
  const lines: JSX.Element[] = [];
  let tile: { def: TileDef; rot: number } | null = null;
  const sentHome = e.events.some((x) => x.type === 'action' && x.action === 'sendHome');
  e.events.forEach((ev, i) => {
    const k = `${e.n}-${i}`;
    switch (ev.type) {
      case 'placed': {
        const t = s.board[ev.tileKey];
        if (!t || t.placedBy < 0) break;
        tile = { def: s.config.tiles[t.tileId], rot: t.rot };
        lines.push(<Line key={k} s={s}>Placed <b>{tile.def.name}</b></Line>);
        break;
      }
      case 'claimed':
        lines.push(<Line key={k} s={s}><span className="log-feat"><FeatureIcon kind={tileFeatureKind(s, ev.tileKey, ev.local)} /></span>Sent a {ev.piece === 'grand' ? 'Grand Wanderer' : 'Wanderer'} to the {featureLabel(tileFeatureKind(s, ev.tileKey, ev.local)).toLowerCase()}</Line>);
        break;
      case 'scored':
        if (!ev.points) break;
        lines.push(
          <Line key={k} s={s} player={ev.players[0]}>
            <b className="pts">+{ev.points}</b> {ev.players.map(name).join(' & ')} · {ev.complete ? '' : 'unfinished '}{featureLabel(ev.kind).toLowerCase()}{ev.complete ? ' complete' : ''}
            {ev.kind !== 'meadow' && ` (${ev.tiles.length} tile${ev.tiles.length > 1 ? 's' : ''})`}
          </Line>,
        );
        break;
      case 'returned':
        if (sentHome) lines.push(<Line key={k} s={s} player={ev.piece.player}>{name(ev.piece.player)}’s Wanderer was sent home</Line>);
        break;
      case 'action':
        lines.push(<Line key={k} s={s}>Played <b>{ACTION_INFO[ev.action].name}</b>{ev.target !== undefined ? ` on ${name(ev.target)}` : ''}</Line>);
        break;
      case 'skipped': lines.push(<Line key={k} s={s} player={ev.player}>{name(ev.player)} missed a turn</Line>); break;
      case 'discarded': lines.push(<Line key={k} s={s}>{ev.reason === 'unplayable' ? 'A tile that fit nowhere was set aside' : 'An action tile was discarded (hand full)'}</Line>); break;
      case 'goods': lines.push(<Line key={k} s={s} player={ev.player}>Took the {ev.good}</Line>); break;
      case 'ended': lines.push(<Line key={k} s={s}><b>Game over.</b> {ev.winners.map(name).join(' & ')} {ev.winners.length > 1 ? 'share the win' : 'wins'}</Line>); break;
    }
  });
  return { lines, tile: tile as { def: TileDef; rot: number } | null };
}

function tileFeatureKind(s: GameState, tileKey: string, local: number): FeatureKind {
  const t = s.board[tileKey];
  if (!t) return 'road';
  const f = s.features[t.featureIds[local]];
  return f?.kind ?? 'road';
}

function LogTab({ entries, s, partial }: { entries: LogEntry[]; s: GameState; partial: boolean }) {
  // Group a player's actions in one turn (place + claim, or an action tile then a placement) into one card.
  const cards = useMemo(() => {
    const out: { player: number; key: number; lines: JSX.Element[]; tile: { def: TileDef; rot: number } | null }[] = [];
    for (const e of entries) {
      const { lines, tile } = entryLines(e, s);
      if (!lines.length) continue;
      const prev = out[out.length - 1];
      const startsTurn = e.action?.type === 'place' && prev?.tile;
      if (prev && prev.player === e.player && !startsTurn) {
        prev.lines.push(...lines);
        prev.tile ??= tile;
      } else out.push({ player: e.player, key: e.n, lines: [...lines], tile });
    }
    return out.reverse();
  }, [entries, s]);
  if (!cards.length) return <p className="note side-empty">Nothing has happened yet. Moves will show up here as the valley grows.</p>;
  return (
    <ol className="log">
      {partial && <li className="note">Showing moves since you joined.</li>}
      {cards.map((c) => (
        <li key={c.key} className="log-card" style={{ '--pc': playerCss(c.player) } as React.CSSProperties}>
          {c.tile ? <TileCard def={c.tile.def} rot={c.tile.rot} small /> : <span className="log-blank" />}
          <div>
            <p className="log-who"><span className="dot" /> {s.players[c.player]?.name}</p>
            <ul>{c.lines}</ul>
          </div>
        </li>
      ))}
    </ol>
  );
}

function ScoresTab({ entries, s, partial }: { entries: LogEntry[]; s: GameState; partial: boolean }) {
  const rows = useMemo(() => {
    const by = s.players.map(() => ({ road: 0, town: 0, monastery: 0, meadow: 0, other: 0 } as Record<Cat, number>));
    for (const e of entries) for (const ev of e.events) if (ev.type === 'scored') for (const p of ev.players) by[p][ev.kind] += ev.points;
    // In play: what each player's Wanderers would earn if the game ended now.
    const pending = s.players.map(() => 0);
    if (s.step !== 'ended') {
      for (const f of s.features) {
        if (s.parent[f.id] !== f.id || f.scored || !f.pieces.length) continue;
        if (f.kind === 'meadow' && !s.config.scoring.meadow.enabled) continue;
        const v = featureValue(s, f, false);
        for (const p of majority(f)) pending[p] += v;
      }
    }
    return s.players.map((p, i) => {
      const known = by[i].road + by[i].town + by[i].monastery + by[i].meadow;
      by[i].other = Math.max(0, p.score - known);
      return { p, cats: by[i], pending: pending[i] };
    }).sort((a, b) => b.p.score - a.p.score);
  }, [entries, s, s.log.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const top = Math.max(1, ...rows.map((r) => r.p.score + r.pending));
  return (
    <div className="scores">
      <ol className="score-list">
        {rows.map(({ p, cats, pending }) => (
          <li key={p.id} style={{ '--pc': playerCss(p.id) } as React.CSSProperties} className={s.current === p.id && s.step !== 'ended' ? 'current' : ''}>
            <div className="score-head">
              <span className="dot" /><b className="sname">{p.name}</b>
              <span className="wleft" title="Wanderers at home">{p.pieces.wanderer}<i />{p.pieces.grand > 0 && <> +{p.pieces.grand}</>}</span>
              <b className="stotal">{p.score}</b>
            </div>
            <div className="sbar" role="img" aria-label={CATS.filter((c) => cats[c.id]).map((c) => `${c.label} ${cats[c.id]}`).join(', ') || 'No points yet'}>
              {CATS.map((c) => cats[c.id] > 0 && <span key={c.id} style={{ width: `${(cats[c.id] / top) * 100}%`, background: c.color }} />)}
              {pending > 0 && <span className="pending" style={{ width: `${(pending / top) * 100}%` }} />}
            </div>
            <p className="sdetail">
              {CATS.filter((c) => cats[c.id]).map((c) => <span key={c.id}><i style={{ background: c.color }} />{c.label} {cats[c.id]}</span>)}
              {pending > 0 && <span className="pend"><i />In play +{pending}</span>}
            </p>
          </li>
        ))}
      </ol>
      <p className="note">{partial ? 'Breakdown covers the moves since you joined. ' : ''}“In play” is what Wanderers on unfinished roads, towns, monasteries and fields would score if the game ended now.</p>
      <ScoringCard s={s} />
    </div>
  );
}

function ScoringCard({ s }: { s: GameState }) {
  const sc = s.config.scoring;
  return (
    <div className="rule-sum">
      <h3>How points work</h3>
      <ul>
        <li><FeatureIcon kind="road" /><span><b>Road</b> {sc.road.perTile} per tile when finished, {sc.road.incompletePerTile} at game end{sc.road.doubleFrom ? `; doubled from ${sc.road.doubleFrom} tiles` : ''}.</span></li>
        <li><FeatureIcon kind="town" /><span><b>Town</b> {sc.town.perTile} per tile and {sc.town.perBanner} per banner when finished, {sc.town.incompletePerTile} and {sc.town.incompletePerBanner} at game end.</span></li>
        <li><FeatureIcon kind="monastery" /><span><b>Monastery</b> {sc.monastery.complete} when surrounded, {sc.monastery.incompletePerTile} per tile around it at game end.</span></li>
        {sc.meadow.enabled && <li><FeatureIcon kind="meadow" /><span><b>Field</b> {sc.meadow.perTown} per completed town it touches, at game end only. Field Wanderers stay out all game.</span></li>}
      </ul>
    </div>
  );
}

const GROUPS: { id: string; label: string; test: (d: TileDef, s: GameState) => boolean }[] = [
  { id: 'river', label: 'River', test: (d, s) => isRiver(s.config, d.id) },
  { id: 'town', label: 'Towns', test: (d) => d.edges.includes('town') },
  { id: 'road', label: 'Roads', test: (d) => d.edges.includes('road') && d.center !== 'monastery' },
  { id: 'land', label: 'Fields and monasteries', test: () => true },
];

function TilesTab({ s }: { s: GameState }) {
  const data = useMemo(() => {
    const used = new Map<string, number>();
    const add = (id: string) => used.set(id, (used.get(id) ?? 0) + 1);
    for (const t of Object.values(s.board)) if (t.placedBy >= 0) add(t.tileId);
    for (const id of s.discard) add(id);
    for (const id of s.hand) add(id);
    const items = s.config.deck
      .filter((d) => d.count > 0 && !s.config.tiles[d.tileId]?.action)
      .map((d) => ({ def: s.config.tiles[d.tileId], total: d.count, left: Math.max(0, d.count - (used.get(d.tileId) ?? 0)) }));
    const landLeft = items.reduce((a, i) => a + i.left, 0);
    const actionLeft = s.config.rules.actions ? Math.max(0, s.deck.length + s.market.length - landLeft) : 0;
    const groups = GROUPS.map((g) => ({ ...g, items: [] as typeof items }));
    for (const it of items) groups.find((g) => g.test(it.def, s))!.items.push(it);
    return { groups: groups.filter((g) => g.items.length), landLeft, actionLeft };
  }, [s, s.log.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="tiles-left">
      <p className="tl-sum"><b className="display">{s.deck.length}</b> tiles left in the bag{data.actionLeft ? `, about ${data.actionLeft} of them action tiles` : ''}.</p>
      {data.groups.map((g) => (
        <section key={g.id}>
          <h3>{g.label} <small>{g.items.reduce((a, i) => a + i.left, 0)} left</small></h3>
          <div className="tl-grid">
            {g.items.map((it) => (
              <div key={it.def.id} className={`tl-item${it.left ? '' : ' gone'}`} title={`${it.def.name}: ${it.left} of ${it.total} left`}>
                <TileCard def={it.def} small />
                <span className="tl-count">{it.left}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export type SideTab = 'log' | 'scores' | 'tiles';

export function Sidebar({ s, history, tab, onTab, onClose }: { s: GameState; history: History; tab: SideTab; onTab: (t: SideTab) => void; onClose: () => void }) {
  const { entries, partial } = history;
  const TABS: { id: SideTab; label: string }[] = [{ id: 'log', label: 'Log' }, { id: 'scores', label: 'Scores' }, { id: 'tiles', label: 'Tiles' }];
  return (
    <aside className="sidebar" aria-label="Game details">
      <div className="side-head">
        <div className="seg side-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} aria-pressed={tab === t.id} onClick={() => onTab(t.id)}>{t.label}</button>
          ))}
        </div>
        <button type="button" className="icon side-close" aria-label="Close panel" onClick={onClose}>✕</button>
      </div>
      <div className="side-body">
        {tab === 'log' && <LogTab entries={entries} s={s} partial={partial} />}
        {tab === 'scores' && <ScoresTab entries={entries} s={s} partial={partial} />}
        {tab === 'tiles' && <TilesTab s={s} />}
      </div>
    </aside>
  );
}
