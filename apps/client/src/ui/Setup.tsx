/**
 * Title screen and custom game builder: players and bots, presets, modules, rules (picked or
 * drafted in secret), tile counts, scoring and end conditions. Every change rebuilds the config
 * through the engine, so the screen can only start a game the engine accepts.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ALL_TILES, buildConfig, DRAFT_RULES, findConflicts, MODULES, optionsFromSpec, PRESETS, isRiver,
  type GameConfig, type GameOptions, type GameSpec,
} from '@glockenfels/engine';
import type { Seat } from '../game/session';
import { playerCss } from '../scene/GameBoard';
import { describeTile, TileCard } from './TileCard';
import { Toggle } from './Overlay';

export interface Builder {
  seats: Seat[];
  modules: string[];
  rules: string[];
  ruleMode: 'pick' | 'draft';
  /** Sparse edits on top of what modules and rules set: 'deck.<tileId>' or a config path such as 'scoring.town.perTile'. */
  edits: Record<string, number>;
  handoff: boolean;
  preset: string | null;
}

const BUILDER_KEY = 'glockenfels.builder.v1';
const DEFAULT_NAMES = ['Anna', 'Ben', 'Clara', 'Dieter', 'Eva', 'Franz', 'Greta', 'Hans'];

export function defaultBuilder(): Builder {
  return {
    seats: [{ name: DEFAULT_NAMES[0], bot: false }, { name: DEFAULT_NAMES[1], bot: false }],
    modules: [], rules: [], ruleMode: 'pick', edits: {}, handoff: true, preset: 'classic',
  };
}
export function loadBuilder(): Builder {
  try {
    const b = JSON.parse(localStorage.getItem(BUILDER_KEY) ?? 'null') as Builder | null;
    if (b && Array.isArray(b.seats) && b.seats.length >= 2) {
      // Drop modules and rules this version no longer has (e.g. Farmers, now part of the base game).
      const known = (ids: unknown, list: { id: string }[]) => (Array.isArray(ids) ? ids.filter((id) => list.some((r) => r.id === id)) : []);
      return { ...defaultBuilder(), ...b, modules: known(b.modules, MODULES), rules: known(b.rules, DRAFT_RULES) };
    }
  } catch { /* fall through */ }
  return defaultBuilder();
}
const saveBuilder = (b: Builder) => { try { localStorage.setItem(BUILDER_KEY, JSON.stringify(b)); } catch { /* ignore */ } };

interface Field { path: string; label: string; min: number; max: number; step?: number; show?: (c: GameConfig) => boolean; zero?: string }
const GAME_FIELDS: Field[] = [
  { path: 'pieces.wanderer', label: 'Wanderers per player', min: 1, max: 12 },
  { path: 'pieces.grand', label: 'Grand Wanderers per player', min: 0, max: 3 },
  { path: 'end.targetScore', label: 'Win at score', min: 0, max: 300, step: 10, zero: 'Off' },
  { path: 'end.turnLimit', label: 'Turn limit', min: 0, max: 300, step: 5, zero: 'Off' },
  { path: 'turn.actionHandSize', label: 'Action tiles you can hold', min: 1, max: 4, show: (c) => c.rules.actions },
];
const SCORE_FIELDS: { group: string; note?: string; fields: Field[] }[] = [
  { group: 'Roads', fields: [
    { path: 'scoring.road.perTile', label: 'Complete, per tile', min: 0, max: 10 },
    { path: 'scoring.road.incompletePerTile', label: 'Unfinished, per tile', min: 0, max: 10 },
    { path: 'scoring.road.doubleFrom', label: 'Double from length', min: 0, max: 15, zero: 'Off' },
  ] },
  { group: 'Towns', fields: [
    { path: 'scoring.town.perTile', label: 'Complete, per tile', min: 0, max: 10 },
    { path: 'scoring.town.perBanner', label: 'Complete, per banner', min: 0, max: 10 },
    { path: 'scoring.town.incompletePerTile', label: 'Unfinished, per tile', min: 0, max: 10 },
    { path: 'scoring.town.incompletePerBanner', label: 'Unfinished, per banner', min: 0, max: 10 },
    { path: 'scoring.town.beerGardenPerTile', label: 'Beer garden bonus, per tile', min: 0, max: 5, show: (c) => c.modules.includes('beerGardens') },
  ] },
  { group: 'Monasteries', fields: [
    { path: 'scoring.monastery.complete', label: 'Complete', min: 0, max: 30 },
    { path: 'scoring.monastery.incompletePerTile', label: 'Unfinished, per tile', min: 0, max: 5 },
    { path: 'scoring.monastery.hopGardenBonus', label: 'Per hop garden nearby', min: 0, max: 5, show: (c) => c.modules.includes('hopGardens') },
  ] },
  { group: 'Fields', note: 'Scored at game end: a Wanderer lying in a field earns points for every completed town the field touches.', fields: [
    { path: 'scoring.meadow.perTown', label: 'Per completed town', min: 0, max: 10, zero: 'Off', show: (c) => !c.draftRules.includes('noFields') },
  ] },
  { group: 'Market Day', fields: [
    { path: 'scoring.market.mostOfGood', label: 'Most of a good', min: 0, max: 30, show: (c) => c.scoring.market.enabled },
  ] },
];
const ALL_FIELDS = [...GAME_FIELDS, ...SCORE_FIELDS.flatMap((g) => g.fields)];

const getPath = (o: unknown, path: string) => path.split('.').reduce<any>((a, k) => a?.[k], o); // eslint-disable-line @typescript-eslint/no-explicit-any

/** The engine options for a builder, with its edits as the custom step. */
export function optionsFor(b: Builder, withRules = b.ruleMode === 'pick', players = b.seats.length): GameOptions {
  return optionsFromSpec(specFor(b, withRules, players));
}

/** The builder as plain data, for the server. */
export function specFor(b: Builder, withRules = b.ruleMode === 'pick', players = b.seats.length): GameSpec {
  return { players, modules: b.modules, rules: withRules ? b.rules : [], edits: b.edits };
}

function Stepper({ value, min, max, step = 1, onChange, zero, label }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; zero?: string; label: string }) {
  return (
    <span className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label={`Less ${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))}>−</button>
      <output>{value === 0 && zero ? zero : value}</output>
      <button type="button" aria-label={`More ${label}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))}>+</button>
    </span>
  );
}

function Section({ title, children, open: initial = false, summary }: { title: string; children: React.ReactNode; open?: boolean; summary?: string }) {
  const [open, setOpen] = useState(initial);
  return (
    <section className={`card${open ? ' open' : ''}`}>
      <button type="button" className="card-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{title}</span>{summary && <small>{summary}</small>}<i aria-hidden="true">{open ? '–' : '+'}</i>
      </button>
      {open && <div className="card-body">{children}</div>}
    </section>
  );
}

/** Builder fields for an online room's settings, with placeholder seats for the player count. */
export function builderFromSettings(st: { modules: string[]; rules: string[]; ruleMode: 'pick' | 'draft'; edits: Record<string, number>; preset: string | null }, players: number): Builder {
  return {
    ...defaultBuilder(),
    seats: Array.from({ length: Math.max(2, players) }, (_, i) => ({ name: DEFAULT_NAMES[i], bot: false })),
    modules: st.modules, rules: st.rules, ruleMode: st.ruleMode, edits: st.edits, preset: st.preset,
  };
}

export function Setup({ onStart, onResume, canResume = false, onStyleTest, onOnline, online }: {
  onStart: (b: Builder, config: GameConfig | null) => void;
  onResume?: () => void;
  canResume?: boolean;
  onStyleTest?: () => void;
  onOnline?: () => void;
  /** Edit an online room's rules: no seats, and the button saves instead of starting. */
  online?: { initial: Builder; onCancel: () => void };
}) {
  const [b, setB] = useState<Builder>(() => online?.initial ?? loadBuilder());
  useEffect(() => { if (!online) saveBuilder(b); }, [b, online]);
  const update = (p: Partial<Builder>) => setB((o) => ({ ...o, ...p, preset: p.preset !== undefined ? p.preset : null }));

  // Build twice: once to read the raw deck before the multipliers, once for the real config.
  const preview = useMemo(() => {
    let rawDeck: GameConfig['deck'] = [];
    try {
      const o = optionsFor(b);
      const cfg = buildConfig({ ...o, customize: (c) => { o.customize?.(c); rawDeck = structuredClone(c.deck); } });
      return { cfg, rawDeck, error: null as string | null };
    } catch (e) {
      try {
        const cfg = buildConfig({ ...optionsFor(b), customize: undefined });
        return { cfg, rawDeck: rawDeck.length ? rawDeck : cfg.deck, error: (e as Error).message };
      } catch (e2) {
        return { cfg: null, rawDeck, error: (e2 as Error).message };
      }
    }
  }, [b]);
  const cfg = preview.cfg;
  const count = (id: string) => preview.rawDeck.find((d) => d.tileId === id)?.count ?? 0;
  const landscape = cfg ? cfg.deck.filter((d) => !cfg.tiles[d.tileId].action && !isRiver(cfg, d.tileId)).reduce((s, d) => s + d.count, 0) : 0;
  const actionCount = cfg ? cfg.deck.filter((d) => cfg.tiles[d.tileId].action).reduce((s, d) => s + d.count, 0) : 0;

  const applyPreset = (id: string) => {
    const p = PRESETS[id];
    // Turn a preset's custom step into builder edits by diffing it against the same game without it.
    const plain = buildConfig({ ...p, customize: undefined });
    const tuned = buildConfig(p);
    const edits: Record<string, number> = {};
    for (const f of ALL_FIELDS) if (getPath(tuned, f.path) !== getPath(plain, f.path)) edits[f.path] = getPath(tuned, f.path);
    const seats = online ? b.seats : Array.from({ length: p.players }, (_, i) => b.seats[i] ?? { name: DEFAULT_NAMES[i], bot: false });
    setB({ ...b, seats, modules: p.modules ?? [], rules: p.rules ?? [], ruleMode: 'pick', edits, preset: id });
  };

  const setSeat = (i: number, s: Partial<Seat>) => update({ seats: b.seats.map((x, j) => (j === i ? { ...x, ...s } : x)) });
  const addSeat = () => {
    if (b.seats.length >= 8) return;
    const used = new Set(b.seats.map((s) => s.name));
    update({ seats: [...b.seats, { name: DEFAULT_NAMES.find((n) => !used.has(n)) ?? `Player ${b.seats.length + 1}`, bot: true }] });
  };
  const removeSeat = (i: number) => { if (b.seats.length > 2) update({ seats: b.seats.filter((_, j) => j !== i) }); };

  const toggleModule = (id: string) => {
    const modules = b.modules.includes(id) ? b.modules.filter((m) => m !== id) : [...b.modules, id];
    // Drop rules that now clash with a module.
    const rules = b.rules.filter((r) => !findConflicts([...modules, r]).length);
    update({ modules, rules });
  };
  const toggleRule = (id: string) => update({ rules: b.rules.includes(id) ? b.rules.filter((r) => r !== id) : [...b.rules, id] });
  const clashOf = (id: string) => {
    if (b.rules.includes(id)) return null;
    const c = findConflicts([...b.modules, ...b.rules, id]).find((x) => x.a === id || x.b === id);
    if (!c) return null;
    const other = c.a === id ? c.b : c.a;
    return [...MODULES, ...DRAFT_RULES].find((r) => r.id === other)?.name ?? other;
  };
  const setEdit = (path: string, v: number) => update({ edits: { ...b.edits, [path]: v } });
  const resetTiles = () => update({ edits: Object.fromEntries(Object.entries(b.edits).filter(([k]) => !k.startsWith('deck.'))) });
  const resetScoring = () => update({ edits: Object.fromEntries(Object.entries(b.edits).filter(([k]) => k.startsWith('deck.'))) });

  const humans = b.seats.filter((s) => !s.bot).length;
  const landTiles = ALL_TILES.filter((t) => !t.action && !t.edges.includes('river') && t.id !== 'castle');
  const riverTiles = ALL_TILES.filter((t) => t.edges.includes('river'));
  const actionTiles = ALL_TILES.filter((t) => t.action);
  const edited = Object.keys(b.edits).length;
  const ruleSummary = b.ruleMode === 'draft' ? 'Secret draft' : b.rules.length ? `${b.rules.length} on` : 'None';

  const fieldRow = (f: Field) => {
    if (!cfg || (f.show && !f.show(cfg))) return null;
    const v = (b.edits[f.path] ?? getPath(cfg, f.path)) as number;
    return (
      <div className="row field-row" key={f.path}>
        <span className="row-label">{f.label}{b.edits[f.path] !== undefined && <em className="edited">edited</em>}</span>
        <Stepper label={f.label} value={v} min={f.min} max={f.max} step={f.step} zero={f.zero} onChange={(n) => setEdit(f.path, n)} />
      </div>
    );
  };
  const tileRow = (t: (typeof ALL_TILES)[number]) => (
    <div className={`tile-row${count(t.id) ? '' : ' none'}`} key={t.id}>
      <TileCard def={t} />
      <span className="tile-text"><b>{t.name}</b><small>{describeTile(t)}</small></span>
      <Stepper label={t.name} value={count(t.id)} min={0} max={20} onChange={(n) => setEdit(`deck.${t.id}`, n)} />
    </div>
  );

  return (
    <div className="setup">
      <div className="setup-inner">
        {online ? (
          <header className="title small">
            <h1>Game rules</h1>
            <p>Everyone at the table plays by these. Player count comes from the table ({b.seats.length}).</p>
          </header>
        ) : (
          <header className="title">
            <h1>Glockenfels</h1>
            <p>Lay the valley tile by tile. Send out your Wanderers. Pass the device, or play friends online.</p>
          </header>
        )}

        {canResume && (
          <button type="button" className="primary wide resume" onClick={onResume}>Continue saved game</button>
        )}
        {onOnline && (
          <button type="button" className="wide online-btn" onClick={onOnline}><b>Play online</b><small>Friends, invites, ratings and the leaderboard</small></button>
        )}

        <section className="card open">
          <div className="card-head static"><span>Quick start</span></div>
          <div className="card-body chips">
            {Object.entries(PRESETS).map(([id, p]) => (
              <button key={id} type="button" className="chip-btn" aria-pressed={b.preset === id} onClick={() => applyPreset(id)}>
                <b>{p.name}</b><small>{p.description}</small>
              </button>
            ))}
          </div>
        </section>

        {!online && <section className="card open">
          <div className="card-head static"><span>Players</span><small>{b.seats.length} · {humans} at this device</small></div>
          <div className="card-body">
            {b.seats.map((s, i) => (
              <div className="row seat" key={i} style={{ '--pc': playerCss(i) } as React.CSSProperties}>
                <span className="dot" />
                <input aria-label={`Player ${i + 1} name`} value={s.name} maxLength={14} onChange={(e) => setSeat(i, { name: e.target.value })} onBlur={(e) => { if (!e.target.value.trim()) setSeat(i, { name: DEFAULT_NAMES[i] }); }} />
                <div className="seg small">
                  <button type="button" aria-pressed={!s.bot} onClick={() => setSeat(i, { bot: false })}>Person</button>
                  <button type="button" aria-pressed={s.bot} onClick={() => setSeat(i, { bot: true })}>Bot</button>
                </div>
                <button type="button" className="icon" aria-label={`Remove ${s.name}`} disabled={b.seats.length <= 2} onClick={() => removeSeat(i)}>×</button>
              </div>
            ))}
            <div className="row">
              <button type="button" disabled={b.seats.length >= 8} onClick={addSeat}>+ Add player</button>
              <span className="note">2 to 8 players</span>
            </div>
            {humans > 1 && <Toggle id="handoff" label="Pass-the-device screen between turns" checked={b.handoff} onChange={(v) => update({ handoff: v, preset: b.preset })} />}
          </div>
        </section>}

        <Section title="Modules" summary={b.modules.length ? `${b.modules.length} on` : 'None'} open={b.modules.length > 0}>
          {MODULES.map((m) => {
            const clash = !b.modules.includes(m.id) && b.ruleMode === 'pick' ? b.rules.map((r) => findConflicts([m.id, r])[0]).find(Boolean) : undefined;
            return (
              <label key={m.id} className={`toggle rich${clash ? ' blocked' : ''}`} htmlFor={`m-${m.id}`}>
                <span><b>{m.name}</b><small>{clash ? clash.reason : m.description}</small></span>
                <input id={`m-${m.id}`} type="checkbox" disabled={!!clash} checked={b.modules.includes(m.id)} onChange={() => toggleModule(m.id)} />
                <i aria-hidden="true" />
              </label>
            );
          })}
        </Section>

        <Section title="Rules" summary={ruleSummary} open={b.rules.length > 0 || b.ruleMode === 'draft'}>
          <div className="seg">
            <button type="button" aria-pressed={b.ruleMode === 'pick'} onClick={() => update({ ruleMode: 'pick' })}>Choose rules</button>
            <button type="button" aria-pressed={b.ruleMode === 'draft'} onClick={() => update({ ruleMode: 'draft' })}>Secret draft</button>
          </div>
          {b.ruleMode === 'draft' ? (
            <p className="note">Before the game, each player secretly picks one rule{online ? ' on their own device' : ''}. They are revealed together. If two clash, {online ? 'the host' : `${b.seats[0]?.name || 'the host'} (the host)`} keeps one and the other player picks again. The engine plays a few quick bot games to be sure the mix works.</p>
          ) : (
            <div className="rule-grid">
              {DRAFT_RULES.map((r) => {
                const clash = clashOf(r.id);
                return (
                  <button key={r.id} type="button" className="rule" aria-pressed={b.rules.includes(r.id)} disabled={!!clash} onClick={() => toggleRule(r.id)}>
                    <b>{r.name}</b><small>{clash ? `Clashes with ${clash}` : r.description}</small>
                  </button>
                );
              })}
            </div>
          )}
        </Section>

        <Section title="Tiles" summary={`${landscape} landscape${actionCount ? ` · ${actionCount} action` : ''}`}>
          <p className="note">Counts before Quick Game or Marathon resize the deck. The castle start tile is always first.</p>
          <h3>Landscape</h3>
          {landTiles.map(tileRow)}
          {b.modules.includes('riverlands') && <><h3>River</h3>{riverTiles.map(tileRow)}</>}
          {b.modules.includes('actions') && <><h3>Action tiles</h3>{actionTiles.map((t) => (
            <div className="row field-row" key={t.id}><span className="row-label">{t.name}</span><Stepper label={t.name} value={count(t.id)} min={0} max={10} onChange={(n) => setEdit(`deck.${t.id}`, n)} /></div>
          ))}</>}
          <button type="button" onClick={resetTiles}>Reset tile counts</button>
        </Section>

        <Section title="Scoring" summary={edited ? 'Edited' : 'Standard'}>
          {SCORE_FIELDS.map((g) => {
            const rows = g.fields.map(fieldRow).filter(Boolean);
            return rows.length ? <div key={g.group} className="field-group"><h3>{g.group}</h3>{g.note && <p className="note">{g.note}</p>}{rows}</div> : null;
          })}
          <button type="button" onClick={resetScoring}>Reset scoring</button>
        </Section>

        <Section title="Pieces and game end" summary={cfg ? `${cfg.pieces.wanderer} Wanderers` : ''}>
          {GAME_FIELDS.map(fieldRow)}
        </Section>

        {preview.error && <p className="error" role="alert">{preview.error}</p>}
        <div className="start-bar">
          {online ? <button type="button" className="link" onClick={online.onCancel}>Cancel</button> : onStyleTest && <button type="button" className="link" onClick={onStyleTest}>Graphics test</button>}
          <button type="button" className="primary wide" disabled={!!preview.error || !cfg} onClick={() => onStart(b, b.ruleMode === 'draft' ? null : cfg)}>
            {online ? 'Use these rules' : b.ruleMode === 'draft' ? 'Start the rule draft' : 'Start game'}
          </button>
        </div>
      </div>
    </div>
  );
}
