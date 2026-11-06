# Glockenfels

A low-poly 3D tile-laying game set in a made-up Bavarian valley, playable in the browser on iPhone, iPad and Mac.

- **Plan:** [Glockenfels build plan](https://claude.ai/artifact/CiHhFg8sfiXhsBrg1Nq112)
- **Style guide:** [docs/style-guide.md](docs/style-guide.md)
- **Rules spec:** [docs/rules-spec.md](docs/rules-spec.md)

## Status

Phase 1 (design and 3D style test) is in progress. `apps/client` holds the 3D prototype: a board of procedurally generated low-poly tiles with touch camera controls, three preset views, tile-drop animations, a town celebration, a graphics panel and a live frame-rate counter.

## Run it

Requires Node 20 or later.

```sh
npm install
npm run dev      # opens a dev server; the --host flag lets your phone on the same Wi-Fi connect
npm run build    # production build in apps/client/dist
```

On your phone, open the "Network" address that `npm run dev` prints.

## Layout

| Folder | What's in it |
| --- | --- |
| `apps/client` | The browser game (React, Three.js via React Three Fiber) |
| `apps/client/src/tiles` | The low-poly tile generator, palette and tile catalog |
| `apps/client/src/board` | Demo board layout (a stand-in for the Phase 2 rules engine) |
| `apps/client/src/scene` | 3D scene: board, scenery, lights, confetti |
| `docs` | Style guide and rules spec |

Planned for later phases: `packages/engine` (rules engine), `packages/content` (tiles and modules as data), `apps/server` (multiplayer).
