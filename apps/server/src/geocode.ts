/**
 * Turn what a person types for "where is home" into coordinates, a timezone and a name.
 * A pasted "47.6062, -122.3321" is answered locally (the timezone comes from Open-Meteo);
 * anything else goes to Open-Meteo's free geocoder.
 * https://open-meteo.com/en/docs/geocoding-api
 */
import type { GeocodeCandidate } from '@mantel/shared';
import { z } from 'zod';

export const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const TIMEZONE_URL = 'https://api.open-meteo.com/v1/forecast';

const PAIR = /^\s*\(?\s*(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*\)?\s*$/;

/** `"47.6062, -122.3321"` (also with a space or semicolon, or in parentheses) → the pair, or null. */
export function parseCoordinatePair(query: string): { latitude: number; longitude: number } | null {
  const m = query.match(PAIR);
  if (!m) return null;
  const latitude = Number(m[1]);
  const longitude = Number(m[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

/** Also accepts a Google Maps link, which carries `@lat,lng` or `?q=lat,lng`. */
export function coordinatesFromQuery(query: string) {
  const direct = parseCoordinatePair(query);
  if (direct) return direct;
  const at = query.match(/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/);
  if (at) return parseCoordinatePair(`${at[1]},${at[2]}`);
  const q =
    query.match(/[?&](?:q|query|ll)=(-?\d{1,2}\.\d+)%2C(-?\d{1,3}\.\d+)/i) ??
    query.match(/[?&](?:q|query|ll)=(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/i);
  if (q) return parseCoordinatePair(`${q[1]},${q[2]}`);
  return null;
}

const SearchJson = z.object({
  results: z
    .array(
      z.object({
        name: z.string(),
        latitude: z.number(),
        longitude: z.number(),
        timezone: z.string().optional(),
        country: z.string().optional(),
        admin1: z.string().optional(),
      }),
    )
    .optional(),
});

const TimezoneJson = z.object({ timezone: z.string() });

export interface GeocoderOptions {
  fetch?: typeof fetch;
  /** Fallback when Open-Meteo gives no timezone (a pair in the ocean). */
  defaultTimezone?: string;
}

export function createGeocoder(opts: GeocoderOptions = {}) {
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  async function getJson(url: string): Promise<unknown> {
    const res = await doFetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
    return res.json();
  }

  async function timezoneFor(latitude: number, longitude: number): Promise<string> {
    try {
      const q = new URLSearchParams({
        latitude: String(latitude),
        longitude: String(longitude),
        timezone: 'auto',
        forecast_days: '1',
        daily: 'sunrise',
      });
      return TimezoneJson.parse(await getJson(`${TIMEZONE_URL}?${q}`)).timezone;
    } catch {
      return opts.defaultTimezone ?? 'UTC';
    }
  }

  return {
    async search(query: string): Promise<GeocodeCandidate[]> {
      const pair = coordinatesFromQuery(query);
      if (pair) {
        return [
          {
            name: `${pair.latitude.toFixed(4)}, ${pair.longitude.toFixed(4)}`,
            ...pair,
            timezone: await timezoneFor(pair.latitude, pair.longitude),
          },
        ];
      }
      const q = new URLSearchParams({ name: query, count: '6', language: 'en', format: 'json' });
      const json = SearchJson.parse(await getJson(`${GEOCODE_URL}?${q}`));
      return (json.results ?? []).map((r) => ({
        name: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
        latitude: r.latitude,
        longitude: r.longitude,
        timezone: r.timezone ?? opts.defaultTimezone ?? 'UTC',
        ...(r.country ? { country: r.country } : {}),
        ...(r.admin1 ? { admin: r.admin1 } : {}),
      }));
    },
  };
}
export type Geocoder = ReturnType<typeof createGeocoder>;
