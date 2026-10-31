import { CommuteResponse } from '@mantel/shared';
import { settings as defaultSettings } from '@mantel/shared/fixtures';
import { describe, expect, it } from 'vitest';
import {
  activeDestinations,
  commuteStatus,
  eventStops,
  realCommute,
  routableLocation,
} from './commute.js';
import type { CalendarEvent } from '@mantel/shared';
import {
  normaliseNominatim,
  normaliseOrs,
  normaliseOsrm,
  orsUrl,
  osrmUrl,
  parseLatLon,
} from './commute-routers.js';
import { loadWs4Env } from './weather-env.js';
import { fakeFetch, json, testContext } from './weather-testing.js';

const TZ = 'America/Los_Angeles';
// Monday 2 November 2026, 7:10:30 am Pacific (PST).
const MONDAY_710 = new Date('2026-11-02T15:10:30Z');
const destinations = defaultSettings().destinations;

const routes = () =>
  fakeFetch((url, init) => {
    if (url.host !== 'routes.googleapis.com') return undefined;
    const body = JSON.parse(String(init?.body));
    return body.destination.address === '123 Lincoln Ave'
      ? json({ routes: [{ duration: '840s', staticDuration: '660s' }] })
      : json({ routes: [{ duration: '1920s', staticDuration: '1500s' }] });
  });

describe('commute window', () => {
  it('opens three hours before arrive-by on the destination days', () => {
    const at = (iso: string) =>
      activeDestinations(destinations, new Date(iso), TZ).map((a) => a.dest.id);
    expect(at('2026-11-02T15:10:30Z')).toEqual(['dest-school', 'dest-office']);
    // 4:54 am: school (7:55) not open yet.
    expect(at('2026-11-02T12:54:00Z')).toEqual([]);
    // 7:55 am: school closes at its arrive-by time.
    expect(at('2026-11-02T15:55:00Z')).toEqual(['dest-office']);
    // Friday: the office is Monday to Thursday only.
    expect(at('2026-11-06T15:10:00Z')).toEqual(['dest-school']);
    // Saturday.
    expect(at('2026-11-07T15:10:00Z')).toEqual([]);
  });

  it('works out the arrive-by instant in the household zone', () => {
    const [school] = activeDestinations(destinations, MONDAY_710, TZ);
    expect(school!.arriveBy.toISOString()).toBe('2026-11-02T15:55:00.000Z');
  });
});

describe('real commute', () => {
  it('turns route durations into leave-by times', async () => {
    const ctx = testContext(MONDAY_710);
    const fetch = routes();
    const commute = realCommute(ctx, { env: loadWs4Env({ GOOGLE_ROUTES_API_KEY: 'k' }), fetch });
    const res = CommuteResponse.parse(await commute());
    expect(res.leaveBy).toEqual([
      {
        destinationId: 'dest-school',
        name: 'Lincoln Elementary',
        leaveBy: '2026-11-02T07:41:00-08:00',
        arriveBy: '2026-11-02T07:55:00-08:00',
        durationMinutes: 14,
        delayMinutes: 3,
        traffic: true,
        personIds: ['sam', 'leo'],
      },
      {
        destinationId: 'dest-office',
        name: 'Office',
        leaveBy: '2026-11-02T08:28:00-08:00',
        arriveBy: '2026-11-02T09:00:00-08:00',
        durationMinutes: 32,
        delayMinutes: 7,
        traffic: true,
        personIds: ['jay'],
      },
    ]);
    const [, init] = fetch.mock.calls[0]!;
    expect((init!.headers as Record<string, string>)['x-goog-api-key']).toBe('k');
    expect(JSON.parse(String(init!.body)).origin.location.latLng.latitude).toBe(37.7749);

    // Re-asked within five minutes, traffic is not re-fetched.
    await commute();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(ctx.markSynced).toHaveBeenCalledWith('commute');
  });

  it('is empty outside the window or with the flag off', async () => {
    const fetch = routes();
    const evening = realCommute(testContext(new Date('2026-11-02T03:00:00Z')), {
      env: loadWs4Env({ GOOGLE_ROUTES_API_KEY: 'k' }),
      fetch,
    });
    expect(await evening()).toEqual({ leaveBy: [] });

    const flags = { ...defaultSettings().flags, commute: false };
    const off = realCommute(testContext(MONDAY_710, { flags }), {
      env: loadWs4Env({ GOOGLE_ROUTES_API_KEY: 'k' }),
      fetch,
    });
    expect(await off()).toEqual({ leaveBy: [] });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('drops a destination whose route fails', async () => {
    const fetch = fakeFetch((_url, init) =>
      JSON.parse(String(init?.body)).destination.address === '123 Lincoln Ave'
        ? new Response('quota', { status: 429 })
        : json({ routes: [{ duration: '1800s' }] }),
    );
    const commute = realCommute(testContext(MONDAY_710), {
      env: loadWs4Env({ GOOGLE_ROUTES_API_KEY: 'k' }),
      fetch,
    });
    const { leaveBy } = await commute();
    expect(leaveBy.map((l) => [l.name, l.delayMinutes])).toEqual([['Office', 0]]);
  });
});

/* ---------- without a Google key ---------- */

/** An OSRM demo server that knows the drive time to each `lon,lat` destination. */
const osrm = (seconds: Record<string, number>) => (url: URL) => {
  if (url.host !== 'router.project-osrm.org') return undefined;
  const to = url.pathname.split(';')[1]!;
  const duration = seconds[to];
  return duration === undefined
    ? json({ code: 'NoRoute', message: 'Impossible route between points' }, 400)
    : json({ code: 'Ok', routes: [{ duration, distance: 1 }] });
};

/** Nominatim knowing the two fixture addresses. */
const nominatim = (url: URL) => {
  if (url.host !== 'nominatim.openstreetmap.org') return undefined;
  const q = url.searchParams.get('q');
  if (q === '123 Lincoln Ave') return json([{ lat: '37.7849', lon: '-122.4094', name: 'x' }]);
  if (q === '500 Market St') return json([{ lat: '37.7935', lon: '-122.3950' }]);
  return json([]);
};

describe('router mapping', () => {
  it('reads pasted coordinates the way Google Maps copies them', () => {
    expect(parseLatLon('47.6062, -122.3321')).toEqual({ latitude: 47.6062, longitude: -122.3321 });
    expect(parseLatLon(' -33.8688 151.2093 ')).toEqual({ latitude: -33.8688, longitude: 151.2093 });
    expect(parseLatLon('123 Lincoln Ave')).toBeNull();
    expect(parseLatLon('95, 10')).toBeNull();
  });

  it('builds OSRM and OpenRouteService requests as lon,lat', () => {
    const from = { latitude: 37.7749, longitude: -122.4194 };
    const to = { latitude: 37.7849, longitude: -122.4094 };
    expect(osrmUrl('https://router.project-osrm.org', from, to)).toBe(
      'https://router.project-osrm.org/route/v1/driving/-122.4194,37.7749;-122.4094,37.7849?overview=false',
    );
    expect(osrmUrl('http://osrm.local:5000/', from, to)).toMatch(
      /^http:\/\/osrm\.local:5000\/route\/v1\/driving\//,
    );
    const ors = new URL(orsUrl(from, to));
    expect(ors.host).toBe('api.openrouteservice.org');
    expect(ors.searchParams.get('start')).toBe('-122.4194,37.7749');
    expect(ors.searchParams.get('end')).toBe('-122.4094,37.7849');
  });

  it('takes the first route duration and explains a missing one', () => {
    expect(normaliseOsrm({ code: 'Ok', routes: [{ duration: 845.3 }, { duration: 900 }] })).toBe(
      845.3,
    );
    expect(() => normaliseOsrm({ code: 'NoRoute', message: 'Impossible route' })).toThrow(
      'Impossible route',
    );
    expect(normaliseOrs({ features: [{ properties: { summary: { duration: 1920 } } }] })).toBe(
      1920,
    );
    expect(() => normaliseOrs({ error: { message: 'Could not find routable point' } })).toThrow(
      'routable point',
    );
    expect(normaliseNominatim([{ lat: '37.1', lon: '-122.2' }])).toEqual({
      latitude: 37.1,
      longitude: -122.2,
    });
    expect(normaliseNominatim([])).toBeNull();
  });

  it('reports which router the keys select', () => {
    expect(commuteStatus(loadWs4Env({ GOOGLE_ROUTES_API_KEY: 'k' }))).toMatchObject({
      source: 'google',
      traffic: true,
    });
    expect(commuteStatus(loadWs4Env({ OPENROUTESERVICE_API_KEY: 'o' }))).toMatchObject({
      source: 'openrouteservice',
      traffic: false,
    });
    const osrmStatus = commuteStatus(loadWs4Env({}));
    expect(osrmStatus).toMatchObject({ source: 'osrm', traffic: false });
    expect(osrmStatus.summary).toContain('router.project-osrm.org');
  });
});

describe('keyless commute', () => {
  it('geocodes once, routes with OSRM and marks the trip traffic-free', async () => {
    const ctx = testContext(MONDAY_710);
    const fetch = fakeFetch(
      nominatim,
      osrm({ '-122.4094,37.7849': 840, '-122.395,37.7935': 1920 }),
    );
    const commute = realCommute(ctx, { env: loadWs4Env({}), fetch });
    const res = CommuteResponse.parse(await commute());
    expect(res.leaveBy).toEqual([
      {
        destinationId: 'dest-school',
        name: 'Lincoln Elementary',
        leaveBy: '2026-11-02T07:41:00-08:00',
        arriveBy: '2026-11-02T07:55:00-08:00',
        durationMinutes: 14,
        delayMinutes: 0,
        traffic: false,
        personIds: ['sam', 'leo'],
      },
      {
        destinationId: 'dest-office',
        name: 'Office',
        leaveBy: '2026-11-02T08:28:00-08:00',
        arriveBy: '2026-11-02T09:00:00-08:00',
        durationMinutes: 32,
        delayMinutes: 0,
        traffic: false,
        personIds: ['jay'],
      },
    ]);
    const hosts = fetch.mock.calls.map(([u]) => new URL(String(u)).host);
    expect(hosts.filter((h) => h === 'nominatim.openstreetmap.org')).toHaveLength(2);
    expect(hosts.filter((h) => h === 'router.project-osrm.org')).toHaveLength(2);
    const [, init] = fetch.mock.calls[0]!;
    expect((init!.headers as Record<string, string>)['user-agent']).toMatch(
      /^mantel\/.* \(https:\/\/github\.com\/sorel123\/mantel\)$/,
    );

    // Typical times are kept for an hour; geocodes are remembered in the database for good.
    ctx.setNow(new Date(MONDAY_710.getTime() + 20 * 60_000));
    await commute();
    expect(fetch).toHaveBeenCalledTimes(4);
    // 8:11: the school's window has closed; the office is routed again, with no geocode.
    ctx.setNow(new Date(MONDAY_710.getTime() + 61 * 60_000));
    await commute();
    const again = fetch.mock.calls.slice(4).map(([u]) => new URL(String(u)).host);
    expect(again).toEqual(['router.project-osrm.org']);
  });

  it('skips geocoding for pasted coordinates and drops an unknown address', async () => {
    const destinations = defaultSettings().destinations.map((d) =>
      d.id === 'dest-school'
        ? { ...d, address: '37.7849, -122.4094' }
        : { ...d, address: 'Nowhere Lane' },
    );
    const fetch = fakeFetch(nominatim, osrm({ '-122.4094,37.7849': 600 }));
    const commute = realCommute(testContext(MONDAY_710, { destinations }), {
      env: loadWs4Env({}),
      fetch,
    });
    const { leaveBy } = await commute();
    expect(leaveBy.map((l) => [l.name, l.durationMinutes, l.traffic])).toEqual([
      ['Lincoln Elementary', 10, false],
    ]);
    const hosts = fetch.mock.calls.map(([u]) => new URL(String(u)).host);
    expect(hosts.filter((h) => h === 'nominatim.openstreetmap.org')).toHaveLength(1);
  });

  it('prefers OpenRouteService when its key is set', async () => {
    const fetch = fakeFetch(nominatim, (url, init) => {
      if (url.host !== 'api.openrouteservice.org') return undefined;
      expect((init!.headers as Record<string, string>).authorization).toBe('ors-key');
      return json({ features: [{ properties: { summary: { duration: 1500 } } }] });
    });
    const commute = realCommute(testContext(MONDAY_710), {
      env: loadWs4Env({ OPENROUTESERVICE_API_KEY: 'ors-key' }),
      fetch,
    });
    const { leaveBy } = await commute();
    expect(leaveBy.map((l) => [l.name, l.durationMinutes, l.traffic])).toEqual([
      ['Lincoln Elementary', 25, false],
      ['Office', 25, false],
    ]);
  });

  it('uses a self-hosted OSRM when its URL is set', async () => {
    const fetch = fakeFetch(nominatim, (url) =>
      url.host === 'osrm.home:5000' ? json({ code: 'Ok', routes: [{ duration: 300 }] }) : undefined,
    );
    const commute = realCommute(testContext(MONDAY_710), {
      env: loadWs4Env({ OSRM_BASE_URL: 'http://osrm.home:5000' }),
      fetch,
    });
    expect((await commute()).leaveBy.map((l) => l.durationMinutes)).toEqual([5, 5]);
  });
});

describe('leave-by from event addresses', () => {
  const ev = (id: string, start: string, location?: string, extra: Partial<CalendarEvent> = {}) =>
    ({
      id,
      calendarId: 'cal',
      title: id,
      start,
      end: start,
      allDay: false,
      personIds: ['jay'],
      color: '#000000',
      ...(location ? { location } : {}),
      ...extra,
    }) as CalendarEvent;

  it('routes addresses, not meeting links or rooms', () => {
    expect(routableLocation('42 Elm St, Springfield')).toBe('42 Elm St, Springfield');
    expect(routableLocation('Lakeside Park, Seattle')).toBe('Lakeside Park, Seattle');
    expect(routableLocation('47.61, -122.33')).toBe('47.61, -122.33');
    expect(routableLocation('Zoom')).toBeNull();
    expect(routableLocation('Kitchen')).toBeNull();
    expect(routableLocation('https://meet.google.com/abc-defg')).toBeNull();
    expect(routableLocation('Microsoft Teams Meeting, room 4')).toBeNull();
    expect(routableLocation(undefined)).toBeNull();
  });

  it('opens three hours before the start and skips saved destinations', () => {
    const stops = eventStops(
      [
        ev('dentist', '2026-11-02T10:00:00-08:00', '42 Elm St, Springfield'),
        ev('later', '2026-11-02T18:00:00-08:00', '42 Elm St, Springfield'),
        ev('started', '2026-11-02T07:00:00-08:00', '42 Elm St, Springfield'),
        ev('office', '2026-11-02T09:00:00-08:00', '500 Market St'),
        ev('allday', '2026-11-02T00:00:00-08:00', '42 Elm St, Springfield', { allDay: true }),
      ],
      MONDAY_710,
      destinations,
    );
    expect(stops.map((s) => s.eventId)).toEqual(['dentist']);
    expect(stops[0]!.dest).toMatchObject({ name: 'dentist', personIds: ['jay'] });
  });

  it('adds a chip tied to the event, and stays quiet about unknown addresses', async () => {
    const ctx = testContext(MONDAY_710, { destinations: [] });
    const fetch = fakeFetch(
      (url) => {
        if (url.host !== 'nominatim.openstreetmap.org') return undefined;
        return url.searchParams.get('q') === '42 Elm St, Springfield'
          ? json([{ lat: '37.70', lon: '-122.40' }])
          : json([]);
      },
      osrm({ '-122.4,37.7': 1200 }),
    );
    const commute = realCommute(ctx, { env: loadWs4Env({}), fetch });
    const events = async () => [
      ev('Dentist', '2026-11-02T10:00:00-08:00', '42 Elm St, Springfield'),
      ev('Party', '2026-11-02T09:30:00-08:00', '1 Nowhere Rd, Atlantis'),
    ];
    const { leaveBy } = CommuteResponse.parse(await commute(events));
    expect(leaveBy).toEqual([
      expect.objectContaining({
        name: 'Dentist',
        eventId: 'Dentist',
        leaveBy: '2026-11-02T09:40:00-08:00',
        arriveBy: '2026-11-02T10:00:00-08:00',
        durationMinutes: 20,
        traffic: false,
      }),
    ]);
    const before = fetch.mock.calls.length;
    await commute(events);
    // The trip is cached and the unknown address is not looked up again within the hour.
    expect(fetch.mock.calls.length).toBe(before);
  });
});
