import type { Photo } from '../models.js';

/** Generated landscapes in the mockup's ambient palettes. The server renders them as SVG at `/api/photos/:id`. */
export const photoPalettes = [
  {
    sky: ['#2B2F55', '#C96B5C', '#F2C28B'],
    hills: ['#3C2E4A', '#5B3E55', '#8A5A5E'],
    sun: '#FFD9A0',
    sunY: 0.62,
  },
  {
    sky: ['#0E2A3A', '#2F6F7A', '#9FD1C7'],
    hills: ['#0B2A2A', '#15423C', '#2A6B57'],
    sun: '#E8FFF6',
    sunY: 0.55,
  },
  {
    sky: ['#5B3A7A', '#C97B9C', '#F6D5C6'],
    hills: ['#2E1E3E', '#5A3C62', '#9A6B87'],
    sun: '#FFF0E0',
    sunY: 0.66,
  },
  {
    sky: ['#1B3B5F', '#5D8FC2', '#DCEBF7'],
    hills: ['#20364D', '#3A5B7A', '#6C8EA8'],
    sun: '#FFFFFF',
    sunY: 0.5,
  },
] as const;

export const MOCK_PHOTO_COUNT = 8;

export function photos(panel = { width: 1180, height: 820 }): Photo[] {
  return Array.from({ length: MOCK_PHOTO_COUNT }, (_, i) => ({
    id: `mock-${i}`,
    width: panel.width,
    height: panel.height,
    dominant: photoPalettes[i % photoPalettes.length]!.sky[1],
  }));
}

/** An SVG landscape for mock photo `index`, sized to the panel. */
export function photoSvg(index: number, width = 1180, height = 820): string {
  const p = photoPalettes[index % photoPalettes.length]!;
  const sunX = width * (0.3 + (0.4 * ((index * 37) % 100)) / 100);
  const sunY = height * p.sunY;
  const hills = p.hills
    .map((color, k) => {
      const base = height * (0.62 + k * 0.12);
      let d = `M0 ${height}`;
      for (let x = 0; x <= width; x += 16) {
        const y =
          base +
          Math.sin((x / width) * Math.PI * (1.4 + k * 0.8) + index + k) * height * 0.05 +
          Math.sin((x / width) * Math.PI * 6 + k * 2) * height * 0.012;
        d += ` L${x} ${y.toFixed(1)}`;
      }
      return `<path d="${d} L${width} ${height} Z" fill="${color}"/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.sky[0]}"/><stop offset=".55" stop-color="${p.sky[1]}"/><stop offset="1" stop-color="${p.sky[2]}"/></linearGradient>
<radialGradient id="g" cx="${sunX}" cy="${sunY}" r="${height * 0.35}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${p.sun}"/><stop offset=".12" stop-color="${p.sun}" stop-opacity=".8"/><stop offset=".13" stop-color="${p.sun}" stop-opacity=".13"/><stop offset="1" stop-color="${p.sun}" stop-opacity="0"/></radialGradient></defs>
<rect width="100%" height="100%" fill="url(#s)"/><rect width="100%" height="100%" fill="url(#g)"/>${hills}</svg>`;
}
