import { describe, expect, it } from 'vitest';
import { analyze, oppositeSlot, rotateEdges } from '../src/tiles';
import { ALL_TILES } from '../src/content/base';

const def = (id: string) => ALL_TILES.find((t) => t.id === id)!;
const kinds = (id: string, rot = 0) => analyze(def(id), rot).features.map((f) => f.kind);

describe('tile analysis', () => {
  it('rotates edges clockwise', () => {
    expect(rotateEdges(['town', 'road', 'meadow', 'river'], 1)).toEqual(['river', 'town', 'road', 'meadow']);
    expect(rotateEdges(['town', 'road', 'meadow', 'river'], -1)).toEqual(['road', 'meadow', 'river', 'town']);
  });

  it('a straight road is one segment with two meadows', () => {
    const a = analyze(def('road'), 0);
    expect(kinds('road')).toEqual(['road', 'meadow', 'meadow']);
    expect(a.features[0].edges).toEqual([0, 2]);
    expect(a.features[1].slots).toEqual([1, 2, 3, 4]);
    expect(a.features[2].slots).toEqual([5, 6, 7, 0]);
  });

  it('a junction splits roads and meadows at the shrine', () => {
    expect(kinds('junction')).toEqual(['road', 'road', 'road', 'meadow', 'meadow', 'meadow']);
    expect(kinds('crossroads').filter((k) => k === 'road')).toHaveLength(4);
  });

  it('castle roads stop at the castle', () => {
    const a = analyze(def('castle'), 0);
    expect(a.features.filter((f) => f.kind === 'road')).toHaveLength(2);
    expect(a.features.filter((f) => f.kind === 'meadow')).toHaveLength(2);
  });

  it('a monastery lane ends at the monastery and does not split the meadow', () => {
    const a = analyze(def('monastery-lane'), 0);
    expect(a.features.map((f) => f.kind)).toEqual(['road', 'monastery', 'meadow']);
    expect(a.features[0].edges).toEqual([2]);
    expect(a.features[2].slots).toHaveLength(8);
  });

  it('towns take every town edge and meadows know they touch them', () => {
    const a = analyze(def('town-corner-road'), 0); // town N and W, road E and S
    const town = a.features.find((f) => f.kind === 'town')!;
    expect(town.edges.sort()).toEqual([0, 3]);
    const meadows = a.features.filter((f) => f.kind === 'meadow');
    expect(meadows).toHaveLength(2);
    expect(meadows.some((m) => m.touchesTowns.length === 1)).toBe(true);
    expect(meadows.some((m) => m.touchesTowns.length === 0)).toBe(true);
  });

  it('a town centre has no meadow', () => {
    expect(kinds('town-centre')).toEqual(['town']);
    expect(analyze(def('town-centre'), 0).features[0].banner).toBe(1);
  });

  it('a bridge carries the road over the river and makes four meadows', () => {
    const a = analyze(def('river-bridge'), 0);
    expect(a.features.filter((f) => f.kind === 'road')).toHaveLength(1);
    expect(a.features.filter((f) => f.kind === 'meadow')).toHaveLength(4);
  });

  it('slots face each other across an edge', () => {
    expect(oppositeSlot(0)).toBe(5);
    expect(oppositeSlot(1)).toBe(4);
    expect(oppositeSlot(2)).toBe(7);
    expect(oppositeSlot(7)).toBe(2);
    for (let s = 0; s < 8; s++) expect(oppositeSlot(oppositeSlot(s))).toBe(s);
  });

  it('every tile id is unique', () => {
    expect(new Set(ALL_TILES.map((t) => t.id)).size).toBe(ALL_TILES.length);
  });
});
