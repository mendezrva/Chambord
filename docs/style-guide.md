# Glockenfels style guide

Glockenfels is a low-poly diorama of a made-up Bavarian valley. Every model is generated in code from simple shapes, so this guide doubles as the rulebook for the generator in `apps/client/src/tiles/`.

Reference images live in the project's reference folder (three low-poly diorama scenes Mark picked on 2026-11-05).

## The look in one sentence

Chunky slabs of land with faceted, flat-shaded tops, warm sun, soft shadows and a slight tilt-shift blur, so the board reads as a toy world on a table.

## Tiles

| Property | Value | Why |
| --- | --- | --- |
| Size | 2 × 2 world units, square | Square tiles were chosen over hex |
| Slab depth | 0.72 units of soil, plus a 0.1 grass rim | The cut-away earth is the signature of the references |
| Gap between tiles | 0.035 units | Tiles read as separate pieces but the land still looks continuous |
| Top surface | 12 × 12 grid, interior points jittered up to 0.11 high and 0.05 sideways | Gives the faceted meadow; edges stay flat so neighbours line up |
| Shards | Rocks, crags, tree canopies, bushes and mountains start as icosahedrons or cones whose welded vertices are pushed out of shape (`tiles/shards.ts`) | The crystalline, many-faceted look of the references |
| Underside | Soil sides with rock shards breaking out, and hanging rock cones below | Each tile reads as a chunk torn out of a hillside |
| Shading | Flat shading, each triangle tinted ±5–16% from its base colour (more on natural surfaces, less on buildings) | The low-poly sparkle without textures |
| Draw calls | One merged mesh per tile | Keeps 200+ tiles fast on phones |

Features are always drawn from a tile's edges (road, town, meadow, river) and its centre feature, never hand-placed. The same tile seed always produces the same tile.

## The world

- **Meadows:** bright green with pines (three stacked six-sided cones), round leafy trees (a single icosahedron) and pale rocks.
- **Roads:** pale sand lanes with a darker border. Two road ends curve through the centre; three or four meet at a wayside shrine.
- **Rivers:** teal water on a sandy bank. They start at a mountain lake and fall off the board edge as a waterfall.
- **Towns:** cobbled plazas with low white stone walls and round corner towers. Houses are whitewashed or pastel with dark half-timber belts and posts, steep red, brown or slate roofs, and the odd chimney. Big towns get a blue-and-white maypole; banner towns fly a blue-and-white pennant.
- **Monasteries:** white church with an onion-domed bell tower in copper green with a gold tip, a cloister yard, hop poles and monks in brown habits.
- **Burg Glockenfels (start tile):** white castle with slender slate-roofed towers on a rocky crag, flying a blue flag.
- **Horizon:** a ring of faceted grey-blue Alpine peaks with snow caps, softened by fog. Low-poly clouds drift overhead.

## Palette

All colours live in `apps/client/src/tiles/palette.ts`. Key values:

| Name | Hex | Used for |
| --- | --- | --- |
| Meadow | `#6aa84f` | Grass tops |
| Soil | `#7a5236` | Slab sides |
| Water | `#3fa7bd` | Rivers and lakes |
| Road | `#e0cfa4` | Lanes |
| Whitewash | `#f5f1e6` | Houses, abbeys |
| Roof red | `#c0472f` | Most roofs |
| Slate | `#4b6283` | Castle and some roofs |
| Bavarian blue | `#2f74c0` | Flags, maypole, first player |
| Copper | `#4e9e82` | Onion domes |
| Sky | `#dde9f3` | Background and fog |

Player colours (in order): blue `#2f74c0`, red `#d9482b`, yellow `#f2b630`, green `#2e9b6b`, purple `#8a52c4`, black `#222831`, white `#f2f2f2`, pink `#e27fb0`. They differ in lightness as well as hue so they stay readable for colour-blind players.

## Bavarian towns and villages

Towns should read as Franconian old towns at a glance (Rothenburg, Bamberg, Nuremberg, Meissen are the references).

| Element | Rule |
|---|---|
| Houses | Tall, narrow, steep gable faces the street. 2-3 jettied storeys, each overhanging the one below. Half-timbering in plain, X and K patterns over ochre, yellow, white or rose plaster. Green, blue or red shutters, geranium boxes, chimney. Some have a sandstone ground floor. |
| Roofs | Steep red-orange tile, built as two faceted slabs. |
| Walls | Stone walls with tiled caps, a round wall tower at each wall end. |
| Gate towers | Where a road enters a town: arched gate, clock face, pyramid, onion or helmet roof, sometimes a stork nest. |
| Squares | Fountain in big towns, maypole where there is one, beer garden with blue-and-white umbrellas, flower barrels. |
| River | The bridge tile carries a Bamberg-style town hall on a sandstone island with a baroque tower. |
| Countryside | Meadows can hold a farmstead with picket fence and barrel. Vineyard terraces below the castle. |

## Water, roads and fields

| Element | Rule |
|---|---|
| Water | Its own mesh with a glossy material (roughness 0.3) and a vertex-shader ripple, flat-shaded so the ripples facet. Three bands: sandy bank, pale shallows, deep teal. Widths wobble along the course. White foam flecks ride the current. |
| Banks | Small grey rocks and clumps of reeds along rivers and around lakes. Lakes are wobbly discs, not circles. |
| Roads | Dirt tracks: pale verge, packed-earth centre, two darker wheel ruts. Stones scatter on the verges, some country roads get a split-rail fence on one side, some a puddle. |
| Meadows | Base green plus 3-5 irregular patches of hay, deep green, lush and scrub tones, coloured per facet. Wildflower clusters (white, yellow, red, purple) and grass tufts fill the gaps. |
| Fields | Open meadows may carry a ploughed field (bare earth, dark furrows, sprouting rows) or a hedgerow of bushes. Farmsteads always have a strip field. |

## Player pieces

Wanderers: a rounded body in the player's colour, a skin-tone head, and a dark green felt hat with a white feather. About 0.4 units tall, so they read at a glance next to houses.

## Light and camera

- Hemisphere sky light plus one warm, low directional sun with soft shadows.
- Ambient occlusion in creases (desktop by default; phones turn it on only if there is headroom).
- Tilt-shift blur at the top and bottom of the screen.
- Three preset views: overhead, isometric and close-up. Moves between them glide over about a third of a second.

## Motion

| Moment | Timing | Feel |
| --- | --- | --- |
| Tile drop | 0.55 s fall from 5 units, accelerating | Weighty |
| Settle | 0.35 s squash (–22% height) and small rebound | Toy-like bounce |
| Wanderer arrives | Hops in 0.25 s after the tile lands | Playful |
| Town completed | Tile bounces three times, blue-and-white confetti, "+points" pops up | Celebration |

Respect "reduce motion" settings: keep the moves but drop the bounces and confetti.

## Interface

- Frosted-glass panels floating over the board, never a solid frame around it.
- Every tap target is at least 44 px tall.
- Controls sit at the bottom within thumb reach; status sits at the top.
- Safe-area insets are respected on iPhone.

## Performance budget

| Device | Target |
| --- | --- |
| iPhone 13 (oldest supported phone) | 60 fps with 200 tiles, shadows and tilt-shift on |
| M1 MacBook Air (oldest supported Mac) | 60 fps with 200 tiles, all effects on |

When the frame rate drops, the game turns effects off in this order: ambient occlusion, resolution to 1.5×, tilt-shift, resolution to 1×.
