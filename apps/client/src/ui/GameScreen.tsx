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
import { BoardTiles, ClaimSpots, FeatureIcon, GhostTile, playerColor, playerCss, Popups, SpotMarkers, usePieces, useTiles, Wanderers, type PieceItem, type Popup } from '../scene/GameBoard';
import { boundsOf, CameraRig, declineQuality, defaultQuality, Effects, ProjectHook, reducedMotion, Stats, type Quality, type View } from '../scene/Stage';
import type { GameController } from '../game/session';
import type { ResultRow } from '@glockenfels/protocol';
import { featureLabel } from '../game/tiles3d';
import { ACTION_INFO, ActionCard, TileCard } from './TileCard';
import { Toggle } from './Overlay';
import { Sidebar, useHistory, type SideTab } from './Sidebar';

const PREFS_KEY = 'glockenfels.prefs.v1';
interface Prefs { side: boolean; tab: SideTab; markers: boolean }
function loadPrefs(): Prefs {
  const wide = typeof window !== 'undefined' && window.innerWidth >= 1000;
  const d: Prefs = { side: wide, tab: 'log', markers: true };
  try { return { ...d, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') }; } catch { return d; }
}
/** A short buzz on Android; iOS Safari ignores it. */
const buzz = (ms = 12) => { try { navigator.vibrate?.(ms); } catch { /* not supported */ } };

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

/** Extra controls and results when the game is played online. */
export interface OnlineExtras {
  result?: ResultRow[];
  rated: boolean;
  onTakeover: (seat: number) => void;
  onResign: () => void;
  takeoverAfter: number;
}

export function GameScreen({ game, onQuit, onRematch, online, quitLabel = 'Save and quit', rematchLabel = 'Play again' }: {
  game: GameController;
  onQuit: () => void;
  onRematch?: () => void;
  online?: OnlineExtras;
  quitLabel?: string;
  rematchLabel?: string;
}) {
  const { state: s, version, batch, error, dispatch, undo, clearError } = game;
  const seats = game.seats;
  // People playing on this device: more than one means pass and play.
  const humans = seats.filter((x) => x.local).length;
  const seat = seats[s.current];
  const isHuman = seat.local && s.step !== 'ended';
  const me = s.players[s.current];
  const color = playerColor(s.current);

  // ---------- view and quality ----------
  const [quality, setQuality] = useState<Quality>(defaultQuality);
  const [autoNote, setAutoNote] = useState<string | null>(null);
  const [view, setView] = useState<View>('isometric');
  const [viewKey, setViewKey] = useState(0);
  const [focus, setFocus] = useState<{ x: number; z: number; n: number } | null>(null);
  const [menu, setMenu] = useState(false);
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);
  const setPrefs = (p: Partial<Prefs>) => setPrefsState((o) => {
    const n = { ...o, ...p };
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(n)); } catch { /* ignore */ }
    return n;
  });
  const history = useHistory(game, prefs.side);
  const [highlight, setHighlight] = useState<string | null>(null);
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
    // Tapping the chosen spot again turns the tile, like tapping the tile itself.
    if (spot && spot[0] === x && spot[1] === z) { turnTile(); return; }
    buzz(8);
    setSpot([x, z]);
    setRot(rots.includes(rot) ? rot : rots[0]);
  };
  // Only one place it can go: put it there straight away; the player still turns and confirms.
  useEffect(() => {
    if (isHuman && s.step === 'place' && !spot && cells.length === 1) pickSpot(cells[0][0], cells[0][1]);
  }, [cells, isHuman]); // eslint-disable-line react-hooks/exhaustive-deps
  const spotWays = spot ? (fits.get(`${spot[0]},${spot[1]}`) ?? []).length : 0;
  const turnTile = () => {
    if (!spot) { setRot((r) => (r + 1) % 4); return; }
    const rots = fits.get(`${spot[0]},${spot[1]}`) ?? [];
    const i = rots.indexOf(rot);
    setRot(rots[(i + 1) % rots.length]);
  };
  const confirmPlace = () => {
    if (!spot) return;
    buzz(15);
    dispatch({ type: 'place', hand: Math.min(handIdx, s.hand.length - 1), x: spot[0], z: spot[1], rot });
  };

  const claimOptions = useMemo(() => {
    if (s.step !== 'claim' || !last) return [];
    const a = tileAnalysis(s, last);
    const order = ['town', 'road', 'monastery', 'meadow'];
    const opts = claimable(s)
      .map((local) => ({ local, kind: a.features[local].kind as string, label: featureLabel(a.features[local].kind) }))
      .sort((x, y) => order.indexOf(x.kind) - order.indexOf(y.kind));
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

  const claim = (piece: PieceType) => { if (claimSel !== null) { buzz(15); dispatch({ type: 'claim', local: claimSel, piece }); } };
  const pickClaim = (local: number) => { buzz(8); setClaimSel(local); };

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
        case 'claimed': {
          const id = `${e.tileKey}:${e.local}`;
          setHighlight(id);
          setTimeout(() => setHighlight((h) => (h === id ? null : h)), 4500);
          break;
        }
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
    if (!seat.local) return;
    if (game.handoff && humans > 1 && prev !== null) setCurtain(s.current);
    else if (prev !== null && humans > 1) toast(`${seat.name}’s turn`);
  }, [s.current, s.turn, s.step]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- bots ----------
  useEffect(() => {
    if (!game.runBots || s.step === 'ended' || !seat.bot || curtain !== null) return;
    const delay = (BOT_DELAY[s.step] ?? 700) * (humans === 0 ? 0.6 : 1);
    const t = setTimeout(() => dispatch(botAction(s, game.seed + s.log.length)), delay);
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
  (window as unknown as { __pick?: unknown }).__pick = () => cells[0] && pickSpot(cells[0][0], cells[0][1]);

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
  } else if (game.mode === 'replay') {
    dock = (
      <div className="dock-row">
        <p className="hint"><b>Replay</b> · move {s.log.length} · {seat.name} to play</p>
      </div>
    );
  } else if (!isHuman) {
    dock = (
      <div className="dock-row">
        <p className="hint">
          <span className="dot" style={{ background: playerCss(s.current) }} /> <b>{seat.name}</b>{' '}
          {seat.bot ? (seat.botControl ? 'is away, so a bot is playing…' : 'is thinking…') : seat.online === false ? 'has dropped out. Waiting for them to come back…' : 'is taking their turn…'}
        </p>
        {online && !seat.bot && seat.online === false && (seat.awayFor ?? 0) >= online.takeoverAfter && (
          <div className="btns"><button type="button" className="primary" onClick={() => online.onTakeover(s.current)}>Let a bot play for {seat.name}</button></div>
        )}
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
          <p className="hint title-hint">{handDef.name}</p>
          <p className="hint small">
            {s.mustPlace > 1 ? 'Draw Two: place this, then one more. ' : ''}
            {spot
              ? spotWays > 1 ? `Fits ${spotWays} ways here. Tap the tile to turn it.` : 'Fits one way here.'
              : cells.length === 1 ? 'Only one spot fits.' : `Tap one of the ${cells.length} glowing spots.`}
          </p>
        </div>
        <div className="btns">
          <button type="button" onClick={turnTile} aria-label="Turn tile" disabled={!!spot && spotWays < 2}><span className="btn-ico">⟳</span> Turn</button>
          <button type="button" className="primary" disabled={!spot} onClick={confirmPlace}>{spot ? 'Place tile' : 'Pick a spot'}</button>
        </div>
      </div>
    );
  } else if (s.step === 'claim') {
    const sel = claimOptions.find((o) => o.local === claimSel);
    dock = (
      <div className="dock-row">
        <div className="hint-col">
          <p className="hint title-hint">Send out a Wanderer? <Pieces n={me.pieces.wanderer} grand={me.pieces.grand} color={playerCss(s.current)} /></p>
          <p className="hint small">{sel ? (sel.kind === 'meadow' ? 'Field Wanderers stay out until the game ends.' : `On the ${sel.label.toLowerCase()}. They come home when it is finished.`) : 'Tap a spot on the new tile, or pick one here.'}</p>
        </div>
        <div className="claim-opts" role="group" aria-label="Feature to claim">
          {claimOptions.map((o) => (
            <button key={o.local} type="button" className="claim-opt" aria-pressed={claimSel === o.local} onClick={() => pickClaim(o.local)}>
              <FeatureIcon kind={o.kind} />{o.label}
            </button>
          ))}
        </div>
        <div className="btns">
          <button type="button" onClick={undo} aria-label="Take the tile back">↶ Undo</button>
          <button type="button" onClick={() => dispatch({ type: 'pass' })}>Skip</button>
          {sel && me.pieces.grand > 0 && <button type="button" onClick={() => claim('grand')}>Grand</button>}
          {sel && me.pieces.wanderer > 0 && <button type="button" className="primary" onClick={() => claim('wanderer')}>Send Wanderer</button>}
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
    <div className={`app game${prefs.side ? ' with-side' : ''}`}>
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
          <Wanderers pieces={pieces} shadows={quality.shadows} markers={prefs.markers} highlight={highlight} pickable={sendHomePick ? (p) => p.player !== s.current : undefined} onPick={onPickPiece} />
          {isHuman && !hidden && s.step === 'place' && handDef && (
            <>
              <SpotMarkers cells={cells} selected={spot} color={color} onPick={pickSpot} />
              {spot && <GhostTile def={handDef} rot={rot} x={spot[0]} z={spot[1]} s={s} onTap={turnTile} color={color} ways={spotWays} onConfirm={confirmPlace} onCancel={cells.length > 1 ? () => setSpot(null) : undefined} />}
            </>
          )}
          {isHuman && !hidden && s.step === 'claim' && (
            <ClaimSpots s={s} options={claimOptions} selected={claimSel} color={color} player={s.current} onPick={pickClaim} />
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
              <span className="pname"><span className="dot" />{p.name}{seats[p.id]?.bot && <em> {seats[p.id]?.botControl ? (seats[p.id]?.resigned ? 'resigned' : 'bot playing') : 'bot'}</em>}{seats[p.id] && !seats[p.id].bot && seats[p.id].online === false && <em> away</em>}</span>
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
          <button type="button" className={`icon${prefs.side ? ' on' : ''}`} aria-expanded={prefs.side} aria-label="Play log, scores and tiles" title="Play log, scores and tiles" onClick={() => setPrefs({ side: !prefs.side })}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M5 4h11l3 3v13H5z M8 9h8 M8 13h8 M8 17h5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
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
          <Toggle id="g-markers" label="Markers over Wanderers" checked={prefs.markers} onChange={(v) => setPrefs({ markers: v })} />
          <Toggle id="g-shadows" label="Shadows" checked={quality.shadows} onChange={(v) => setQuality({ ...quality, shadows: v })} />
          <Toggle id="g-ao" label="Ambient occlusion" checked={quality.ao} onChange={(v) => setQuality({ ...quality, ao: v, auto: false })} />
          <Toggle id="g-tilt" label="Tilt-shift blur" checked={quality.tiltShift} onChange={(v) => setQuality({ ...quality, tiltShift: v, auto: false })} />
          <Toggle id="g-auto" label="Adjust automatically" checked={quality.auto} onChange={(v) => setQuality({ ...quality, auto: v })} />
          <p className="note"><span className="stats inline" ref={statsRef} data-level="good">– fps</span>{autoNote ? ` ${autoNote}.` : ''}</p>
          <div className="panel-row">
            {online && s.step !== 'ended' && !seats.find((x) => x.local)?.resigned && seats.some((x) => x.local) && (
              <button type="button" onClick={() => { if (confirm('Resign? A bot finishes the game for you and you rank last.')) { online.onResign(); setMenu(false); } }}>Resign</button>
            )}
            <button type="button" onClick={onQuit}>{quitLabel}</button>
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

      {prefs.side && !hidden && <Sidebar s={s} history={history} tab={prefs.tab} onTab={(tab) => setPrefs({ tab })} onClose={() => setPrefs({ side: false })} />}

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
                  const by = game.drafted?.find((d) => d.rule === r!.id);
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
                  {(() => {
                    const r = online?.result?.find((x) => x.seat === p.id);
                    if (!r || r.ratingBefore === undefined || r.ratingAfter === undefined || !online?.rated) return null;
                    const d = r.ratingAfter - r.ratingBefore;
                    return <small className={`elo ${d > 0 ? 'up' : d < 0 ? 'down' : ''}`}>{r.ratingAfter} ({d >= 0 ? '+' : ''}{d})</small>;
                  })()}
                  <b>{p.score}</b>
                </li>
              ))}
            </ol>
            <p className="note">{Object.keys(s.board).length} tiles on the board · {s.turn} turns{online ? (online.rated ? ' · rated game' : ' · unrated (needs two people)') : ''}</p>
            <div className="panel-row">
              <button type="button" onClick={() => setShowEnd(false)}>See the board</button>
              <button type="button" onClick={onQuit}>{game.mode === 'local' ? 'New game' : quitLabel}</button>
              {onRematch && <button type="button" className="primary" onClick={onRematch}>{rematchLabel}</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export type { GameState };
