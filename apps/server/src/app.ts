import { API_PREFIX, WsEvent, toLocalIso, type WsEventInput } from '@mantel/shared';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { DeviceAuth } from './auth.js';
import type { Config } from './config.js';
import { makeHandle } from './contract.js';
import { openDb, type Db } from './db/index.js';
import { HttpError } from './errors.js';
import { log } from './log.js';
import { mockProviders } from './providers/mock/index.js';
import { realProviders } from './providers/real/index.js';
import type { ProviderContext, Providers } from './providers/types.js';
import { registerRoutes } from './routes/index.js';
import { DisplayScheduler } from './schedule.js';
import { SettingsStore } from './settings.js';
import { WsHub } from './ws/hub.js';

export interface AppDeps {
  config: Config;
  db: Db;
  auth: DeviceAuth;
  hub: WsHub;
  settings: SettingsStore;
  providers: Providers;
  /** Last successful sync per source, for `/api/health`. */
  sync: Map<string, string | null>;
}

export function createApp(config: Config, overrides: { now?: () => Date } = {}) {
  const db = openDb(config.DATA_DIR);
  const auth = new DeviceAuth(db, config.MOCK);
  const hub = new WsHub(auth);
  const settings = new SettingsStore(db);
  const sync = new Map<string, string | null>();
  const ctx: ProviderContext = {
    config,
    db,
    emit: (event: WsEventInput) => hub.broadcast(event),
    now: overrides.now ?? (() => new Date()),
    markSynced: (source) => sync.set(source, new Date().toISOString()),
    settings: () => settings.get(),
  };
  const providers = config.MOCK ? mockProviders(ctx) : realProviders(ctx);
  const deps: AppDeps = { config, db, auth, hub, settings, providers, sync };
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
  providers.calendar.mount?.(api, auth);

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
    close: () => {
      scheduler.stop();
      hub.close();
    },
  };
}
