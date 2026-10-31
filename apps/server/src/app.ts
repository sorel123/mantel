import { API_PREFIX, WsEvent, toLocalIso, type WsEventInput } from '@mantel/shared';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { DeviceAuth } from './auth.js';
import type { Config } from './config.js';
import { makeHandle } from './contract.js';
import { openDb, type Db } from './db/index.js';
import { HttpError } from './errors.js';
import { log } from './log.js';
import { createGeocoder, type Geocoder } from './geocode.js';
import { createPlugins, type PluginSet } from './plugins/index.js';
import { mockPlugins } from './plugins/mock.js';
import { PluginRegistry } from './plugins/registry.js';
import { mockProviders } from './providers/mock/index.js';
import type { ProviderContext, Providers } from './providers/types.js';
import { registerRoutes } from './routes/index.js';
import { DisplayScheduler } from './schedule.js';
import { SecretStore } from './secrets.js';
import { SettingsStore } from './settings.js';
import { SetupStore } from './setup.js';
import { WsHub } from './ws/hub.js';
import { geocodeCandidates } from '@mantel/shared/fixtures';

export interface AppDeps {
  config: Config;
  db: Db;
  auth: DeviceAuth;
  hub: WsHub;
  settings: SettingsStore;
  providers: Providers;
  /** Last successful sync per source, for `/api/health`. */
  sync: Map<string, string | null>;
  secrets: SecretStore;
  registry: PluginRegistry;
  setup: SetupStore;
  geocoder: Geocoder;
}

export interface CreateAppOptions {
  now?: () => Date;
  /** Environment the plugins read fallbacks from (tests pass their own). */
  env?: NodeJS.ProcessEnv;
  /** `fetch` for every outbound call the plugins make (tests pass a fake). */
  fetch?: typeof fetch;
}

/** In mock mode the geocoder answers from fixtures and never leaves the machine. */
function mockGeocodeFetch(timezone: () => string): typeof fetch {
  return async (input) => {
    const url = String(input);
    if (url.includes('nominatim')) return new Response('[]');
    const body = url.includes('geocoding-api')
      ? {
          results: geocodeCandidates.map((c) => ({
            name: c.name.split(',')[0],
            latitude: c.latitude,
            longitude: c.longitude,
            timezone: c.timezone,
            country: c.country,
            admin1: c.admin,
          })),
        }
      : { timezone: timezone() };
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  };
}

export function createApp(config: Config, overrides: CreateAppOptions = {}) {
  const db = openDb(config.DATA_DIR);
  const auth = new DeviceAuth(db, config.MOCK);
  const hub = new WsHub(auth);
  const settings = new SettingsStore(db);
  const secrets = SecretStore.open(db, config.DATA_DIR);
  const setup = new SetupStore(db, auth);
  const sync = new Map<string, string | null>();
  let registry: PluginRegistry | null = null;
  const ctx: ProviderContext = {
    config,
    db,
    emit: (event: WsEventInput) => hub.broadcast(event),
    now: overrides.now ?? (() => new Date()),
    markSynced: (source) => sync.set(source, new Date().toISOString()),
    settings: () => settings.get(),
    integration: (id) =>
      registry
        ? { enabled: registry.enabled(id), ...registry.resolve(id) }
        : { enabled: true, config: {}, secrets: {} },
  };

  let providers: Providers;
  let pluginSet: PluginSet | null = null;
  registry = new PluginRegistry(ctx, { db, secrets, settings, sync, env: overrides.env });
  if (config.MOCK) {
    providers = mockProviders(ctx);
    for (const p of mockPlugins(ctx.now)) registry.register(p);
  } else {
    pluginSet = createPlugins(ctx, { env: overrides.env, fetch: overrides.fetch });
    providers = pluginSet.providers;
    for (const p of pluginSet.plugins) registry.register(p);
  }
  const ready = registry.start();

  const geocoder = createGeocoder({
    defaultTimezone: settings.get().timezone,
    ...(config.MOCK
      ? { fetch: mockGeocodeFetch(() => settings.get().timezone) }
      : overrides.fetch
        ? { fetch: overrides.fetch }
        : {}),
  });

  const deps: AppDeps = {
    config,
    db,
    auth,
    hub,
    settings,
    providers,
    sync,
    secrets,
    registry,
    setup,
    geocoder,
  };
  const scheduler = new DisplayScheduler(settings, (e) => hub.broadcast(e), ctx.now);
  scheduler.start();

  const app = new Hono();
  app.onError((err, c) => {
    if (err instanceof HttpError)
      return c.json({ error: { code: err.code, message: err.message } }, err.status as 400);
    log.error(`${c.req.method} ${c.req.path} failed`, {
      err: err instanceof Error ? err.stack : String(err),
    });
    return c.json({ error: { code: 'internal', message: 'internal error' } }, 500);
  });

  const api = new Hono();
  registerRoutes(makeHandle(api, { auth, validateResponses: !config.isProd }), deps);
  // Non-contract routes a provider needs (WS2: calendar setup page, OAuth and push callbacks).
  // Real mode mounts them through the calendar service so they follow a rebuilt provider.
  if (pluginSet) pluginSet.calendar.mount(api, auth);
  else providers.calendar.mount?.(api, auth);

  if (config.MOCK) {
    // Mock-only helpers so workstreams can demo server pushes: `curl -XPOST .../api/dev/emit -d '{...}'`.
    api.post('/dev/emit', async (c) => {
      const event = WsEvent.safeParse(await c.req.json().catch(() => null));
      if (!event.success) throw new HttpError('bad_request', event.error.message);
      hub.broadcast(event.data);
      return c.json({ ok: true, clients: hub.size });
    });
    api.post('/dev/doorbell', (c) => {
      hub.broadcast({
        type: 'home.doorbell',
        payload: {
          cameraEntityId: 'camera.front_door',
          at: toLocalIso(new Date()),
          durationSeconds: 30,
        },
      });
      return c.json({ ok: true, clients: hub.size });
    });
  }

  api.all('*', (c) =>
    c.json(
      { error: { code: 'not_found', message: `no route ${c.req.method} ${c.req.path}` } },
      404,
    ),
  );
  app.route(API_PREFIX, api);

  if (config.DISPLAY_DIST) {
    const root = config.DISPLAY_DIST;
    app.use('/*', serveStatic({ root }));
    // Single-page app: unknown paths get index.html.
    app.get('*', serveStatic({ root, path: 'index.html' }));
  }

  return {
    app,
    deps,
    /** Settles when every plugin has started (the built-in ones start synchronously). */
    ready,
    close: () => {
      scheduler.stop();
      void registry?.stop();
      hub.close();
    },
  };
}
