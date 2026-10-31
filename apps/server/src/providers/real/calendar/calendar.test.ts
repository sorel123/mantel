import type { WsEventInput } from '@mantel/shared';
import { addDays, atHour, startOfDay, toIsoDate } from '@mantel/shared';
import { settings as defaultSettings } from '@mantel/shared/fixtures';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../app.js';
import { loadConfig } from '../../../config.js';
import { openDb } from '../../../db/index.js';
import type { ProviderContext } from '../../types.js';
import { loadCalendarEnv } from './env.js';
import type { GEvent } from './google.js';
import { RealCalendar } from './index.js';

/* ---------- a fake Google and a fake iCloud behind one fetch ---------- */

const today = startOfDay(new Date());
const at = (days: number, h: number) => atHour(addDays(today, days), h).toISOString();
const date = (days: number) => toIsoDate(addDays(today, days));

function fakeUpstream() {
  const calls: Array<{ method: string; url: string; body?: string }> = [];
  let tokenN = 0;
  const google: Record<string, GEvent[]> = {
    'jay@example.com': [
      {
        id: 'g1',
        summary: 'Team standup',
        start: { dateTime: at(0, 9) },
        end: { dateTime: at(0, 10) },
      },
      {
        id: 'g2',
        summary: 'Declined thing',
        start: { dateTime: at(0, 11) },
        end: { dateTime: at(0, 12) },
        attendees: [{ self: true, responseStatus: 'declined' }],
      },
      { id: 'g3', status: 'cancelled' },
    ],
    'family@group.calendar.google.com': [
      {
        id: 'f1',
        summary: 'Leo soccer',
        location: 'Riverside field',
        start: { dateTime: at(0, 15.5) },
        end: { dateTime: at(0, 17) },
      },
      {
        id: 'f2',
        summary: '⭐ Grandma visits',
        start: { date: date(18) },
        end: { date: date(21) },
      },
      { id: 'f3', summary: 'Picture day', start: { date: date(0) }, end: { date: date(1) } },
    ],
    'meals@group.calendar.google.com': [
      { id: 'm1', summary: 'Tacos', start: { date: date(0) }, end: { date: date(1) } },
    ],
    'holidays@group.v.calendar.google.com': [
      { id: 'h1', summary: 'Holiday', start: { date: date(1) }, end: { date: date(2) } },
    ],
  };
  const icloud = { ctag: 'ctag-1', ics: '' };
  icloud.ics = vevent('sam-1', 'Book club', at(1, 19.5), at(1, 21));
  let googleDown = false;

  const fetch = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const body =
      typeof init.body === 'string' ? init.body : init.body ? String(init.body) : undefined;
    calls.push({ method, url: url.toString(), ...(body ? { body } : {}) });
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
    const xml = (v: string) =>
      new Response(v, { status: 207, headers: { 'content-type': 'application/xml' } });

    if (url.host === 'oauth2.googleapis.com') {
      const form = new URLSearchParams(body);
      if (form.get('grant_type') === 'authorization_code') {
        return form.get('code') === 'good-code'
          ? json({
              access_token: `at-${++tokenN}`,
              expires_in: 3600,
              refresh_token: 'rt-1',
              scope: 'x',
            })
          : json({ error: 'invalid_grant' }, 400);
      }
      if (form.get('refresh_token') === 'rt-revoked') return json({ error: 'invalid_grant' }, 400);
      return json({ access_token: `at-${++tokenN}`, expires_in: 3600 });
    }
    if (url.host === 'www.googleapis.com') {
      if (googleDown) return json({ error: { message: 'backend' } }, 503);
      const path = decodeURIComponent(url.pathname.replace('/calendar/v3', ''));
      if (path === '/users/me/calendarList')
        return json({
          items: [
            {
              id: 'jay@example.com',
              summary: 'jay@example.com',
              summaryOverride: 'Jay',
              backgroundColor: '#E2694F',
              accessRole: 'owner',
              primary: true,
              selected: true,
            },
            {
              id: 'family@group.calendar.google.com',
              summary: 'Family',
              backgroundColor: '#246B5B',
              accessRole: 'writer',
              selected: true,
            },
            {
              id: 'meals@group.calendar.google.com',
              summary: 'Meals',
              backgroundColor: '#C8761E',
              accessRole: 'writer',
              selected: false,
            },
            {
              id: 'holidays@group.v.calendar.google.com',
              summary: 'Holidays',
              accessRole: 'reader',
              selected: false,
            },
          ],
        });
      const m = /^\/calendars\/([^/]+)\/events(\/watch)?$/.exec(path);
      if (m && m[2])
        return json({
          kind: 'api#channel',
          resourceId: `res-${m[1]}`,
          expiration: String(Date.now() + 6 * 864e5),
        });
      if (m && method === 'POST') {
        const ev = JSON.parse(body!) as GEvent;
        const created = { ...ev, id: `new-${google[m[1]!]!.length}`, status: 'confirmed' as const };
        google[m[1]!]!.push(created);
        return json(created);
      }
      if (m) return json({ items: google[m[1]!] ?? [] });
      if (path === '/channels/stop') return new Response(null, { status: 204 });
    }
    if (url.host === 'caldav.icloud.com' && method === 'PROPFIND' && url.pathname === '/')
      return xml(
        multistatus(
          `<d:response><d:href>/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>/123/principal/</d:href></d:current-user-principal></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
        ),
      );
    if (url.host === 'caldav.icloud.com' || url.host === 'p01-caldav.icloud.com') {
      if (method === 'PROPFIND' && url.pathname === '/123/principal/')
        return xml(
          multistatus(
            `<d:response><d:href>/123/principal/</d:href><d:propstat><d:prop><c:calendar-home-set><d:href>https://p01-caldav.icloud.com/123/calendars/</d:href></c:calendar-home-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
          ),
        );
      if (method === 'PROPFIND' && url.pathname === '/123/calendars/')
        return xml(
          multistatus(`
          <d:response><d:href>/123/calendars/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
          <d:response><d:href>/123/calendars/sam/</d:href><d:propstat><d:prop>
            <d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Sam</d:displayname>
            <cs:getctag>${icloud.ctag}</cs:getctag><ic:calendar-color>#3F7BD9FF</ic:calendar-color>
            <c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>
            <d:current-user-privilege-set><d:privilege><d:read/></d:privilege><d:privilege><d:write/></d:privilege></d:current-user-privilege-set>
          </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
          <d:response><d:href>/123/calendars/tasks/</d:href><d:propstat><d:prop>
            <d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Reminders</d:displayname>
            <c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>
          </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`),
        );
      if (method === 'REPORT')
        return xml(
          multistatus(
            `<d:response><d:href>/123/calendars/sam/sam-1.ics</d:href><d:propstat><d:prop><d:getetag>"1"</d:getetag><c:calendar-data>${escapeXml(icloud.ics)}</c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
          ),
        );
      if (method === 'PUT') return new Response(null, { status: 201 });
    }
    return new Response(`unexpected ${method} ${url}`, { status: 599 });
  });

  return {
    fetch: fetch as unknown as typeof globalThis.fetch,
    calls,
    google,
    icloud,
    setGoogleDown: (v: boolean) => (googleDown = v),
  };
}

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const multistatus = (inner: string) =>
  `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:ic="http://apple.com/ns/ical/">${inner}</d:multistatus>`;
const utc = (iso: string) =>
  new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
function vevent(uid: string, title: string, start: string, end: string) {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:test',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    'DTSTAMP:20260101T000000Z',
    `DTSTART:${utc(start)}`,
    `DTEND:${utc(end)}`,
    `SUMMARY:${title}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

/* ---------- harness ---------- */

function harness(
  envOverrides: Record<string, string> = {},
  publicUrl = 'http://192.168.1.20:8787',
) {
  const up = fakeUpstream();
  const events: WsEventInput[] = [];
  const synced: string[] = [];
  const s = defaultSettings();
  const ctx: ProviderContext = {
    config: loadConfig({ DATA_DIR: ':memory:', PUBLIC_URL: publicUrl }),
    db: openDb(':memory:'),
    emit: (e) => events.push(e),
    now: () => new Date(),
    markSynced: (src) => synced.push(src),
    settings: () => s,
  };
  const env = loadCalendarEnv({
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'secret',
    ICLOUD_USERNAME: 'sam@example.com',
    ICLOUD_APP_PASSWORD: 'abcd-efgh-ijkl-mnop',
    ...envOverrides,
  });
  const cal = new RealCalendar(ctx, { env, fetch: up.fetch, autoStart: false });
  return { up, cal, ctx, events, synced };
}

async function connect(h: ReturnType<typeof harness>) {
  const url = new URL(h.cal.googleAuth.authUrl());
  await h.cal.googleAuth.finish('good-code', url.searchParams.get('state')!);
  await h.cal.sync();
}

const dayRange = (d = 0) => [addDays(today, d), addDays(today, d + 1)] as const;

describe('RealCalendar', () => {
  it('answers empty until a source is connected', async () => {
    const h = harness({ ICLOUD_USERNAME: '' });
    expect(await h.cal.calendars()).toEqual([]);
    expect((await h.cal.events(...dayRange())).events).toEqual([]);
    expect(h.up.calls).toHaveLength(0);
  });

  it('builds the Google consent URL with the paste-back redirect on a LAN address', () => {
    const h = harness();
    const url = new URL(h.cal.googleAuth.authUrl());
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:8787/api/calendar/google/callback',
    );
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('scope')).toContain('calendar.events');
    expect(h.cal.redirect.pasteBack).toBe(true);
    expect(harness({}, 'https://mantel.example.net').cal.redirect).toEqual({
      uri: 'https://mantel.example.net/api/calendar/google/callback',
      pasteBack: false,
    });
  });

  it('rejects a stale or reused state', async () => {
    const h = harness();
    const state = new URL(h.cal.googleAuth.authUrl()).searchParams.get('state')!;
    await expect(h.cal.googleAuth.finish('good-code', 'nope')).rejects.toThrow(/expired/);
    await h.cal.googleAuth.finish('good-code', state);
    await expect(h.cal.googleAuth.finish('good-code', state)).rejects.toThrow(/expired/);
  });

  it('syncs Google and iCloud and serves normalised events from the cache', async () => {
    const h = harness();
    await connect(h);
    const cals = await h.cal.calendars();
    expect(cals.map((c) => [c.id, c.name, c.isMeals])).toEqual([
      ['google:jay@example.com', 'Jay', false],
      ['google:family@group.calendar.google.com', 'Family', false],
      ['google:meals@group.calendar.google.com', 'Meals', true],
      ['icloud:/123/calendars/sam/', 'Sam', false],
    ]);
    expect(cals.find((c) => c.source === 'icloud')!.color).toBe('#3F7BD9');
    expect(h.synced).toContain('calendar');
    expect(h.events.some((e) => e.type === 'calendar.changed')).toBe(true);

    h.cal.setPrefs({
      calendars: {
        'google:jay@example.com': { personIds: ['jay'] },
        'icloud:/123/calendars/sam/': { personIds: ['sam'] },
      },
    });
    const { events } = await h.cal.events(...dayRange());
    expect(events.map((e) => [e.title, e.allDay, e.personIds])).toEqual([
      ['Picture day', true, []],
      ['Team standup', false, ['jay']],
      ['Leo soccer', false, ['leo']],
    ]);
    expect(events.find((e) => e.title === 'Leo soccer')).toMatchObject({
      location: 'Riverside field',
      color: '#3BA06F',
    });
    const tomorrow = await h.cal.events(...dayRange(1));
    expect(tomorrow.events.map((e) => [e.title, e.personIds])).toEqual([['Book club', ['sam']]]);
  });

  it('reports changes only when something changed, and skips unchanged iCloud calendars', async () => {
    const h = harness();
    await connect(h);
    const reports = () => h.up.calls.filter((c) => c.method === 'REPORT').length;
    const before = reports();
    h.events.length = 0;
    await h.cal.sync();
    expect(h.events).toEqual([]);
    expect(reports()).toBe(before);

    h.up.google['jay@example.com']![0]!.summary = 'Team standup (moved)';
    h.up.icloud.ctag = 'ctag-2';
    await h.cal.sync();
    expect(reports()).toBe(before + 1);
    const changed = h.events.filter((e) => e.type === 'calendar.changed');
    expect(changed).toHaveLength(1);
    const range = changed[0]!.payload as { from: string; to: string };
    expect(new Date(range.from).getTime()).toBe(new Date(at(0, 9)).getTime());
  });

  it('keeps serving the cache when Google is down', async () => {
    const h = harness();
    await connect(h);
    h.up.setGoogleDown(true);
    await h.cal.sync();
    expect(h.cal.sourceStatus('google').error).toMatch(/503/);
    expect((await h.cal.calendars()).length).toBe(4);
    expect((await h.cal.events(...dayRange())).events.length).toBe(3);
  });

  it('counts down to tagged events and reads the meal plan', async () => {
    const h = harness();
    await connect(h);
    const { countdowns } = await h.cal.countdowns();
    expect(countdowns).toEqual([
      expect.objectContaining({ title: 'Grandma visits', daysRemaining: 18, date: date(18) }),
    ]);
    const meals = await h.cal.meals(today);
    expect(meals.meals).toContainEqual(
      expect.objectContaining({ date: date(0), slot: 'dinner', title: 'Tacos' }),
    );
    // Meal events stay off the timeline.
    expect((await h.cal.events(...dayRange())).events.some((e) => e.title === 'Tacos')).toBe(false);
  });

  it('quick-adds to the primary Google calendar with people, visible before the next sync', async () => {
    const h = harness();
    await connect(h);
    h.events.length = 0;
    const { event } = await h.cal.quickAdd({
      title: 'Pizza night',
      start: at(0, 18),
      personIds: ['ava', 'leo'],
    });
    expect(event).toMatchObject({
      calendarId: 'google:jay@example.com',
      title: 'Pizza night',
      personIds: ['ava', 'leo'],
    });
    expect(new Date(event.end).getTime() - new Date(event.start).getTime()).toBe(3600e3);
    const post = h.up.calls.find((c) => c.method === 'POST' && c.url.endsWith('/events'))!;
    expect(JSON.parse(post.body!).extendedProperties.private.mantelPeople).toBe('ava,leo');
    expect(h.events.map((e) => e.type)).toEqual(['calendar.changed']);
    expect((await h.cal.events(...dayRange())).events.map((e) => e.title)).toContain('Pizza night');
    await h.cal.sync();
    expect(
      (await h.cal.events(...dayRange())).events.filter((e) => e.title === 'Pizza night'),
    ).toHaveLength(1);
  });

  it('quick-adds all-day events to iCloud', async () => {
    const h = harness();
    await connect(h);
    const { event } = await h.cal.quickAdd({
      title: 'Picture day',
      start: at(3, 10),
      allDay: true,
      calendarId: 'icloud:/123/calendars/sam/',
    });
    expect(event.allDay).toBe(true);
    expect(new Date(event.start).getTime()).toBe(addDays(today, 3).getTime());
    const put = h.up.calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toMatch(/^https:\/\/p01-caldav\.icloud\.com\/123\/calendars\/sam\/.+\.ics$/);
    expect(put.body).toContain(`DTSTART;VALUE=DATE:${date(3).replace(/-/g, '')}`);
  });

  it('refuses read-only calendars', async () => {
    const h = harness();
    await connect(h);
    await expect(
      h.cal.quickAdd({
        title: 'x',
        start: at(0, 9),
        calendarId: 'google:holidays@group.v.calendar.google.com',
      }),
    ).rejects.toThrow(/read-only/);
  });

  it('refreshes expired access tokens and flags a revoked grant', async () => {
    const h = harness();
    await connect(h);
    const t = h.cal.googleAuth.tokens()!;
    h.cal.store.set('google.tokens', { ...t, expiresAt: Date.now() - 1 });
    await h.cal.sync();
    expect(h.cal.googleAuth.tokens()!.accessToken).not.toBe(t.accessToken);
    h.cal.store.set('google.tokens', { ...t, refreshToken: 'rt-revoked', expiresAt: 0 });
    await h.cal.sync();
    expect(h.cal.googleAuth.tokens()!.revoked).toBe(true);
    expect(h.cal.googleAuth.connected()).toBe(false);
  });

  it('opens push channels on an https address and syncs when Google calls', async () => {
    const h = harness({}, 'https://mantel.example.net');
    await connect(h);
    const watches = h.up.calls.filter((c) => c.url.endsWith('/events/watch'));
    expect(watches).toHaveLength(3);
    expect(JSON.parse(watches[0]!.body!).address).toBe(
      'https://mantel.example.net/api/calendar/google/push',
    );
    expect(h.cal.pushActive()).toBe(true);
    const ch = h.cal.store.get<Array<{ channelId: string; token: string }>>('google.channels')![0]!;
    expect(h.cal.onPush(ch.channelId, 'wrong', 'exists')).toBe(false);
    expect(h.cal.onPush(ch.channelId, ch.token, 'exists')).toBe(true);
    h.cal.stop();
  });
});

/* ---------- the setup routes through the real app ---------- */

describe('calendar setup routes', () => {
  let up: ReturnType<typeof fakeUpstream>;
  beforeEach(() => {
    up = fakeUpstream();
    vi.stubGlobal('fetch', up.fetch);
    vi.stubEnv('GOOGLE_CLIENT_ID', 'cid');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret');
    vi.stubEnv('ICLOUD_USERNAME', '');
    vi.stubEnv('ICLOUD_APP_PASSWORD', '');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('pairs, connects Google by paste-back, and saves choices', async () => {
    const { app, deps, close } = createApp(
      loadConfig({ DATA_DIR: ':memory:', PUBLIC_URL: 'http://tower.local:8787' }),
    );
    const page = await app.request('/api/calendar/setup');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Calendars');
    expect((await app.request('/api/calendar/setup/state')).status).toBe(401);

    const { deviceKey } = (await (
      await app.request('/api/pair', {
        method: 'POST',
        body: JSON.stringify({ code: deps.auth.currentCode() }),
      })
    ).json()) as { deviceKey: string };
    const h = { 'x-mantel-device-key': deviceKey, 'content-type': 'application/json' };

    const state = (await (
      await app.request('/api/calendar/setup/state', { headers: h })
    ).json()) as {
      google: { configured: boolean; connected: boolean; pasteBack: boolean; redirectUri: string };
    };
    expect(state.google).toMatchObject({ configured: true, connected: false, pasteBack: true });

    const start = (await (
      await app.request('/api/calendar/google/start', { method: 'POST', headers: h })
    ).json()) as { url: string };
    const st = new URL(start.url).searchParams.get('state');
    const bad = await app.request('/api/calendar/google/callback?code=good-code&state=forged');
    expect(bad.status).toBe(400);

    const finish = await app.request('/api/calendar/google/finish', {
      method: 'POST',
      headers: h,
      body: JSON.stringify({
        url: `http://localhost:8787/api/calendar/google/callback?state=${st}&code=good-code&scope=x`,
      }),
    });
    expect(finish.status, await finish.clone().text()).toBe(200);
    const after = (await finish.json()) as {
      google: { connected: boolean; account: string };
      calendars: Array<{ id: string }>;
    };
    expect(after.google).toMatchObject({ connected: true, account: 'jay@example.com' });
    expect(after.calendars).toHaveLength(4);

    const save = await app.request('/api/calendar/setup/prefs', {
      method: 'POST',
      headers: h,
      body: JSON.stringify({
        calendars: { 'google:family@group.calendar.google.com': { enabled: false } },
        defaultCalendarId: 'google:jay@example.com',
      }),
    });
    expect(save.status).toBe(200);
    const boot = (await (await app.request('/api/bootstrap', { headers: h })).json()) as {
      calendars: Array<{ id: string }>;
    };
    expect(boot.calendars.map((c) => c.id)).toEqual([
      'google:jay@example.com',
      'google:meals@group.calendar.google.com',
    ]);

    const push = await app.request('/api/calendar/google/push', {
      method: 'POST',
      headers: { 'x-goog-channel-id': 'x' },
    });
    expect(push.status).toBe(200);
    close();
  });

  it('answers the contract routes in real mode', async () => {
    const { app, deps, close } = createApp(loadConfig({ DATA_DIR: ':memory:' }));
    const { deviceKey } = (await (
      await app.request('/api/pair', {
        method: 'POST',
        body: JSON.stringify({ code: deps.auth.currentCode() }),
      })
    ).json()) as { deviceKey: string };
    const h = { 'x-mantel-device-key': deviceKey };
    const q = `from=${encodeURIComponent(today.toISOString())}&to=${encodeURIComponent(addDays(today, 1).toISOString())}`;
    for (const path of [`/api/calendar?${q}`, '/api/countdowns', '/api/meals']) {
      const res = await app.request(path, { headers: h });
      expect(res.status, path).toBe(200);
    }
    const quick = await app.request('/api/calendar/quick', {
      method: 'POST',
      headers: { ...h, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'x', start: today.toISOString() }),
    });
    expect(quick.status).toBe(400);
    close();
  });
});
