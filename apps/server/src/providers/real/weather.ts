/**
 * Real weather: Open-Meteo forecast (48 hours, ten days, the moon) plus air quality, pollen and
 * NWS alerts, cached for 15 minutes (in memory and in SQLite, so a restart serves the last
 * snapshot at once). Once a display has asked, a timer refreshes every 15 minutes and pushes
 * `weather.updated`; a warning that just became active also pushes `weather.alert` and wakes
 * the displays. Other places (the sheet's search and saved places) get the same snapshot from
 * a small per-place cache. The daily quip comes from the library in `quips.ts`, or from Claude
 * when a key is set.
 */
import {
  WeatherSnapshotExtended,
  isUrgentAlert,
  weatherPrefsOf,
  type CalendarEvent,
  type WeatherAlertPayload,
  type WeatherPlace,
  type WeatherQuip,
} from '@mantel/shared';
import { kvGet, kvSet } from '../../db/index.js';
import { HttpError } from '../../errors.js';
import { log } from '../../log.js';
import { integrationValues, type ProviderContext, type WeatherProvider } from '../types.js';
import { realCommute } from './commute.js';
import { quipContext, quipSeed, selectQuip, writeQuipWithClaude } from './quips.js';
import type { Ws4Env } from './weather-env.js';
import {
  googlePollenUrl,
  normaliseGooglePollen,
  normaliseNws,
  nwsAlertsUrl,
  nwsHeaders,
} from './weather-extras.js';
import {
  AirQualityJson,
  ForecastJson,
  GeocodingJson,
  airQualityUrl,
  forecastUrl,
  geocodingUrl,
  normaliseAirQuality,
  normaliseForecast,
  normaliseGeocoding,
  parseCoordinates,
  type WeatherQuery,
} from './weather-openmeteo.js';
import { dateInZone } from './weather-time.js';

export const WEATHER_TTL_MS = 15 * 60_000;
/** Other places are looked at, not lived in: a longer cache and a small cap. */
export const PLACE_TTL_MS = 30 * 60_000;
const PLACE_CACHE_MAX = 24;
const SEARCH_TTL_MS = 24 * 60 * 60_000;
const KV_KEY = 'ws4.weather';
const KV_ALERTED = 'ws4.weather.alerted';
const KV_QUIP = 'ws4.weather.quip';

export interface WeatherOptions {
  env: Ws4Env;
  fetch?: typeof fetch;
}

interface Cached {
  /** Location, units and zone the snapshot was fetched for; a settings change refetches. */
  key: string;
  fetchedAt: number;
  snapshot: WeatherSnapshotExtended;
}

interface CachedQuip {
  /** `${date}:${personality}` the line was written for. */
  key: string;
  quip: WeatherQuip;
  /** When Claude was last tried and failed, so a broken key is retried hourly, not per request. */
  claudeFailedAt?: number;
}

export async function getJson(
  doFetch: typeof fetch,
  url: string,
  init: RequestInit = {},
): Promise<unknown> {
  const res = await doFetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(15_000) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${new URL(url).host} answered ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export function realWeather(
  ctx: ProviderContext,
  opts: WeatherOptions,
): WeatherProvider & { stop(): void } {
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  let cached: Cached | null = loadCached();
  let inflight: Promise<WeatherSnapshotExtended> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let pollenWarned = false;
  const places = new Map<string, Cached>();
  const searches = new Map<string, { at: number; places: WeatherPlace[] }>();
  let alerted = new Set<string>(kvGet<string[]>(ctx.db, KV_ALERTED) ?? []);
  let quipCache: CachedQuip | null = kvGet<CachedQuip>(ctx.db, KV_QUIP) ?? null;

  function loadCached(): Cached | null {
    const stored = kvGet<Cached>(ctx.db, KV_KEY);
    if (!stored) return null;
    const parsed = WeatherSnapshotExtended.safeParse(stored.snapshot);
    return parsed.success ? { ...stored, snapshot: parsed.data } : null;
  }

  function query(): WeatherQuery & { locationName: string } {
    const s = ctx.settings();
    return {
      latitude: s.location.latitude,
      longitude: s.location.longitude,
      timeZone: s.timezone,
      units: s.units,
      locationName: s.location.name,
    };
  }
  const keyOf = (q: WeatherQuery) => `${q.latitude},${q.longitude},${q.units},${q.timeZone}`;

  async function extras(q: WeatherQuery) {
    const [air, alerts] = await Promise.all([
      getJson(doFetch, airQualityUrl(q))
        .then((raw) => normaliseAirQuality(AirQualityJson.parse(raw)))
        .catch((err: unknown) => {
          log.warn('weather: air quality unavailable', { err: String(err) });
          return { airQuality: null, pollen: null };
        }),
      getJson(doFetch, nwsAlertsUrl(q.latitude, q.longitude), {
        headers: nwsHeaders(opts.env.NWS_CONTACT),
      })
        .then((raw) => normaliseNws(raw, ctx.now()))
        .catch((err: unknown) => {
          // Outside the US api.weather.gov has no data for the point; that is not worth a warning.
          log.debug('weather: NWS alerts unavailable', { err: String(err) });
          return [];
        }),
    ]);
    let pollen = air.pollen;
    const pollenKey = opts.env.GOOGLE_POLLEN_API_KEY ?? opts.env.GOOGLE_ROUTES_API_KEY;
    if (!pollen && pollenKey) {
      pollen = await getJson(doFetch, googlePollenUrl(q.latitude, q.longitude, pollenKey))
        .then(normaliseGooglePollen)
        .catch((err: unknown) => {
          // Usually the Pollen API is not enabled for the key; say so once.
          if (!pollenWarned)
            log.warn('weather: Google Pollen unavailable; pollen hidden', { err: String(err) });
          pollenWarned = true;
          return null;
        });
    }
    return { airQuality: air.airQuality, pollen, alerts };
  }

  /** Warnings that were not active at the last refresh wake the displays. */
  function announceAlerts(snapshot: WeatherSnapshotExtended) {
    const urgent = snapshot.alerts.filter(isUrgentAlert);
    const fresh = urgent.filter((a) => !alerted.has(a.id));
    // Keep only ids still active, so the store does not grow for ever.
    const active = new Set(snapshot.alerts.map((a) => a.id));
    alerted = new Set([...alerted].filter((id) => active.has(id)));
    for (const alert of fresh) alerted.add(alert.id);
    kvSet(ctx.db, KV_ALERTED, [...alerted]);
    for (const alert of fresh) {
      const payload: WeatherAlertPayload = { alert, locationName: snapshot.locationName };
      log.info('weather: alert', { event: alert.event, severity: alert.severity });
      ctx.emit({ type: 'weather.alert', payload });
      ctx.emit({ type: 'display.wake', payload: { reason: 'manual' } });
    }
  }

  async function refresh(): Promise<WeatherSnapshotExtended> {
    const q = query();
    const now = ctx.now();
    const [forecast, more] = await Promise.all([
      getJson(doFetch, forecastUrl(q)).then((raw) =>
        normaliseForecast(ForecastJson.parse(raw), { ...q, now }),
      ),
      extras(q),
    ]);
    const snapshot = WeatherSnapshotExtended.parse({ ...forecast, ...more });
    const first = cached === null;
    cached = { key: keyOf(q), fetchedAt: now.getTime(), snapshot };
    kvSet(ctx.db, KV_KEY, cached);
    ctx.markSynced('weather');
    // On the very first fetch after install, do not wake the house for a warning already running.
    if (first && alerted.size === 0) {
      alerted = new Set(snapshot.alerts.filter(isUrgentAlert).map((a) => a.id));
      kvSet(ctx.db, KV_ALERTED, [...alerted]);
    } else announceAlerts(snapshot);
    return snapshot;
  }

  function refreshOnce(): Promise<WeatherSnapshotExtended> {
    inflight ??= refresh().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  function startTimer() {
    if (timer) return;
    timer = setInterval(() => {
      refreshOnce()
        .then((weather) => ctx.emit({ type: 'weather.updated', payload: { weather } }))
        .catch((err: unknown) => log.warn('weather: refresh failed', { err: String(err) }));
    }, WEATHER_TTL_MS);
    timer.unref?.();
  }

  async function weather(): Promise<WeatherSnapshotExtended> {
    startTimer();
    const q = query();
    const fresh =
      cached && cached.key === keyOf(q) && ctx.now().getTime() - cached.fetchedAt < WEATHER_TTL_MS;
    if (fresh) return cached!.snapshot;
    try {
      return await refreshOnce();
    } catch (err) {
      // A stale snapshot beats an empty card; the display shows `updatedAt`.
      if (cached && cached.key === keyOf(q)) {
        log.warn('weather: upstream failed, serving the last snapshot', { err: String(err) });
        return cached.snapshot;
      }
      throw new HttpError('upstream_error', `weather unavailable: ${String(err)}`);
    }
  }

  /** Forecast plus air quality for another place. No alerts or pollen: those are for home. */
  async function place(req: { lat: number; lon: number; name?: string }) {
    const home = query();
    const s = ctx.settings();
    const saved = weatherPrefsOf(s).savedPlaces.find(
      (p) => Math.abs(p.latitude - req.lat) < 1e-4 && Math.abs(p.longitude - req.lon) < 1e-4,
    );
    const q: WeatherQuery & { locationName: string } = {
      latitude: req.lat,
      longitude: req.lon,
      units: home.units,
      // Open-Meteo resolves the place's own zone from `auto`; local days then line up there.
      timeZone: 'auto',
      locationName: req.name ?? saved?.name ?? `${req.lat.toFixed(2)}, ${req.lon.toFixed(2)}`,
    };
    const key = keyOf(q);
    const hit = places.get(key);
    const now = ctx.now();
    if (hit && now.getTime() - hit.fetchedAt < PLACE_TTL_MS) return hit.snapshot;
    try {
      const forecastRaw = await getJson(doFetch, forecastUrl(q));
      const json = ForecastJson.parse(forecastRaw);
      const zone = json.timezone && json.timezone !== 'auto' ? json.timezone : home.timeZone;
      const [forecast, air] = await Promise.all([
        normaliseForecast(json, { ...q, timeZone: zone, now }),
        getJson(doFetch, airQualityUrl({ ...q, timeZone: zone }))
          .then((raw) => normaliseAirQuality(AirQualityJson.parse(raw)))
          .catch(() => ({ airQuality: null, pollen: null })),
      ]);
      const snapshot = WeatherSnapshotExtended.parse({
        ...forecast,
        airQuality: air.airQuality,
        pollen: null,
        alerts: [],
      });
      if (places.size >= PLACE_CACHE_MAX) places.delete(places.keys().next().value!);
      places.set(key, { key, fetchedAt: now.getTime(), snapshot });
      return snapshot;
    } catch (err) {
      if (hit) return hit.snapshot;
      throw new HttpError('upstream_error', `weather for that place unavailable: ${String(err)}`);
    }
  }

  async function search(qText: string) {
    const text = qText.trim();
    const coords = parseCoordinates(text);
    const typed: WeatherPlace[] = coords
      ? [
          {
            id: `${coords.latitude.toFixed(4)},${coords.longitude.toFixed(4)}`,
            name: text,
            latitude: coords.latitude,
            longitude: coords.longitude,
          },
        ]
      : [];
    if (coords) return { places: typed };
    const key = text.toLowerCase();
    const hit = searches.get(key);
    const now = ctx.now().getTime();
    if (hit && now - hit.at < SEARCH_TTL_MS) return { places: hit.places };
    try {
      const raw = await getJson(doFetch, geocodingUrl(text));
      const found = normaliseGeocoding(GeocodingJson.parse(raw));
      if (searches.size >= 200) searches.delete(searches.keys().next().value!);
      searches.set(key, { at: now, places: found });
      return { places: found };
    } catch (err) {
      throw new HttpError('upstream_error', `place search unavailable: ${String(err)}`);
    }
  }

  async function quip(loadEvents: () => Promise<CalendarEvent[]>) {
    const s = ctx.settings();
    const personality = weatherPrefsOf(s).personality;
    if (personality === 'off') return { quip: null };
    const now = ctx.now();
    const snapshot = await weather();
    const ctxQ = quipContext(snapshot, now, s.timezone, personality);
    const day = dateInZone(now, s.timezone);
    const dayKey = `${day}:${personality}`;

    // One Claude line per day, when the quips integration is on with a key and the last try did
    // not fail within the hour.
    const quips = integrationValues(ctx, 'quips');
    const apiKey = quips.enabled ? quips.secrets.claudeApiKey : undefined;
    if (apiKey) {
      if (quipCache?.key === dayKey && quipCache.quip.source === 'claude')
        return { quip: quipCache.quip };
      const recentlyFailed =
        quipCache?.key === dayKey &&
        quipCache.claudeFailedAt !== undefined &&
        now.getTime() - quipCache.claudeFailedAt < 60 * 60_000;
      if (!recentlyFailed) {
        const events = await loadEvents().catch(() => []);
        const text = await writeQuipWithClaude({
          apiKey,
          weather: snapshot,
          events,
          personality,
          now,
          timeZone: s.timezone,
          fetch: doFetch,
        });
        if (text) {
          const line: WeatherQuip = {
            text,
            personality,
            source: 'claude',
            at: snapshot.updatedAt,
          };
          quipCache = { key: dayKey, quip: line };
          kvSet(ctx.db, KV_QUIP, quipCache);
          return { quip: line };
        }
        quipCache = {
          key: dayKey,
          quip: quipCache?.key === dayKey ? quipCache.quip : libraryQuip(),
          claudeFailedAt: now.getTime(),
        };
        kvSet(ctx.db, KV_QUIP, quipCache);
        return { quip: quipCache.quip };
      }
    }

    function libraryQuip(): WeatherQuip {
      return {
        text: selectQuip(ctxQ, quipSeed(ctxQ, now, s.timezone)),
        personality,
        source: 'library',
        at: snapshot.updatedAt,
      };
    }
    return { quip: libraryQuip() };
  }

  return {
    weather,
    place,
    search,
    quip,
    commute: realCommute(ctx, { env: opts.env, fetch: doFetch }),
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
