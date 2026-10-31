import { CommuteResponse } from '@mantel/shared';
import { settings as defaultSettings } from '@mantel/shared/fixtures';
import { describe, expect, it } from 'vitest';
import { activeDestinations, commuteStatus, realCommute } from './commute.js';
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
