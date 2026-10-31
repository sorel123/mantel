import { WeatherSnapshotExtended, type Settings } from '@mantel/shared';
import { describe, expect, it } from 'vitest';
import { realWeather, WEATHER_TTL_MS } from './weather.js';
import { loadWs4Env } from './weather-env.js';
import { normaliseGooglePollen, normaliseNws } from './weather-extras.js';
import {
  describeCode,
  forecastUrl,
  geocodingUrl,
  normaliseAirQuality,
  normaliseGeocoding,
  parseCoordinates,
  pollenLevel,
  uvCategory,
} from './weather-openmeteo.js';
import { dateInZone, isoInZone } from './weather-time.js';
import { fakeFetch, json, testContext } from './weather-testing.js';

const TZ = 'America/Los_Angeles';
// 7:20 am Pacific on Saturday 31 October 2026; clocks go back on 1 November.
const NOW = new Date('2026-10-31T14:20:00Z');
const MIDNIGHT = Date.UTC(2026, 9, 31, 7) / 1000;

/** An Open-Meteo forecast response in the shape `timeformat=unixtime` returns. */
function forecastJson() {
  const hours = Array.from({ length: 7 * 24 + 1 }, (_, i) => MIDNIGHT + i * 3600);
  // Local midnights: 7:00 UTC before the change, 8:00 UTC after.
  const days = Array.from({ length: 7 }, (_, i) => MIDNIGHT + i * 86400 + (i >= 2 ? 3600 : 0));
  return {
    latitude: 37.77,
    longitude: -122.42,
    utc_offset_seconds: -25200,
    current: {
      time: NOW.getTime() / 1000 - 300,
      interval: 900,
      temperature_2m: 53.6,
      apparent_temperature: 51.2,
      relative_humidity_2m: 62,
      is_day: 1,
      weather_code: 2,
      wind_speed_10m: 6.8,
    },
    hourly: {
      time: hours,
      temperature_2m: hours.map((_, i) => 50 + (i % 10)),
      weather_code: hours.map((_, i) => (i % 24 >= 18 ? 61 : 2)),
      is_day: hours.map((_, i) => (i % 24 >= 7 && i % 24 < 18 ? 1 : 0)),
      precipitation_probability: hours.map((_, i) => (i === 7 ? 20 : i % 24 >= 18 ? 70 : null)),
      uv_index: hours.map((_, i) => (i === 7 ? 0.4 : 3.2)),
      precipitation: hours.map((_, i) => (i % 24 >= 18 ? 0.123 : 0)),
      wind_speed_10m: hours.map((_, i) => 4 + (i % 5)),
      wind_gusts_10m: hours.map((_, i) => 9 + (i % 5)),
      wind_direction_10m: hours.map(() => 225),
      relative_humidity_2m: hours.map(() => 61.4),
      dew_point_2m: hours.map(() => 40.6),
      surface_pressure: hours.map(() => 1013.7),
      visibility: hours.map(() => 16093.44),
    },
    daily: {
      time: days,
      weather_code: [2, 61, 3, 0, 0, 2, 63],
      temperature_2m_max: [61.2, 58, 55, 60, 63, 59, 52],
      temperature_2m_min: [44.4, 42, 40, 43, 46, 45, 39],
      precipitation_probability_max: [40, 80, 30, 5, 0, 15, null],
      sunrise: days.map((d) => d + 7 * 3600 + 22 * 60),
      sunset: days.map((d) => d + 17 * 3600 + 58 * 60),
      uv_index_max: [3.16, 1, 2, 4, 4, 3, 1],
      wind_speed_10m_max: [12.4, 18, 9, 7, 6, 11, 22],
      precipitation_sum: [0, 0.35, 0, 0, 0, 0, 0.8],
      daylight_duration: days.map(() => 38160),
    },
  };
}

const geocodingJson = {
  results: [
    {
      name: 'Seattle',
      latitude: 47.60621,
      longitude: -122.33207,
      country: 'United States',
      admin1: 'Washington',
      timezone: 'America/Los_Angeles',
      population: 737015,
    },
    { name: 'Seattle', latitude: 47.60621, longitude: -122.33207, country: 'United States' },
    {
      name: 'Seattle Hill-Silver Firs',
      latitude: 47.8679,
      longitude: -122.1536,
      country: 'United States',
    },
  ],
};

const airJson = (pollen: number | null) => ({
  current: {
    us_aqi: 32,
    alder_pollen: pollen,
    birch_pollen: pollen === null ? null : pollen * 2,
    olive_pollen: null,
    grass_pollen: pollen,
    mugwort_pollen: null,
    ragweed_pollen: pollen,
  },
});

const nwsJson = {
  features: [
    {
      properties: {
        id: 'urn:oid:2.49.0.1.840.0.1',
        event: 'Wind Advisory',
        severity: 'Moderate',
        headline: 'Wind Advisory until 6 PM PDT',
        description: 'Gusts up to 45 mph.\n',
        onset: '2026-10-31T09:00:00-07:00',
        ends: '2026-10-31T18:00:00-07:00',
      },
    },
    {
      properties: {
        id: 'urn:oid:2.49.0.1.840.0.2',
        event: 'Red Flag Warning',
        severity: 'Severe',
        headline: null,
        description: 'Critical fire weather.',
        effective: '2026-10-31T06:00:00-07:00',
        ends: null,
        expires: '2026-11-01T06:00:00-07:00',
      },
    },
    {
      properties: {
        id: 'old',
        event: 'Frost Advisory',
        severity: 'Minor',
        onset: '2026-10-30T01:00:00-07:00',
        ends: '2026-10-30T09:00:00-07:00',
      },
    },
  ],
};

function upstream(opts: { pollen?: number | null; failForecast?: boolean } = {}) {
  return fakeFetch(
    (url) =>
      url.host === 'api.open-meteo.com'
        ? opts.failForecast
          ? new Response('busy', { status: 503 })
          : json(forecastJson())
        : undefined,
    (url) =>
      url.host === 'air-quality-api.open-meteo.com'
        ? json(airJson(opts.pollen === undefined ? 20 : opts.pollen))
        : undefined,
    (url) => (url.host === 'api.weather.gov' ? json(nwsJson) : undefined),
    (url) => (url.host === 'geocoding-api.open-meteo.com' ? json(geocodingJson) : undefined),
    (url) =>
      url.host === 'pollen.googleapis.com'
        ? json({
            dailyInfo: [
              {
                pollenTypeInfo: [
                  { code: 'GRASS', indexInfo: { value: 2 } },
                  { code: 'TREE', indexInfo: { value: 4 } },
                  { code: 'WEED' },
                ],
              },
            ],
          })
        : undefined,
  );
}

describe('household timezone helpers', () => {
  it('formats with the zone offset either side of the DST change', () => {
    expect(isoInZone(NOW, TZ)).toBe('2026-10-31T07:20:00-07:00');
    expect(isoInZone(new Date('2026-11-02T16:00:00Z'), TZ)).toBe('2026-11-02T08:00:00-08:00');
    expect(dateInZone(new Date('2026-11-01T06:30:00Z'), TZ)).toBe('2026-10-31');
  });
});

describe('Open-Meteo mapping', () => {
  it('maps WMO codes, day words and wind', () => {
    expect(describeCode(0, { isDay: true })).toEqual({ condition: 'clear', summary: 'Sunny' });
    expect(describeCode(0)).toEqual({ condition: 'clear', summary: 'Clear' });
    expect(describeCode(66).condition).toBe('sleet');
    expect(describeCode(81).condition).toBe('rain');
    expect(describeCode(99).condition).toBe('storm');
    expect(describeCode(2, { windSpeed: 30, units: 'imperial' })).toEqual({
      condition: 'wind',
      summary: 'Windy',
    });
    expect(describeCode(2, { windSpeed: 30, units: 'metric' }).condition).toBe('partly');
    expect(describeCode(63, { windSpeed: 40 }).condition).toBe('rain');
    expect(describeCode(1234).condition).toBe('clear');
  });

  it('bands UV and pollen', () => {
    expect([0, 3, 6, 8, 11].map(uvCategory)).toEqual([
      'Low',
      'Moderate',
      'High',
      'Very high',
      'Extreme',
    ]);
    expect(pollenLevel('grass', 0)).toBe('none');
    expect(pollenLevel('grass', 6)).toBe('moderate');
    expect(pollenLevel('tree', 6)).toBe('low');
    expect(pollenLevel('weed', 600)).toBe('very_high');
  });

  it('asks for units and the household zone', () => {
    const url = new URL(
      forecastUrl({ latitude: 1, longitude: 2, timeZone: TZ, units: 'imperial' }),
    );
    expect(url.searchParams.get('temperature_unit')).toBe('fahrenheit');
    expect(url.searchParams.get('timezone')).toBe(TZ);
    expect(url.searchParams.get('timeformat')).toBe('unixtime');
    const metric = new URL(
      forecastUrl({ latitude: 1, longitude: 2, timeZone: TZ, units: 'metric' }),
    );
    expect(metric.searchParams.get('temperature_unit')).toBeNull();
  });

  it('reads geocoding results and pasted coordinates', () => {
    const places = normaliseGeocoding(geocodingJson);
    expect(places).toHaveLength(2);
    expect(places[0]).toMatchObject({
      id: '47.6062,-122.3321',
      name: 'Seattle',
      region: 'Washington',
      country: 'United States',
      timezone: 'America/Los_Angeles',
    });
    expect(new URL(geocodingUrl('Sea')).searchParams.get('name')).toBe('Sea');
    expect(parseCoordinates('47.6062, -122.3321')).toEqual({
      latitude: 47.6062,
      longitude: -122.3321,
    });
    expect(parseCoordinates('Seattle')).toBeNull();
    expect(parseCoordinates('95, 10')).toBeNull();
  });

  it('treats all-null pollen as no pollen data', () => {
    expect(normaliseAirQuality(airJson(null))).toEqual({
      airQuality: { aqi: 32, category: 'Good' },
      pollen: null,
    });
  });
});

describe('extras', () => {
  it('keeps active NWS alerts, most severe first', () => {
    const alerts = normaliseNws(nwsJson, NOW);
    expect(alerts.map((a) => a.event)).toEqual(['Red Flag Warning', 'Wind Advisory']);
    expect(alerts[0]).toMatchObject({
      severity: 'severe',
      headline: 'Red Flag Warning',
      starts: '2026-10-31T06:00:00-07:00',
      ends: '2026-11-01T06:00:00-07:00',
    });
    expect(alerts[1]!.description).toBe('Gusts up to 45 mph.');
  });

  it('reads the Google pollen index', () => {
    expect(normaliseGooglePollen({ dailyInfo: [] })).toBeNull();
    expect(
      normaliseGooglePollen({
        dailyInfo: [{ pollenTypeInfo: [{ code: 'TREE', indexInfo: { value: 5 } }] }],
      }),
    ).toEqual({ tree: 'very_high', grass: 'none', weed: 'none' });
  });
});

describe('real weather provider', () => {
  it('builds a snapshot within the contract', async () => {
    const ctx = testContext(NOW);
    const fetch = upstream();
    const w = await realWeather(ctx, { env: loadWs4Env({}), fetch }).weather();
    expect(() => WeatherSnapshotExtended.parse(w)).not.toThrow();
    expect(w.current).toMatchObject({
      temp: 54,
      feelsLike: 51,
      condition: 'partly',
      summary: 'Partly cloudy',
      isDay: true,
      precipChance: 20,
    });
    expect(w.hourly).toHaveLength(48);
    expect(w.hourly[0]!.time).toBe('2026-10-31T08:00:00-07:00');
    expect(w.hourly[0]).toMatchObject({
      windSpeed: 4 + (8 % 5),
      windDirection: 225,
      humidity: 61,
      dewPoint: 41,
      pressure: 1014,
      visibility: 10,
      precipAmount: 0,
    });
    expect(w.hourly.find((h) => h.time.startsWith('2026-10-31T18'))!.precipAmount).toBe(0.12);
    expect(w.daily[0]).toMatchObject({
      windMax: 12,
      precipSum: 0,
      daylightHours: 10.6,
      summary: 'Partly cloudy',
    });
    expect(w.daily[1]).toMatchObject({ precipSum: 0.35, summary: 'Light rain' });
    expect(w.moon?.phase).toBeDefined();
    expect(w.coordinates).toEqual({ latitude: 37.7749, longitude: -122.4194 });
    expect(w.timezone).toBe(TZ);
    expect(w.hourly.find((h) => h.time.startsWith('2026-10-31T18'))!.condition).toBe('rain');
    expect(w.daily.map((d) => d.date)).toEqual([
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
    ]);
    expect(w.daily[0]).toMatchObject({ high: 61, low: 44, uvMax: 3.2 });
    expect(w.daily[2]!.sunrise).toBe('2026-11-02T07:22:00-08:00');
    expect(w.sunrise).toBe('2026-10-31T07:22:00-07:00');
    expect(w.uv).toEqual({ index: 0, category: 'Low' });
    expect(w.airQuality).toEqual({ aqi: 32, category: 'Good' });
    expect(w.pollen).toEqual({ tree: 'moderate', grass: 'high', weed: 'moderate' });
    expect(w.alerts).toHaveLength(2);
    expect(ctx.markSynced).toHaveBeenCalledWith('weather');
  });

  it('falls back to Google pollen outside Europe when a key is set', async () => {
    const ctx = testContext(NOW);
    const fetch = upstream({ pollen: null });
    const w = await realWeather(ctx, {
      env: loadWs4Env({ GOOGLE_ROUTES_API_KEY: 'k' }),
      fetch,
    }).weather();
    expect(w.pollen).toEqual({ tree: 'high', grass: 'low', weed: 'none' });
    const none = await realWeather(testContext(NOW), {
      env: loadWs4Env({}),
      fetch: upstream({ pollen: null }),
    }).weather();
    expect(none.pollen).toBeNull();
  });

  it('caches for 15 minutes, then refetches', async () => {
    const ctx = testContext(NOW);
    const fetch = upstream();
    const provider = realWeather(ctx, { env: loadWs4Env({}), fetch });
    await Promise.all([provider.weather(), provider.weather()]);
    const forecastCalls = () =>
      fetch.mock.calls.filter(([u]) => new URL(String(u)).host === 'api.open-meteo.com').length;
    expect(forecastCalls()).toBe(1);
    ctx.setNow(new Date(NOW.getTime() + WEATHER_TTL_MS - 1000));
    await provider.weather();
    expect(forecastCalls()).toBe(1);
    ctx.setNow(new Date(NOW.getTime() + WEATHER_TTL_MS + 1000));
    await provider.weather();
    expect(forecastCalls()).toBe(2);
  });

  it('serves the last snapshot when Open-Meteo is down, and 502 when it has none', async () => {
    const ctx = testContext(NOW);
    await realWeather(ctx, { env: loadWs4Env({}), fetch: upstream() }).weather();
    ctx.setNow(new Date(NOW.getTime() + 2 * WEATHER_TTL_MS));
    // A new provider on the same database starts from the stored snapshot.
    const down = realWeather(ctx, { env: loadWs4Env({}), fetch: upstream({ failForecast: true }) });
    expect((await down.weather()).current.temp).toBe(54);

    const fresh = realWeather(testContext(NOW), {
      env: loadWs4Env({}),
      fetch: upstream({ failForecast: true }),
    });
    await expect(fresh.weather()).rejects.toMatchObject({ code: 'upstream_error' });
  });

  it('serves other places and searches for them', async () => {
    const ctx = testContext(NOW);
    const fetch = upstream();
    const provider = realWeather(ctx, { env: loadWs4Env({}), fetch });
    const seattle = await provider.place({ lat: 47.6062, lon: -122.3321, name: 'Seattle' });
    expect(seattle.locationName).toBe('Seattle');
    expect(seattle.coordinates).toEqual({ latitude: 47.6062, longitude: -122.3321 });
    expect(seattle.alerts).toEqual([]);
    expect(seattle.pollen).toBeNull();
    await provider.place({ lat: 47.6062, lon: -122.3321 });
    const forecastCalls = fetch.mock.calls.filter(
      ([u]) => new URL(String(u)).host === 'api.open-meteo.com',
    );
    expect(forecastCalls).toHaveLength(1);
    expect(new URL(String(forecastCalls[0]![0])).searchParams.get('timezone')).toBe('auto');

    const { places } = await provider.search('Seattle');
    expect(places[0]?.name).toBe('Seattle');
    const typed = await provider.search('47.6, -122.3');
    expect(typed.places).toEqual([
      { id: '47.6000,-122.3000', name: '47.6, -122.3', latitude: 47.6, longitude: -122.3 },
    ]);
  });

  it('wakes the display for a new warning, but not for one already running at install', async () => {
    const ctx = testContext(NOW);
    const fetch = upstream();
    const provider = realWeather(ctx, { env: loadWs4Env({}), fetch });
    await provider.weather();
    // The Red Flag Warning was active on the first fetch: no wake-up for that.
    expect(ctx.emit).not.toHaveBeenCalled();

    const later = new Date(NOW.getTime() + WEATHER_TTL_MS + 1000);
    ctx.setNow(later);
    nwsJson.features.push({
      properties: {
        id: 'urn:oid:new-tornado',
        event: 'Tornado Warning',
        severity: 'Extreme',
        headline: 'Tornado Warning until 8 AM PDT',
        description: 'Take cover now.',
        onset: '2026-10-31T07:30:00-07:00',
        ends: '2026-10-31T08:00:00-07:00',
      },
    });
    try {
      await provider.weather();
    } finally {
      nwsJson.features.pop();
    }
    const types = (
      ctx.emit as unknown as { mock: { calls: Array<[{ type: string }]> } }
    ).mock.calls.map(([e]) => e.type);
    expect(types).toEqual(['weather.alert', 'display.wake']);
  });

  it("writes the day's quip with Claude when the quips integration has a key", async () => {
    const prefs = {
      weather: { savedPlaces: [], personality: 'friendly' },
    } as unknown as Partial<Settings>;
    const claude = (text: string) => (url: URL) =>
      url.hostname === 'api.anthropic.com'
        ? json({
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            model: 'claude-haiku-5-5',
            content: [{ type: 'text', text }],
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 10 },
          })
        : undefined;
    const withKey = testContext(NOW, prefs);
    withKey.integration = () => ({ enabled: true, config: {}, secrets: { claudeApiKey: 'k' } });
    const fetch = fakeFetch(claude('Soccer at four, so the good umbrella goes too.'), upstream());
    const provider = realWeather(withKey, { env: loadWs4Env({}), fetch });
    const { quip } = await provider.quip(async () => []);
    expect(quip).toMatchObject({
      source: 'claude',
      text: 'Soccer at four, so the good umbrella goes too.',
    });
    // Cached for the day: a second ask does not call Claude again.
    const calls = fetch.mock.calls.filter(([u]) => String(u).includes('anthropic')).length;
    await provider.quip(async () => []);
    expect(fetch.mock.calls.filter(([u]) => String(u).includes('anthropic')).length).toBe(calls);

    // Integration switched off: the library answers, Claude is never asked.
    const off = testContext(NOW, prefs);
    off.integration = () => ({ enabled: false, config: {}, secrets: { claudeApiKey: 'k' } });
    const quiet = fakeFetch(claude('nope'), upstream());
    const { quip: libraryQuip } = await realWeather(off, {
      env: loadWs4Env({}),
      fetch: quiet,
    }).quip(async () => []);
    expect(libraryQuip?.source).toBe('library');
    expect(quiet.mock.calls.some(([u]) => String(u).includes('anthropic'))).toBe(false);
  });

  it('quips from the library when the personality is on and no key is set', async () => {
    const off = realWeather(testContext(NOW), { env: loadWs4Env({}), fetch: upstream() });
    expect(await off.quip(async () => [])).toEqual({ quip: null });

    const ctx = testContext(NOW, {
      weather: { savedPlaces: [], personality: 'snarky' },
    } as unknown as Partial<Settings>);
    const provider = realWeather(ctx, { env: loadWs4Env({}), fetch: upstream() });
    const { quip } = await provider.quip(async () => []);
    expect(quip).toMatchObject({ personality: 'snarky', source: 'library' });
    expect(quip!.text.length).toBeGreaterThan(10);
    expect(quip!.text).not.toContain('{');
  });
});
