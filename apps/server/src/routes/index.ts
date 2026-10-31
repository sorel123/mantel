import { fromIsoDate } from '@mantel/shared';
import { DEFAULT_PANEL } from '@mantel/shared/fixtures';
import type { Handle } from '../contract.js';
import { HttpError, notFound } from '../errors.js';
import { log } from '../log.js';
import type { AppDeps } from '../app.js';
import { VERSION } from '../version.js';

/** Every contract route. Each block is owned by the workstream named beside it. */
export function registerRoutes(handle: Handle, deps: AppDeps) {
  const { providers, auth, settings, config, sync } = deps;
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
    };
  });

  handle('settings', async () => settings.get());
  handle('settingsPut', async ({ body }) => settings.put(body));

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
  handle('media', async () => providers.home.media());
  handle('mediaCall', async ({ body }) => providers.home.mediaCall(body));

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
  handle('chores', async () => providers.lists.chores());
  handle('choreDone', async ({ params, body }) =>
    providers.lists.choreDone(params.id!, body?.personId),
  );
}
