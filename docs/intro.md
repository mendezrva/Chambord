# Title page and flyover

The game opens on a title page that plays an 18 second flyover of a hand-laid valley, then settles on an isometric overview behind the title. Code lives in `apps/client/src/intro/`.

| Time (s) | Shot | Caption |
| --- | --- | --- |
| 0 – 3.4 | Close on two Wanderers (blue and red) clinking steins at a barrel table outside the town gate | "Prost!" |
| 3.4 – 6.9 | Pull back down the lane, then turn east along the road out of town | "Lay a road out of town," |
| 6.9 – 10 | Over the fields to the stream below the bridge | "follow the river past the fields," |
| 10 – 13 | Follow the stream round the bend | "and a friend is always waiting." |
| 13 – 14.6 | A third Wanderer (yellow) waves with a stein in front of the monastery | |
| 14.6 – 18.2 | Rise to the isometric overview; title, then Play and Watch again appear | |

After the flyover the camera turns slowly around the valley.

- **Files:** `board.ts` (the 6 × 6 layout, built with the game's tile generator), `characters.ts` (Wanderers with a moving arm, steins, barrel table), `flyover.ts` (camera keyframes, centripetal Catmull-Rom paths and monotone timing), `Intro.tsx` (scene and overlay), `intro.css`.
- **Narrow screens:** close-ups stand further back on portrait phones so both Wanderers stay in frame; the overview distance follows the screen's aspect ratio.
- **Skip:** the Skip button (or Esc) jumps to the title. `?nointro` in the URL goes straight to the game builder. Reduced motion opens on the still title.
- **Type:** the title uses Fraunces through `--font-display`, the shared token from the interface restyle, with Fraunces bundled as a fallback.
- **Debug hook:** `window.__introSeek(seconds)` jumps the flyover, for screenshots.
