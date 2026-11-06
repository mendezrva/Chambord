import { describe, expect, it } from 'vitest';
import { buildConfig, PRESETS, upgradeConfig } from '../src/config';

describe('fields are on in every game', () => {
  it('turns fields on in the base game and every preset', () => {
    expect(buildConfig({ players: 2 }).scoring.meadow.enabled).toBe(true);
    for (const p of Object.values(PRESETS)) expect(buildConfig(p).scoring.meadow.enabled).toBe(true);
  });

  it('keeps fields on with any module', () => {
    for (const m of ['riverlands', 'hopGardens', 'beerGardens', 'grandWanderer', 'marketDay', 'actions']) {
      expect(buildConfig({ players: 3, modules: [m] }).scoring.meadow.enabled).toBe(true);
    }
  });

  it('upgrades a game saved before fields were standard', () => {
    const old = buildConfig({ players: 2 });
    old.scoring.meadow.enabled = false;
    expect(upgradeConfig(old).scoring.meadow.enabled).toBe(true);
  });

  it('respects Town Folk and a builder that set fields to Off', () => {
    const folk = buildConfig({ players: 2, rules: ['noFields'] });
    expect(upgradeConfig(folk).scoring.meadow.enabled).toBe(false);
    const off = buildConfig({ players: 2, customize: (c) => { c.scoring.meadow.perTown = 0; } });
    expect(upgradeConfig(off).scoring.meadow.enabled).toBe(false);
  });
});
