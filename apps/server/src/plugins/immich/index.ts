/** Immich plugin (v4 S): favourites, albums or the whole library, cached for the slideshow. */
import type { IntegrationConfig, TestResult } from '@mantel/shared';
import { PhotoCache } from '../../providers/real/photos-cache.js';
import { ImmichClient, ImmichError, type ImmichMode } from '../../providers/real/photos-immich.js';
import type { MixSource } from '../../providers/real/photos-mixer.js';
import { dateInZone } from '../../providers/real/weather-time.js';
import { integrationValues, type ProviderContext } from '../../providers/types.js';
import { humanError } from '../registry.js';
import type { Plugin, PluginStatusFields } from '../types.js';
import { manifest } from './manifest.js';

export const IMMICH_REFRESH_MS = 60 * 60_000;

function options(config: IntegrationConfig, secrets: Record<string, string>, f?: typeof fetch) {
  const mode: ImmichMode =
    config.mode === 'albums' || config.mode === 'all' ? config.mode : 'favorites';
  return {
    url: typeof config.url === 'string' ? config.url : '',
    apiKey: secrets.apiKey ?? '',
    mode,
    albums: String(config.albums ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    memories: config.memories !== false,
    limit: typeof config.limit === 'number' ? config.limit : 2000,
    ...(f ? { fetch: f } : {}),
  };
}

export function immichPlugin(opts: { fetch?: typeof fetch; dir?: string } = {}): Plugin & {
  source: MixSource;
} {
  let ctx: ProviderContext | null = null;
  let cache: PhotoCache | null = null;
  let builtFrom = '';
  let lastDay = '';

  const today = () => (ctx ? dateInZone(ctx.now(), ctx.settings().timezone) : '');

  const source: MixSource = {
    id: 'immich',
    name: 'Immich',
    short: 'Immich',
    enabled: () => (ctx ? integrationValues(ctx, 'immich').enabled : false),
    configured: () => cache !== null,
    items: () => cache?.items() ?? [],
    bytes: async (id) => (cache ? cache.bytes(id) : null),
    // Memories change with the date; re-read on the first request of a new day.
    touch: () => {
      const d = today();
      if (cache && d !== lastDay) {
        lastDay = d;
        void cache.refresh();
      }
    },
    status: () => cache?.status() ?? { syncing: false, lastSync: null, error: null },
  };

  return {
    manifest,
    source,
    start(c) {
      ctx = c;
    },
    stop() {
      cache?.stop();
    },
    apply(config, secrets) {
      if (!ctx) return;
      const o = options(config, secrets, opts.fetch);
      const key = JSON.stringify(o);
      if (key === builtFrom) return;
      builtFrom = key;
      cache?.stop();
      cache = null;
      if (!o.url || !o.apiKey) return;
      const client = new ImmichClient(o);
      lastDay = today();
      cache = new PhotoCache({
        ctx,
        prefix: 'immich',
        limit: o.limit + 200,
        refreshMs: IMMICH_REFRESH_MS,
        concurrency: 3,
        ...(opts.dir ? { dir: opts.dir } : {}),
        list: () => client.list(today()),
        read: (p) => client.preview(p.remoteId),
      });
      cache.start();
    },
    async test(config, secrets): Promise<TestResult> {
      const o = options(config, secrets, opts.fetch);
      if (!o.url) return { ok: false, message: 'Type Immich’s address first.' };
      if (!o.apiKey) return { ok: false, message: 'Paste the API key first.' };
      try {
        const client = new ImmichClient(o);
        const albums = await client.albums();
        if (o.mode === 'albums') {
          if (!o.albums.length)
            return {
              ok: false,
              message: albums.length
                ? `Connected. Type the albums to show. Immich has: ${albums
                    .map((a) => a.albumName)
                    .slice(0, 12)
                    .join(', ')}.`
                : 'Connected, but Immich has no albums yet. Choose Favourites or Everything instead.',
            };
          const { ids, missing } = await client.resolveAlbums();
          if (missing.length)
            return {
              ok: false,
              message: `Immich has no album called ${missing.join(', ')}. It has: ${albums
                .map((a) => a.albumName)
                .slice(0, 12)
                .join(', ')}.`,
            };
          const count = ids.reduce(
            (n, a) => n + (albums.find((x) => x.id === a.id)?.assetCount ?? 0),
            0,
          );
          return {
            ok: true,
            message: `Connected: ${ids.length} album${ids.length === 1 ? '' : 's'}, about ${count} photos.`,
          };
        }
        const photos = await client.list(today());
        if (!photos.length)
          return {
            ok: o.mode !== 'favorites',
            message:
              o.mode === 'favorites'
                ? 'Connected, but nothing is marked as a favourite yet. Heart some photos in Immich, or choose Everything.'
                : 'Connected, but the library has no photos yet.',
          };
        return {
          ok: true,
          message: `Connected: ${photos.length} photo${photos.length === 1 ? '' : 's'} to show.`,
        };
      } catch (err) {
        return { ok: false, message: err instanceof ImmichError ? err.message : humanError(err) };
      }
    },
    status(): PluginStatusFields {
      if (!cache)
        return {
          state: 'not_set_up',
          summary: 'Add Immich’s address and an API key',
          lastOkAt: null,
          lastError: null,
        };
      const s = cache.status();
      if (s.error && !s.count)
        return { state: 'error', summary: s.error, lastOkAt: s.lastSync, lastError: s.error };
      return {
        state: 'connected',
        summary:
          s.syncing && !s.count
            ? 'Downloading photos…'
            : `${s.count} photo${s.count === 1 ? '' : 's'} ready`,
        lastOkAt: s.lastSync,
        lastError: s.error,
      };
    },
  };
}
