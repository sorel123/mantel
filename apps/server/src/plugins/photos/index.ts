/** Photos plugin: an iCloud shared album link; the provider is rebuilt when it changes. */
import type { TestResult } from '@mantel/shared';
import { IcloudAlbum } from '../../providers/real/photos-icloud.js';
import { realPhotos } from '../../providers/real/photos.js';
import { loadWs4Env } from '../../providers/real/weather-env.js';
import type { PhotoProvider, ProviderContext } from '../../providers/types.js';
import { live, type Live } from '../live.js';
import { humanError } from '../registry.js';
import type { Plugin, PluginStatusFields } from '../types.js';
import { manifest } from './manifest.js';

const none: PhotoProvider = {
  next: async () => ({ photos: [] }),
  bytes: async () => null,
};

export function photosPlugin(opts: { fetch?: typeof fetch; dir?: string } = {}): Plugin & {
  live: Live<PhotoProvider>;
} {
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const livePhotos = live<PhotoProvider>(none);
  let ctx: ProviderContext | null = null;
  let instance: ReturnType<typeof realPhotos> | null = null;
  let builtFrom = '';
  let lastError: string | null = null;

  return {
    manifest,
    live: livePhotos,
    start(c) {
      ctx = c;
    },
    stop() {
      instance?.stop();
      instance = null;
    },
    apply(config) {
      if (!ctx) return;
      const key = JSON.stringify([config.albumUrl, config.limit]);
      if (instance && key === builtFrom) return;
      builtFrom = key;
      instance?.stop();
      instance = null;
      lastError = null;
      if (!config.albumUrl) {
        livePhotos.set(none);
        return;
      }
      try {
        instance = realPhotos(ctx, {
          env: loadWs4Env({
            ICLOUD_SHARED_ALBUM_URL: String(config.albumUrl),
            PHOTO_LIMIT: config.limit === undefined ? undefined : String(config.limit),
          }),
          fetch: doFetch,
          ...(opts.dir ? { dir: opts.dir } : {}),
        });
        if (!instance.configured) lastError = 'That is not an iCloud shared album link.';
        livePhotos.set(instance);
      } catch (err) {
        lastError = humanError(err);
        livePhotos.set(none);
      }
    },
    async test(config): Promise<TestResult> {
      if (!config.albumUrl) return { ok: false, message: 'Paste the shared album link first.' };
      try {
        const album = new IcloudAlbum(String(config.albumUrl), doFetch);
        const photos = await album.photos();
        return {
          ok: true,
          message: `Album found with ${photos.length} photo${photos.length === 1 ? '' : 's'}.`,
        };
      } catch (err) {
        const text = humanError(err);
        return {
          ok: false,
          message: /not found|404/i.test(text)
            ? 'Apple could not find that album. Check that Public Website is on and the link is complete.'
            : text,
        };
      }
    },
    status(): PluginStatusFields {
      if (!instance)
        return {
          state: 'not_set_up',
          summary: 'Add a shared album link',
          lastOkAt: null,
          lastError,
        };
      if (lastError) return { state: 'error', summary: lastError, lastOkAt: null, lastError };
      return {
        state: 'connected',
        summary: 'Shared album linked',
        lastOkAt: null,
        lastError: null,
      };
    },
  };
}
