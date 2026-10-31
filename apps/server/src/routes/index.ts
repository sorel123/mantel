import {
  DEVICE_KEY_HEADER,
  fromIsoDate,
  minutesInZone,
  scheduleStateAt,
  toLocalIso,
} from '@mantel/shared';
import { DEFAULT_PANEL } from '@mantel/shared/fixtures';
import { decryptSecrets, encryptSecrets } from '../backup.js';
import type { Handle, HandlerArgs } from '../contract.js';
import { HttpError, notFound } from '../errors.js';
import { log, logTail } from '../log.js';
import type { AppDeps } from '../app.js';
import type { HomeBytes } from '../providers/types.js';
import { dateInZone } from '../providers/real/weather-time.js';
import { VERSION } from '../version.js';

/** Every contract route. Each block is owned by the workstream named beside it. */
export function registerRoutes(handle: Handle, deps: AppDeps) {
  const { providers, auth, settings, config, sync, hub, registry, setup, geocoder } = deps;
  const started = Date.now();

  /* ---- scaffold / WS6: pairing, bootstrap, settings, health ---- */
  handle('pair', async ({ body }) => {
    if (body.pin !== undefined && !body.code) {
      if (!auth.pinSet() && !config.MOCK)
        throw new HttpError(
          'forbidden',
          'no admin PIN is set yet; use the code from the server log',
        );
      if (auth.pinLocked())
        throw new HttpError('forbidden', 'too many wrong PINs; wait 30 seconds and try again');
      const paired = auth.pairWithPin(body.pin, body.name);
      if (!paired) throw new HttpError('forbidden', 'that PIN is wrong');
      setup.markDone('wall');
      return paired;
    }
    const paired = auth.pair(body.code ?? '', body.name);
    if (!paired) throw new HttpError('forbidden', 'pairing code is wrong or expired');
    return paired;
  });

  handle('bootstrap', async ({ deviceId }) => {
    const s = settings.get();
    const calendars = await providers.calendar.calendars().catch((err: unknown) => {
      log.warn('bootstrap: calendars unavailable', { err: String(err) });
      return [];
    });
    return {
      version: VERSION,
      mock: config.MOCK,
      serverTime: new Date().toISOString(),
      timezone: s.timezone,
      people: s.people,
      calendars,
      settings: {
        location: s.location,
        units: s.units,
        schedule: s.schedule,
        appearance: s.appearance,
        layout: s.layout,
        screens: s.screens,
        defaultScreen: s.defaultScreen,
        integrations: s.integrations,
      },
      theme: s.theme,
      panel: DEFAULT_PANEL,
      flags: s.flags,
      device: auth.list(deviceId).find((d) => d.current) ?? null,
    };
  });

  handle('settings', async () => settings.get());
  handle('settingsPut', async ({ body }) => {
    const before = settings.get();
    let next = body;
    // A new "where is home" text with untouched coordinates: look it up and fill them in.
    const query = body.location.query.trim();
    if (
      query &&
      query !== before.location.query &&
      body.location.latitude === before.location.latitude &&
      body.location.longitude === before.location.longitude
    ) {
      try {
        const [hit] = await geocoder.search(query);
        if (hit) {
          next = {
            ...body,
            timezone: hit.timezone || body.timezone,
            location: {
              ...body.location,
              name: body.location.name === before.location.name ? hit.name : body.location.name,
              latitude: hit.latitude,
              longitude: hit.longitude,
            },
          };
        }
      } catch (err) {
        log.warn('settings: could not look up the location', { query, err: String(err) });
      }
    }
    const saved = settings.put(next);
    await registry.refreshToggles(before.integrations, saved.integrations);
    // Displays read settings at bootstrap, so a reload applies the new schedule and flags.
    hub.broadcast({ type: 'display.reload', payload: {} });
    return saved;
  });

  handle('devices', async ({ deviceId }) => ({ devices: auth.list(deviceId) }));
  handle('deviceRevoke', async ({ params }) => {
    if (!auth.revoke(params.id!)) throw notFound(`device ${params.id}`);
    hub.disconnect(params.id!);
    return { ok: true as const };
  });
  handle('deviceRename', async ({ params, body, deviceId }) => {
    const device = auth.patch(params.id!, body, deviceId);
    if (!device) throw notFound(`device ${params.id}`);
    // The display reads its overrides at bootstrap.
    hub.broadcast({ type: 'display.reload', payload: {} });
    return { device };
  });
  handle('pairingCode', async () => {
    const { code, expiresAt } = auth.pairingCode();
    return { code, expiresAt: toLocalIso(expiresAt) };
  });

  handle('displayState', async () => {
    const s = settings.get();
    const now = new Date();
    return {
      at: toLocalIso(now),
      ...scheduleStateAt(s.schedule, minutesInZone(now, s.timezone)),
    };
  });
  handle('displayReload', async () => {
    hub.broadcast({ type: 'display.reload', payload: {} });
    return { ok: true as const, clients: hub.size };
  });

  handle('health', async () => ({
    ok: true,
    version: VERSION,
    mock: config.MOCK,
    uptimeSeconds: Math.round((Date.now() - started) / 1000),
    lastSync: Object.fromEntries(sync),
  }));

  /* ---- v2 workstream A: plugins, integrations, admin PIN, setup, backup, geocode ---- */
  handle('plugins', async () => ({ plugins: registry.manifests() }));
  handle('integrations', async () => ({ integrations: registry.statuses() }));
  handle('integrationPut', async ({ params, body }) => {
    const integration = await registry.update(params.id!, body);
    if (integration.state === 'connected') setup.markDone(stepFor(registry, params.id!));
    // Turning a plugin on or off adds or drops whole screens and cards.
    if (body.enabled !== undefined) hub.broadcast({ type: 'display.reload', payload: {} });
    return { integration };
  });
  handle('integrationTest', async ({ params, body }) => registry.test(params.id!, body));
  handle('integrationAuthorizeUrl', async ({ params }) => {
    const plugin = registry.get(params.id!);
    if (!plugin.authorizeUrl)
      throw new HttpError('bad_request', `${plugin.manifest.name} does not sign in with a browser`);
    return plugin.authorizeUrl();
  });
  handle('integrationCallback', async ({ params, body }) => {
    const plugin = registry.get(params.id!);
    if (!plugin.callback)
      throw new HttpError('bad_request', `${plugin.manifest.name} does not sign in with a browser`);
    await plugin.callback(body.url);
    setup.markDone(stepFor(registry, params.id!));
    return { integration: registry.status(plugin.manifest.id) };
  });

  handle('healthDetails', async () => ({
    version: VERSION,
    mock: config.MOCK,
    uptimeSeconds: Math.round((Date.now() - started) / 1000),
    firstRun: auth.firstRun(),
    pinSet: auth.pinSet(),
    publicUrl: config.PUBLIC_URL,
    integrations: registry.statuses(),
    logTail: logTail(),
    lastSync: Object.fromEntries(sync),
  }));

  handle('adminPin', async ({ body, deviceId }) => {
    const problem = auth.pinChangeProblem(body.currentPin, deviceId !== null);
    if (problem) throw new HttpError('forbidden', problem);
    auth.setPin(body.pin);
    setup.markDone('welcome');
    return { ok: true as const, pinSet: true as const };
  });

  handle('setupState', async () => setup.get());
  handle('setupStatePut', async ({ body }) => setup.put(body));

  handle('settingsExport', async ({ body }) => ({
    format: 'mantel-settings' as const,
    version: 1 as const,
    exportedAt: new Date().toISOString(),
    appVersion: VERSION,
    settings: settings.get(),
    integrations: registry.exportConfig(),
    ...(body?.passphrase
      ? { secrets: encryptSecrets(registry.exportSecrets(), body.passphrase) }
      : {}),
  }));
  handle('settingsImport', async ({ body }) => {
    const { bundle, passphrase } = body;
    let restored: Record<string, Record<string, string>> = {};
    if (bundle.secrets) {
      if (!passphrase)
        throw new HttpError(
          'bad_request',
          'this backup holds secrets; type the passphrase it was exported with',
        );
      try {
        restored = decryptSecrets(bundle.secrets, passphrase);
      } catch {
        throw new HttpError('forbidden', 'that passphrase does not open this backup');
      }
    }
    const before = settings.get();
    const saved = settings.put(bundle.settings);
    const known = new Set<string>(registry.ids());
    for (const [id, entry] of Object.entries(bundle.integrations)) {
      if (!known.has(id)) continue;
      await registry.update(id, {
        enabled: entry.enabled,
        config: entry.config,
        ...(restored[id] ? { secrets: restored[id] } : {}),
      });
    }
    await registry.refreshToggles(before.integrations, saved.integrations);
    hub.broadcast({ type: 'display.reload', payload: {} });
    return {
      ok: true as const,
      secretsRestored: Object.keys(restored).filter((id) => known.has(id)),
    };
  });

  handle('geocode', async ({ body }) => {
    try {
      return { candidates: await geocoder.search(body.query) };
    } catch (err) {
      throw new HttpError('upstream_error', `could not look that up: ${String(err)}`);
    }
  });

  /* ---- WS2: calendars ---- */
  handle('calendar', async ({ query }) =>
    providers.calendar.events(new Date(query.from), new Date(query.to)),
  );
  handle('calendarQuick', async ({ body }) => providers.calendar.quickAdd(body));
  handle('countdowns', async () => providers.calendar.countdowns());
  handle('meals', async ({ query }) =>
    providers.calendar.meals(query.week ? fromIsoDate(query.week) : undefined),
  );

  /* ---- WS3: Home Assistant and media ---- */
  handle('homeState', async () => providers.home.state());
  handle('homeCall', async ({ body }) => providers.home.call(body));
  handle('homeAnnounce', async ({ body }) => {
    if (!settings.get().flags.alexaAnnouncements)
      throw new HttpError('forbidden', 'Alexa announcements are turned off in settings');
    return providers.home.announce(body);
  });
  handle('media', async () => providers.home.media());
  handle('mediaCall', async ({ body }) => providers.home.mediaCall(body));

  // Byte routes for <img src>: the device key comes in the header or `?key=`.
  const image =
    (
      what: string,
      load: (id: string, signal: AbortSignal) => Promise<HomeBytes | null>,
      cache: string,
    ) =>
    async ({ c, query, params }: Pick<HandlerArgs<'cameraSnapshot'>, 'c' | 'query' | 'params'>) => {
      if (!auth.verify(c.req.header(DEVICE_KEY_HEADER) ?? query.key))
        throw new HttpError('unauthorized', 'missing or invalid device key');
      const bytes = await load(params.id ?? '', c.req.raw.signal);
      if (!bytes) throw notFound(`${what} ${params.id}`);
      return new Response(bytes.body, {
        headers: { 'content-type': bytes.contentType, 'cache-control': cache },
      });
    };
  handle(
    'cameraSnapshot',
    image('camera', (id) => providers.home.cameraSnapshot(id), 'no-store'),
  );
  handle(
    'cameraStream',
    image('camera', (id, signal) => providers.home.cameraStream(id, signal), 'no-store'),
  );
  handle(
    'mediaArtwork',
    image('artwork', (id) => providers.home.mediaArtwork(id), 'private, max-age=300'),
  );

  /* ---- WS4: weather, commute, photos ---- */
  handle('weather', async () => providers.weather.weather());
  handle('weatherPlace', async ({ query }) => providers.weather.place(query));
  handle('weatherSearch', async ({ query }) => providers.weather.search(query.q));
  handle('weatherQuip', async () =>
    providers.weather.quip(async () => {
      // Today's events, for a quip written by Claude; the library needs none.
      const s = settings.get();
      const day = fromIsoDate(dateInZone(new Date(), s.timezone));
      const to = new Date(day.getTime() + 864e5);
      return providers.calendar
        .events(day, to)
        .then((r) => r.events)
        .catch(() => []);
    }),
  );
  handle('commute', async () => providers.weather.commute());
  handle('photosNext', async ({ query }) => providers.photos.next(query.n ?? 5));
  handle('photo', async ({ params }) => {
    const photo = await providers.photos.bytes(params.id ?? '');
    if (!photo) throw notFound(`photo ${params.id}`);
    return new Response(photo.body, {
      headers: { 'content-type': photo.contentType, 'cache-control': 'private, max-age=86400' },
    });
  });

  /* ---- WS5: lists and chores ---- */
  handle('lists', async () => providers.lists.lists());
  handle('listAddItem', async ({ params, body }) => providers.lists.addItem(params.id!, body));
  handle('itemPatch', async ({ params, body }) => providers.lists.patchItem(params.id!, body));
  handle('itemDelete', async ({ params }) => providers.lists.deleteItem(params.id!));
  handle('listCreate', async ({ body }) => providers.lists.createList(body));
  handle('listDelete', async ({ params }) => providers.lists.deleteList(params.id!));
  handle('chores', async () => providers.lists.chores());
  handle('choreDone', async ({ params, body }) =>
    providers.lists.choreDone(params.id!, body?.personId),
  );
  handle('choreUndo', async ({ params }) => providers.lists.choreUndo(params.id!));
  handle('choreCreate', async ({ body }) => providers.lists.createChore(body));
  handle('choreDelete', async ({ params }) => providers.lists.deleteChore(params.id!));
}

/** The wizard step a plugin belongs to, for marking progress from the server side. */
function stepFor(registry: AppDeps['registry'], id: string): string {
  return registry.get(id).manifest.step ?? 'extras';
}
