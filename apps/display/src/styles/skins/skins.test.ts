import {
  Skin,
  checkContrast,
  contrastRatio,
  deriveTokens,
  pickSkin,
  seasonalSkin,
  type Appearance,
} from '@mantel/shared';
import { describe, expect, it } from 'vitest';
import { builtInSkins, decorSvgs, defaultSkin } from './index';

describe('bundled skins', () => {
  it('has the twelve skins, each valid', () => {
    expect(builtInSkins.map((s) => s.id)).toEqual([
      'mantel',
      'slate',
      'paper',
      'midnight',
      'chalkboard',
      'poster',
      'harvest',
      'frost',
      'bloom',
      'shore',
      'harvest-night',
      'lights',
    ]);
    for (const s of builtInSkins) expect(Skin.safeParse(s).success).toBe(true);
  });

  it('keeps Mantel on the tokens.css defaults', () => {
    expect(defaultSkin.daylight.bg).toBe('#efeee9');
    expect(defaultSkin.dusk.accent).toBe('#e0a94a');
  });

  for (const skin of builtInSkins) {
    it(`${skin.name} passes the contrast check in both modes`, () => {
      expect(checkContrast(skin)).toEqual([]);
    });
  }

  it('references only decor files that exist', () => {
    for (const s of builtInSkins) {
      for (const name of [s.decor?.background, s.decor?.header, s.decor?.corners]) {
        if (name) expect(decorSvgs[name], `${s.id} decor ${name}`).toContain('<svg');
      }
    }
  });

  it('has twelve distinct person colours each', () => {
    for (const s of builtInSkins)
      expect(new Set(s.personPalette.map((p) => p.color)).size, s.id).toBe(12);
  });
});

describe('seasons', () => {
  const at = (m: number, d: number) => new Date(2026, m - 1, d, 12);
  it('picks the fall skin in October and Harvest Night in the last week', () => {
    expect(seasonalSkin(builtInSkins, at(10, 5))?.id).toBe('harvest');
    expect(seasonalSkin(builtInSkins, at(10, 31))?.id).toBe('harvest-night');
    expect(seasonalSkin(builtInSkins, at(11, 2))?.id).toBe('harvest');
  });
  it('wraps the year for Lights and Frost', () => {
    expect(seasonalSkin(builtInSkins, at(12, 20))?.id).toBe('lights');
    expect(seasonalSkin(builtInSkins, at(1, 3))?.id).toBe('lights');
    expect(seasonalSkin(builtInSkins, at(1, 20))?.id).toBe('frost');
    expect(seasonalSkin(builtInSkins, at(2, 28))?.id).toBe('frost');
  });
  it('covers spring and summer', () => {
    expect(seasonalSkin(builtInSkins, at(4, 1))?.id).toBe('bloom');
    expect(seasonalSkin(builtInSkins, at(7, 4))?.id).toBe('shore');
    expect(seasonalSkin(builtInSkins, at(9, 1))).toBeUndefined();
  });
  it('only follows the season when asked', () => {
    const base: Appearance = { skin: 'slate', textSize: 'default', followSeason: false };
    expect(pickSkin(base, builtInSkins, defaultSkin, at(10, 31)).id).toBe('slate');
    expect(
      pickSkin({ ...base, followSeason: true }, builtInSkins, defaultSkin, at(10, 31)).id,
    ).toBe('harvest-night');
    expect(pickSkin({ ...base, followSeason: true }, builtInSkins, defaultSkin, at(9, 1)).id).toBe(
      'slate',
    );
    expect(pickSkin({ ...base, skin: 'nope' }, builtInSkins, defaultSkin).id).toBe('mantel');
  });
});

describe('deriving a skin from eight colours', () => {
  it('fills the rest with usable values', () => {
    const t = deriveTokens({
      bg: '#f4f1ea',
      surface: '#ffffff',
      ink: '#202020',
      ink2: '#5a5a5a',
      accent: '#1d4ed8',
      accentInk: '#ffffff',
      warn: '#b45309',
      good: '#15803d',
    });
    expect(t.surface2).not.toBe(t.surface);
    expect(t.line.startsWith('rgba(')).toBe(true);
    expect(contrastRatio(t.ink, t.surface2)).toBeGreaterThan(4.5);
    expect(checkContrast({ daylight: t, dusk: t })).toEqual([]);
  });
});
