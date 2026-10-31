import { describe, expect, it } from 'vitest';
import { resolveMode } from './theme';

const at = (h: number) => new Date(2026, 9, 31, h, 0);

describe('resolveMode', () => {
  it('honours a fixed theme', () => {
    expect(resolveMode('daylight', at(23), null)).toBe('daylight');
    expect(resolveMode('dusk', at(12), null)).toBe('dusk');
  });

  it('auto uses 7 pm to 6 am without sun times', () => {
    expect(resolveMode('auto', at(12), null)).toBe('daylight');
    expect(resolveMode('auto', at(18), null)).toBe('daylight');
    expect(resolveMode('auto', at(19), null)).toBe('dusk');
    expect(resolveMode('auto', at(5), null)).toBe('dusk');
    expect(resolveMode('auto', at(6), null)).toBe('daylight');
  });

  it('auto follows the sun when the weather feature has published it', () => {
    const sun = { sunrise: at(7).toISOString(), sunset: at(17).toISOString() };
    expect(resolveMode('auto', at(6), sun)).toBe('dusk');
    expect(resolveMode('auto', at(7), sun)).toBe('daylight');
    expect(resolveMode('auto', at(16), sun)).toBe('daylight');
    expect(resolveMode('auto', at(17), sun)).toBe('dusk');
    expect(resolveMode('auto', at(18), sun)).toBe('dusk');
  });

  it('falls back to the clock on bad sun times', () => {
    expect(resolveMode('auto', at(12), { sunrise: 'nope', sunset: 'nah' })).toBe('daylight');
  });
});
