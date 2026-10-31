import { describe, expect, it } from 'vitest';
import {
  coordinatesFromQuery,
  createGeocoder,
  looksLikeAddress,
  parseCoordinatePair,
} from './geocode.js';

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

  it('sends street addresses to OpenStreetMap and names them street, town, state', async () => {
    const seen: string[] = [];
    const agents: (string | null)[] = [];
    const osm: typeof fetch = async (input, init) => {
      const url = String(input);
      seen.push(url);
      if (url.includes('nominatim')) {
        agents.push(new Headers(init?.headers).get('user-agent'));
        return new Response(
          JSON.stringify([
            {
              lat: '38.8977',
              lon: '-77.0365',
              display_name:
                '1600, Pennsylvania Avenue NW, Washington, District of Columbia, 20500, United States',
              address: {
                house_number: '1600',
                road: 'Pennsylvania Avenue NW',
                city: 'Washington',
                state: 'District of Columbia',
                country: 'United States',
              },
            },
          ]),
        );
      }
      return new Response(JSON.stringify({ timezone: 'America/New_York' }));
    };
    const out = await createGeocoder({ fetch: osm }).search('1600 Pennsylvania Ave, Washington DC');
    expect(out).toEqual([
      {
        name: '1600 Pennsylvania Avenue NW, Washington, District of Columbia',
        latitude: 38.8977,
        longitude: -77.0365,
        timezone: 'America/New_York',
        country: 'United States',
        admin: 'District of Columbia',
      },
    ]);
    expect(seen[0]).toContain('nominatim.openstreetmap.org');
    expect(seen.some((u) => u.includes('geocoding-api'))).toBe(false);
    expect(agents[0]).toMatch(/^mantel/);
  });

  it('falls back to the other service when the first finds nothing or fails', async () => {
    const seen: string[] = [];
    const flaky: typeof fetch = async (input) => {
      const url = String(input);
      seen.push(url);
      if (url.includes('nominatim')) return new Response('busy', { status: 503 });
      if (url.includes('geocoding-api'))
        return new Response(
          JSON.stringify({
            results: [
              {
                name: 'Tacoma',
                latitude: 47.25,
                longitude: -122.44,
                timezone: 'America/Los_Angeles',
              },
            ],
          }),
        );
      return new Response(JSON.stringify({ timezone: 'UTC' }));
    };
    const out = await createGeocoder({ fetch: flaky }).search('Tacoma, WA');
    expect(out[0]?.name).toBe('Tacoma');
    expect(seen.map((u) => new URL(u).host)).toEqual([
      'nominatim.openstreetmap.org',
      'geocoding-api.open-meteo.com',
    ]);

    const empty: typeof fetch = async (input) =>
      new Response(String(input).includes('nominatim') ? '[]' : JSON.stringify({}));
    await expect(createGeocoder({ fetch: empty }).search('Nowhere')).resolves.toEqual([]);
  });

  it('tells addresses from place names', () => {
    expect(looksLikeAddress('12 Main St')).toBe(true);
    expect(looksLikeAddress('Seattle, WA')).toBe(true);
    expect(looksLikeAddress('Seattle')).toBe(false);
  });
});
