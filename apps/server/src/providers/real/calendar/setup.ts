/**
 * The calendar setup routes, outside the display contract. The picker UI lives in Settings
 * (`/settings#calendars`, workstream B); the old page address redirects there.
 *
 *   GET  /api/calendar/setup             redirects to /settings#calendars
 *   GET  /api/calendar/setup/state       status, calendars and choices          (device key)
 *   POST /api/calendar/setup/prefs       save choices                           (device key)
 *   POST /api/calendar/sync              sync now                               (device key)
 *   POST /api/calendar/google/start      the Google consent URL                 (device key)
 *   GET  /api/calendar/google/callback   Google's redirect back                 (state check)
 *   POST /api/calendar/google/finish     paste-back of the redirect address     (device key)
 *   POST /api/calendar/google/disconnect forget the Google tokens               (device key)
 *   POST /api/calendar/google/push       Google push notifications              (channel token)
 */
import { DEVICE_KEY_HEADER } from '@mantel/shared';
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import type { DeviceAuth } from '../../../auth.js';
import { HttpError } from '../../../errors.js';
import { log } from '../../../log.js';
import type { ProviderContext } from '../../types.js';
import type { RealCalendar } from './index.js';
import { pushAddress } from './urls.js';
import { isEnabled, isMeals, toCalendar } from './normalize.js';
import type { CalendarPrefs } from './types.js';

const Prefs = z.object({
  calendars: z.record(
    z.string(),
    z.object({
      enabled: z.boolean().optional(),
      name: z.string().max(80).optional(),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
      personIds: z.array(z.string()).optional(),
      isMeals: z.boolean().optional(),
    }),
  ),
  defaultCalendarId: z.string().optional(),
});

const Finish = z.object({ url: z.string().min(1) });

export function setupState(cal: RealCalendar, ctx: ProviderContext) {
  const prefs = cal.prefs();
  const people = ctx.settings().people;
  const tokens = cal.googleAuth.tokens();
  return {
    google: {
      ...cal.sourceStatus('google'),
      account: tokens?.account ?? null,
      revoked: Boolean(tokens?.revoked),
      redirectUri: cal.redirect.uri,
      pasteBack: cal.redirect.pasteBack,
      push: Boolean(pushAddress(ctx.config)),
      pushActive: cal.pushActive(),
    },
    icloud: { ...cal.sourceStatus('icloud'), username: cal.env.ICLOUD_USERNAME ?? null },
    people: people.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    defaultCalendarId: cal.defaultCalendar(prefs)?.id ?? null,
    calendars: cal.sourceCalendars().map((c) => {
      const out = toCalendar(c, prefs, people);
      return {
        ...out,
        sourceName: c.name,
        sourceColor: c.color,
        enabled: isEnabled(c, prefs),
        isMeals: isMeals(c, prefs),
        primary: Boolean(c.primary),
      };
    }),
  };
}

export function mountCalendarSetup(
  api: Hono,
  auth: DeviceAuth,
  cal: RealCalendar,
  ctx: ProviderContext,
) {
  const guard = (c: Context) => {
    if (!auth.verify(c.req.header(DEVICE_KEY_HEADER)))
      throw new HttpError('unauthorized', 'pair this page with the code from the server log');
  };
  const body = async <T>(c: Context, schema: z.ZodType<T>): Promise<T> => {
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new HttpError('bad_request', parsed.error.message);
    return parsed.data;
  };
  const connected = async () => {
    cal.start();
    await cal.sync();
  };

  // The setup page moved into Settings; keep the old address working.
  api.get('/calendar/setup', (c) => c.redirect(`/settings${SETTINGS_HASH}`, 302));

  api.get('/calendar/setup/state', (c) => {
    guard(c);
    return c.json(setupState(cal, ctx));
  });

  api.post('/calendar/setup/prefs', async (c) => {
    guard(c);
    const next: CalendarPrefs = await body(c, Prefs);
    cal.setPrefs(next);
    return c.json(setupState(cal, ctx));
  });

  api.post('/calendar/sync', async (c) => {
    guard(c);
    if (!cal.store.sourceCalendars().length) cal.start();
    await cal.sync();
    return c.json(setupState(cal, ctx));
  });

  api.post('/calendar/google/start', (c) => {
    guard(c);
    return c.json({ url: cal.googleAuth.authUrl(), redirectUri: cal.redirect.uri });
  });

  api.get('/calendar/google/callback', async (c) => {
    const { code, state, error } = c.req.query();
    if (error || !code || !state)
      return c.redirect(failed(error ? `Google said: ${error}` : 'No code in the address.'), 302);
    try {
      await cal.googleAuth.finish(code, state);
      await connected();
      return c.redirect(`/settings?google=connected${SETTINGS_HASH}`, 302);
    } catch (err) {
      return c.redirect(failed(err instanceof Error ? err.message : String(err)), 302);
    }
  });

  api.post('/calendar/google/finish', async (c) => {
    guard(c);
    const { url } = await body(c, Finish);
    let parsed: URL;
    try {
      parsed = new URL(url.trim());
    } catch {
      throw new HttpError('bad_request', 'paste the whole address from the browser bar');
    }
    const code = parsed.searchParams.get('code');
    const state = parsed.searchParams.get('state');
    if (!code || !state) throw new HttpError('bad_request', 'that address has no code in it');
    await cal.googleAuth.finish(code, state);
    await connected();
    return c.json(setupState(cal, ctx));
  });

  api.post('/calendar/google/disconnect', (c) => {
    guard(c);
    cal.googleAuth.disconnect();
    return c.json(setupState(cal, ctx));
  });

  api.post('/calendar/google/push', (c) => {
    const ok = cal.onPush(
      c.req.header('x-goog-channel-id'),
      c.req.header('x-goog-channel-token'),
      c.req.header('x-goog-resource-state'),
    );
    if (!ok) log.debug('google push for an unknown channel');
    // Always 200: Google retries anything else, and an unknown channel just expires.
    return c.body(null, 200);
  });
}

/** Settings opens on the Calendars section and shows the Google result from the query string. */
const SETTINGS_HASH = '#calendars';
const failed = (message: string) =>
  `/settings?google=error&message=${encodeURIComponent(message)}${SETTINGS_HASH}`;
