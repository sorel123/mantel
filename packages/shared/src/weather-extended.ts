/**
 * Workstream D: the extended weather contract. Adds to `WeatherSnapshot` without renaming
 * anything: 48 hours with per-hour detail, ten days with wind and rain totals, the moon, and
 * the coordinates the snapshot is for. Plus the new routes: forecasts for other places, place
 * search, and the daily quip. Every new field is optional so older snapshots still parse.
 */
import { z } from 'zod';
import {
  Id,
  IsoDateTime,
  WeatherAlert,
  WeatherDay,
  WeatherHour,
  WeatherSnapshot,
} from './models.js';

/* ---------- hourly and daily detail ---------- */

export const WeatherHourDetail = WeatherHour.extend({
  /** Rain or melted snow in the hour, in the snapshot's units (inches or millimetres). */
  precipAmount: z.number().nonnegative().optional(),
  windSpeed: z.number().nonnegative().optional(),
  windGust: z.number().nonnegative().optional(),
  /** Degrees, 0 = from the north. */
  windDirection: z.number().min(0).max(360).optional(),
  humidity: z.number().min(0).max(100).optional(),
  dewPoint: z.number().optional(),
  /** Surface pressure in hPa. */
  pressure: z.number().nonnegative().optional(),
  /** Visibility in the snapshot's units (miles or kilometres). */
  visibility: z.number().nonnegative().optional(),
  uv: z.number().nonnegative().optional(),
});
export type WeatherHourDetail = z.infer<typeof WeatherHourDetail>;

export const WeatherDayDetail = WeatherDay.extend({
  /** Words for the day's sky: "Showers", "Mostly sunny". */
  summary: z.string().optional(),
  windMax: z.number().nonnegative().optional(),
  /** Rain plus melted snow over the day, in the snapshot's units. */
  precipSum: z.number().nonnegative().optional(),
  /** Hours of daylight. */
  daylightHours: z.number().nonnegative().optional(),
});
export type WeatherDayDetail = z.infer<typeof WeatherDayDetail>;

export const MoonPhaseName = z.enum([
  'new',
  'waxing_crescent',
  'first_quarter',
  'waxing_gibbous',
  'full',
  'waning_gibbous',
  'last_quarter',
  'waning_crescent',
]);
export type MoonPhaseName = z.infer<typeof MoonPhaseName>;

export const MoonPhase = z.object({
  phase: MoonPhaseName,
  /** 0 = new, 0.5 = full, approaching 1 = new again. */
  fraction: z.number().min(0).max(1),
  /** Lit part of the disc, 0 to 100. */
  illumination: z.number().min(0).max(100),
  label: z.string(),
});
export type MoonPhase = z.infer<typeof MoonPhase>;

export const Coordinates = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type Coordinates = z.infer<typeof Coordinates>;

/** `WeatherSnapshot` with the detail the weather sheet shows. This is what `/weather` returns. */
export const WeatherSnapshotExtended = WeatherSnapshot.extend({
  /** Up to 48 hours, starting with the next whole hour. */
  hourly: z.array(WeatherHourDetail),
  /** Today plus up to nine days. */
  daily: z.array(WeatherDayDetail),
  moon: MoonPhase.optional(),
  coordinates: Coordinates.optional(),
  timezone: z.string().optional(),
});
export type WeatherSnapshotExtended = z.infer<typeof WeatherSnapshotExtended>;

/* ---------- places ---------- */

export const WeatherPlace = z.object({
  /** Stable id, `${lat},${lon}` rounded to four places. */
  id: Id,
  name: z.string(),
  /** State or region, when known. */
  region: z.string().optional(),
  country: z.string().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  timezone: z.string().optional(),
});
export type WeatherPlace = z.infer<typeof WeatherPlace>;

/**
 * A place saved from the weather sheet; lives in `settings.weather.savedPlaces`. Same shape as
 * workstream A's `SavedPlace` in the Settings schema, under a name that does not collide with it.
 */
export const WeatherSavedPlace = z.object({
  name: z.string().min(1).max(60),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type WeatherSavedPlace = z.infer<typeof WeatherSavedPlace>;

export const WeatherPlaceQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  /** What to call the place in the snapshot. */
  name: z.string().max(80).optional(),
});
export const WeatherSearchQuery = z.object({ q: z.string().min(1).max(120) });
export const WeatherSearchResponse = z.object({ places: z.array(WeatherPlace) });

/* ---------- quips ---------- */

export const QuipPersonality = z.enum(['off', 'friendly', 'snarky']);
export type QuipPersonality = z.infer<typeof QuipPersonality>;

export const WeatherQuip = z.object({
  text: z.string(),
  personality: QuipPersonality,
  /** Hand-written library line or one written by Claude from today's forecast and events. */
  source: z.enum(['library', 'claude']),
  /** When this line was chosen. */
  at: IsoDateTime,
});
export type WeatherQuip = z.infer<typeof WeatherQuip>;

/** `quip` is null when the personality is off. */
export const WeatherQuipResponse = z.object({ quip: WeatherQuip.nullable() });

/**
 * What this workstream reads from `settings.weather` (workstream A's `WeatherSettings` schema),
 * with defaults so the display and server work before those fields exist in a saved settings row.
 */
export const WeatherPrefs = z.object({
  savedPlaces: z.array(WeatherSavedPlace).default([]),
  personality: QuipPersonality.default('friendly'),
  newsJokes: z.boolean().default(false),
});
export type WeatherPrefs = z.infer<typeof WeatherPrefs>;

/** Read `settings.weather` from any settings object, filling defaults. */
export function weatherPrefsOf(settings: unknown): WeatherPrefs {
  const raw = (settings as { weather?: unknown } | null | undefined)?.weather;
  const parsed = WeatherPrefs.safeParse(raw ?? {});
  return parsed.success
    ? parsed.data
    : { savedPlaces: [], personality: 'friendly', newsJokes: false };
}

/* ---------- alerts over the socket ---------- */

/** Payload of `weather.alert`: a warning (not a watch) that just became active. */
export const WeatherAlertPayload = z.object({ alert: WeatherAlert, locationName: z.string() });
export type WeatherAlertPayload = z.infer<typeof WeatherAlertPayload>;

/**
 * Which alerts wake the display: severe or extreme ones whose event is a warning. Watches,
 * advisories and statements stay in the card and the sheet.
 */
export function isUrgentAlert(alert: z.infer<typeof WeatherAlert>): boolean {
  if (alert.severity !== 'severe' && alert.severity !== 'extreme') return false;
  return /\bwarning\b/i.test(alert.event) || alert.severity === 'extreme';
}

/* ---------- moon maths ---------- */

const SYNODIC_MONTH = 29.530588853;
/** A known new moon: 2000-01-06 18:14 UTC. */
const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);

const MOON_LABELS: Record<MoonPhaseName, string> = {
  new: 'New moon',
  waxing_crescent: 'Waxing crescent',
  first_quarter: 'First quarter',
  waxing_gibbous: 'Waxing gibbous',
  full: 'Full moon',
  waning_gibbous: 'Waning gibbous',
  last_quarter: 'Last quarter',
  waning_crescent: 'Waning crescent',
};

/** Phase of the moon at `at`, from the mean synodic month (good to about a day). */
export function moonPhaseAt(at: Date): MoonPhase {
  const days = (at.getTime() - KNOWN_NEW_MOON) / 86_400_000;
  const fraction = (((days % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH) / SYNODIC_MONTH;
  const illumination = Math.round(((1 - Math.cos(fraction * 2 * Math.PI)) / 2) * 100);
  // Eight phases; the four principal ones each get a window of about 1.8 days.
  const edge = 0.0625 / 2;
  let phase: MoonPhaseName;
  if (fraction < edge || fraction >= 1 - edge) phase = 'new';
  else if (fraction < 0.25 - edge) phase = 'waxing_crescent';
  else if (fraction < 0.25 + edge) phase = 'first_quarter';
  else if (fraction < 0.5 - edge) phase = 'waxing_gibbous';
  else if (fraction < 0.5 + edge) phase = 'full';
  else if (fraction < 0.75 - edge) phase = 'waning_gibbous';
  else if (fraction < 0.75 + edge) phase = 'last_quarter';
  else phase = 'waning_crescent';
  return { phase, fraction, illumination, label: MOON_LABELS[phase] };
}

/** `${lat},${lon}` to four places, the id of a place. */
export const placeId = (lat: number, lon: number) => `${lat.toFixed(4)},${lon.toFixed(4)}`;
