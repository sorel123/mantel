/**
 * Leave-by times from the Google Routes API for each configured destination, from home
 * (`settings.location`). A destination shows on its days from three hours before its
 * arrive-by time until that time; traffic is re-checked every five minutes.
 * https://developers.google.com/maps/documentation/routes/compute_route_directions
 */
import type { Destination, LeaveBy } from '@mantel/shared';
import { z } from 'zod';
import { log } from '../../log.js';
import type { ProviderContext, WeatherProvider } from '../types.js';
import type { Ws4Env } from './weather-env.js';
import { clockMinutes, isoInZone, zoned } from './weather-time.js';

export const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
/** How long before arrive-by a destination's chip appears. */
export const WINDOW_MINUTES = 180;
const ROUTE_TTL_MS = 5 * 60_000;

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

export function realCommute(
  ctx: ProviderContext,
  opts: CommuteOptions,
): WeatherProvider['commute'] {
  const trips = new Map<string, { at: number; trip: Trip }>();
  let warnedNoKey = false;

  async function route(dest: Destination, key: string): Promise<Trip> {
    const hit = trips.get(dest.id);
    const now = ctx.now().getTime();
    if (hit && now - hit.at < ROUTE_TTL_MS) return hit.trip;
    const { location } = ctx.settings();
    const res = await opts.fetch(ROUTES_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': key,
        'x-goog-fieldmask': 'routes.duration,routes.staticDuration',
      },
      body: JSON.stringify({
        origin: {
          location: { latLng: { latitude: location.latitude, longitude: location.longitude } },
        },
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
    const trip = {
      durationSeconds,
      staticSeconds: Number.isFinite(staticSeconds) ? staticSeconds : durationSeconds,
    };
    trips.set(dest.id, { at: now, trip });
    return trip;
  }

  return async () => {
    const s = ctx.settings();
    if (!s.flags.commute) return { leaveBy: [] };
    const active = activeDestinations(s.destinations, ctx.now(), s.timezone);
    if (!active.length) return { leaveBy: [] };
    const key = opts.env.GOOGLE_ROUTES_API_KEY;
    if (!key) {
      if (!warnedNoKey) log.warn('commute: GOOGLE_ROUTES_API_KEY is not set; no leave-by times');
      warnedNoKey = true;
      return { leaveBy: [] };
    }

    const results = await Promise.all(
      active.map(async ({ dest, arriveBy }): Promise<LeaveBy | null> => {
        try {
          const trip = await route(dest, key);
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
