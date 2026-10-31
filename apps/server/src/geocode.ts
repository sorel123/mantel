/**
 * Turn what a person types for "where is home" into coordinates, a timezone and a name.
 * A pasted "47.6062, -122.3321" is answered locally (the timezone comes from Open-Meteo).
 * Open-Meteo's free geocoder only knows place names ("Seattle"), so a street address or a
 * "Town, ST" query goes to OpenStreetMap's Nominatim first, and either service backs up
 * the other when it finds nothing.
 * https://open-meteo.com/en/docs/geocoding-api · https://nominatim.org/release-docs/latest/api/Search/
 */
import type { GeocodeCandidate } from '@mantel/shared';
import { z } from 'zod';

export const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
/** Nominatim's usage policy asks for a User-Agent that names the app and a contact. */
const NOMINATIM_AGENT = 'mantel (https://github.com/sorel123/mantel)';
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

const NominatimJson = z.array(
  z.object({
    lat: z.coerce.number(),
    lon: z.coerce.number(),
    display_name: z.string(),
    name: z.string().optional(),
    address: z.record(z.string(), z.string()).optional(),
  }),
);

const TimezoneJson = z.object({ timezone: z.string() });

/** A house number, a postcode or a comma: Open-Meteo's name search won't match it. */
export function looksLikeAddress(query: string): boolean {
  return /\d/.test(query) || query.includes(',');
}

type NominatimHit = z.infer<typeof NominatimJson>[number];

/** "1600 Pennsylvania Avenue NW, Washington, District of Columbia" from Nominatim's parts. */
function nominatimName(hit: NominatimHit): string {
  const a = hit.address;
  if (!a) return hit.display_name;
  const street = [a.house_number, a.road].filter(Boolean).join(' ');
  const town = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.suburb ?? a.county;
  const parts = [street || hit.name, town, a.state].filter(
    (p, i, all): p is string => !!p && all.indexOf(p) === i,
  );
  return parts.length > 0 ? parts.join(', ') : hit.display_name;
}

export interface GeocoderOptions {
  fetch?: typeof fetch;
  /** Fallback when Open-Meteo gives no timezone (a pair in the ocean). */
  defaultTimezone?: string;
}

export function createGeocoder(opts: GeocoderOptions = {}) {
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  async function getJson(url: string, headers?: Record<string, string>): Promise<unknown> {
    const res = await doFetch(url, { signal: AbortSignal.timeout(10_000), headers });
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

  async function searchOpenMeteo(query: string): Promise<GeocodeCandidate[]> {
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
  }

  async function searchNominatim(query: string): Promise<GeocodeCandidate[]> {
    const q = new URLSearchParams({
      q: query,
      format: 'jsonv2',
      limit: '5',
      addressdetails: '1',
      'accept-language': 'en',
    });
    const hits = NominatimJson.parse(
      await getJson(`${NOMINATIM_URL}?${q}`, {
        accept: 'application/json',
        'user-agent': NOMINATIM_AGENT,
      }),
    );
    // Nominatim has no timezones; ask Open-Meteo once per distinct rounded spot.
    const zones = new Map<string, Promise<string>>();
    const zoneFor = (lat: number, lon: number) => {
      const key = `${lat.toFixed(1)},${lon.toFixed(1)}`;
      if (!zones.has(key)) zones.set(key, timezoneFor(lat, lon));
      return zones.get(key)!;
    };
    return Promise.all(
      hits.map(async (h) => {
        const country = h.address?.country;
        const admin = h.address?.state;
        return {
          name: nominatimName(h),
          latitude: h.lat,
          longitude: h.lon,
          timezone: await zoneFor(h.lat, h.lon),
          ...(country ? { country } : {}),
          ...(admin ? { admin } : {}),
        };
      }),
    );
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
      const ordered = looksLikeAddress(query)
        ? [() => searchNominatim(query), () => searchOpenMeteo(query)]
        : [() => searchOpenMeteo(query), () => searchNominatim(query)];
      let lastError: unknown = null;
      for (const run of ordered) {
        try {
          const found = await run();
          if (found.length > 0) return found;
        } catch (err) {
          lastError = err;
        }
      }
      if (lastError) throw lastError;
      return [];
    },
  };
}
export type Geocoder = ReturnType<typeof createGeocoder>;
