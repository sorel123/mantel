/**
 * Open-Meteo forecast and air-quality APIs (no key needed), normalised to `WeatherSnapshot`.
 * https://open-meteo.com/en/docs and https://open-meteo.com/en/docs/air-quality-api
 *
 * Requests use `timeformat=unixtime` with the household timezone, so daily values are
 * aggregated over local days while every timestamp stays unambiguous.
 */
import type { Units, WeatherCondition, WeatherSnapshot } from '@mantel/shared';
import { z } from 'zod';
import { dateInZone, isoInZone } from './weather-time.js';

export const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
export const AIR_QUALITY_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

type Pollen = NonNullable<WeatherSnapshot['pollen']>;
type PollenLevel = Pollen['tree'];

/* ---------- WMO weather codes ---------- */

/** WMO code to icon key and words. https://open-meteo.com/en/docs#weather_variable_documentation */
const WMO: Record<number, [WeatherCondition, string]> = {
  0: ['clear', 'Clear'],
  1: ['clear', 'Mostly clear'],
  2: ['partly', 'Partly cloudy'],
  3: ['cloudy', 'Cloudy'],
  45: ['fog', 'Fog'],
  48: ['fog', 'Freezing fog'],
  51: ['drizzle', 'Light drizzle'],
  53: ['drizzle', 'Drizzle'],
  55: ['drizzle', 'Heavy drizzle'],
  56: ['sleet', 'Freezing drizzle'],
  57: ['sleet', 'Freezing drizzle'],
  61: ['rain', 'Light rain'],
  63: ['rain', 'Rain'],
  65: ['rain', 'Heavy rain'],
  66: ['sleet', 'Freezing rain'],
  67: ['sleet', 'Freezing rain'],
  71: ['snow', 'Light snow'],
  73: ['snow', 'Snow'],
  75: ['snow', 'Heavy snow'],
  77: ['snow', 'Snow grains'],
  80: ['rain', 'Light showers'],
  81: ['rain', 'Showers'],
  82: ['rain', 'Heavy showers'],
  85: ['snow', 'Snow showers'],
  86: ['snow', 'Heavy snow showers'],
  95: ['storm', 'Thunderstorms'],
  96: ['storm', 'Thunderstorms with hail'],
  99: ['storm', 'Thunderstorms with hail'],
};

/** Wind at or above this (mph, or the km/h equivalent) turns a dry sky into "Windy". */
const WINDY_MPH = 25;

export function describeCode(
  code: number | null | undefined,
  opts: { isDay?: boolean; windSpeed?: number; units?: Units } = {},
): { condition: WeatherCondition; summary: string } {
  const [condition, summary] = WMO[code ?? 0] ?? WMO[0]!;
  const windy =
    opts.windSpeed !== undefined &&
    opts.windSpeed >= (opts.units === 'metric' ? WINDY_MPH * 1.609 : WINDY_MPH);
  if (windy && (condition === 'clear' || condition === 'partly' || condition === 'cloudy'))
    return { condition: 'wind', summary: 'Windy' };
  if (opts.isDay && code === 0) return { condition, summary: 'Sunny' };
  if (opts.isDay && code === 1) return { condition, summary: 'Mostly sunny' };
  return { condition, summary };
}

export function uvCategory(index: number): string {
  if (index < 3) return 'Low';
  if (index < 6) return 'Moderate';
  if (index < 8) return 'High';
  if (index < 11) return 'Very high';
  return 'Extreme';
}

/** US EPA AQI bands. */
export function aqiCategory(aqi: number): string {
  if (aqi <= 50) return 'Good';
  if (aqi <= 100) return 'Moderate';
  if (aqi <= 150) return 'Unhealthy for sensitive groups';
  if (aqi <= 200) return 'Unhealthy';
  if (aqi <= 300) return 'Very unhealthy';
  return 'Hazardous';
}

/**
 * Grains per cubic metre to a level, using the National Allergy Bureau bands for each group.
 * Tree: 1-14 low, 15-89 moderate, 90-1499 high. Grass: 1-4, 5-19, 20-199. Weed: 1-9, 10-49, 50-499.
 */
const POLLEN_BANDS: Record<keyof Pollen, [number, number, number]> = {
  tree: [15, 90, 1500],
  grass: [5, 20, 200],
  weed: [10, 50, 500],
};

export function pollenLevel(group: keyof Pollen, grains: number): PollenLevel {
  const [moderate, high, veryHigh] = POLLEN_BANDS[group];
  if (grains < 1) return 'none';
  if (grains < moderate) return 'low';
  if (grains < high) return 'moderate';
  if (grains < veryHigh) return 'high';
  return 'very_high';
}

/* ---------- upstream shapes ---------- */

const num = z.number().nullable().optional();
const series = z.array(z.number().nullable());

export const ForecastJson = z.object({
  current: z.object({
    time: z.number(),
    temperature_2m: num,
    apparent_temperature: num,
    relative_humidity_2m: num,
    is_day: num,
    weather_code: num,
    wind_speed_10m: num,
  }),
  hourly: z.object({
    time: z.array(z.number()),
    temperature_2m: series,
    weather_code: series,
    is_day: series,
    precipitation_probability: series,
    uv_index: series,
  }),
  daily: z.object({
    time: z.array(z.number()),
    weather_code: series,
    temperature_2m_max: series,
    temperature_2m_min: series,
    precipitation_probability_max: series,
    sunrise: series,
    sunset: series,
    uv_index_max: series,
  }),
});
export type ForecastJson = z.infer<typeof ForecastJson>;

export const AirQualityJson = z.object({
  current: z.object({
    us_aqi: num,
    alder_pollen: num,
    birch_pollen: num,
    olive_pollen: num,
    grass_pollen: num,
    mugwort_pollen: num,
    ragweed_pollen: num,
  }),
});
export type AirQualityJson = z.infer<typeof AirQualityJson>;

export interface WeatherQuery {
  latitude: number;
  longitude: number;
  timeZone: string;
  units: Units;
}

export function forecastUrl(q: WeatherQuery): string {
  const params = new URLSearchParams({
    latitude: String(q.latitude),
    longitude: String(q.longitude),
    current: [
      'temperature_2m',
      'apparent_temperature',
      'relative_humidity_2m',
      'is_day',
      'weather_code',
      'wind_speed_10m',
    ].join(','),
    hourly: [
      'temperature_2m',
      'weather_code',
      'is_day',
      'precipitation_probability',
      'uv_index',
    ].join(','),
    daily: [
      'weather_code',
      'temperature_2m_max',
      'temperature_2m_min',
      'precipitation_probability_max',
      'sunrise',
      'sunset',
      'uv_index_max',
    ].join(','),
    timezone: q.timeZone,
    timeformat: 'unixtime',
    forecast_days: '7',
    ...(q.units === 'imperial'
      ? { temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', precipitation_unit: 'inch' }
      : { wind_speed_unit: 'kmh' }),
  });
  return `${FORECAST_URL}?${params}`;
}

export function airQualityUrl(q: WeatherQuery): string {
  const params = new URLSearchParams({
    latitude: String(q.latitude),
    longitude: String(q.longitude),
    current: [
      'us_aqi',
      'alder_pollen',
      'birch_pollen',
      'olive_pollen',
      'grass_pollen',
      'mugwort_pollen',
      'ragweed_pollen',
    ].join(','),
    timezone: q.timeZone,
  });
  return `${AIR_QUALITY_URL}?${params}`;
}

/* ---------- normalising ---------- */

const pct = (v: number | null | undefined) => Math.min(100, Math.max(0, Math.round(v ?? 0)));
const round = (v: number | null | undefined) => Math.round(v ?? 0);

export type ForecastPart = Omit<WeatherSnapshot, 'airQuality' | 'pollen' | 'alerts'>;

export function normaliseForecast(
  json: ForecastJson,
  q: WeatherQuery & { now: Date; locationName: string },
): ForecastPart {
  const iso = (unix: number) => isoInZone(new Date(unix * 1000), q.timeZone);
  const nowSec = q.now.getTime() / 1000;
  const h = json.hourly;
  const d = json.daily;

  // The hour we are in, for values Open-Meteo only gives hourly (precipitation chance, UV).
  let currentHour = 0;
  h.time.forEach((t, i) => {
    if (t <= nowSec) currentHour = i;
  });

  const hourly = h.time
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t > nowSec)
    .slice(0, 24)
    .map(({ t, i }) => ({
      time: iso(t),
      temp: round(h.temperature_2m[i]),
      condition: describeCode(h.weather_code[i]).condition,
      isDay: h.is_day[i] === 1,
      precipChance: pct(h.precipitation_probability[i]),
    }));

  const daily = d.time.slice(0, 7).map((t, i) => ({
    date: dateInZone(new Date(t * 1000), q.timeZone),
    high: round(d.temperature_2m_max[i]),
    low: round(d.temperature_2m_min[i]),
    condition: describeCode(d.weather_code[i]).condition,
    precipChance: pct(d.precipitation_probability_max[i]),
    sunrise: iso(d.sunrise[i] ?? t),
    sunset: iso(d.sunset[i] ?? t),
    uvMax: Math.max(0, Math.round((d.uv_index_max[i] ?? 0) * 10) / 10),
  }));

  const c = json.current;
  const isDay = c.is_day === 1;
  const windSpeed = Math.max(0, round(c.wind_speed_10m));
  const uvIndex = Math.max(0, Math.round(h.uv_index[currentHour] ?? 0));
  const today = daily[0];

  return {
    updatedAt: isoInZone(q.now, q.timeZone),
    locationName: q.locationName,
    units: q.units,
    current: {
      temp: round(c.temperature_2m),
      feelsLike: round(c.apparent_temperature ?? c.temperature_2m),
      ...describeCode(c.weather_code, { isDay, windSpeed, units: q.units }),
      isDay,
      humidity: pct(c.relative_humidity_2m),
      windSpeed,
      precipChance: pct(h.precipitation_probability[currentHour]),
    },
    hourly,
    daily,
    sunrise: today?.sunrise ?? isoInZone(q.now, q.timeZone),
    sunset: today?.sunset ?? isoInZone(q.now, q.timeZone),
    uv: { index: uvIndex, category: uvCategory(uvIndex) },
  };
}

export function normaliseAirQuality(json: AirQualityJson): {
  airQuality: WeatherSnapshot['airQuality'];
  pollen: WeatherSnapshot['pollen'];
} {
  const c = json.current;
  const aqi = c.us_aqi;
  const maxOf = (...v: Array<number | null | undefined>) => {
    const known = v.filter((x): x is number => typeof x === 'number');
    return known.length ? Math.max(...known) : null;
  };
  const tree = maxOf(c.alder_pollen, c.birch_pollen, c.olive_pollen);
  const grass = maxOf(c.grass_pollen);
  const weed = maxOf(c.mugwort_pollen, c.ragweed_pollen);
  // Open-Meteo's pollen model covers Europe only; elsewhere every value is null.
  const pollen =
    tree === null && grass === null && weed === null
      ? null
      : {
          tree: pollenLevel('tree', tree ?? 0),
          grass: pollenLevel('grass', grass ?? 0),
          weed: pollenLevel('weed', weed ?? 0),
        };
  return {
    airQuality:
      typeof aqi === 'number'
        ? { aqi: Math.max(0, Math.round(aqi)), category: aqiCategory(aqi) }
        : null,
    pollen,
  };
}
