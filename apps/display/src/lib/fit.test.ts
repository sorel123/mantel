import { describe, expect, it } from 'vitest';
import { fitPanel } from './fit';

const panel = { width: 1180, height: 820 };

describe('fitPanel', () => {
  it('is 1:1 on the iPad', () => {
    expect(fitPanel(panel, 1180, 820)).toEqual({ width: 1180, height: 820, scale: 1 });
  });
  it('widens to fill a Surface', () => {
    const f = fitPanel(panel, 1440, 960);
    expect(f.height).toBe(820);
    expect(f.width).toBe(1230);
    expect(f.scale).toBeCloseTo(960 / 820, 3);
    expect(f.width * f.scale).toBeCloseTo(1440, 0);
  });
  it('letterboxes on a 16:9 monitor', () => {
    const f = fitPanel(panel, 1920, 1080);
    expect(f.width).toBe(1180);
    expect(f.scale).toBeCloseTo(1080 / 820, 3);
  });
  it('shrinks on a small window', () => {
    expect(fitPanel(panel, 590, 410).scale).toBe(0.5);
  });
});
