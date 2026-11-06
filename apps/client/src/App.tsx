import { useState } from 'react';
import { buildConfig, type GameConfig } from '@glockenfels/engine';
import StyleTest from './StyleTest';
import { loadSave, useGame, writeSave, type SavedGame } from './game/session';
import { GameScreen } from './ui/GameScreen';
import { Setup, optionsFor, type Builder } from './ui/Setup';
import { Draft } from './ui/Draft';
import { Online } from './ui/Online';

type Screen =
  | { kind: 'setup' }
  | { kind: 'draft'; builder: Builder }
  | { kind: 'game'; saved: SavedGame; n: number }
  | { kind: 'style' }
  | { kind: 'online'; join: string | null };

const newSeed = () => (Math.random() * 2 ** 31) >>> 0;

function newGame(b: Builder, config: GameConfig, drafted?: SavedGame['drafted']): SavedGame {
  const s: SavedGame = {
    v: 1, config, seed: newSeed(), log: [], drafted, startedAt: Date.now(),
    seats: b.seats.map((x, i) => ({ name: x.name.trim() || `Player ${i + 1}`, bot: x.bot })),
    handoff: b.handoff,
  };
  writeSave(s);
  return s;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>(() => {
    const q = new URLSearchParams(location.search);
    if (q.has('styletest')) return { kind: 'style' };
    if (q.has('join') || q.has('online')) return { kind: 'online', join: q.get('join')?.toUpperCase() ?? null };
    return { kind: 'setup' };
  });
  const [save, setSave] = useState(loadSave);

  if (screen.kind === 'online') return <Online joinCode={screen.join} onBack={() => setScreen({ kind: 'setup' })} />;

  if (screen.kind === 'style') return <StyleTest onBack={() => setScreen({ kind: 'setup' })} />;

  if (screen.kind === 'draft') {
    const b = screen.builder;
    return (
      <Draft
        seats={b.seats}
        base={optionsFor(b, false)}
        onCancel={() => setScreen({ kind: 'setup' })}
        onDone={(config, drafted) => setScreen({ kind: 'game', saved: newGame(b, config, drafted), n: Date.now() })}
      />
    );
  }

  if (screen.kind === 'game') {
    const saved = screen.saved;
    return (
      <LocalGame
        key={screen.n}
        saved={saved}
        onQuit={() => { setSave(loadSave()); setScreen({ kind: 'setup' }); }}
        onRematch={() => {
          const s: SavedGame = { ...saved, seed: newSeed(), log: [], startedAt: Date.now() };
          writeSave(s);
          setScreen({ kind: 'game', saved: s, n: Date.now() });
        }}
      />
    );
  }

  return (
    <Setup
      canResume={!!save}
      onResume={() => { const s = loadSave(); if (s) setScreen({ kind: 'game', saved: s, n: Date.now() }); }}
      onStyleTest={() => setScreen({ kind: 'style' })}
      onOnline={() => setScreen({ kind: 'online', join: null })}
      onStart={(b, config) => {
        if (b.ruleMode === 'draft') { setScreen({ kind: 'draft', builder: b }); return; }
        const cfg = config ?? buildConfig(optionsFor(b));
        setScreen({ kind: 'game', saved: newGame(b, cfg), n: Date.now() });
      }}
    />
  );
}

function LocalGame({ saved, onQuit, onRematch }: { saved: SavedGame; onQuit: () => void; onRematch: () => void }) {
  const game = useGame(saved);
  return <GameScreen game={game} onQuit={onQuit} onRematch={onRematch} />;
}
