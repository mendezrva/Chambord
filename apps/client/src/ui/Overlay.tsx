import { useState } from 'react';

import type { Quality, View } from '../scene/Stage';

const VIEWS: { id: View; label: string }[] = [
  { id: 'overhead', label: 'Overhead' },
  { id: 'isometric', label: 'Isometric' },
  { id: 'closeup', label: 'Close-up' },
];

export function Toggle({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle" htmlFor={id}>
      <span>{label}</span>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <i aria-hidden="true" />
    </label>
  );
}

export function Overlay(props: {
  statsRef: React.RefObject<HTMLSpanElement>;
  view: View;
  onView: (v: View) => void;
  quality: Quality;
  onQuality: (q: Partial<Quality>) => void;
  onDrop: () => void;
  onRebuild: () => void;
  onCelebrate: () => void;
  tileCount: number;
  autoNote: string | null;
  onBack: () => void;
}) {
  const { quality: q, onQuality } = props;
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(true);
  return (
    <>
      <header className="topbar">
        <div className="brand">
          <strong>Glockenfels</strong>
          <span>Phase 1 style test · {props.tileCount} tiles</span>
        </div>
        <span className="stats" ref={props.statsRef} data-level="good">– fps</span>
      </header>

      {help && (
        <div className="help" role="note">
          <p><b>Touch:</b> drag to move, pinch to zoom, two fingers to rotate and tilt.</p>
          <p><b>Mouse:</b> drag to rotate, right-drag to move, scroll to zoom.</p>
          <button type="button" onClick={() => setHelp(false)}>Got it</button>
        </div>
      )}

      {open && (
        <div className="panel" role="dialog" aria-label="Graphics settings">
          <div className="panel-row">
            <span>Tiles on the board</span>
            <div className="seg">
              {([40, 200] as const).map((n) => (
                <button key={n} type="button" aria-pressed={q.tiles === n} onClick={() => onQuality({ tiles: n })}>{n}</button>
              ))}
            </div>
          </div>
          <Toggle id="q-shadows" label="Shadows" checked={q.shadows} onChange={(v) => onQuality({ shadows: v })} />
          <Toggle id="q-ao" label="Ambient occlusion" checked={q.ao} onChange={(v) => onQuality({ ao: v, auto: false })} />
          <Toggle id="q-tilt" label="Tilt-shift blur" checked={q.tiltShift} onChange={(v) => onQuality({ tiltShift: v, auto: false })} />
          <div className="panel-row">
            <span>Resolution</span>
            <div className="seg">
              {[1, 1.5, 2].map((d) => (
                <button key={d} type="button" aria-pressed={q.dpr === d} onClick={() => onQuality({ dpr: d, auto: false })}>{d}×</button>
              ))}
            </div>
          </div>
          <Toggle id="q-auto" label="Adjust automatically" checked={q.auto} onChange={(v) => onQuality({ auto: v })} />
          {props.autoNote && <p className="note">{props.autoNote}.</p>}
        </div>
      )}

      <nav className="dock" aria-label="Controls">
        <div className="seg views">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" aria-pressed={props.view === v.id} onClick={() => props.onView(v.id)}>{v.label}</button>
          ))}
        </div>
        <div className="actions">
          <button type="button" className="primary" onClick={props.onDrop}>Drop a tile</button>
          <button type="button" onClick={props.onCelebrate}>Celebrate</button>
          <button type="button" onClick={props.onRebuild}>Rebuild</button>
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>Graphics</button>
          <button type="button" onClick={props.onBack}>Back</button>
        </div>
      </nav>
    </>
  );
}
