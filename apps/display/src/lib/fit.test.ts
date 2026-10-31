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

  describe('fill', () => {
    const fill = { fit: 'fill' as const, scale: 1 };
    it('reaches the edges of a 16:9 monitor, keeping the design height', () => {
      const f = fitPanel(panel, 1920, 1080, fill);
      expect(f.height).toBe(820);
      expect(f.width).toBe(1458);
      expect(f.width * f.scale).toBeCloseTo(1920, 0);
      expect(f.height * f.scale).toBeCloseTo(1080, 0);
    });
    it('keeps the design width on a tall viewport and grows the height', () => {
      const f = fitPanel(panel, 1000, 1000, fill);
      expect(f.width).toBe(1180);
      expect(f.height).toBe(1180);
      expect(f.scale).toBeCloseTo(1000 / 1180, 3);
    });
    it('is the same as fit on the iPad and the Surface', () => {
      expect(fitPanel(panel, 1180, 820, fill)).toEqual(fitPanel(panel, 1180, 820));
      expect(fitPanel(panel, 1440, 960, fill)).toEqual(fitPanel(panel, 1440, 960));
    });
  });

  describe('scale', () => {
    it('zooms by the factor and still fills the viewport', () => {
      const f = fitPanel(panel, 1180, 820, { fit: 'scale', scale: 1.2 });
      expect(f.scale).toBeCloseTo(1.2, 2);
      expect(f.width * f.scale).toBeCloseTo(1180, 0);
      expect(f.height).toBe(683);
    });
    it('gives a Surface more room at 90 percent', () => {
      const f = fitPanel(panel, 1440, 960, { fit: 'scale', scale: 0.9 });
      expect(f.width).toBe(1367);
      expect(f.height).toBe(911);
      expect(f.scale).toBeCloseTo((960 / 820) * 0.9, 2);
    });
    it('treats a bad factor as 1', () => {
      expect(fitPanel(panel, 1920, 1080, { fit: 'scale', scale: NaN })).toEqual(
        fitPanel(panel, 1920, 1080, { fit: 'fill', scale: 1 }),
      );
    });
  });
});
