import { describe, expect, it } from 'vitest';
import { clampPct, classify, dragPct, dragStart } from './dim';

describe('drag to dim', () => {
  it('waits for the slop before deciding', () => {
    expect(classify(0, 0)).toBe('pending');
    expect(classify(5, 5)).toBe('pending');
    expect(classify(12, 3)).toBe('drag');
    expect(classify(-12, 3)).toBe('drag');
    expect(classify(3, 12)).toBe('scroll');
    expect(classify(3, -20)).toBe('scroll');
  });

  it('follows the finger one to one across the tile', () => {
    expect(dragPct(50, 0, 200)).toBe(50);
    expect(dragPct(50, 50, 200)).toBe(75);
    expect(dragPct(50, -50, 200)).toBe(25);
    expect(dragPct(0, 100, 400)).toBe(25);
  });

  it('never goes below 1 or above 100', () => {
    expect(dragPct(50, 1000, 200)).toBe(100);
    expect(dragPct(50, -1000, 200)).toBe(1);
    expect(dragPct(0, 0, 200)).toBe(1);
    expect(clampPct(0.2)).toBe(1);
    expect(clampPct(140)).toBe(100);
  });

  it('copes with a tile that has no width yet', () => {
    expect(dragPct(40, 30, 0)).toBe(40);
  });

  it('starts from nothing when the light is off', () => {
    expect(dragStart(false, 80)).toBe(0);
    expect(dragStart(true, 80)).toBe(80);
    expect(dragStart(true, null)).toBe(100);
  });
});
