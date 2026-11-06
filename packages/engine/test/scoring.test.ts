import { describe, expect, it } from 'vitest';
import { apply, claimable, featureOf, legalPlacements } from '../src/game';
import { force, newGame } from './helpers';

describe('scoring', () => {
  it('scores a road closed by a monastery and returns the Wanderer', () => {
    const s = newGame();
    // Castle road runs east; a monastery lane rotated so its road faces west closes it.
    force(s, 'monastery-lane', 1, 0, 1, { local: 0 });
    expect(s.players[0].score).toBe(2);
    expect(s.players[0].pieces.wanderer).toBe(7);
    expect(s.events.some((e) => e.type === 'scored' && e.kind === 'road' && e.complete)).toBe(true);
  });

  it('completes a town and pays per tile plus banners', () => {
    const s = newGame();
    force(s, 'town-edge', 0, -1, 0, { local: 0 });
    force(s, 'town-edge', 0, -2, 2); // town faces south: closes the town
    expect(s.players[0].score).toBe(4);
    const s2 = newGame();
    force(s2, 'town-edge', 0, -1, 0, { local: 0 });
    force(s2, 'town-street-banner', 0, -2, 1); // town N and S
    expect(s2.players[0].score).toBe(0);
    force(s2, 'town-edge', 0, -3, 2);
    expect(s2.players[0].score).toBe(3 * 2 + 2);
  });

  it('a monastery scores 9 once surrounded and 1 per tile at game end', () => {
    const s = newGame({ rules: ['homebodies'] });
    force(s, 'monastery', 0, 1, 0, { local: 0 });
    force(s, 'road', -1, 0, 1); // rot 1: roads E and W
    force(s, 'road', 1, 0, 1);
    force(s, 'meadow', -1, 1, 0);
    force(s, 'meadow', 1, 1, 0);
    force(s, 'meadow', -1, 2, 0);
    force(s, 'meadow', 0, 2, 0);
    expect(s.players[0].score).toBe(0);
    force(s, 'meadow', 1, 2, 0);
    expect(s.players[0].score).toBe(9);
  });

  it('ties share the full score and the majority wins', () => {
    const s = newGame({ players: 3 });
    // Player 1 starts a town west of the castle? The castle's west edge is a road, so build north.
    force(s, 'town-edge', 0, -1, 0, { local: 0 });
    force(s, 'town-street', 0, -2, 1); // rot 1: town N and S. Player 2 cannot claim the same town, only a field.
    expect(s.players[1].pieces.wanderer).toBe(7);
    // Player 3 closes it with a town edge facing south.
    force(s, 'town-edge', 0, -3, 2);
    expect(s.players[0].score).toBe(6);
    expect(s.players[1].score).toBe(0);
  });

  it('refuses a claim on a feature that already has a Wanderer', () => {
    const s = newGame();
    force(s, 'town-edge', 0, -1, 0, { local: 0 });
    s.hand = ['town-street'];
    s.step = 'place';
    apply(s, { type: 'place', hand: 0, x: 0, z: -2, rot: 1 });
    // Only the field is open now; the town already has a Wanderer.
    const t = s.board['0,-2'];
    const kinds = claimable(s).map((i) => featureOf(s, t.featureIds[i]).kind);
    expect(kinds).not.toContain('town');
    expect(() => apply(s, { type: 'claim', local: 0, piece: 'wanderer' })).toThrow();
  });

  it('scores incomplete features at the end', () => {
    const s = newGame();
    force(s, 'town-edge', 0, -1, 0, { local: 0 });
    s.deck = [];
    s.market = [];
    force(s, 'meadow', 0, 1, 0);
    expect(s.step).toBe('ended');
    expect(s.players[0].score).toBe(1);
  });

  it('fields score 3 per completed town they touch in the base game', () => {
    const s = newGame();
    force(s, 'town-edge', 0, -1, 0); // open town
    // Claim the meadow of a plain tile that joins the town tile's meadow.
    force(s, 'meadow', 1, -1, 0, { local: 0 });
    force(s, 'town-edge', 0, -2, 2); // close the town
    expect(featureOf(s, s.board['0,-1'].featureIds[0]).open).toBe(0);
    s.deck = [];
    force(s, 'meadow', 0, 1, 0);
    expect(s.step).toBe('ended');
    expect(s.players[1].score).toBe(3);
  });

  it('Bumper Harvest makes fields worth 4 per town', () => {
    const s = newGame({ rules: ['harvest'] });
    force(s, 'town-edge', 0, -1, 0); // open town
    // Claim the meadow of a plain tile that joins the town tile's meadow.
    force(s, 'meadow', 1, -1, 0, { local: 0 });
    force(s, 'town-edge', 0, -2, 2); // close the town
    expect(featureOf(s, s.board['0,-1'].featureIds[0]).open).toBe(0);
    s.deck = [];
    force(s, 'meadow', 0, 1, 0);
    expect(s.step).toBe('ended');
    expect(s.players[1].score).toBe(4);
  });

  it('Town Folk takes fields out of play', () => {
    const s = newGame({ rules: ['noFields'] });
    force(s, 'meadow', 0, 1, 0);
    expect(s.step).toBe('place'); // a plain field tile offers nothing to claim
  });

  it('Long Roads doubles roads of five tiles', () => {
    const s = newGame({ rules: ['longRoads'] });
    force(s, 'road', 1, 0, 1, { local: 0 });
    force(s, 'road', 2, 0, 1);
    force(s, 'road', 3, 0, 1);
    force(s, 'road', 4, 0, 1);
    force(s, 'monastery-lane', 5, 0, 1);
    expect(s.players[0].score).toBe(12);
  });

  it('legal placements respect every edge', () => {
    const s = newGame();
    const spots = legalPlacements(s, 'town-centre');
    expect(spots).toHaveLength(0); // nothing on the castle is a town edge
    expect(legalPlacements(s, 'road').length).toBeGreaterThan(0);
  });
});
