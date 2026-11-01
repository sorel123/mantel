import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT,
  LayoutSettings,
  cardFits,
  cardsFromParam,
  cardsToParam,
  findSpot,
  layoutFromSearch,
  resolveLayout,
  tidyCards,
} from './layout.js';
import { DEFAULT_TODAY_CARDS, type TodayCard } from './models.js';

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
      todayCards: DEFAULT_TODAY_CARDS,
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

describe('Custom layout cards', () => {
  const card = (id: string, x: number, y: number, w: number, h: number): TodayCard => ({
    id,
    kind: 'photo',
    x,
    y,
    w,
    h,
  });

  it('drops a card that overlaps an earlier one and clamps sizes to the grid', () => {
    const out = tidyCards([card('a', 0, 0, 4, 4), card('b', 2, 2, 4, 4), card('c', 10, 6, 6, 6)]);
    expect(out.map((c) => c.id)).toEqual(['a', 'c']);
    expect(out[1]).toMatchObject({ w: 2, h: 2 });
  });

  it('finds the first free spot, or none', () => {
    expect(findSpot(DEFAULT_TODAY_CARDS, 2, 2)).toBeNull();
    expect(findSpot([card('a', 0, 0, 4, 8)], 3, 2)).toEqual({ x: 4, y: 0 });
  });

  it('checks a move against the other cards', () => {
    const cards = [card('a', 0, 0, 4, 4), card('b', 4, 0, 4, 4)];
    expect(cardFits({ ...cards[0]!, x: 1 }, cards)).toBe(false);
    expect(cardFits({ ...cards[0]!, y: 4 }, cards)).toBe(true);
    expect(cardFits({ ...cards[0]!, x: 10 }, cards)).toBe(false);
  });

  it('round-trips through the display address', () => {
    const param = cardsToParam(DEFAULT_TODAY_CARDS);
    expect(param).toBe('date:0.0.4.2,weather:0.2.4.4,list:0.6.4.2,agenda:4.0.8.8');
    expect(cardsFromParam(param).map(({ kind, x, y, w, h }) => [kind, x, y, w, h])).toEqual(
      DEFAULT_TODAY_CARDS.map(({ kind, x, y, w, h }) => [kind, x, y, w, h]),
    );
    expect(layoutFromSearch('?today=custom&cards=photo:0.0.6.8,nope:1.1.1.1')).toEqual({
      todayPreset: 'custom',
      todayCards: [{ id: 'photo-0', kind: 'photo', x: 0, y: 0, w: 6, h: 8 }],
    });
  });
});
