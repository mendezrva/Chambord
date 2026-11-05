import { describe, expect, it } from 'vitest';
import { buildConfig, findConflicts, PRESETS } from '../src/config';
import { apply, createGame, legalActions, replay } from '../src/game';
import { botAction } from '../src/bot';
import { playBotGame, resolveDraft } from '../src/draft';
import { force, newGame } from './helpers';

describe('config', () => {
  it('reports conflicting picks', () => {
    expect(findConflicts(['bigTowns', 'townTax'])).toHaveLength(1);
    expect(findConflicts(['actions', 'peacefulValley'])).toHaveLength(1);
    expect(findConflicts(['bigTowns', 'farmers'])).toHaveLength(0);
    expect(() => buildConfig({ players: 2, rules: ['quickGame', 'marathon'] })).toThrow();
  });

  it('applies deck limits and multipliers', () => {
    const count = (c: ReturnType<typeof buildConfig>) => c.deck.reduce((n, d) => n + d.count, 0);
    expect(count(buildConfig({ players: 2 }))).toBe(63);
    expect(count(buildConfig({ players: 2, rules: ['quickGame'] }))).toBeLessThanOrEqual(44);
    expect(count(buildConfig({ players: 2, rules: ['marathon'] }))).toBe(126);
    expect(count(buildConfig({ players: 2, modules: ['actions'], rules: ['chaos'] }))).toBe(63 + 28);
    expect(() => buildConfig({ players: 2, customize: (c) => { c.deck = c.deck.slice(0, 1); } })).toThrow();
    expect(() => buildConfig({ players: 9 })).toThrow();
  });

  it('enforces a minimum of one Wanderer', () => {
    const c = buildConfig({ players: 2, customize: (x) => { x.pieces.wanderer = -3; } });
    expect(c.pieces.wanderer).toBe(1);
  });

  it('presets build', () => {
    for (const p of Object.values(PRESETS)) expect(buildConfig(p).players).toBe(p.players);
  });
});

describe('game flow', () => {
  it('is deterministic and replays from the log', () => {
    const config = buildConfig(PRESETS.party);
    const a = playBotGame(config, 42);
    const b = playBotGame(config, 42);
    expect(b.players.map((p) => p.score)).toEqual(a.players.map((p) => p.score));
    const c = replay(config, 42, a.log);
    expect(c.players.map((p) => p.score)).toEqual(a.players.map((p) => p.score));
    expect(Object.keys(c.board).sort()).toEqual(Object.keys(a.board).sort());
  });

  it('always offers a legal action until the game ends', () => {
    const s = createGame(buildConfig({ players: 3, modules: ['actions', 'riverlands'] }), 5);
    let n = 0;
    while (s.step !== 'ended') {
      expect(legalActions(s).length).toBeGreaterThan(0);
      apply(s, botAction(s, n++));
    }
    expect(s.winners!.length).toBeGreaterThan(0);
  });

  it('rejects illegal moves without changing state', () => {
    const s = newGame();
    const before = JSON.stringify(s);
    expect(() => apply(s, { type: 'place', hand: 0, x: 9, z: 9, rot: 0 })).toThrow();
    expect(() => apply(s, { type: 'claim', local: 0, piece: 'wanderer' })).toThrow();
    expect(JSON.stringify({ ...s, events: [] })).toBe(JSON.stringify({ ...JSON.parse(before), events: [] }));
  });

  it('lays the river first, from the lake, without turning back', () => {
    const s = createGame(buildConfig({ players: 2, modules: ['riverlands'] }), 3);
    expect(s.hand).toEqual(['lake']);
    let n = 0;
    while (s.step !== 'ended' && n < 400) {
      apply(s, botAction(s, n++));
      if (s.step === 'place' && !s.config.tiles[s.hand[0]].edges.includes('river')) break;
    }
    const riverTiles = Object.values(s.board).filter((t) => s.config.tiles[t.tileId].edges.includes('river'));
    expect(riverTiles.length + s.discard.length).toBe(10);
    expect(riverTiles.length).toBeGreaterThanOrEqual(6);
  });

  it('Skip and Lose a Turn never skip the same player twice in a row', () => {
    const s = newGame({ players: 2, modules: ['actions'] });
    s.players[0].actions = ['skip', 'skip'];
    s.step = 'action';
    apply(s, { type: 'playAction', action: 'skip' });
    expect(s.players[1].skip).toBe(true);
    // Finish player 1's turn.
    force(s, 'meadow', 0, -1, 0);
    expect(s.current).toBe(0); // player 2 was skipped
    expect(s.players[1].justSkipped).toBe(true);
    expect(s.step).toBe('action');
    apply(s, { type: 'playAction', action: 'skip' });
    expect(s.players[1].skip).toBe(false); // fizzled
    force(s, 'meadow', 0, 1, 0);
    expect(s.current).toBe(1);
  });

  it('Reverse flips the order and Draw Two forces two placements without claims', () => {
    const s = newGame({ players: 3, modules: ['actions'] });
    s.players[0].actions = ['reverse', 'drawTwo'];
    s.step = 'action';
    apply(s, { type: 'playAction', action: 'reverse' });
    expect(s.direction).toBe(-1);
    force(s, 'meadow', 0, -1, 0);
    expect(s.current).toBe(2);
    s.players[2].actions = ['drawTwo'];
    s.step = 'action';
    apply(s, { type: 'playAction', action: 'drawTwo' });
    expect(s.players[1].drawTwo).toBe(true);
    force(s, 'meadow', 0, 1, 0);
    expect(s.current).toBe(1);
    expect(s.mustPlace).toBe(2);
    force(s, 'town-edge', 1, -1, 0);
    expect(s.current).toBe(1);
    expect(s.step).toBe('place');
    force(s, 'meadow', -1, 1, 0);
    expect(s.current).toBe(0);
  });

  it('Send Home returns an opponent Wanderer and Steal takes a tile', () => {
    const s = newGame({ players: 2, modules: ['actions'] });
    force(s, 'town-edge', 0, -1, 0, { local: 0 });
    expect(s.players[0].pieces.wanderer).toBe(6);
    s.players[1].actions = ['sendHome', 'steal'];
    s.players[0].actions = ['skip'];
    s.step = 'action';
    apply(s, { type: 'playAction', action: 'sendHome', piece: { tileKey: '0,-1', local: 0 } });
    expect(s.players[0].pieces.wanderer).toBe(7);
    force(s, 'meadow', 0, 1, 0);
    s.step = 'action';
    s.current = 1;
    apply(s, { type: 'playAction', action: 'steal', target: 0 });
    expect(s.players[0].actions).not.toContain('skip');
    expect(s.players[1].actions).toContain('skip');
  });

  it('Open Market lets a player take a face-up tile', () => {
    const s = createGame(buildConfig({ players: 2, rules: ['openMarket'] }), 8);
    expect(s.step).toBe('draw');
    expect(s.market).toHaveLength(3);
    const choice = legalActions(s).find((a) => a.type === 'draw' && a.market !== undefined);
    expect(choice).toBeDefined();
    apply(s, choice!);
    expect(s.step).toBe('place');
    expect(s.hand).toHaveLength(1);
  });

  it('First to 100 ends the game early', () => {
    const s = newGame({ players: 2, rules: ['firstTo100'] });
    s.players[0].score = 99;
    force(s, 'monastery-lane', 1, 0, 1, { local: 0 });
    expect(s.step).toBe('ended');
    expect(s.winners).toEqual([0]);
  });

  it('Market Day gives goods to whoever completes the town and pays the most at the end', () => {
    const s = newGame({ players: 2, modules: ['marketDay'] });
    force(s, 'market-pretzels', 0, -1, 0, { local: 0 });
    force(s, 'town-edge', 0, -2, 2); // player 2 closes it
    expect(s.players[1].goods.pretzels).toBe(1);
    s.deck = [];
    force(s, 'meadow', 0, 1, 0);
    expect(s.step).toBe('ended');
    expect(s.players[1].score).toBe(10);
    expect(s.players[0].score).toBe(4);
  });
});

describe('rule draft', () => {
  it('sends conflicts to the host and otherwise proves the mix playable', () => {
    const r = resolveDraft({ players: 3 }, ['bigTowns', 'townTax', 'farmers']);
    expect(r.conflicts).toHaveLength(1);
    expect(r.config).toBeNull();
    const ok = resolveDraft({ players: 3, modules: ['actions'] }, ['bigTowns', 'chaos', 'turnabout'], 2);
    expect(ok.conflicts).toHaveLength(0);
    expect(ok.stuck).toHaveLength(0);
    expect(ok.config?.scoring.town.perTile).toBe(3);
  });
});
