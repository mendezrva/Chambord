# Glockenfels

A low-poly 3D tile-laying game set in a made-up Bavarian valley, playable in the browser on iPhone, iPad and Mac.

- **Plan:** [Glockenfels build plan](https://claude.ai/artifact/CiHhFg8sfiXhsBrg1Nq112)
- **Style guide:** [docs/style-guide.md](docs/style-guide.md)
- **Rules spec:** [docs/rules-spec.md](docs/rules-spec.md)

## Status

Phase 1 (design and 3D style test) is done: `apps/client` holds the 3D prototype, a board of procedurally generated low-poly tiles with touch camera controls, three preset views, tile-drop animations, a town celebration, a graphics panel and a live frame-rate counter.

Phase 2 (rules engine) is built: `packages/engine` is a standalone TypeScript engine with no graphics. Every tile, module, scoring value and draft rule is data; a seed plus the action log replays any game; a bot plays complete games; and the test suite plays thousands of bot games across every module and rule mix to prove no game can get stuck.

Phase 3 (playable 3D game) is built: the client now runs a full pass-and-play game on the engine. A title screen with a custom game builder (players and bots, presets, modules, picked or secretly drafted rules, tile counts, scoring, pieces and end conditions) starts a game on the 3D board. Legal spots glow, the drawn tile hovers over the spot you tap and turns as you tap it, Wanderers hop onto the feature you pick, completed features bounce with score popups (and confetti for towns), and a pass-the-device screen hides action tiles between turns. Games save to the device after every move and resume after a reload. The Phase 1 style test is still there under "Graphics test" (or `?styletest`).

Phase 4 (online multiplayer) is built: `apps/server` is one small Node server that serves the game and runs online matches over a WebSocket, with SQLite for storage. Username-and-passcode accounts, friends with one-tap invites, rooms with a 5-letter code and a share link, the secret rule draft on everyone's own device, server-checked moves with hidden information stripped, bots and "let a bot play for them" when someone drops out, Elo ratings, match history with move-by-move replays, and a leaderboard. See [docs/online.md](docs/online.md) for how it works, how to play with a friend tonight and the hosting recommendation.

## How to play (pass and play)

1. Pick a quick-start preset or build your own game, then **Start game**.
2. **Your turn:** tap a glowing spot. The tile hovers there; tap it (or **Turn**) to rotate it through the ways it fits, then **Place**.
3. **Wanderer:** pick a feature of the new tile (Town, Road, Monastery, Meadow when Farmers is on) and tap **Wanderer**, or **No thanks**. **Undo** lifts the tile back up.
4. **Action tiles** (if on): at the start of your turn, play one or tap **Not now**.
5. Hand the device to the next player when the pass screen asks.

Touch: one finger pans, pinch zooms, two fingers rotate and tilt. Mouse: drag to rotate, right-drag to pan, scroll to zoom; R turns the tile, Enter places it.

## Play online

```sh
npm run online   # builds the game and starts the server at http://localhost:8787
```

Tap **Play online**, pick a username, host a game and share the link. To let a friend in from anywhere before it's hosted, run `cloudflared tunnel --url http://localhost:8787` in a second terminal and share the address it prints. Deploying to Fly.io: [docs/online.md](docs/online.md#hosting-recommendation).

## Run it

Requires Node 20 or later.

```sh
npm install
npm run dev      # opens a dev server; the --host flag lets your phone on the same Wi-Fi connect
npm run build    # production build in apps/client/dist
npm test         # engine tests (2,000+ simulated bot games, about 90 seconds) and server tests
npm run dev:server  # game server with reload; run next to `npm run dev`, which passes /ws through
npm run play -w packages/engine -- --preset party --players 4 --seed 7   # watch a bot game in the terminal
```

Presets: `classic`, `quick`, `bigTable`, `party`. Or mix your own: `--modules riverlands,actions --rules bigTowns,farmers`.

On your phone, open the "Network" address that `npm run dev` prints.

## Layout

| Folder | What's in it |
| --- | --- |
| `apps/client` | The browser game (React, Three.js via React Three Fiber) |
| `apps/client/src/tiles` | The low-poly tile generator, palette and tile catalog |
| `apps/client/src/board` | Random demo board for the graphics test |
| `apps/client/src/scene` | 3D scene: the live game board (tiles, Wanderers, spot markers, preview tile), camera, scenery, lights, confetti |
| `apps/client/src/game` | Glue between engine and 3D: tile specs, Wanderer spots, the saved session and undo |
| `apps/client/src/ui` | Game screen, builder, secret rule draft, tile cards |
| `apps/client/src/online`, `ui/Online.tsx` | Connection to the server; sign-in, home, friends, lobby, online draft, online game and replays |
| `apps/server` | Game server: accounts, friends, rooms, secret draft, server-side games and bots, Elo, history (SQLite) |
| `packages/protocol` | Message types shared by client and server |
| `packages/engine` | The rules engine: tiles, modules, scoring, turn flow, action tiles, rule draft, bot, CLI runner |
| `packages/engine/src/content` | Tile sets and decks as data (base set, Riverlands, Hop Gardens, Beer Gardens, Market Day, action tiles) |
| `docs` | Style guide and rules spec |


## How the engine works

- **Tiles** list four edges and a centre. `analyze()` turns that into local features: road segments, the town, the monastery and the meadow regions, each with the edges or half-edges where it meets a neighbour.
- **The board** is a map of placed tiles. A union-find graph merges features across edges as tiles are placed, tracking open ends, banners, goods and Wanderers per feature.
- **Turns** go action tile → draw → place → claim → score. `apply(state, action)` validates and applies one action; `legalActions(state)` lists what the current player may do.
- **Config** (`buildConfig`) starts from the base set and applies modules and draft rules, each a small function that edits the config and declares its conflicts. `normalize()` enforces the minimums that keep a game finishable.
- **Never stuck:** unplayable tiles are discarded, a skipped player can't be skipped again, every deck runs out, and `test/simulation.test.ts` plays thousands of random bot games to check it.
