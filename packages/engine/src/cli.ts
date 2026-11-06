/**
 * Command-line runner: plays a bot game and prints the turns and the final scores.
 *
 *   npm run play -w packages/engine -- --preset party --players 4 --seed 7
 *   npm run play -w packages/engine -- --modules riverlands,actions --rules bigTowns,harvest --quiet
 */
import { buildConfig, PRESETS, type GameOptions } from './config';
import { botAction } from './bot';
import { apply, createGame, type GameEvent } from './game';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args.set(a.slice(2), process.argv[i + 1]?.startsWith('--') || process.argv[i + 1] === undefined ? 'true' : process.argv[++i]);
}
const list = (k: string) => (args.get(k) ? args.get(k)!.split(',').filter(Boolean) : undefined);

const preset = PRESETS[args.get('preset') ?? 'classic'];
if (!preset) { console.error(`Unknown preset. Options: ${Object.keys(PRESETS).join(', ')}`); process.exit(1); }
const options: GameOptions = {
  players: Number(args.get('players') ?? preset.players),
  modules: list('modules') ?? preset.modules,
  rules: list('rules') ?? preset.rules,
  customize: preset.customize,
};
const seed = Number(args.get('seed') ?? 1);
const quiet = args.get('quiet') === 'true';

const config = buildConfig(options);
const s = createGame(config, seed);
console.log(`Glockenfels: ${preset.name}, ${config.players} players, seed ${seed}`);
console.log(`Modules: ${config.modules.join(', ') || 'none'}. Rules: ${config.draftRules.join(', ') || 'none'}. Deck: ${s.deck.length} tiles.`);

const describe = (e: GameEvent) => {
  switch (e.type) {
    case 'placed': return `${name(e.player)} places ${s.config.tiles[s.board[e.tileKey].tileId].name} at ${e.tileKey}`;
    case 'claimed': return `${name(e.player)} claims a ${s.config.tiles[s.board[e.tileKey].tileId].name} feature with a ${e.piece}`;
    case 'scored': return `  ${e.players.map(name).join(' and ')} score${e.players.length > 1 ? '' : 's'} ${e.points} for a${e.complete ? ' complete' : 'n incomplete'} ${e.kind} of ${e.tiles.length}`;
    case 'action': return `${name(e.player)} plays ${e.action}${e.target !== undefined ? ` on ${name(e.target)}` : ''}`;
    case 'skipped': return `${name(e.player)} misses a turn`;
    case 'discarded': return `  (${s.config.tiles[e.tileId].name} fits nowhere, discarded)`;
    case 'goods': return `  ${name(e.player)} takes ${e.good}`;
    case 'returned': return `  ${name(e.piece.player)} gets a ${e.piece.type} back`;
    case 'ended': return `Game over. Winner${e.winners.length > 1 ? 's' : ''}: ${e.winners.map(name).join(', ')}`;
  }
};
const name = (i: number) => (i < 0 ? 'Setup' : s.players[i].name);

let actions = 0;
while (s.step !== 'ended') {
  apply(s, botAction(s, seed + actions++));
  if (!quiet) for (const e of s.events) if (e.type !== 'returned') console.log(describe(e));
}
console.log('');
for (const p of [...s.players].sort((a, b) => b.score - a.score)) console.log(`${p.name.padEnd(10)} ${String(p.score).padStart(4)}`);
console.log(`${Object.keys(s.board).length} tiles on the board, ${s.turn} turns, ${actions} actions.`);
