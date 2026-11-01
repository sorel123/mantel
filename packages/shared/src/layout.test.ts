import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, LayoutSettings, layoutFromSearch, resolveLayout } from './layout.js';

describe('LayoutSettings', () => {
  it('fills defaults for an old database', () => {
    expect(LayoutSettings.parse({})).toEqual(DEFAULT_LAYOUT);
    expect(LayoutSettings.parse({ fit: 'fill' })).toEqual({ ...DEFAULT_LAYOUT, fit: 'fill' });
  });
  it('bounds the scale', () => {
    expect(LayoutSettings.safeParse({ scale: 2.5 }).success).toBe(false);
    expect(LayoutSettings.safeParse({ scale: 0.9 }).success).toBe(true);
  });
});

describe('resolveLayout', () => {
  it('lays overrides over the household setting, later ones winning', () => {
    const base = { ...DEFAULT_LAYOUT, todayPreset: 'weather' as const };
    expect(resolveLayout(base, { fit: 'fill' }, { fit: 'scale', scale: 1.2 })).toEqual({
      todayPreset: 'weather',
      monthPreset: 'grid',
      monthDensity: 'roomy',
      todayRows: ['tonight', 'week'],
      fit: 'scale',
      scale: 1.2,
    });
  });
  it('reads the Month density, and drops one it does not know', () => {
    expect(resolveLayout(undefined, { monthDensity: 'compact' }).monthDensity).toBe('compact');
    expect(resolveLayout(undefined, { monthDensity: 'tiny' } as never).monthDensity).toBe('roomy');
    expect(layoutFromSearch('?density=compact')).toEqual({ monthDensity: 'compact' });
  });
  it('keeps the rows under the agenda, dropping unknown ones and repeats', () => {
    expect(
      resolveLayout(undefined, { todayRows: ['photo', 'nope', 'photo', 'week'] } as never)
        .todayRows,
    ).toEqual(['photo', 'week']);
    expect(layoutFromSearch('?rows=list,tonight')).toEqual({ todayRows: ['list', 'tonight'] });
  });
  it('ignores values it does not know and keeps the rest', () => {
    expect(
      resolveLayout(undefined, { todayPreset: 'nope', monthPreset: 'week', scale: 9 } as never),
    ).toEqual({ ...DEFAULT_LAYOUT, monthPreset: 'week' });
  });
});

describe('layoutFromSearch', () => {
  it('reads the display address', () => {
    expect(layoutFromSearch('?mode=dusk&today=poster&month=week&fit=scale&scale=120')).toEqual({
      todayPreset: 'poster',
      monthPreset: 'week',
      fit: 'scale',
      scale: 1.2,
    });
    expect(layoutFromSearch('?scale=1.1')).toEqual({ scale: 1.1 });
  });
  it('drops bad values', () => {
    expect(layoutFromSearch('?today=huge&fit=fill&scale=abc')).toEqual({ fit: 'fill' });
    expect(layoutFromSearch('')).toEqual({});
  });
});
