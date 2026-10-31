/**
 * `MOCK=1`: the calendar setup JSON (`/api/calendar/setup/*`) answered from fixtures, so the
 * Calendars section of Settings and the wizard can be used and tested without a Google account.
 * Choices are kept in memory for the life of the process; Google "connects" on the first
 * paste-back and forgets on disconnect. Under `MOCK_EMPTY` nothing is connected and the list is
 * empty, like a fresh install.
 */
import { DEVICE_KEY_HEADER } from '@mantel/shared';
import { calendars as fixtureCalendars, routeFixtures } from '@mantel/shared/fixtures';
import type { Context, Hono } from 'hono';
import type { DeviceAuth } from '../../auth.js';
import { HttpError } from '../../errors.js';
import type { ProviderContext } from '../types.js';

type Pref = {
  enabled?: boolean;
  name?: string;
  color?: string;
  personIds?: string[];
  isMeals?: boolean;
};

export function mountMockCalendarSetup(api: Hono, auth: DeviceAuth, ctx: ProviderContext) {
  const empty = Boolean(ctx.config.MOCK_EMPTY);
  let google = !empty;
  let prefs: { calendars: Record<string, Pref>; defaultCalendarId?: string } = { calendars: {} };

  const guard = (c: Context) => {
    if (!auth.verify(c.req.header(DEVICE_KEY_HEADER)))
      throw new HttpError('unauthorized', 'pair this page first');
  };

  const state = () => {
    const now = ctx.now().toISOString();
    const people = ctx.settings().people.map((p) => ({ id: p.id, name: p.name, color: p.color }));
    const list = google
      ? fixtureCalendars.map((c) => {
          const p = prefs.calendars[c.id] ?? {};
          return {
            ...c,
            name: p.name ?? c.name,
            color: p.color ?? c.color,
            personIds: p.personIds ?? c.personIds,
            isMeals: p.isMeals ?? c.isMeals,
            sourceName: c.name,
            sourceColor: c.color,
            enabled: p.enabled ?? true,
            primary: c.id === 'cal-family',
          };
        })
      : [];
    return {
      google: {
        configured: true,
        connected: google,
        lastSync: google ? now : null,
        error: null,
        account: google ? 'jay@example.com' : null,
        revoked: false,
        redirectUri: 'http://localhost:8787/api/calendar/google/callback',
        pasteBack: true,
        push: false,
        pushActive: false,
      },
      icloud: { configured: false, connected: false, lastSync: null, error: null, username: null },
      people,
      defaultCalendarId: prefs.defaultCalendarId ?? (google ? 'cal-family' : null),
      calendars: list,
    };
  };

  api.get('/calendar/setup', (c) => c.redirect('/settings#calendars', 302));
  api.get('/calendar/setup/state', (c) => {
    guard(c);
    return c.json(state());
  });
  api.post('/calendar/setup/prefs', async (c) => {
    guard(c);
    const body = (await c.req.json().catch(() => null)) as typeof prefs | null;
    if (!body || typeof body.calendars !== 'object')
      throw new HttpError('bad_request', 'calendars must be an object');
    prefs = { calendars: { ...body.calendars }, defaultCalendarId: body.defaultCalendarId };
    return c.json(state());
  });
  api.post('/calendar/sync', (c) => {
    guard(c);
    return c.json(state());
  });
  api.post('/calendar/google/start', (c) => {
    guard(c);
    const { url, redirectUri } = routeFixtures(ctx.now()).integrationAuthorizeUrl;
    return c.json({ url, redirectUri });
  });
  api.post('/calendar/google/finish', async (c) => {
    guard(c);
    const body = (await c.req.json().catch(() => null)) as { url?: string } | null;
    if (!body?.url || !/[?&]code=/.test(body.url))
      throw new HttpError('bad_request', 'that address has no code in it');
    google = true;
    return c.json(state());
  });
  api.post('/calendar/google/disconnect', (c) => {
    guard(c);
    google = false;
    return c.json(state());
  });
  api.get('/calendar/google/callback', (c) => {
    google = true;
    return c.redirect('/settings?google=connected#calendars', 302);
  });
}
