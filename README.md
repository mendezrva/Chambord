# Glockenfels

A low-poly 3D tile-laying game set in a made-up Bavarian valley, playable in the browser on iPhone, iPad and Mac.

- **Plan:** [Glockenfels build plan](https://claude.ai/artifact/CiHhFg8sfiXhsBrg1Nq112)
- **Style guide:** [docs/style-guide.md](docs/style-guide.md)
- **Rules spec:** [docs/rules-spec.md](docs/rules-spec.md)

## Status

Phase 1 (design and 3D style test) is done: `apps/client` holds the 3D prototype, a board of procedurally generated low-poly tiles with touch camera controls, three preset views, tile-drop animations, a town celebration, a graphics panel and a live frame-rate counter.

Phase 2 (rules engine) is built: `packages/engine` is a standalone TypeScript engine with no graphics. Every tile, module, scoring value and draft rule is data; a seed plus the action log replays any game; a bot plays complete games; and the test suite plays thousands of bot games across every module and rule mix to prove no game can get stuck.

## Run it

Requires Node 20 or later.

```sh
npm install
npm run dev      # opens a dev server; the --host flag lets your phone on the same Wi-Fi connect
npm run build    # production build in apps/client/dist
npm test         # engine tests, including 2,000+ simulated bot games (about 90 seconds)
npm run play -w packages/engine -- --preset party --players 4 --seed 7   # watch a bot game in the terminal
```

Presets: `classic`, `quick`, `bigTable`, `party`. Or mix your own: `--modules riverlands,actions --rules bigTowns,farmers`.

On your phone, open the "Network" address that `npm run dev` prints.

## Layout

| Folder | What's in it |
| --- | --- |
| `apps/client` | The browser game (React, Three.js via React Three Fiber) |
| `apps/client/src/tiles` | The low-poly tile generator, palette and tile catalog |
| `apps/client/src/board` | Demo board layout (a stand-in for the Phase 2 rules engine) |
| `apps/client/src/scene` | 3D scene: board, scenery, lights, confetti |
| `packages/engine` | The rules engine: tiles, modules, scoring, turn flow, action tiles, rule draft, bot, CLI runner |
| `packages/engine/src/content` | Tile sets and decks as data (base set, Riverlands, Hop Gardens, Beer Gardens, Market Day, action tiles) |
| `docs` | Style guide and rules spec |

Planned for later phases: wiring the engine into the 3D client (Phase 3) and `apps/server` for online multiplayer (Phase 4).

## How the engine works

- **Tiles** list four edges and a centre. `analyze()` turns that into local features: road segments, the town, the monastery and the meadow regions, each with the edges or half-edges where it meets a neighbour.
- **The board** is a map of placed tiles. A union-find graph merges features across edges as tiles are placed, tracking open ends, banners, goods and Wanderers per feature.
- **Turns** go action tile → draw → place → claim → score. `apply(state, action)` validates and applies one action; `legalActions(state)` lists what the current player may do.
- **Config** (`buildConfig`) starts from the base set and applies modules and draft rules, each a small function that edits the config and declares its conflicts. `normalize()` enforces the minimums that keep a game finishable.
- **Never stuck:** unplayable tiles are discarded, a skipped player can't be skipped again, every deck runs out, and `test/simulation.test.ts` plays thousands of random bot games to check it.
