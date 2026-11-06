import type { ActionKind, TileDef } from '@glockenfels/engine';

/**
 * A flat picture of a tile for the hand, the market and the builder. It draws the unrotated tile
 * and turns it with CSS, so rotating a preview animates.
 */
const C = {
  meadow: '#6aa84f', meadowDark: '#4f8a3c', town: '#ece6d8', roof: '#c0472f', road: '#e0cfa4', roadEdge: '#9b815a',
  river: '#2f94ad', abbey: '#f5f1e6', copper: '#4e9e82', blue: '#2f74c0', crag: '#c9c0ae', hops: '#7fbf4d', bench: '#c9772f',
};
const MID = [[50, 0], [100, 50], [50, 100], [0, 50]];
const CORN = [[[0, 0], [100, 0]], [[100, 0], [100, 100]], [[100, 100], [0, 100]], [[0, 100], [0, 0]]];
const JUNCTION = new Set(['shrine', 'castle', 'maypole', 'lake']);
const GOOD_COLOR = { pretzels: '#a8642c', hops: '#7fbf4d', timber: '#7a5236' } as const;

function paths(dirs: number[], junction: boolean) {
  if (dirs.length === 2 && !junction) {
    const [a, b] = [MID[dirs[0]], MID[dirs[1]]];
    return [`M${a[0]} ${a[1]} Q50 50 ${b[0]} ${b[1]}`];
  }
  return dirs.map((d) => `M${MID[d][0]} ${MID[d][1]} L50 50`);
}

export function TileArt({ def }: { def: TileDef }) {
  const dirs = (k: string) => def.edges.map((e, i) => (e === k ? i : -1)).filter((i) => i >= 0);
  const towns = dirs('town'), roads = dirs('road'), rivers = dirs('river');
  const junction = JUNCTION.has(def.center);
  const townShapes = towns.length === 1
    ? [CORN[towns[0]].concat([[CORN[towns[0]][1][0] * 0.55 + 22.5, CORN[towns[0]][1][1] * 0.55 + 22.5], [CORN[towns[0]][0][0] * 0.55 + 22.5, CORN[towns[0]][0][1] * 0.55 + 22.5]])]
    : towns.map((t) => [[50, 50], ...CORN[t]]);
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <rect width="100" height="100" fill={C.meadow} />
      <rect x="4" y="4" width="92" height="92" fill="none" stroke={C.meadowDark} strokeWidth="2" opacity="0.5" />
      {townShapes.map((pts, i) => (
        <polygon key={i} points={pts.map((p) => p.join(',')).join(' ')} fill={C.town} stroke={C.roof} strokeWidth="3" strokeLinejoin="round" />
      ))}
      {towns.length > 0 && townShapes.map((pts, i) => {
        const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
        return <g key={`r${i}`}><rect x={cx - 7} y={cy - 5} width="9" height="8" fill={C.roof} /><rect x={cx + 3} y={cy - 2} width="7" height="7" fill={C.roof} opacity="0.85" /></g>;
      })}
      {paths(rivers, def.center === 'lake').map((d, i) => <path key={`w${i}`} d={d} stroke={C.river} strokeWidth="16" fill="none" strokeLinecap="round" />)}
      {paths(roads, junction).map((d, i) => (
        <g key={`r${i}`}>
          <path d={d} stroke={C.roadEdge} strokeWidth="13" fill="none" />
          <path d={d} stroke={C.road} strokeWidth="9" fill="none" />
        </g>
      ))}
      {def.center === 'monastery' && <g><rect x="34" y="38" width="32" height="22" fill={C.abbey} stroke="#9b3b2a" strokeWidth="3" /><circle cx="38" cy="34" r="7" fill={C.copper} /></g>}
      {def.center === 'castle' && <g><polygon points="30,70 50,30 70,70" fill={C.crag} /><rect x="40" y="34" width="20" height="18" fill="#f7f4ec" stroke="#4b6283" strokeWidth="3" /></g>}
      {def.center === 'shrine' && <g><rect x="44" y="40" width="12" height="16" fill="#f5f1e6" stroke="#9b3b2a" strokeWidth="2.5" /></g>}
      {def.center === 'maypole' && <g><circle cx="50" cy="50" r="5" fill="#fff" stroke={C.blue} strokeWidth="3" /></g>}
      {def.center === 'lake' && <ellipse cx="50" cy="48" rx="24" ry="20" fill={C.river} />}
      {(def.banner ?? 0) > 0 && <g><path d="M68 16 h16 v12 l-8 6 l-8 -6 z" fill={C.blue} stroke="#fff" strokeWidth="2.5" /></g>}
      {def.hopGarden && [0, 1, 2].map((i) => <circle key={i} cx={roads.length ? 80 : 30 + i * 20} cy={roads.length ? 25 + i * 25 : 72} r="5" fill={C.hops} stroke="#3f7a4a" strokeWidth="2" />)}
      {def.beerGarden && <g><rect x="16" y="62" width="18" height="6" fill={C.bench} /><circle cx="25" cy="58" r="7" fill="#fff" stroke={C.blue} strokeWidth="2.5" /></g>}
      {def.goods && <circle cx="22" cy="78" r="8" fill={GOOD_COLOR[def.goods]} stroke="#fff" strokeWidth="2.5" />}
    </svg>
  );
}

export function TileCard({ def, rot = 0, selected, onClick, label, small }: {
  def: TileDef; rot?: number; selected?: boolean; onClick?: () => void; label?: string; small?: boolean;
}) {
  const body = (
    <span className="tile-art" style={{ transform: `rotate(${rot * 90}deg)` }}>
      <TileArt def={def} />
    </span>
  );
  if (!onClick) return <span className={`tile-card${small ? ' small' : ''}`} title={label ?? def.name}>{body}</span>;
  return (
    <button type="button" className={`tile-card${small ? ' small' : ''}`} aria-pressed={selected} aria-label={label ?? def.name} onClick={onClick}>
      {body}
    </button>
  );
}

export const ACTION_INFO: Record<ActionKind, { name: string; icon: string; text: string }> = {
  skip: { name: 'Skip', icon: '⤼', text: 'The next player misses their turn.' },
  reverse: { name: 'Reverse', icon: '⇄', text: 'Turn order changes direction.' },
  drawTwo: { name: 'Draw Two', icon: '+2', text: 'The next player places two tiles and can’t claim.' },
  loseTurn: { name: 'Lose a Turn', icon: '⏸', text: 'Pick a player; they miss their next turn.' },
  sendHome: { name: 'Send Home', icon: '⌂', text: 'Send an opponent’s Wanderer home, unscored.' },
  steal: { name: 'Steal', icon: '✋', text: 'Take an action tile from another player.' },
};

export function ActionCard({ kind, selected, onClick, hidden }: { kind: ActionKind; selected?: boolean; onClick?: () => void; hidden?: boolean }) {
  const a = ACTION_INFO[kind];
  return (
    <button type="button" className={`action-card${hidden ? ' hidden' : ''}`} aria-pressed={selected} onClick={onClick} disabled={!onClick} title={a.text}>
      <b>{hidden ? '?' : a.icon}</b>
      <span>{hidden ? 'Action' : a.name}</span>
    </button>
  );
}
