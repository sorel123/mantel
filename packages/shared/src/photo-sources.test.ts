import { describe, expect, it } from 'vitest';
import { captionText, PhotoSettings } from './photo-sources.js';
import { Settings } from './models.js';
import { settings } from './fixtures/settings.js';

describe('photo captions', () => {
  it('reads album, place and month', () => {
    expect(
      captionText({
        source: 'Immich',
        album: 'Lake',
        place: 'Traverse City, Michigan',
        takenAt: '2019-07-04T18:22',
      }),
    ).toBe('Lake · Traverse City, Michigan · July 2019');
  });
  it('leads On this day photos with how long ago', () => {
    expect(captionText({ source: 'iCloud', takenAt: '2025-07-04', yearsAgo: 1 })).toBe(
      'A year ago today',
    );
    expect(captionText({ source: 'iCloud', album: 'Camping', yearsAgo: 3 })).toBe(
      '3 years ago today · Camping',
    );
  });
  it('is empty when nothing is known', () => {
    expect(captionText({ source: 'Photo folder' })).toBe('');
  });
});

describe('photo settings', () => {
  it('default for settings saved before v4', () => {
    const { photos: _p, ...old } = settings();
    expect(Settings.parse(old).photos).toEqual({ captions: true, onThisDay: true, weights: {} });
    expect(PhotoSettings.parse({ weights: { immich: 'more' } }).weights.immich).toBe('more');
  });
});
