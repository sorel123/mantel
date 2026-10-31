import {
  DEVICE_KEY_HEADER,
  fromIsoDate,
  minutesInZone,
  scheduleStateAt,
  toLocalIso,
} from '@mantel/shared';
import { DEFAULT_PANEL, routeFixtures } from '@mantel/shared/fixtures';
import type { Handle, HandlerArgs } from '../contract.js';
import { HttpError, notFound, notImplemented } from '../errors.js';
import { log } from '../log.js';
import type { AppDeps } from '../app.js';
import type { HomeBytes } from '../providers/types.js';
import { dateInZone } from '../providers/real/weather-time.js';
import { VERSION } from '../version.js';

/** Every contract route. Each block is owned by the workstream named beside it. */
export function registerRoutes(handle: Handle, deps: AppDeps) {
  const { providers, auth, settings, config, sync, hub } = deps;
  const started = Date.now();

  /* ---- scaffold / WS6: pairing, bootstrap, settings, health ---- */
  handle('pair', async ({ body }) => {
    if (body.pin !== undefined && !body.code) {
      // The admin PIN arrives with the settings-first server (workstream A, step 2).
      if (!config.MOCK) throw new HttpError('forbidden', 'the admin PIN is not set up yet');
      return auth.pair('000000', body.name) ?? { deviceId: 'dev-mock', deviceKey: 'mock' };
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
    const saved = settings.put(body);
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
    // Per-display overrides (look, default screen, fit, scale) land with workstream A step 2.
    const device = body.name
      ? auth.rename(params.id!, body.name, deviceId)
      : (auth.list(deviceId).find((d) => d.id === params.id) ?? null);
    if (!device) throw notFound(`device ${params.id}`);
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

  /* ---- v2 workstream A: plugins, integrations, admin PIN, setup, backup, geocode ----
   * Contract only for now: fixtures in mock mode, 501 otherwise. The implementation follows. */
  const fixture = <N extends keyof ReturnType<typeof routeFixtures>>(name: N) => {
    if (!config.MOCK) throw notImplemented(name);
    return routeFixtures(new Date())[name];
  };
  handle('plugins', async () => fixture('plugins'));
  handle('integrations', async () => fixture('integrations'));
  handle('integrationPut', async ({ params, body }) => {
    const { integrations } = fixture('integrations');
    const current = integrations.find((i) => i.id === params.id);
    if (!current) throw notFound(`integration ${params.id}`);
    const enabled = body.enabled ?? current.enabled;
    return {
      integration: {
        ...current,
        enabled,
        state: enabled ? (current.state === 'disabled' ? 'not_set_up' : current.state) : 'disabled',
        config: { ...current.config, ...body.config },
        hasSecrets: Array.from(
          new Set([
            ...current.hasSecrets.filter((k) => body.secrets?.[k] !== null),
            ...Object.keys(body.secrets ?? {}).filter((k) => body.secrets?.[k]),
          ]),
        ),
      },
    };
  });
  handle('integrationTest', async ({ params }) => {
    if (!fixture('integrations').integrations.some((i) => i.id === params.id))
      throw notFound(`integration ${params.id}`);
    return fixture('integrationTest');
  });
  handle('integrationAuthorizeUrl', async () => fixture('integrationAuthorizeUrl'));
  handle('integrationCallback', async () => fixture('integrationCallback'));
  handle('healthDetails', async () => fixture('healthDetails'));
  handle('adminPin', async () => fixture('adminPin'));
  handle('setupState', async () => fixture('setupState'));
  handle('setupStatePut', async ({ body }) => {
    const state = fixture('setupState');
    return {
      ...state,
      completed: body.completed ?? state.completed,
      steps: { ...state.steps, ...body.steps },
    };
  });
  handle('settingsExport', async () => fixture('settingsExport'));
  handle('settingsImport', async () => fixture('settingsImport'));
  handle('geocode', async ({ body }) => {
    const pair = body.query.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (pair) {
      const latitude = Number(pair[1]);
      const longitude = Number(pair[2]);
      if (Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180)
        return {
          candidates: [
            {
              name: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
              latitude,
              longitude,
              timezone: settings.get().timezone,
            },
          ],
        };
    }
    return fixture('geocode');
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
