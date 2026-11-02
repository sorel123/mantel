import { describe, expect, it } from 'vitest';
import { moveCard, patchCard, resolveCards, standsAlone, switchSide } from './arrange';

const defaults = ['climate', 'room:a', 'room:b', 'cameras', 'camera:x', 'camera:y', 'media'];
const keys = (cards: { key: string }[]) => cards.map((c) => c.key);

describe('Home arrangement', () => {
  it('starts in the default order, cameras and media on the side', () => {
    const cards = resolveCards(defaults, []);
    expect(keys(cards)).toEqual(defaults);
    expect(cards.filter((c) => c.side).map((c) => c.key)).toEqual([
      'cameras',
      'camera:x',
      'camera:y',
      'media',
    ]);
  });

  it('keeps the saved order, drops cards that are gone, and slots new ones by their neighbour', () => {
    const saved = [
      { key: 'room:b', side: false, hidden: false, wide: true },
      { key: 'room:gone', side: false, hidden: false, wide: false },
      { key: 'camera:y', side: false, hidden: false, wide: false },
      { key: 'climate', side: false, hidden: false, wide: false },
    ];
    const cards = resolveCards(defaults, saved);
    // room:a follows climate; the cameras card follows room:b (the card before it by default).
    expect(keys(cards)).toEqual([
      'room:b',
      'cameras',
      'camera:x',
      'camera:y',
      'media',
      'climate',
      'room:a',
    ]);
    expect(cards[0]!.wide).toBe(true);
  });

  it('moves a card past the cards of the other column', () => {
    const cards = resolveCards(defaults, []);
    const next = moveCard(cards, 'media', -1, 'feature');
    // camera:x and camera:y live inside the cameras card in this style, so media jumps them.
    expect(keys(next).slice(-4)).toEqual(['media', 'cameras', 'camera:x', 'camera:y']);
    expect(moveCard(cards, 'climate', -1, 'feature')).toBe(cards);
    expect(keys(moveCard(cards, 'climate', 1, 'feature')).slice(0, 2)).toEqual([
      'room:a',
      'climate',
    ]);
  });

  it('reorders cameras among themselves inside the cameras card', () => {
    const cards = resolveCards(defaults, []);
    expect(keys(moveCard(cards, 'camera:y', -1, 'grid'))).toContain('camera:y');
    const next = moveCard(cards, 'camera:y', -1, 'grid');
    expect(keys(next).indexOf('camera:y')).toBeLessThan(keys(next).indexOf('camera:x'));
  });

  it('sends a card to the other column, hides it, and knows what stands alone', () => {
    const cards = switchSide(resolveCards(defaults, []), 'room:a');
    expect(cards.at(-1)).toMatchObject({ key: 'room:a', side: true });
    expect(patchCard(cards, 'climate', { hidden: true })[0]!.hidden).toBe(true);
    expect(standsAlone('cameras', 'cards')).toBe(false);
    expect(standsAlone('camera:x', 'cards')).toBe(true);
    expect(standsAlone('camera:x', 'feature')).toBe(false);
  });
});
