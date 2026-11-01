import { DEFAULT_APPEARANCE, DEFAULT_TODAY_CARDS, layoutFromSearch } from '@mantel/shared';
import { describe, expect, it } from 'vitest';
import { appearanceFromSearch, isPreview, previewUrl } from './preview';

describe('preview on the wall', () => {
  it('round-trips the appearance draft and the layout through the address', () => {
    const appearance = {
      ...DEFAULT_APPEARANCE,
      skin: 'poster',
      accent: '#b82f66',
      displayFont: 'caveat' as const,
      textSize: 'large' as const,
    };
    const url = previewUrl({
      appearance,
      layout: {
        todayPreset: 'family',
        monthPreset: 'week',
        monthDensity: 'compact',
        todayRows: ['photo', 'week'],
        todayCards: DEFAULT_TODAY_CARDS,
        fit: 'scale',
        scale: 1.1,
      },
      screen: 'month',
      mode: 'dusk',
    });
    const search = url.slice(1);
    expect(isPreview(search)).toBe(true);
    expect(appearanceFromSearch(search)).toEqual(appearance);
    expect(layoutFromSearch(search)).toMatchObject({
      todayPreset: 'family',
      monthPreset: 'week',
      monthDensity: 'compact',
      todayRows: ['photo', 'week'],
      fit: 'scale',
      scale: 1.1,
    });
    expect(new URLSearchParams(search).get('screen')).toBe('month');
  });

  it("carries the Custom layout's cards", () => {
    const cards = [{ id: 'photo', kind: 'photo' as const, x: 0, y: 0, w: 6, h: 8 }];
    const url = previewUrl({
      layout: {
        todayPreset: 'custom',
        monthPreset: 'grid',
        monthDensity: 'roomy',
        todayRows: [],
        todayCards: cards,
        fit: 'fit',
        scale: 1,
      },
    });
    expect(layoutFromSearch(url.slice(1)).todayCards).toMatchObject([
      { kind: 'photo', x: 0, y: 0, w: 6, h: 8 },
    ]);
  });

  it('ignores a malformed look', () => {
    expect(appearanceFromSearch('?look=not-json')).toBeNull();
    expect(appearanceFromSearch('?preview=1')).toBeNull();
  });
});
