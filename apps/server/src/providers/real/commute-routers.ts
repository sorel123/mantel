/**
 * Drive times without a Google key. Destinations are geocoded once with Nominatim (OpenStreetMap,
 * no key; a pasted "47.6062, -122.3321" skips the lookup) and routed with OSRM (the public demo
 * server by default, or your own) or OpenRouteService when its free key is set. Neither knows
 * live traffic, so trips from here carry `traffic: false`. Google Routes stays the upgrade.
 */
import { z } from 'zod';
import { VERSION } from '../../version.js';
import type { Ws4Env } from './weather-env.js';

export interface LatLon {
  latitude: number;
  longitude: number;
}

export type CommuteSource = 'google' | 'openrouteservice' | 'osrm';

export interface CommuteStatus {
  source: CommuteSource;
  /** Whether leave-by times include live traffic. */
  traffic: boolean;
  /** One line for the Settings integration card. */
  summary: string;
}

/** Which router the env selects: Google when its key is set, else OpenRouteService, else OSRM. */
export function commuteStatus(env: Ws4Env): CommuteStatus {
  if (env.GOOGLE_ROUTES_API_KEY)
    return { source: 'google', traffic: true, summary: 'Google Routes with live traffic' };
  if (env.OPENROUTESERVICE_API_KEY)
    return {
      source: 'openrouteservice',
      traffic: false,
      summary: 'OpenRouteService, typical drive times (no live traffic)',
    };
  return {
    source: 'osrm',
    traffic: false,
    summary: `OSRM at ${new URL(env.OSRM_BASE_URL).host}, typical drive times (no live traffic). Add a Google Routes key for traffic.`,
  };
}

/* ---------- coordinates typed or pasted ---------- */

const COORDS = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

/** "47.6062, -122.3321" (as Google Maps copies it) to a point; null for anything else. */
export function parseLatLon(text: string): LatLon | null {
  const m = COORDS.exec(text);
  if (!m) return null;
  const latitude = Number(m[1]);
  const longitude = Number(m[2]);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

/* ---------- Nominatim geocoding ---------- */

const NominatimJson = z.array(z.object({ lat: z.coerce.number(), lon: z.coerce.number() }));

export function nominatimUrl(base: string, query: string): string {
  const u = new URL('/search', base);
  u.searchParams.set('q', query);
  u.searchParams.set('format', 'jsonv2');
  u.searchParams.set('limit', '1');
  return u.toString();
}

/** Nominatim's usage policy asks for a User-Agent that identifies the app and a contact. */
export function osmHeaders(contact: string): Record<string, string> {
  return { accept: 'application/json', 'user-agent': `mantel/${VERSION} (${contact})` };
}

/** The first match, or null when the address is unknown. */
export function normaliseNominatim(raw: unknown): LatLon | null {
  const first = NominatimJson.parse(raw)[0];
  return first ? { latitude: first.lat, longitude: first.lon } : null;
}

/* ---------- OSRM ---------- */

const OsrmJson = z.object({
  code: z.string(),
  message: z.string().optional(),
  routes: z.array(z.object({ duration: z.number() })).optional(),
});

export function osrmUrl(base: string, from: LatLon, to: LatLon): string {
  const path = `/route/v1/driving/${from.longitude},${from.latitude};${to.longitude},${to.latitude}`;
  const u = new URL(path, base);
  u.searchParams.set('overview', 'false');
  return u.toString();
}

/** Drive time in seconds from an OSRM `route` answer. */
export function normaliseOsrm(raw: unknown): number {
  const json = OsrmJson.parse(raw);
  const duration = json.routes?.[0]?.duration;
  if (json.code !== 'Ok' || duration === undefined)
    throw new Error(`OSRM: ${json.message ?? json.code}`);
  return duration;
}

/* ---------- OpenRouteService ---------- */

export const ORS_URL = 'https://api.openrouteservice.org/v2/directions/driving-car';

const OrsJson = z.object({
  features: z
    .array(z.object({ properties: z.object({ summary: z.object({ duration: z.number() }) }) }))
    .optional(),
  error: z.object({ message: z.string().optional() }).optional(),
});

export function orsUrl(from: LatLon, to: LatLon): string {
  const u = new URL(ORS_URL);
  u.searchParams.set('start', `${from.longitude},${from.latitude}`);
  u.searchParams.set('end', `${to.longitude},${to.latitude}`);
  return u.toString();
}

/** Drive time in seconds from an OpenRouteService directions answer. */
export function normaliseOrs(raw: unknown): number {
  const json = OrsJson.parse(raw);
  const duration = json.features?.[0]?.properties.summary.duration;
  if (duration === undefined)
    throw new Error(`OpenRouteService: ${json.error?.message ?? 'no route'}`);
  return duration;
}
