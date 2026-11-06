/**
 * The pass-and-play game: the 3D board, the turn dock at the bottom, the scoreboard at the top,
 * bot seats, the pass-the-device screen, scoring effects and the end-of-game standings.
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import {
  analyze, botAction, claimable, findRule, legalActions, legalPlacements, tileAnalysis,
  type Action, type ActionKind, type GameEvent, type GameState, type PieceType,
} from '@glockenfels/engine';
import { TILE } from '../tiles/buildTile';
import { PALETTE } from '../tiles/palette';
import { Clouds, Lights, Mountains } from '../scene/World';
import { Confetti } from '../scene/Confetti';
import { BoardTiles, ClaimSpots, GhostTile, playerColor, playerCss, Popups, SpotMarkers, usePieces, useTiles, Wanderers, type PieceItem, type Popup } from '../scene/GameBoard';
import { boundsOf, CameraRig, declineQuality, defaultQuality, Effects, ProjectHook, reducedMotion, Stats, type Quality, type View } from '../scene/Stage';
import { useGame, type SavedGame } from '../game/session';
import { featureLabel } from '../game/tiles3d';
import { ACTION_INFO, ActionCard, TileCard } from './TileCard';
import { Toggle } from './Overlay';

const VIEWS: { id: View; label: string }[] = [
  { id: 'overhead', label: 'Overhead' },
  { id: 'isometric', label: 'Isometric' },
  { id: 'closeup', label: 'Close-up' },
];

const BOT_DELAY: Record<string, number> = { action: 700, draw: 700, place: 1000, claim: 650 };

interface Toast { id: number; text: string }

function Pieces({ n, grand, color }: { n: number; grand: number; color: string }) {
  return (
    <span className="pieces" aria-label={`${n} Wanderers${grand ? ` and ${grand} Grand Wanderer` : ''} left`}>
      <i style={{ background: color }} />{n}{grand > 0 && <> <i className="grand" style={{ background: color }} />{grand}</>}
    </span>
  );
}

export function GameScreen({ saved, onQuit, onRematch }: { saved: SavedGame; onQuit: () => void; onRematch: () => void }) {
  const { state: s, version, batch, error, dispatch, undo, clearError } = useGame(saved);
  const seats = saved.seats;
  const humans = seats.filter((x) => !x.bot).length;
  const seat = seats[s.current];
  const isHuman = !seat.bot && s.step !== 'ended';
  const me = s.players[s.current];
  const color = playerColor(s.current);

  // ---------- view and quality ----------
  const [quality, setQuality] = useState<Quality>(defaultQuality);
  const [autoNote, setAutoNote] = useState<string | null>(null);
  const [view, setView] = useState<View>('isometric');
  const [viewKey, setViewKey] = useState(0);
  const [focus, setFocus] = useState<{ x: number; z: number; n: number } | null>(null);
  const [menu, setMenu] = useState(false);
  const statsRef = useRef<HTMLSpanElement>(null);
  const onDecline = useCallback(() => setQuality((q) => { const r = declineQuality(q); if (r.note) setAutoNote(r.note); return r.q; }), []);

  const tiles = useTiles(s, version);
  const pieces = usePieces(s, version);
  const bounds = useMemo(() => boundsOf(tiles), [tiles]);
  const last = s.lastPlaced ? s.board[s.lastPlaced] : null;

  // ---------- turn selections ----------
  const [handIdx, setHandIdx] = useState(0);
  const [spot, setSpot] = useState<[number, number] | null>(null);
  const [rot, setRot] = useState(0);
  const [claimSel, setClaimSel] = useState<number | null>(null);
  const [actionSel, setActionSel] = useState<ActionKind | null>(null);
  const [curtain, setCurtain] = useState<number | null>(null);
  const [showEnd, setShowEnd] = useState(false);
  const [ruleCard, setRuleCard] = useState(false);

  // Reset selections whenever the step or player changes.
  const stepKey = `${s.turn}/${s.step}/${s.current}/${s.hand.join()}`;
  useEffect(() => {
    setHandIdx(0); setSpot(null); setClaimSel(null); setActionSel(null);
  }, [stepKey]);

  const handTile = s.step === 'place' ? s.hand[Math.min(handIdx, s.hand.length - 1)] : undefined;
  const handDef = handTile ? s.config.tiles[handTile] : undefined;
  const fits = useMemo(() => {
    const m = new Map<string, number[]>();
    if (!handTile) return m;
    for (const p of legalPlacements(s, handTile)) {
      const k = `${p.x},${p.z}`;
      m.set(k, [...(m.get(k) ?? []), p.rot]);
    }
    // Symmetric tiles list fewer rotations; add the equivalent ones so every turn of the tile works.
    const def = s.config.tiles[handTile];
    for (const [k, rots] of m) {
      const ok = new Set(rots.map((r) => analyze(def, r).edges.join()));
      m.set(k, [0, 1, 2, 3].filter((r) => ok.has(analyze(def, r).edges.join())));
    }
    return m;
  }, [s, version, handTile]); // eslint-disable-line react-hooks/exhaustive-deps
  const cells = useMemo(() => [...fits.keys()].map((k) => k.split(',').map(Number) as [number, number]), [fits]);
  // At the start of a human placement, make sure every spot the tile fits is on screen.
  const keepVisible = useMemo(
    () => (isHuman && s.step === 'place' && cells.length ? { points: cells.map(([x, z]) => [x * TILE, z * TILE] as [number, number]), n: Date.now() } : null),
    [cells, isHuman], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const pickSpot = (x: number, z: number) => {
    const rots = fits.get(`${x},${z}`);
    if (!rots) return;
    setSpot([x, z]);
    setRot(rots.includes(rot) ? rot : rots[0]);
  };
  const turnTile = () => {
    if (!spot) { setRot((r) => (r + 1) % 4); return; }
    const rots = fits.get(`${spot[0]},${spot[1]}`) ?? [];
    const i = rots.indexOf(rot);
    setRot(rots[(i + 1) % rots.length]);
  };
  const confirmPlace = () => {
    if (!spot) return;
    dispatch({ type: 'place', hand: Math.min(handIdx, s.hand.length - 1), x: spot[0], z: spot[1], rot });
  };

  const claimOptions = useMemo(() => {
    if (s.step !== 'claim' || !last) return [];
    const a = tileAnalysis(s, last);
    const opts = claimable(s).map((local) => ({ local, kind: a.features[local].kind, label: featureLabel(a.features[local].kind) }));
    // Number repeats ("Road 1", "Road 2") so each chip is distinct.
    const count = new Map<string, number>();
    for (const o of opts) count.set(o.kind, (count.get(o.kind) ?? 0) + 1);
    const seen = new Map<string, number>();
    return opts.map((o) => {
      if ((count.get(o.kind) ?? 0) < 2) return o;
      const n = (seen.get(o.kind) ?? 0) + 1;
      seen.set(o.kind, n);
      return { ...o, label: `${o.label} ${n}` };
    });
  }, [s, version, last]); // eslint-disable-line react-hooks/exhaustive-deps

  const claim = (piece: PieceType) => { if (claimSel !== null) dispatch({ type: 'claim', local: claimSel, piece }); };

  const legal = useMemo(() => (s.step === 'action' ? legalActions(s) : []), [s, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const actionTargets = (kind: ActionKind) => legal.filter((a): a is Extract<Action, { type: 'playAction' }> => a.type === 'playAction' && a.action === kind);
  const playAction = (a: Action) => { setActionSel(null); dispatch(a); };

  // ---------- events: popups, bounces, confetti, toasts ----------
  const [popups, setPopups] = useState<Popup[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [bounce, setBounce] = useState<{ keys: string[]; n: number } | null>(null);
  const [party, setParty] = useState<{ x: number; z: number; n: number } | null>(null);
  const fxId = useRef(0);
  const toast = useCallback((text: string) => {
    const id = ++fxId.current;
    setToasts((t) => [...t.slice(-2), { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);
  const nameOf = (p: number) => s.players[p]?.name ?? `Player ${p + 1}`;

  useEffect(() => {
    if (!batch) return;
    const add: Popup[] = [];
    const endGame = batch.events.some((e) => e.type === 'ended');
    for (const e of batch.events as GameEvent[]) {
      switch (e.type) {
        case 'placed': {
          const t = s.board[e.tileKey];
          if (t && !endGame) setFocus({ x: t.x * TILE, z: t.z * TILE, n: Date.now() });
          break;
        }
        case 'scored': {
          if (!e.points) break;
          const ts = e.tiles.map((k) => s.board[k]).filter(Boolean);
          const cx = ts.reduce((a, t) => a + t.x, 0) / ts.length * TILE, cz = ts.reduce((a, t) => a + t.z, 0) / ts.length * TILE;
          const who = e.players.length > 1 ? `${e.players.map(nameOf).join(' & ')}` : nameOf(e.players[0]);
          add.push({
            id: ++fxId.current, x: cx, z: cz, player: e.players[0], big: e.complete && e.points >= 8,
            text: `+${e.points}${e.players.length > 1 ? ' each' : ''}`,
            sub: `${featureLabel(e.kind)}${e.complete ? ' complete' : ''} · ${who}`,
          });
          if (e.complete) {
            setBounce({ keys: e.tiles, n: Date.now() });
            if (e.kind === 'town' && !reducedMotion) setParty({ x: cx, z: cz, n: Date.now() });
          }
          break;
        }
        case 'action': {
          const info = ACTION_INFO[e.action];
          toast(`${nameOf(e.player)} played ${info.name}${e.target !== undefined ? ` on ${nameOf(e.target)}` : ''}`);
          break;
        }
        case 'skipped': toast(`${nameOf(e.player)} misses a turn`); break;
        case 'discarded': toast(e.reason === 'unplayable' ? 'A tile that fits nowhere was set aside' : 'Action hand full, so the action tile was discarded'); break;
        case 'goods': toast(`${nameOf(e.player)} takes the ${e.good}`); break;
        case 'ended': setTimeout(() => setShowEnd(true), add.length ? 2200 : 900); break;
      }
    }
    if (add.length) {
      // End-of-game scoring can produce many popups; stagger them so they read one by one.
      add.forEach((p, i) => setTimeout(() => {
        setPopups((old) => [...old, p]);
        setTimeout(() => setPopups((old) => old.filter((x) => x.id !== p.id)), 1900);
      }, endGame ? i * 160 : i * 250));
    }
  }, [batch]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (error) { toast(error); clearError(); } }, [error]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (s.step === 'ended') setShowEnd(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- turn hand-off ----------
  const lastTurnOf = useRef<number | null>(null);
  useEffect(() => {
    if (s.step === 'ended') return;
    if (lastTurnOf.current === s.current) return;
    const prev = lastTurnOf.current;
    lastTurnOf.current = s.current;
    if (seat.bot) return;
    if (saved.handoff && humans > 1 && prev !== null) setCurtain(s.current);
    else if (prev !== null && humans > 1) toast(`${seat.name}’s turn`);
  }, [s.current, s.turn, s.step]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- bots ----------
  useEffect(() => {
    if (s.step === 'ended' || !seat.bot || curtain !== null) return;
    const delay = (BOT_DELAY[s.step] ?? 700) * (humans === 0 ? 0.6 : 1);
    const t = setTimeout(() => dispatch(botAction(s, saved.seed + s.log.length)), delay);
    return () => clearTimeout(t);
  }, [version, curtain]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- keyboard (Mac): R turns, Enter confirms, Esc deselects ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isHuman || curtain !== null || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (s.step === 'place' && (e.key === 'r' || e.key === 'R' || e.key === ' ')) { e.preventDefault(); turnTile(); }
      if (s.step === 'place' && e.key === 'Enter' && spot) confirmPlace();
      if (e.key === 'Escape') { setSpot(null); setClaimSel(null); setActionSel(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Debug hook for automated tests.
  (window as unknown as { __glock?: unknown }).__glock = { s, dispatch, undo, seats };
  (window as unknown as { __fits?: unknown }).__fits = cells;

  const cycleView = (v: View) => { setView(v); setViewKey((k) => k + 1); };
  const hidden = curtain !== null;
  const standings = [...s.players].sort((a, b) => b.score - a.score);
  const rulesInPlay = [...s.config.modules, ...s.config.draftRules].map((id) => findRule(id)).filter(Boolean);
  const deckLeft = s.deck.length;

  // ---------- dock content ----------
  let dock: JSX.Element | null = null;
  if (s.step === 'ended') {
    dock = (
      <div className="dock-row">
        <p className="hint"><b>Game over.</b> {s.winners?.map(nameOf).join(' & ')} {s.winners && s.winners.length > 1 ? 'share the win' : 'wins'}.</p>
        <button type="button" className="primary" onClick={() => setShowEnd(true)}>Results</button>
      </div>
    );
  } else if (!isHuman) {
    dock = (
      <div className="dock-row">
        <p className="hint"><span className="dot" style={{ background: playerCss(s.current) }} /> <b>{seat.name}</b> is thinking…</p>
      </div>
    );
  } else if (s.step === 'place' && handDef) {
    dock = (
      <div className="dock-row">
        <div className="hand">
          {s.hand.map((id, i) => (
            <TileCard key={`${id}-${i}`} def={s.config.tiles[id]} rot={i === handIdx ? rot : 0} selected={s.hand.length > 1 && i === handIdx}
              onClick={() => { if (i === handIdx) turnTile(); else { setHandIdx(i); setSpot(null); } }} label={`${s.config.tiles[id].name}. Tap to turn.`} />
          ))}
        </div>
        <div className="hint-col">
          <p className="hint"><b>{handDef.name}</b></p>
          <p className="hint small">
            {s.mustPlace > 1 ? 'Draw Two: place this, then one more. ' : ''}
            {spot ? 'Tap the tile to turn it, then place it.' : `Tap a glowing spot (${cells.length}).`}
          </p>
        </div>
        <div className="btns">
          <button type="button" onClick={turnTile} aria-label="Turn tile">⟳ Turn</button>
          <button type="button" className="primary" disabled={!spot} onClick={confirmPlace}>Place</button>
        </div>
      </div>
    );
  } else if (s.step === 'claim') {
    const selKind = claimOptions.find((o) => o.local === claimSel);
    dock = (
      <div className="dock-row">
        <div className="hint-col">
          <p className="hint"><b>Send out a Wanderer?</b> <Pieces n={me.pieces.wanderer} grand={me.pieces.grand} color={playerCss(s.current)} /></p>
          <p className="hint small">{selKind ? `On the ${selKind.label.toLowerCase()}.` : 'Pick a feature of the new tile.'}</p>
        </div>
        <div className="claim-opts" role="group" aria-label="Feature to claim">
          {claimOptions.map((o) => (
            <button key={o.local} type="button" aria-pressed={claimSel === o.local} onClick={() => setClaimSel(o.local)}>{o.label}</button>
          ))}
        </div>
        <div className="btns">
          <button type="button" onClick={undo}>Undo</button>
          <button type="button" onClick={() => dispatch({ type: 'pass' })}>No thanks</button>
          {me.pieces.grand > 0 && <button type="button" disabled={claimSel === null} onClick={() => claim('grand')}>Grand</button>}
          <button type="button" className="primary" disabled={claimSel === null || me.pieces.wanderer <= 0} onClick={() => claim('wanderer')}>Wanderer</button>
        </div>
      </div>
    );
  } else if (s.step === 'draw') {
    dock = (
      <div className="dock-row">
        <div className="hint-col">
          <p className="hint"><b>Open Market</b></p>
          <p className="hint small">{s.market.length ? 'Take a face-up tile or draw blind.' : 'No tiles face up right now. Draw blind.'}</p>
        </div>
        <div className="hand">
          {s.market.map((id, i) => {
            const ok = legalPlacements(s, id).length > 0;
            return <TileCard key={`${id}-${i}`} def={s.config.tiles[id]} onClick={ok ? () => dispatch({ type: 'draw', market: i }) : undefined} label={ok ? `Take ${s.config.tiles[id].name}` : `${s.config.tiles[id].name} fits nowhere`} />;
          })}
        </div>
        <div className="btns">
          <button type="button" className="primary" disabled={!s.deck.length} onClick={() => dispatch({ type: 'draw' })}>Draw blind</button>
        </div>
      </div>
    );
  } else if (s.step === 'action') {
    const targets = actionSel ? actionTargets(actionSel) : [];
    const needsPlayer = actionSel === 'loseTurn' || actionSel === 'steal';
    dock = (
      <div className="dock-row">
        <div className="hand">
          {me.actions.map((a, i) => <ActionCard key={`${a}-${i}`} kind={a} selected={actionSel === a} onClick={actionTargets(a).length ? () => setActionSel(actionSel === a ? null : a) : undefined} />)}
        </div>
        <div className="hint-col">
          <p className="hint"><b>{actionSel ? ACTION_INFO[actionSel].name : 'Play an action tile?'}</b></p>
          <p className="hint small">
            {actionSel ? (actionSel === 'sendHome' ? 'Tap an opponent’s Wanderer on the board.' : needsPlayer ? 'Pick a player.' : ACTION_INFO[actionSel].text) : 'Before you draw, you may play one.'}
          </p>
        </div>
        <div className="btns">
          {needsPlayer && targets.map((t) => (
            <button key={t.target} type="button" onClick={() => playAction(t)} style={{ borderColor: playerCss(t.target!) }}>
              <span className="dot" style={{ background: playerCss(t.target!) }} /> {nameOf(t.target!)}
            </button>
          ))}
          <button type="button" onClick={() => dispatch({ type: 'pass' })}>Not now</button>
          {actionSel && !needsPlayer && actionSel !== 'sendHome' && <button type="button" className="primary" onClick={() => playAction(targets[0])}>Play</button>}
        </div>
      </div>
    );
  }

  const sendHomePick = isHuman && s.step === 'action' && actionSel === 'sendHome' && !hidden;
  const onPickPiece = (p: PieceItem) => {
    const a = actionTargets('sendHome').find((t) => t.piece && `${t.piece.tileKey}:${t.piece.local}` === p.id);
    if (a) playAction(a);
  };

  return (
    <div className="app game">
      <Canvas
        className="scene"
        shadows={quality.shadows ? 'soft' : false}
        dpr={quality.dpr}
        flat
        gl={{ antialias: !(quality.ao || quality.tiltShift), powerPreference: 'high-performance' }}
        camera={{ fov: 38, near: 0.1, far: 220, position: [20, 18, 20] }}
        onCreated={({ scene }) => {
          scene.background = new THREE.Color(PALETTE.sky);
          scene.fog = new THREE.Fog(PALETTE.sky, 38, 90);
        }}
      >
        <PerformanceMonitor onDecline={onDecline} flipflops={6} />
        <Suspense fallback={null}>
          <Lights extent={bounds.extent + 2} shadows={quality.shadows} />
          <Mountains />
          <Clouds extent={bounds.extent} />
          <BoardTiles tiles={tiles} bounce={bounce} shadows={quality.shadows} />
          <Wanderers pieces={pieces} shadows={quality.shadows} pickable={sendHomePick ? (p) => p.player !== s.current : undefined} onPick={onPickPiece} />
          {isHuman && !hidden && s.step === 'place' && handDef && (
            <>
              <SpotMarkers cells={cells} selected={spot} color={color} onPick={pickSpot} />
              {spot && <GhostTile def={handDef} rot={rot} x={spot[0]} z={spot[1]} s={s} onTap={turnTile} color={color} />}
            </>
          )}
          {isHuman && !hidden && s.step === 'claim' && (
            <ClaimSpots s={s} options={claimOptions} selected={claimSel} color={color} player={s.current} onPick={setClaimSel} />
          )}
          <Confetti at={party} />
          <Popups items={popups} />
          <CameraRig view={view} viewKey={viewKey} bounds={bounds} focus={focus} closeTarget={last ? { x: last.x * TILE, z: last.z * TILE } : undefined} minDistance={6.5} keepVisible={curtain === null ? keepVisible : null} />
          <Effects quality={quality} />
        </Suspense>
        <Stats target={statsRef} />
        <ProjectHook />
      </Canvas>

      <header className="topbar game-top">
        <div className="players" role="list" aria-label="Scores">
          {s.players.map((p) => (
            <div key={p.id} role="listitem" className={`player${p.id === s.current && s.step !== 'ended' ? ' current' : ''}`} style={{ '--pc': playerCss(p.id) } as React.CSSProperties}>
              <span className="pname"><span className="dot" />{p.name}{seats[p.id]?.bot && <em> bot</em>}</span>
              <span className="pscore">{p.score}</span>
              <span className="pmeta">
                <Pieces n={p.pieces.wanderer} grand={p.pieces.grand} color={playerCss(p.id)} />
                {s.config.rules.actions && <span className="acts" title="Action tiles in hand">▤{p.actions.length}</span>}
                {s.config.scoring.market.enabled && <span className="goods">🥨{p.goods.pretzels} 🌿{p.goods.hops} 🪵{p.goods.timber}</span>}
              </span>
            </div>
          ))}
        </div>
        <div className="top-right">
          <span className="chip" title="Tiles left in the deck">▦ {deckLeft}</span>
          {s.players.length > 2 && <span className="chip" title="Turn order">{s.direction === 1 ? '↻' : '↺'}</span>}
          <button type="button" className="icon" aria-expanded={menu} aria-label="Menu" onClick={() => setMenu(!menu)}>☰</button>
        </div>
      </header>

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className="toast">{t.text}</div>)}
      </div>

      {menu && (
        <div className="panel menu" role="dialog" aria-label="Menu">
          <div className="seg views">
            {VIEWS.map((v) => <button key={v.id} type="button" aria-pressed={view === v.id} onClick={() => cycleView(v.id)}>{v.label}</button>)}
          </div>
          <button type="button" onClick={() => { setRuleCard(true); setMenu(false); }}>Rule card</button>
          <Toggle id="g-shadows" label="Shadows" checked={quality.shadows} onChange={(v) => setQuality({ ...quality, shadows: v })} />
          <Toggle id="g-ao" label="Ambient occlusion" checked={quality.ao} onChange={(v) => setQuality({ ...quality, ao: v, auto: false })} />
          <Toggle id="g-tilt" label="Tilt-shift blur" checked={quality.tiltShift} onChange={(v) => setQuality({ ...quality, tiltShift: v, auto: false })} />
          <Toggle id="g-auto" label="Adjust automatically" checked={quality.auto} onChange={(v) => setQuality({ ...quality, auto: v })} />
          <p className="note"><span className="stats inline" ref={statsRef} data-level="good">– fps</span>{autoNote ? ` ${autoNote}.` : ''}</p>
          <div className="panel-row">
            <button type="button" onClick={onQuit}>Save and quit</button>
            <button type="button" onClick={() => setMenu(false)} className="primary">Close</button>
          </div>
        </div>
      )}

      <nav className="dock game-dock" aria-label="Your turn">
        <div className="seg views quick">
          {VIEWS.map((v) => <button key={v.id} type="button" aria-pressed={view === v.id} onClick={() => cycleView(v.id)}>{v.label}</button>)}
        </div>
        {!hidden && <div className="turn-panel" style={{ '--pc': playerCss(s.current) } as React.CSSProperties}>{dock}</div>}
      </nav>

      {curtain !== null && (
        <div className="curtain" style={{ '--pc': playerCss(curtain) } as React.CSSProperties}>
          <div className="curtain-card">
            <span className="big-dot" />
            <h2>Pass to {nameOf(curtain)}</h2>
            <p>{s.players[curtain].skip ? '' : 'Your turn. Tap when you have the device.'}</p>
            <button type="button" className="primary" onClick={() => setCurtain(null)}>I’m {nameOf(curtain)}</button>
          </div>
        </div>
      )}

      {ruleCard && (
        <div className="curtain soft" onClick={() => setRuleCard(false)}>
          <div className="curtain-card rules" onClick={(e) => e.stopPropagation()}>
            <h2>Rule card</h2>
            {rulesInPlay.length ? (
              <ul>
                {rulesInPlay.map((r) => {
                  const by = saved.drafted?.find((d) => d.rule === r!.id);
                  return <li key={r!.id}><b>{r!.name}</b>{by ? <em> · picked by {seats[by.player]?.name}</em> : null}<br /><span>{r!.description}</span></li>;
                })}
              </ul>
            ) : <p>Base rules only.</p>}
            <p className="note">{s.config.pieces.wanderer} Wanderers each · {s.config.end.targetScore ? `first to ${s.config.end.targetScore} wins` : 'game ends when the deck runs out'}{s.config.end.turnLimit ? ` · ${s.config.end.turnLimit} turn limit` : ''}.</p>
            <button type="button" className="primary" onClick={() => setRuleCard(false)}>Close</button>
          </div>
        </div>
      )}

      {showEnd && s.step === 'ended' && (
        <div className="curtain soft">
          <div className="curtain-card results">
            <h2>{s.winners && s.winners.length > 1 ? 'A shared win!' : `${nameOf(s.winners?.[0] ?? 0)} wins!`}</h2>
            <ol>
              {standings.map((p, i) => (
                <li key={p.id} style={{ '--pc': playerCss(p.id) } as React.CSSProperties}>
                  <span className="rank">{s.winners?.includes(p.id) ? '👑' : i + 1}</span>
                  <span className="dot" />
                  <span className="pname">{p.name}</span>
                  <b>{p.score}</b>
                </li>
              ))}
            </ol>
            <p className="note">{Object.keys(s.board).length} tiles on the board · {s.turn} turns</p>
            <div className="panel-row">
              <button type="button" onClick={() => setShowEnd(false)}>See the board</button>
              <button type="button" onClick={onQuit}>New game</button>
              <button type="button" className="primary" onClick={onRematch}>Play again</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export type { GameState };
