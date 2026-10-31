import {
  DEVICE_KEY_HEADER,
  fromIsoDate,
  minutesInZone,
  scheduleStateAt,
  toLocalIso,
} from '@mantel/shared';
import { DEFAULT_PANEL } from '@mantel/shared/fixtures';
import type { Handle, HandlerArgs } from '../contract.js';
import { HttpError, notFound } from '../errors.js';
import { log } from '../log.js';
import type { AppDeps } from '../app.js';
import type { HomeBytes } from '../providers/types.js';
import { VERSION } from '../version.js';

/** Every contract route. Each block is owned by the workstream named beside it. */
export function registerRoutes(handle: Handle, deps: AppDeps) {
  const { providers, auth, settings, config, sync, hub } = deps;
  const started = Date.now();

  /* ---- scaffold / WS6: pairing, bootstrap, settings, health ---- */
  handle('pair', async ({ body }) => {
    const paired = auth.pair(body.code, body.name);
    if (!paired) throw new HttpError('forbidden', 'pairing code is wrong or expired');
    return paired;
  });

  handle('bootstrap', async () => {
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
      settings: { location: s.location, units: s.units, schedule: s.schedule },
      theme: s.theme,
      panel: DEFAULT_PANEL,
      flags: s.flags,
      // WS C: the display hides the Home screen and doorbell layer when Home Assistant is off.
      integrations: { homeassistant: { enabled: providers.home.setup.enabled() } },
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
    const device = auth.rename(params.id!, body.name, deviceId);
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

  // Setup without YAML: the connection, what HA has, and the stored allow-list.
  const setup = providers.home.setup;
  handle('homeConnection', async () => setup.connection());
  handle('homeConnectionPut', async ({ body }) => setup.setConnection(body));
  handle('homeConnectionTest', async ({ body }) => setup.test(body));
  handle('homeDiscover', async () => setup.discover());
  handle('homeConfig', async () => setup.config());
  const saveConfig = (run: () => ReturnType<typeof setup.config>) => {
    try {
      return run();
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError('bad_request', err instanceof Error ? err.message : String(err));
    }
  };
  handle('homeConfigPut', async ({ body }) => saveConfig(() => setup.putConfig(body)));
  handle('homeConfigImportYaml', async ({ body }) => saveConfig(() => setup.importYaml(body.yaml)));
  handle('homeConfigExportYaml', async () => ({ yaml: setup.exportYaml() }));

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
