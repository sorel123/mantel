/**
 * Leave-by times for each configured destination, from home (`settings.location`). A destination
 * shows on its days from three hours before its arrive-by time until that time.
 *
 * With a Google Routes key, trips follow live traffic and are re-checked every five minutes.
 * Without one, `commute-routers.ts` geocodes the address (Nominatim) and asks OSRM or
 * OpenRouteService for the typical drive time, cached for an hour, with `traffic: false`.
 * https://developers.google.com/maps/documentation/routes/compute_route_directions
 */
import type { Destination, LeaveBy } from '@mantel/shared';
import { z } from 'zod';
import { kvGet, kvSet } from '../../db/index.js';
import { log } from '../../log.js';
import type { ProviderContext, WeatherProvider } from '../types.js';
import {
  commuteStatus,
  nominatimUrl,
  normaliseNominatim,
  normaliseOrs,
  normaliseOsrm,
  orsUrl,
  osmHeaders,
  osrmUrl,
  parseLatLon,
  type LatLon,
} from './commute-routers.js';
import type { Ws4Env } from './weather-env.js';
import { clockMinutes, isoInZone, zoned } from './weather-time.js';

export { commuteStatus } from './commute-routers.js';

export const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
/** How long before arrive-by a destination's chip appears. */
export const WINDOW_MINUTES = 180;
/** Traffic-aware trips go stale fast; typical drive times barely change. */
const TRAFFIC_TTL_MS = 5 * 60_000;
const STATIC_TTL_MS = 60 * 60_000;
const GEOCODE_KEY = 'ws4.geocode';

const RoutesJson = z.object({
  routes: z
    .array(z.object({ duration: z.string().optional(), staticDuration: z.string().optional() }))
    .optional(),
});

/** `"845s"` to seconds. */
const seconds = (s: string | undefined) => (s ? Number.parseFloat(s) : Number.NaN);

export interface CommuteOptions {
  env: Ws4Env;
  fetch: typeof fetch;
}

interface Trip {
  durationSeconds: number;
  staticSeconds: number;
  traffic: boolean;
}

/** Destinations whose window is open at `now`, with their arrive-by instant. */
export function activeDestinations(
  destinations: Destination[],
  now: Date,
  timeZone: string,
): Array<{ dest: Destination; arriveBy: Date }> {
  const z = zoned(now, timeZone);
  const nowMinutes = z.hour * 60 + z.minute;
  const minuteStart = now.getTime() - z.second * 1000 - now.getMilliseconds();
  return destinations.flatMap((dest) => {
    if (!dest.days.includes(z.weekday)) return [];
    const arrive = clockMinutes(dest.arriveBy);
    if (nowMinutes < arrive - WINDOW_MINUTES || nowMinutes >= arrive) return [];
    return [{ dest, arriveBy: new Date(minuteStart + (arrive - nowMinutes) * 60_000) }];
  });
}

async function getJson(doFetch: typeof fetch, url: string, init: RequestInit = {}) {
  const res = await doFetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${new URL(url).host} answered ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<unknown>;
}

export function realCommute(
  ctx: ProviderContext,
  opts: CommuteOptions,
): WeatherProvider['commute'] {
  const { env } = opts;
  const status = commuteStatus(env);
  const trips = new Map<string, { at: number; trip: Trip }>();
  let announced = false;

  const home = (): LatLon => {
    const { location } = ctx.settings();
    return { latitude: location.latitude, longitude: location.longitude };
  };

  async function googleRoute(dest: Destination, key: string): Promise<Trip> {
    const from = home();
    const res = await opts.fetch(ROUTES_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': key,
        'x-goog-fieldmask': 'routes.duration,routes.staticDuration',
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: from.latitude, longitude: from.longitude } } },
        destination: { address: dest.address },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Routes API answered ${res.status}: ${await res.text()}`);
    const first = RoutesJson.parse(await res.json()).routes?.[0];
    const durationSeconds = seconds(first?.duration);
    if (!Number.isFinite(durationSeconds)) throw new Error(`no route to ${dest.name}`);
    const staticSeconds = seconds(first?.staticDuration);
    return {
      durationSeconds,
      staticSeconds: Number.isFinite(staticSeconds) ? staticSeconds : durationSeconds,
      traffic: true,
    };
  }

  /** The destination's point: pasted coordinates, a remembered lookup, or Nominatim once. */
  async function geocode(dest: Destination): Promise<LatLon> {
    const typed = parseLatLon(dest.address);
    if (typed) return typed;
    const address = dest.address.trim();
    const store = kvGet<Record<string, LatLon>>(ctx.db, GEOCODE_KEY) ?? {};
    const known = store[address];
    if (known) return known;
    const found = normaliseNominatim(
      await getJson(opts.fetch, nominatimUrl(env.NOMINATIM_BASE_URL, address), {
        headers: osmHeaders(env.NWS_CONTACT),
      }),
    );
    if (!found) throw new Error(`"${address}" was not found on the map; try pasting coordinates`);
    kvSet(ctx.db, GEOCODE_KEY, { ...store, [address]: found });
    return found;
  }

  async function keylessRoute(dest: Destination): Promise<Trip> {
    const [from, to] = [home(), await geocode(dest)];
    const durationSeconds =
      status.source === 'openrouteservice'
        ? normaliseOrs(
            await getJson(opts.fetch, orsUrl(from, to), {
              headers: { accept: 'application/json', authorization: env.OPENROUTESERVICE_API_KEY! },
            }),
          )
        : normaliseOsrm(await getJson(opts.fetch, osrmUrl(env.OSRM_BASE_URL, from, to)));
    return { durationSeconds, staticSeconds: durationSeconds, traffic: false };
  }

  async function route(dest: Destination): Promise<Trip> {
    const hit = trips.get(dest.id);
    const now = ctx.now().getTime();
    const ttl = status.traffic ? TRAFFIC_TTL_MS : STATIC_TTL_MS;
    if (hit && now - hit.at < ttl) return hit.trip;
    const trip = env.GOOGLE_ROUTES_API_KEY
      ? await googleRoute(dest, env.GOOGLE_ROUTES_API_KEY)
      : await keylessRoute(dest);
    trips.set(dest.id, { at: now, trip });
    return trip;
  }

  return async () => {
    const s = ctx.settings();
    if (!s.flags.commute) return { leaveBy: [] };
    const active = activeDestinations(s.destinations, ctx.now(), s.timezone);
    if (!active.length) return { leaveBy: [] };
    if (!announced) log.info(`commute: ${status.summary}`);
    announced = true;

    const results = await Promise.all(
      active.map(async ({ dest, arriveBy }): Promise<LeaveBy | null> => {
        try {
          const trip = await route(dest);
          return {
            destinationId: dest.id,
            name: dest.name,
            leaveBy: isoInZone(
              new Date(arriveBy.getTime() - trip.durationSeconds * 1000),
              s.timezone,
            ),
            arriveBy: isoInZone(arriveBy, s.timezone),
            durationMinutes: Math.round(trip.durationSeconds / 60),
            delayMinutes: Math.max(0, Math.round((trip.durationSeconds - trip.staticSeconds) / 60)),
            traffic: trip.traffic,
            personIds: dest.personIds,
          };
        } catch (err) {
          log.warn(`commute: ${dest.name} unavailable`, { err: String(err) });
          return null;
        }
      }),
    );
    const leaveBy = results.filter((r): r is LeaveBy => r !== null);
    if (leaveBy.length) ctx.markSynced('commute');
    return { leaveBy: leaveBy.sort((a, b) => a.leaveBy.localeCompare(b.leaveBy)) };
  };
}
