/**
 * Google Photos plugin (v4 S): sign in once (Mantel's shared Google client, or the household's
 * own client from the Google Calendar card), then pick photos on a phone through Google's
 * Picker. Picked photos are downloaded at once and kept; see providers/real/photos-google.ts.
 */
import type {
  GooglePickSession,
  GooglePickStatus,
  IntegrationConfig,
  TestResult,
} from '@mantel/shared';
import { HttpError } from '../../errors.js';
import { log } from '../../log.js';
import { PhotoCache, type RemotePhoto } from '../../providers/real/photos-cache.js';
import {
  GooglePhotosAuth,
  PickerClient,
  type PickedItem,
} from '../../providers/real/photos-google.js';
import type { MixSource } from '../../providers/real/photos-mixer.js';
import { dateInZone } from '../../providers/real/weather-time.js';
import {
  integrationValues,
  type GooglePhotoPicker,
  type ProviderContext,
} from '../../providers/types.js';
import { sharedGoogleClient, type SharedClient } from '../google/shared-client.js';
import { humanError } from '../registry.js';
import type { Plugin, PluginStatusFields } from '../types.js';
import { manifest } from './manifest.js';

export const CALLBACK_PATH = '/api/photo-sources/google/callback';

interface PickState extends GooglePickStatus {
  expiresAt: number;
}

export function googlePhotosPlugin(
  opts: { fetch?: typeof fetch; dir?: string; shared?: SharedClient | null } = {},
): Plugin & { source: MixSource; picker: GooglePhotoPicker } {
  const shared = opts.shared === undefined ? sharedGoogleClient() : opts.shared;
  let ctx: ProviderContext | null = null;
  let auth: GooglePhotosAuth | null = null;
  let client: PickerClient | null = null;
  let cache: PhotoCache | null = null;
  let builtFrom = '';
  let lastError: string | null = null;
  const sessions = new Map<string, PickState>();

  /** The shared Desktop client, else the household's own client from the Google Calendar card. */
  const credentials = () => {
    if (!ctx) return null;
    const g = integrationValues(ctx, 'google');
    const ownId = typeof g.config.clientId === 'string' ? g.config.clientId : '';
    const ownSecret = g.secrets.clientSecret ?? '';
    if (ownId && ownSecret)
      return {
        clientId: ownId,
        clientSecret: ownSecret,
        redirectUri: `http://localhost:${ctx.config.PORT}${CALLBACK_PATH}`,
      };
    if (shared)
      return { ...shared, redirectUri: `http://127.0.0.1:${ctx.config.PORT}${CALLBACK_PATH}` };
    return null;
  };

  const build = () => {
    if (!ctx) return;
    const creds = credentials();
    const key = JSON.stringify(creds);
    if (key === builtFrom && auth) return;
    builtFrom = key;
    auth = creds
      ? new GooglePhotosAuth({
          db: ctx.db,
          ...creds,
          ...(opts.fetch ? { fetch: opts.fetch } : {}),
          now: () => ctx!.now().getTime(),
        })
      : null;
    client = auth ? new PickerClient(auth, opts.fetch) : null;
  };

  const ensure = () => {
    build();
    if (!auth || !client)
      throw new HttpError(
        'bad_request',
        'Google sign-in is not available. Add a Google client on the Google Calendar card first.',
      );
    return { auth, client };
  };

  const toRemote = (item: PickedItem): RemotePhoto => {
    const tz = ctx?.settings().timezone ?? 'UTC';
    const d = item.createTime ? new Date(item.createTime) : null;
    return {
      remoteId: item.id,
      version: item.id,
      takenAt: d && !Number.isNaN(d.getTime()) ? dateInZone(d, tz) : null,
    };
  };

  async function save(id: string, state: PickState, c: PickerClient) {
    try {
      const picked = (await c.items(id)).filter(
        (i) => (!i.type || i.type === 'PHOTO') && i.mediaFile?.baseUrl,
      );
      const urls = new Map(picked.map((i) => [i.id, i.mediaFile!.baseUrl]));
      if (!cache) throw new Error('Google Photos was turned off');
      await cache.add(
        picked.map(toRemote),
        (n) => {
          state.saved = n;
        },
        (p) => c.download(urls.get(p.remoteId)!),
      );
      void c.remove(id);
      Object.assign(state, {
        state: 'done',
        message: picked.length
          ? `Saved ${state.saved} photo${state.saved === 1 ? '' : 's'} from Google Photos.`
          : 'Nothing was picked (videos are left out).',
      });
      ctx?.markSynced('photos');
    } catch (err) {
      log.warn('google-photos: saving the picked photos failed', { err: String(err) });
      Object.assign(state, { state: 'error', message: humanError(err) });
    }
  }

  const picker: GooglePhotoPicker = {
    async start(): Promise<GooglePickSession> {
      const { client: c } = ensure();
      if (!auth?.connected())
        throw new HttpError(
          'bad_request',
          'Connect Google Photos in Settings first, then pick photos.',
        );
      const s = await c.create();
      if (!s.pickerUri)
        throw new HttpError('upstream_error', 'Google did not return a picking link.');
      const expiresAt = s.expireTime ? Date.parse(s.expireTime) : Date.now() + 30 * 60_000;
      sessions.set(s.id, { state: 'waiting', saved: 0, expiresAt });
      return { id: s.id, pickerUri: s.pickerUri, expiresAt: new Date(expiresAt).toISOString() };
    },
    async status(id): Promise<GooglePickStatus> {
      const state = sessions.get(id);
      if (!state)
        throw new HttpError(
          'not_found',
          'That picking session has ended. Press Pick photos again.',
        );
      if (state.state === 'waiting') {
        if (Date.now() > state.expiresAt) {
          state.state = 'expired';
          state.message = 'The picking link expired. Press Pick photos again.';
        } else {
          const { client: c } = ensure();
          const s = await c.get(id);
          if (s.mediaItemsSet) {
            state.state = 'saving';
            void save(id, state, c);
          }
        }
      }
      const { expiresAt: _e, ...out } = state;
      return out;
    },
    async clear() {
      const n = (await cache?.clear()) ?? 0;
      return n;
    },
    async callback(url) {
      const { auth: a } = ensure();
      let parsed: URL;
      try {
        parsed = new URL(url.trim());
      } catch {
        throw new HttpError('bad_request', 'Paste the whole address from the browser bar.');
      }
      const err = parsed.searchParams.get('error');
      if (err)
        throw new HttpError(
          'bad_request',
          'Google sign-in was cancelled. Press Connect to try again.',
        );
      const code = parsed.searchParams.get('code');
      if (!code) throw new HttpError('bad_request', 'That address has no sign-in code in it.');
      await a.finish(code, parsed.searchParams.get('state') ?? '');
      lastError = null;
    },
  };

  const source: MixSource = {
    id: 'google-photos',
    name: 'Google Photos',
    short: 'Google Photos',
    enabled: () => (ctx ? integrationValues(ctx, 'google-photos').enabled : false),
    configured: () => Boolean(auth?.connected()),
    items: () => cache?.items() ?? [],
    bytes: async (id) => (cache ? cache.bytes(id) : null),
    status: () => {
      const s = cache?.status();
      return {
        syncing: [...sessions.values()].some((x) => x.state === 'saving'),
        lastSync: s?.lastSync ?? null,
        error: lastError,
      };
    },
  };

  return {
    manifest,
    source,
    picker,
    start(c) {
      ctx = c;
      // Picked photos stay until cleared; the "list" is what is already stored.
      cache = new PhotoCache({
        ctx: c,
        prefix: 'gphotos',
        limit: 5000,
        ...(opts.dir ? { dir: opts.dir } : {}),
        list: async () =>
          (cache?.items() ?? []).map((p) => ({
            remoteId: p.remoteId,
            version: p.version,
            takenAt: p.takenAt,
          })),
        read: () => Promise.reject(new Error('Google photos are only downloaded when picked')),
      });
    },
    stop() {
      cache?.stop();
    },
    apply() {
      build();
    },
    computed(): IntegrationConfig {
      const creds = credentials();
      if (!creds || creds.redirectUri.startsWith('http://127.0.0.1:')) return {};
      return { redirectUri: creds.redirectUri };
    },
    async test(): Promise<TestResult> {
      build();
      if (!auth)
        return {
          ok: false,
          message: 'Add a Google client on the Google Calendar card first (Advanced).',
        };
      if (!auth.connected())
        return { ok: true, message: 'Ready. Press Connect to sign in with Google.' };
      try {
        const c = client!;
        const s = await c.create();
        await c.remove(s.id);
        return {
          ok: true,
          message: `Connected. ${cache?.items().length ?? 0} picked photos kept. Pick more in Settings, Slideshow.`,
        };
      } catch (err) {
        return { ok: false, message: humanError(err) };
      }
    },
    status(): PluginStatusFields {
      build();
      if (!auth)
        return {
          state: 'not_set_up',
          summary: 'Needs a Google client (see the Google Calendar card)',
          lastOkAt: null,
          lastError: null,
        };
      const t = auth.tokens();
      if (t?.revoked)
        return {
          state: 'error',
          summary: 'Google signed Mantel out. Press Connect to sign in again.',
          lastOkAt: null,
          lastError: 'The refresh token was revoked.',
        };
      if (!auth.connected())
        return {
          state: 'not_set_up',
          summary: 'Press Connect to sign in with Google',
          lastOkAt: null,
          lastError: null,
        };
      const n = cache?.items().length ?? 0;
      return {
        state: 'connected',
        summary: n
          ? `${n} picked photo${n === 1 ? '' : 's'}`
          : 'Connected. Pick photos in Settings, Slideshow.',
        lastOkAt: cache?.status().lastSync ?? null,
        lastError,
      };
    },
    authorizeUrl() {
      const { auth: a } = ensure();
      return {
        url: a.authUrl(),
        redirectUri: a.redirectUri,
        pasteBack: !ctx || !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(ctx.config.PUBLIC_URL),
      };
    },
    async callback(url) {
      await picker.callback(url);
    },
  };
}
