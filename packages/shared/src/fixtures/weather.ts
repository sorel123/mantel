import type { LeaveBy, WeatherCondition } from '../models.js';
import { addDays, atHour, startOfDay, toIsoDate, toLocalIso } from '../time.js';
import {
  moonPhaseAt,
  placeId,
  type WeatherDayDetail,
  type WeatherHourDetail,
  type WeatherPlace,
  type WeatherQuip,
  type WeatherSnapshotExtended,
} from '../weather-extended.js';

/** One day of the mockup's hourly rhythm: a mild afternoon, rain in the evening, clearing overnight. */
const hourlyTemps = [54, 56, 58, 59, 57, 53, 51, 50, 49, 48, 47, 46];
const hourlyKinds: WeatherCondition[] = [
  'partly',
  'partly',
  'clear',
  'clear',
  'cloudy',
  'rain',
  'rain',
  'rain',
  'cloudy',
  'cloudy',
  'partly',
  'clear',
];
const daily: Array<[number, number, WeatherCondition, number, string]> = [
  [61, 44, 'partly', 40, 'Partly cloudy'],
  [58, 42, 'rain', 80, 'Showers'],
  [55, 40, 'cloudy', 30, 'Cloudy'],
  [60, 43, 'clear', 5, 'Sunny'],
  [63, 46, 'clear', 0, 'Sunny'],
  [59, 45, 'partly', 15, 'Partly cloudy'],
  [52, 39, 'rain', 70, 'Rain'],
  [50, 37, 'storm', 85, 'Thunderstorms'],
  [54, 38, 'partly', 20, 'Partly cloudy'],
  [57, 41, 'clear', 5, 'Sunny'],
];

const isDayAt = (d: Date) => d.getHours() >= 7 && d.getHours() < 18;

function hour(t: Date, i: number): WeatherHourDetail {
  const kind = hourlyKinds[i % hourlyKinds.length]!;
  const wet = kind === 'rain';
  // The second day runs a few degrees cooler and wetter, so a 48 h strip has something to show.
  const dayShift = i >= 24 ? -3 : 0;
  const temp = hourlyTemps[i % hourlyTemps.length]! + dayShift;
  return {
    time: toLocalIso(t),
    temp,
    condition: kind,
    isDay: isDayAt(t),
    precipChance: wet ? 70 + (i % 3) * 5 : i >= 24 ? 25 : 10,
    precipAmount: wet ? 0.04 + (i % 3) * 0.02 : 0,
    windSpeed: 5 + (i % 7),
    windGust: 9 + (i % 9),
    windDirection: (200 + i * 7) % 360,
    humidity: wet ? 84 : 58 + (i % 9),
    dewPoint: temp - (wet ? 4 : 12),
    pressure: 1014 - Math.round(i / 6),
    visibility: wet ? 4 : 10,
    uv: isDayAt(t) ? [1, 2, 3, 4, 4, 3, 2, 1, 0, 0, 0][Math.min(10, t.getHours() - 7)]! : 0,
  };
}

/** The mockup's "54°, partly cloudy, H 61 L 44, rain after 6 pm", now over 48 hours and ten days. */
export function weather(now: Date): WeatherSnapshotExtended {
  const today = startOfDay(now);
  const nextHour = new Date(now);
  nextHour.setMinutes(0, 0, 0);
  nextHour.setHours(nextHour.getHours() + 1);
  const days: WeatherDayDetail[] = daily.map(([high, low, condition, precipChance, summary], i) => {
    const d = addDays(today, i);
    return {
      date: toIsoDate(d),
      high,
      low,
      condition,
      summary,
      precipChance,
      precipSum: condition === 'rain' ? 0.35 : condition === 'storm' ? 0.6 : 0,
      windMax: [12, 18, 9, 7, 6, 11, 22, 26, 10, 8][i]!,
      sunrise: toLocalIso(atHour(d, 7 + (22 + i) / 60)),
      sunset: toLocalIso(atHour(d, 17 + (58 - i) / 60)),
      daylightHours: 10.6 - i * 0.03,
      uvMax: [3, 1, 2, 4, 4, 3, 1, 1, 3, 4][i]!,
    };
  });
  return {
    updatedAt: toLocalIso(now),
    locationName: 'Home',
    units: 'imperial',
    coordinates: { latitude: 37.7749, longitude: -122.4194 },
    timezone: 'America/Los_Angeles',
    current: {
      temp: 54,
      feelsLike: 52,
      condition: 'partly',
      summary: 'Partly cloudy',
      isDay: isDayAt(now),
      humidity: 62,
      windSpeed: 7,
      precipChance: 20,
    },
    hourly: Array.from({ length: 48 }, (_, i) =>
      hour(new Date(nextHour.getTime() + i * 3600e3), i),
    ),
    daily: days,
    sunrise: days[0]!.sunrise,
    sunset: days[0]!.sunset,
    uv: { index: 3, category: 'Moderate' },
    airQuality: { aqi: 32, category: 'Good' },
    pollen: { tree: 'low', grass: 'moderate', weed: 'low' },
    moon: moonPhaseAt(now),
    alerts: [],
  };
}

/** Places the mock place search knows about (any query matches by name). */
export const weatherPlaces: WeatherPlace[] = [
  {
    id: placeId(47.6062, -122.3321),
    name: 'Seattle',
    region: 'Washington',
    country: 'United States',
    latitude: 47.6062,
    longitude: -122.3321,
    timezone: 'America/Los_Angeles',
  },
  {
    id: placeId(45.5152, -122.6784),
    name: 'Portland',
    region: 'Oregon',
    country: 'United States',
    latitude: 45.5152,
    longitude: -122.6784,
    timezone: 'America/Los_Angeles',
  },
  {
    id: placeId(39.1911, -106.8175),
    name: 'Aspen',
    region: 'Colorado',
    country: 'United States',
    latitude: 39.1911,
    longitude: -106.8175,
    timezone: 'America/Denver',
  },
  {
    id: placeId(21.3069, -157.8583),
    name: 'Honolulu',
    region: 'Hawaii',
    country: 'United States',
    latitude: 21.3069,
    longitude: -157.8583,
    timezone: 'Pacific/Honolulu',
  },
  {
    id: placeId(51.5072, -0.1276),
    name: 'London',
    region: 'England',
    country: 'United Kingdom',
    latitude: 51.5072,
    longitude: -0.1276,
    timezone: 'Europe/London',
  },
];

/** The home snapshot shifted for another place: cooler up north, warmer down south. */
export function weatherForPlace(
  now: Date,
  place: { latitude: number; longitude: number; name?: string },
): WeatherSnapshotExtended {
  const home = weather(now);
  const shift = Math.round((37.7749 - place.latitude) * 0.8);
  const known = weatherPlaces.find((p) => p.id === placeId(place.latitude, place.longitude));
  const warm = (t: number) => t + shift;
  return {
    ...home,
    locationName: place.name ?? known?.name ?? placeId(place.latitude, place.longitude),
    coordinates: { latitude: place.latitude, longitude: place.longitude },
    timezone: known?.timezone ?? home.timezone,
    current: {
      ...home.current,
      temp: warm(home.current.temp),
      feelsLike: warm(home.current.feelsLike),
    },
    hourly: home.hourly.map((h) => ({
      ...h,
      temp: warm(h.temp),
      dewPoint: warm(h.dewPoint ?? 40),
    })),
    daily: home.daily.map((d) => ({ ...d, high: warm(d.high), low: warm(d.low) })),
    pollen: null,
    alerts: [],
  };
}

export function weatherQuip(now: Date): WeatherQuip {
  return {
    text: 'Partly cloudy with a side of rain after dinner. Bring the good umbrella, not the one that flips.',
    personality: 'friendly',
    source: 'library',
    at: toLocalIso(now),
  };
}

/** Leave-by chips: present on weekday mornings before 9:30, empty otherwise, like the real route. */
export function commute(now: Date, opts: { force?: boolean } = {}): { leaveBy: LeaveBy[] } {
  const weekday = now.getDay() >= 1 && now.getDay() <= 5;
  const morning =
    now.getHours() >= 5 && (now.getHours() < 9 || (now.getHours() === 9 && now.getMinutes() < 30));
  if (!opts.force && !(weekday && morning)) return { leaveBy: [] };
  const today = startOfDay(now);
  return {
    leaveBy: [
      {
        destinationId: 'dest-school',
        name: 'Lincoln Elementary',
        leaveBy: toLocalIso(atHour(today, 7 + 38 / 60)),
        arriveBy: toLocalIso(atHour(today, 7 + 55 / 60)),
        durationMinutes: 14,
        delayMinutes: 3,
        personIds: ['sam', 'leo'],
        eventId: 'evt-fixed-0',
      },
      {
        destinationId: 'dest-office',
        name: 'Office',
        leaveBy: toLocalIso(atHour(today, 8 + 20 / 60)),
        arriveBy: toLocalIso(atHour(today, 9)),
        durationMinutes: 32,
        delayMinutes: 8,
        personIds: ['jay'],
      },
    ],
  };
}
