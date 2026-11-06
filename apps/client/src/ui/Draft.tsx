/**
 * The secret rule draft, played on one device: each person picks a rule behind a pass screen,
 * bots pick on their own, the picks are revealed together, the host settles clashes, and the
 * engine plays quick bot games to prove the mix can finish before the game starts.
 */
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { DRAFT_RULES, MODULES, findConflicts, findRule, resolveDraft, type GameConfig, type GameOptions } from '@glockenfels/engine';
import type { Seat } from '../game/session';
import { playerCss } from '../scene/GameBoard';

type Phase =
  | { kind: 'pass'; player: number }
  | { kind: 'pick'; player: number }
  | { kind: 'reveal' }
  | { kind: 'checking' }
  | { kind: 'conflict'; a: string; b: string }
  | { kind: 'stuck' }
  | { kind: 'ready'; config: GameConfig };

const ruleName = (id: string) => findRule(id)?.name ?? id;

export function Draft({ seats, base, onDone, onCancel }: {
  seats: Seat[];
  base: GameOptions;
  onDone: (config: GameConfig, drafted: { rule: string; player: number }[]) => void;
  onCancel: () => void;
}) {
  const [modules, setModules] = useState<string[]>(base.modules ?? []);
  const [picks, setPicks] = useState<(string | null)[]>(() => seats.map(() => null));
  const [banned, setBanned] = useState<Set<string>[]>(() => seats.map(() => new Set()));
  const [phase, setPhase] = useState<Phase>({ kind: 'reveal' });
  const [choice, setChoice] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const host = seats[0]?.name ?? 'Host';

  /** Rules a player may pick now: not banned for them, and no clash with the modules. */
  const poolFor = (player: number, current = picks) => DRAFT_RULES.filter((r) => {
    if (banned[player].has(r.id)) return false;
    if (findConflicts([...modules, r.id]).length) return false;
    // Bots also steer clear of clashing with picks already made; people may clash and the host settles it.
    if (seats[player].bot) return !current.some((p, i) => i !== player && p && findConflicts([p, r.id]).length);
    return true;
  });

  /** Next seat without a pick: bots pick at once, people get the pass screen. */
  const advance = (current: (string | null)[]) => {
    const next = [...current];
    for (let i = 0; i < seats.length; i++) {
      if (next[i]) continue;
      if (seats[i].bot) {
        const pool = poolFor(i, next);
        next[i] = pool.length ? pool[Math.floor(Math.random() * pool.length)].id : null;
        if (!next[i]) next[i] = '';
        continue;
      }
      setPicks(next);
      setChoice(null);
      setPhase({ kind: 'pass', player: i });
      return;
    }
    setPicks(next);
    setRevealed(false);
    setPhase({ kind: 'reveal' });
  };

  useLayoutEffect(() => { advance(picks); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (phase.kind !== 'reveal') return;
    const t = setTimeout(() => setRevealed(true), 350);
    return () => clearTimeout(t);
  }, [phase]);

  const lockIn = (player: number) => {
    if (!choice) return;
    const next = [...picks];
    next[player] = choice;
    advance(next);
  };

  const check = () => {
    setPhase({ kind: 'checking' });
    // Let the "checking" card paint before the bot games run.
    setTimeout(() => {
      const chosen = picks.filter((p): p is string => !!p);
      const r = resolveDraft({ ...base, modules }, chosen, 3);
      if (r.conflicts.length) setPhase({ kind: 'conflict', a: r.conflicts[0].a, b: r.conflicts[0].b });
      else if (r.stuck.length || !r.config) setPhase({ kind: 'stuck' });
      else setPhase({ kind: 'ready', config: r.config });
    }, 60);
  };

  /** The host keeps `keep`; whoever picked `drop` picks again (or the module goes). */
  const settle = (keep: string, drop: string) => {
    if (MODULES.some((m) => m.id === drop)) {
      setModules(modules.filter((m) => m !== drop));
      setPhase({ kind: 'reveal' });
      return;
    }
    const next = picks.map((p) => (p === drop ? null : p));
    setBanned(banned.map((s, i) => (picks[i] === drop ? new Set([...s, drop, keep]) : s)));
    advance(next);
  };
  const dropRule = (rule: string) => {
    const next = picks.map((p) => (p === rule ? null : p));
    setBanned(banned.map((s, i) => (picks[i] === rule ? new Set([...s, rule]) : s)));
    advance(next);
  };

  const pickList = useMemo(() => picks.map((p, i) => ({ player: i, rule: p })), [picks]);

  if (phase.kind === 'pass') {
    const s = seats[phase.player];
    return (
      <div className="curtain solid" style={{ '--pc': playerCss(phase.player) } as React.CSSProperties}>
        <div className="curtain-card">
          <span className="big-dot" />
          <h2>Pass to {s.name}</h2>
          <p>Pick one secret rule. Nobody else should look.</p>
          <button type="button" className="primary" onClick={() => setPhase({ kind: 'pick', player: phase.player })}>I’m {s.name}</button>
          <button type="button" className="link" onClick={onCancel}>Back to setup</button>
        </div>
      </div>
    );
  }

  if (phase.kind === 'pick') {
    const pool = poolFor(phase.player);
    return (
      <div className="setup draft">
        <div className="setup-inner">
          <header className="title small" style={{ '--pc': playerCss(phase.player) } as React.CSSProperties}>
            <h1><span className="dot" /> {seats[phase.player].name}, pick a rule</h1>
            <p>It stays secret until everyone has picked.</p>
          </header>
          <div className="rule-grid">
            {pool.map((r) => (
              <button key={r.id} type="button" className="rule" aria-pressed={choice === r.id} onClick={() => setChoice(r.id)}>
                <b>{r.name}</b><small>{r.description}</small>
              </button>
            ))}
          </div>
          <div className="start-bar">
            <button type="button" className="primary wide" disabled={!choice} onClick={() => lockIn(phase.player)}>
              {choice ? `Lock in ${ruleName(choice)}` : 'Pick a rule'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const reveal = (
    <ul className="reveal">
      {pickList.map(({ player, rule }) => (
        <li key={player} className={revealed ? 'flip' : ''} style={{ '--pc': playerCss(player), transitionDelay: `${player * 120}ms` } as React.CSSProperties}>
          <span className="dot" /> <span className="pname">{seats[player].name}</span>
          <b>{rule ? ruleName(rule) : 'No rule'}</b>
          {rule && <small>{findRule(rule)?.description}</small>}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="curtain solid">
      <div className="curtain-card draft-card">
        {phase.kind === 'reveal' && (
          <>
            <h2>The rules are in</h2>
            {reveal}
            {modules.length > 0 && <p className="note">Modules: {modules.map(ruleName).join(', ')}</p>}
            <button type="button" className="primary" onClick={check}>Check they work together</button>
          </>
        )}
        {phase.kind === 'checking' && (
          <>
            <h2>Checking the mix…</h2>
            <p>Playing a few quick bot games with these rules.</p>
            <div className="spinner" aria-hidden="true" />
          </>
        )}
        {phase.kind === 'conflict' && (
          <>
            <h2>{ruleName(phase.a)} and {ruleName(phase.b)} clash</h2>
            <p>{host}, you’re the host: keep one. {MODULES.some((m) => m.id === phase.a || m.id === phase.b) ? 'Dropping a module turns it off for this game.' : 'Whoever picked the other one picks again.'}</p>
            {reveal}
            <div className="panel-row">
              <button type="button" onClick={() => settle(phase.a, phase.b)}>Keep {ruleName(phase.a)}</button>
              <button type="button" onClick={() => settle(phase.b, phase.a)}>Keep {ruleName(phase.b)}</button>
            </div>
          </>
        )}
        {phase.kind === 'stuck' && (
          <>
            <h2>This mix could get stuck</h2>
            <p>{host}, drop one rule. Whoever picked it picks again.</p>
            <div className="panel-row wrap">
              {[...new Set(picks.filter((p): p is string => !!p))].map((r) => <button key={r} type="button" onClick={() => dropRule(r)}>Drop {ruleName(r)}</button>)}
            </div>
          </>
        )}
        {phase.kind === 'ready' && (
          <>
            <h2>Rule card</h2>
            {reveal}
            <p className="note">All rules checked: three bot games finished with this mix.</p>
            <button type="button" className="primary" onClick={() => onDone(phase.config, picks.flatMap((rule, player) => (rule ? [{ rule, player }] : [])))}>Start the game</button>
          </>
        )}
      </div>
    </div>
  );
}
