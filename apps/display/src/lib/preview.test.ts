import { DEFAULT_APPEARANCE, layoutFromSearch } from '@mantel/shared';
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
      fit: 'scale',
      scale: 1.1,
    });
    expect(new URLSearchParams(search).get('screen')).toBe('month');
  });

  it('ignores a malformed look', () => {
    expect(appearanceFromSearch('?look=not-json')).toBeNull();
    expect(appearanceFromSearch('?preview=1')).toBeNull();
  });
});
