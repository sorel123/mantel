import { describe, expect, it } from 'vitest';
import { coordinatesFromQuery, createGeocoder, parseCoordinatePair } from './geocode.js';

describe('coordinates typed or pasted', () => {
  it('accepts the formats Google Maps hands out', () => {
    expect(parseCoordinatePair('47.6062, -122.3321')).toEqual({
      latitude: 47.6062,
      longitude: -122.3321,
    });
    expect(parseCoordinatePair('47.6062,-122.3321')).toEqual({
      latitude: 47.6062,
      longitude: -122.3321,
    });
    expect(parseCoordinatePair('(47.6062, -122.3321)')).toEqual({
      latitude: 47.6062,
      longitude: -122.3321,
    });
    expect(parseCoordinatePair('47.6062 -122.3321')).toEqual({
      latitude: 47.6062,
      longitude: -122.3321,
    });
    expect(parseCoordinatePair('Seattle')).toBeNull();
    expect(parseCoordinatePair('95, 10')).toBeNull();
  });

  it('pulls coordinates out of a Google Maps link', () => {
    expect(
      coordinatesFromQuery(
        'https://www.google.com/maps/place/Seattle/@47.6062,-122.3321,12z/data=x',
      ),
    ).toEqual({ latitude: 47.6062, longitude: -122.3321 });
    expect(coordinatesFromQuery('https://maps.google.com/?q=47.6062,-122.3321')).toEqual({
      latitude: 47.6062,
      longitude: -122.3321,
    });
    expect(
      coordinatesFromQuery('https://www.google.com/maps/search/?api=1&query=47.6062%2C-122.3321'),
    ).toEqual({
      latitude: 47.6062,
      longitude: -122.3321,
    });
  });
});

describe('geocoder', () => {
  const calls: string[] = [];
  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    const body = url.includes('geocoding-api')
      ? {
          results: [
            {
              name: 'Seattle',
              latitude: 47.6,
              longitude: -122.3,
              timezone: 'America/Los_Angeles',
              country: 'United States',
              admin1: 'Washington',
            },
            {
              name: 'Seattle',
              latitude: 33.5,
              longitude: -86.7,
              country: 'United States',
              admin1: 'Alabama',
            },
          ],
        }
      : { timezone: 'Europe/Paris' };
    return new Response(JSON.stringify(body));
  };
  const geo = createGeocoder({ fetch: fakeFetch, defaultTimezone: 'UTC' });

  it('names candidates and fills a missing timezone with the default', async () => {
    const out = await geo.search('Seattle');
    expect(out[0]).toMatchObject({
      name: 'Seattle, Washington, United States',
      timezone: 'America/Los_Angeles',
      admin: 'Washington',
    });
    expect(out[1]?.timezone).toBe('UTC');
    expect(calls.at(-1)).toContain('name=Seattle');
  });

  it('answers a pair locally and only asks for its timezone', async () => {
    calls.length = 0;
    const out = await geo.search('48.85, 2.35');
    expect(out).toEqual([
      { name: '48.8500, 2.3500', latitude: 48.85, longitude: 2.35, timezone: 'Europe/Paris' },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('api.open-meteo.com');
  });
});
