/**
 * Real weather: Open-Meteo forecast plus air quality, pollen and NWS alerts, cached for
 * 15 minutes (in memory and in SQLite, so a restart serves the last snapshot at once).
 * Once a display has asked, a timer refreshes every 15 minutes and pushes `weather.updated`.
 */
import { WeatherSnapshot } from '@mantel/shared';
import { kvGet, kvSet } from '../../db/index.js';
import { HttpError } from '../../errors.js';
import { log } from '../../log.js';
import type { ProviderContext, WeatherProvider } from '../types.js';
import { realCommute } from './commute.js';
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
  airQualityUrl,
  forecastUrl,
  normaliseAirQuality,
  normaliseForecast,
  type WeatherQuery,
} from './weather-openmeteo.js';

export const WEATHER_TTL_MS = 15 * 60_000;
const KV_KEY = 'ws4.weather';

export interface WeatherOptions {
  env: Ws4Env;
  fetch?: typeof fetch;
}

interface Cached {
  /** Location, units and zone the snapshot was fetched for; a settings change refetches. */
  key: string;
  fetchedAt: number;
  snapshot: WeatherSnapshot;
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
  let inflight: Promise<WeatherSnapshot> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let pollenWarned = false;

  function loadCached(): Cached | null {
    const stored = kvGet<Cached>(ctx.db, KV_KEY);
    if (!stored) return null;
    const parsed = WeatherSnapshot.safeParse(stored.snapshot);
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

  async function refresh(): Promise<WeatherSnapshot> {
    const q = query();
    const now = ctx.now();
    const [forecast, more] = await Promise.all([
      getJson(doFetch, forecastUrl(q)).then((raw) =>
        normaliseForecast(ForecastJson.parse(raw), { ...q, now }),
      ),
      extras(q),
    ]);
    const snapshot = WeatherSnapshot.parse({ ...forecast, ...more });
    cached = { key: keyOf(q), fetchedAt: now.getTime(), snapshot };
    kvSet(ctx.db, KV_KEY, cached);
    ctx.markSynced('weather');
    return snapshot;
  }

  function refreshOnce(): Promise<WeatherSnapshot> {
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

  return {
    async weather() {
      startTimer();
      const q = query();
      const fresh =
        cached &&
        cached.key === keyOf(q) &&
        ctx.now().getTime() - cached.fetchedAt < WEATHER_TTL_MS;
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
    },
    commute: realCommute(ctx, { env: opts.env, fetch: doFetch }),
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
