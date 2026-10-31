/**
 * Calls the settings page makes beside the typed `api.call`: WS2's calendar setup JSON (outside
 * the route table) and the Google sign-in, which workstream A moves from `/calendar/google/*` to
 * `/integrations/google/*`. The new route is tried first and the old one second, so the page
 * works against today's server, A's server and the mock.
 */
import {
  ApiRequestError,
  DEVICE_KEY_HEADER,
  type GeocodeCandidate,
  type HealthDetails,
  type ResponseOf,
} from '@mantel/shared';
import { api, getStoredKey } from '../../lib/api';
import type { CalendarPrefs, CalendarSetupState } from './contract';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A JSON call to a path outside the route table, with the device key. */
export async function raw<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  const key = getStoredKey();
  if (key) headers[DEVICE_KEY_HEADER] = key;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const err = json as { error?: { code?: string; message?: string } } | null;
    throw new ApiRequestError(
      res.status,
      err?.error?.code ?? 'internal',
      err?.error?.message ?? `${method} ${path} failed (${res.status})`,
    );
  }
  return json as T;
}

/** The server does not have this route (yet): 404, 405 or 501. */
export const isMissing = (err: unknown) =>
  err instanceof ApiRequestError && [404, 405, 501].includes(err.status);

/** Try the new route, and if the server does not have it yet, the old one. */
export async function either<T>(first: () => Promise<T>, second: () => Promise<T>): Promise<T> {
  try {
    return await first();
  } catch (err) {
    if (!isMissing(err)) throw err;
    return second();
  }
}

/** Human text for an error from any of these calls. */
export const errorText = (err: unknown) =>
  err instanceof ApiRequestError
    ? err.message
    : err instanceof Error
      ? err.message
      : 'Could not reach the server';

/* ---- Google sign-in: A's routes first, WS2's second ---- */

export const googleAuthorizeUrl = (): Promise<ResponseOf<'integrationAuthorizeUrl'>> =>
  either(
    () => api.call('integrationAuthorizeUrl', { params: { id: 'google' } }),
    () =>
      raw<{ url: string; redirectUri: string }>('POST', '/calendar/google/start').then((r) => ({
        ...r,
        pasteBack: true,
      })),
  );

export const googleFinish = (url: string) =>
  either(
    () =>
      api
        .call('integrationCallback', { params: { id: 'google' }, body: { url } })
        .then(() => undefined),
    () => raw<unknown>('POST', '/calendar/google/finish', { url }).then(() => undefined),
  );

export const googleDisconnect = () =>
  either(
    () =>
      api
        .call('integrationPut', {
          params: { id: 'google' },
          body: { secrets: { refreshToken: null } },
        })
        .then(() => undefined),
    () => raw<unknown>('POST', '/calendar/google/disconnect').then(() => undefined),
  );

/* ---- calendar picker (WS2's JSON, kept) ---- */

export const calendarSetupState = () => raw<CalendarSetupState>('GET', '/calendar/setup/state');
export const saveCalendarPrefs = (prefs: CalendarPrefs) =>
  raw<CalendarSetupState>('POST', '/calendar/setup/prefs', prefs);
export const syncCalendars = () => raw<CalendarSetupState>('POST', '/calendar/sync');

/* ---- health: A's details, or today's `/api/health` shaped like them ---- */

export const getHealthDetails = (): Promise<HealthDetails> =>
  either(
    () => api.call('healthDetails'),
    async () => {
      const h = await api.call('health');
      return {
        version: h.version,
        mock: h.mock,
        uptimeSeconds: h.uptimeSeconds,
        firstRun: false,
        pinSet: false,
        publicUrl: location.origin,
        integrations: [],
        logTail: [],
        lastSync: h.lastSync,
      };
    },
  );

/* ---- geocoding: the server (A), or Open-Meteo straight from the browser ---- */

export async function geocode(query: string): Promise<GeocodeCandidate[]> {
  return either(
    () => api.call('geocode', { body: { query } }).then((r) => r.candidates),
    async () => {
      const url = `https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&name=${encodeURIComponent(query)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('The place lookup is not reachable right now');
      const data = (await res.json()) as {
        results?: Array<{
          name: string;
          latitude: number;
          longitude: number;
          timezone: string;
          admin1?: string;
          country?: string;
        }>;
      };
      return (data.results ?? []).map((r) => ({
        name: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
        latitude: r.latitude,
        longitude: r.longitude,
        timezone: r.timezone,
        admin: r.admin1,
        country: r.country,
      }));
    },
  );
}
