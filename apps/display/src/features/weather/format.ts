import type { WeatherCondition } from '@mantel/shared';
import type { Weather } from './store';

/** `7 am`, `6:30 pm`, as in the mockup. */
export function formatHour(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const h = d.getHours();
  const m = d.getMinutes();
  const hh = ((h + 11) % 12) + 1;
  const ap = h >= 12 ? 'pm' : 'am';
  return m ? `${hh}:${String(m).padStart(2, '0')} ${ap}` : `${hh} ${ap}`;
}

/** `7:41`, for clock-like times in chips. */
export function formatClockTime(iso: string): string {
  const d = new Date(iso);
  return `${((d.getHours() + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const WET: Partial<Record<WeatherCondition, string>> = {
  drizzle: 'Drizzle',
  rain: 'Rain',
  storm: 'Storms',
  snow: 'Snow',
  sleet: 'Sleet',
};
const isWet = (c: WeatherCondition, chance: number) => c in WET && chance >= 40;

/**
 * The one-line outlook under the high and low, from the rest of today's hours:
 * "Rain after 6 pm", "Rain until 3 pm", or the feels-like temperature.
 */
export function outlook(w: Weather, now = new Date()): string {
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  const today = w.hourly.filter((h) => new Date(h.time) <= endOfDay);
  const wetNow = isWet(w.current.condition, Math.max(w.current.precipChance, 40));
  if (wetNow && w.current.condition in WET) {
    const dry = today.find((h) => !isWet(h.condition, h.precipChance));
    const word = WET[w.current.condition]!;
    return dry ? `${word} until ${formatHour(dry.time)}` : `${word} all day`;
  }
  const wet = today.find((h) => isWet(h.condition, h.precipChance));
  if (wet) return `${WET[wet.condition]} after ${formatHour(wet.time)}`;
  if (Math.abs(w.current.feelsLike - w.current.temp) >= 3)
    return `Feels like ${Math.round(w.current.feelsLike)}°`;
  return `Wind ${Math.round(w.current.windSpeed)} ${w.units === 'imperial' ? 'mph' : 'km/h'}`;
}

const POLLEN_WORDS = {
  none: 'None',
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  very_high: 'Very high',
} as const;
const POLLEN_RANK = ['none', 'low', 'moderate', 'high', 'very_high'] as const;

/** The worst pollen group, e.g. `{ label: 'Grass', level: 'Moderate', rank: 2 }`; null when there is no data. */
export function worstPollen(pollen: Weather['pollen']) {
  if (!pollen) return null;
  const groups = [
    ['Tree', pollen.tree],
    ['Grass', pollen.grass],
    ['Weed', pollen.weed],
  ] as const;
  const [label, level] = groups.reduce((a, b) =>
    POLLEN_RANK.indexOf(b[1]) > POLLEN_RANK.indexOf(a[1]) ? b : a,
  );
  return { label, level: POLLEN_WORDS[level], rank: POLLEN_RANK.indexOf(level) };
}

/** Sunrise if it is still ahead today, else sunset, else tomorrow's sunrise. */
export function nextSun(
  w: Weather,
  now = new Date(),
): { kind: 'sunrise' | 'sunset'; time: string } {
  if (new Date(w.sunrise) > now) return { kind: 'sunrise', time: w.sunrise };
  if (new Date(w.sunset) > now) return { kind: 'sunset', time: w.sunset };
  return { kind: 'sunrise', time: w.daily[1]?.sunrise ?? w.sunrise };
}

/** `6 pm` today, `Sun 6 am` on another day. */
export function formatWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (d.toDateString() === now.toDateString()) return formatHour(d);
  return `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${formatHour(d)}`;
}
