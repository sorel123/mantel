import type { GooglePickStatus } from '@mantel/shared';
import {
  DEFAULT_PANEL,
  MOCK_PHOTO_COUNT,
  photoCaption,
  photoSources,
  photoSvg,
  photos,
} from '@mantel/shared/fixtures';
import { HttpError } from '../../errors.js';
import type { PhotoProvider, ProviderContext } from '../types.js';

/**
 * Mock photos: eight generated landscapes, each "from" a different source with a caption
 * (two are On this day photos), the four sources for Settings, and a Google Photos picker that
 * "saves" twelve photos a few seconds after it starts.
 */
export function mockPhotos(ctx?: Pick<ProviderContext, 'now' | 'settings'>): PhotoProvider {
  let cursor = 0;
  const now = () => ctx?.now() ?? new Date();
  const picks = new Map<string, number>();
  return {
    async next(n) {
      const all = photos(DEFAULT_PANEL);
      const captions = ctx?.settings().photos.captions ?? true;
      const out = Array.from({ length: n }, () => cursor++ % all.length);
      return {
        photos: out.map((i) => ({
          ...all[i]!,
          url: `/api/photos/${all[i]!.id}`,
          ...(captions ? { caption: photoCaption(i, now()) } : {}),
        })),
      };
    },
    async bytes(id) {
      const m = /^mock-(\d+)$/.exec(id);
      if (!m || Number(m[1]) >= MOCK_PHOTO_COUNT) return null;
      return {
        contentType: 'image/svg+xml',
        body: photoSvg(Number(m[1]), DEFAULT_PANEL.width, DEFAULT_PANEL.height),
      };
    },
    async sources() {
      const weights = ctx?.settings().photos.weights ?? {};
      return photoSources(now()).map((s) => ({ ...s, weight: weights[s.id] ?? s.weight }));
    },
    picker: {
      async start() {
        const id = `mock-${picks.size + 1}`;
        picks.set(id, Date.now());
        return {
          id,
          pickerUri: `https://photos.google.com/picker/${id}`,
          expiresAt: new Date(now().getTime() + 30 * 60_000).toISOString(),
        };
      },
      async status(id): Promise<GooglePickStatus> {
        const at = picks.get(id);
        if (at === undefined) throw new HttpError('not_found', 'That picking session has ended.');
        const age = Date.now() - at;
        if (age < 4000) return { state: 'waiting', saved: 0 };
        if (age < 6000) return { state: 'saving', saved: 5 };
        return {
          state: 'done',
          saved: 12,
          message: 'Saved 12 photos from Google Photos (mock mode).',
        };
      },
      async clear() {
        return 48;
      },
      async callback() {},
    },
  };
}
