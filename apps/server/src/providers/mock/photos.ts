import { DEFAULT_PANEL, MOCK_PHOTO_COUNT, photoSvg, photos } from '@mantel/shared/fixtures';
import type { PhotoProvider } from '../types.js';

export function mockPhotos(): PhotoProvider {
  let cursor = 0;
  return {
    async next(n) {
      const all = photos(DEFAULT_PANEL);
      const out = Array.from({ length: n }, () => all[cursor++ % all.length]!);
      return { photos: out.map((p) => ({ ...p, url: `/api/photos/${p.id}` })) };
    },
    async bytes(id) {
      const m = /^mock-(\d+)$/.exec(id);
      if (!m || Number(m[1]) >= MOCK_PHOTO_COUNT) return null;
      return {
        contentType: 'image/svg+xml',
        body: photoSvg(Number(m[1]), DEFAULT_PANEL.width, DEFAULT_PANEL.height),
      };
    },
  };
}
