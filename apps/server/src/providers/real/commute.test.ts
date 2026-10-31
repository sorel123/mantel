import { CommuteResponse } from '@mantel/shared';
import { settings as defaultSettings } from '@mantel/shared/fixtures';
import { describe, expect, it } from 'vitest';
import { activeDestinations, realCommute } from './commute.js';
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
        personIds: ['sam', 'leo'],
      },
      {
        destinationId: 'dest-office',
        name: 'Office',
        leaveBy: '2026-11-02T08:28:00-08:00',
        arriveBy: '2026-11-02T09:00:00-08:00',
        durationMinutes: 32,
        delayMinutes: 7,
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

  it('is empty without a key, outside the window, or with the flag off', async () => {
    const fetch = routes();
    const noKey = realCommute(testContext(MONDAY_710), { env: loadWs4Env({}), fetch });
    expect(await noKey()).toEqual({ leaveBy: [] });

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
