import type { LeaveBy, WeatherCondition, WeatherSnapshot } from '../models.js';
import { addDays, atHour, startOfDay, toIsoDate, toLocalIso } from '../time.js';

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
const daily: Array<[number, number, WeatherCondition, number]> = [
  [61, 44, 'partly', 40],
  [58, 42, 'rain', 80],
  [55, 40, 'cloudy', 30],
  [60, 43, 'clear', 5],
  [63, 46, 'clear', 0],
  [59, 45, 'partly', 15],
  [52, 39, 'rain', 70],
];

/** The mockup's "54°, partly cloudy, H 61 L 44, rain after 6 pm". */
export function weather(now: Date): WeatherSnapshot {
  const today = startOfDay(now);
  const nextHour = new Date(now);
  nextHour.setMinutes(0, 0, 0);
  nextHour.setHours(nextHour.getHours() + 1);
  const isDayAt = (d: Date) => d.getHours() >= 7 && d.getHours() < 18;
  return {
    updatedAt: toLocalIso(now),
    locationName: 'Home',
    units: 'imperial',
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
    hourly: Array.from({ length: 24 }, (_, i) => {
      const t = new Date(nextHour.getTime() + i * 3600e3);
      return {
        time: toLocalIso(t),
        temp: hourlyTemps[i % hourlyTemps.length]!,
        condition: hourlyKinds[i % hourlyKinds.length]!,
        isDay: isDayAt(t),
        precipChance: hourlyKinds[i % hourlyKinds.length] === 'rain' ? 70 : 10,
      };
    }),
    daily: daily.map(([high, low, condition, precipChance], i) => {
      const d = addDays(today, i);
      return {
        date: toIsoDate(d),
        high,
        low,
        condition,
        precipChance,
        sunrise: toLocalIso(atHour(d, 7 + 22 / 60)),
        sunset: toLocalIso(atHour(d, 17 + 58 / 60)),
        uvMax: [3, 1, 2, 4, 4, 3, 1][i]!,
      };
    }),
    sunrise: toLocalIso(atHour(today, 7 + 22 / 60)),
    sunset: toLocalIso(atHour(today, 17 + 58 / 60)),
    uv: { index: 3, category: 'Moderate' },
    airQuality: { aqi: 32, category: 'Good' },
    pollen: { tree: 'low', grass: 'moderate', weed: 'low' },
    alerts: [],
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
