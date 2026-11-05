# Glockenfels rules spec (v1)

This is the paper version of the rules. In Phase 2 every number and table here becomes a data file that the rules engine reads, so any of it can be changed in a custom game.

## Setup

- 2 to 8 players. Each player takes 7 Wanderers in their colour.
- Place Burg Glockenfels (the start tile) in the middle of the table.
- Shuffle the remaining tiles face down.
- Turn order goes clockwise, starting with the host.

## A turn

1. **Draw** a tile.
2. **Place** it next to at least one tile, so every touching edge matches (road to road, town to town, meadow to meadow, river to river). If it fits nowhere, discard it and draw again.
3. **Claim (optional):** put one Wanderer on a feature of the tile you just placed: a road, a town, the monastery or (with the meadow rule) a meadow. You can't claim a feature that already has a Wanderer anywhere along it.
4. **Score** every feature that the tile completed. Wanderers on scored features go back to their owners.

## Features and scoring

| Feature | Complete when | Score when complete | Score at game end if incomplete |
| --- | --- | --- | --- |
| Road | Both ends reach a junction, town, monastery, castle or loop | 1 per tile | 1 per tile |
| Town | Fully enclosed by walls | 2 per tile, +2 per banner | 1 per tile, +1 per banner |
| Monastery | It and all 8 surrounding spaces are filled | 9 | 1 per filled space in the 3 × 3 |
| Meadow (optional rule) | Never; scored only at game end | – | 3 per completed town it touches |

**Majority:** the player with the most Wanderers on a feature scores it. Tied players all score the full amount. Other players score nothing.

**Game end:** when the last tile is placed, score every incomplete feature, then meadows if that rule is on. Highest score wins; ties share the win.

## Base set: 64 tiles

| Tile | Edges (N, E, S, W) | Centre | Count |
| --- | --- | --- | --- |
| Burg Glockenfels (start) | meadow, road, meadow, road | castle | 1 |
| Forest meadow | meadow ×4 | – | 3 |
| Monastery | meadow ×4 | monastery | 4 |
| Monastery with lane | meadow, meadow, road, meadow | monastery | 2 |
| Road | road, meadow, road, meadow | – | 8 |
| Road bend | meadow, meadow, road, road | – | 9 |
| Junction | meadow, road, road, road | shrine | 4 |
| Crossroads | road ×4 | shrine | 1 |
| Town edge | town, meadow, meadow, meadow | – | 5 |
| Town edge with road | town, road, meadow, road | – | 4 |
| Town edge with bend | town, meadow, road, road | – | 3 |
| Town corner | town, meadow, meadow, town | – | 3 |
| Town corner with banner | town, meadow, meadow, town | banner | 2 |
| Town corner with road | town, road, road, town | – | 3 |
| Town street | meadow, town, meadow, town | – | 3 |
| Town street with banner | meadow, town, meadow, town | banner | 1 |
| Town square | town, town, meadow, town | – | 3 |
| Town square with banner | town, town, meadow, town | banner | 1 |
| Town gate | town, town, road, town | – | 2 |
| Town gate with banner | town, town, road, town | banner | 1 |
| Town centre with maypole | town ×4 | maypole, banner | 1 |

Tiles can be rotated in quarter turns. Every count is a custom-game setting.

## Add-on modules

Modules are optional and can be combined. Each one lists what it adds and what it conflicts with.

| Module | Adds | Rules | Conflicts |
| --- | --- | --- | --- |
| Riverlands | 10 river tiles (lake, straights, bends, a bridge) | Lay the whole river first, starting from the lake, before the base tiles are shuffled in. A river can't turn back on itself. | – |
| Hop Gardens | 6 meadow tiles with hop gardens | A completed monastery scores +1 for each hop garden tile in its 3 × 3. | – |
| Beer Gardens | 6 town tiles with a beer garden | A completed town with a beer garden scores +1 per tile. An incomplete one scores 0 at game end. | – |
| Grand Wanderer | 1 large Wanderer per player | Counts as two Wanderers for majority. | – |
| Market Day | Goods on 12 town tiles: pretzels, hops, timber | Whoever places the tile that completes a town takes its goods. Most of each good at game end scores +10. | – |
| Action tiles | 14 action tiles (below) | See "Action tiles". | Peaceful Valley rule |

## Secret rule draft

Before the game, every player secretly picks one rule from the pool below. The picks are revealed together.

1. The engine checks each pair of picks against the conflict list. If two picks conflict, the host chooses which one stays, and the other player picks again.
2. The engine then plays a few quick bot games with the surviving rules in the background. If any game gets stuck, the host is asked to drop one rule, and that player picks again.
3. The game starts with all surviving rules shown on a rule card.

| Rule | Effect | Conflicts with |
| --- | --- | --- |
| Big Towns | Completed towns score 3 per tile | Town Tax |
| Town Tax | Completed towns score 1 per tile | Big Towns |
| Long Roads | Roads of 5 or more tiles score double | – |
| Toll Roads | Roads score 2 per tile, but 0 if incomplete at game end | – |
| Pilgrims | Completed monasteries score 12 | – |
| Crowded Valley | 5 Wanderers per player | Big Crew |
| Big Crew | 9 Wanderers per player | Crowded Valley |
| Open Market | Three tiles lie face up; take one of them or draw blind | Double Draw |
| Double Draw | Draw two tiles, place one, put the other on the bottom | Open Market |
| Homebodies | Wanderers stay on scored features instead of returning | – |
| Quick Game | Only 40 tiles in the deck | Marathon |
| Marathon | The deck is doubled | Quick Game |
| First to 100 | The game ends as soon as someone reaches 100 points | – |
| Farmers | The meadow scoring rule is on | – |
| Proud Banners | Banners are worth 4 | – |
| Chaos | Action tiles appear twice as often | Peaceful Valley |
| Peaceful Valley | No action tiles | Chaos |
| Turnabout | Turn order reverses every 10 tiles | – |

## Action tiles

Action tiles are shuffled into the deck. When you draw one, put it in your hand (up to two; a third is discarded) and draw again. At the start of your turn you may play one action tile before drawing.

| Tile | Count | Effect |
| --- | --- | --- |
| Skip | 3 | The next player misses their turn |
| Reverse | 3 | Turn order changes direction |
| Draw Two | 2 | The next player must place two tiles in a row and can't claim with either |
| Lose a Turn | 2 | Pick any player; they miss their next turn |
| Send Home | 2 | Pick an opponent's Wanderer on the board; it returns to them without scoring |
| Steal | 2 | Take one action tile from another player's hand |

## Never stuck

The engine guarantees every game can finish:

- A tile that fits nowhere is discarded and replaced.
- No player can miss more than one turn in a row, and skips can't pass over every player.
- Every game has an end condition that always triggers (the deck runs out, even with Marathon).
- Rules that change counts have minimums: at least 1 Wanderer per player and at least 10 tiles in the deck.
- Thousands of automated bot games run for every module and rule combination in the test suite.
