import type { MoonPhaseName, WeatherCondition } from '@mantel/shared';
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
  return `Wind ${Math.round(w.current.windSpeed)} ${speedUnit(w.units)}`;
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

export const pollenWord = (level: keyof typeof POLLEN_WORDS) => POLLEN_WORDS[level];

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

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** `Today`, `Tomorrow`, then `Wed`. `date` is `YYYY-MM-DD`. */
export function dayLabel(date: string, now = new Date(), long = false): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const day = new Date(y, m - 1, d);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - today.getTime()) / 864e5);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return (long ? LONG_DAYS : SHORT_DAYS)[day.getDay()]!;
}

/**
 * The day label for an hour: `Today`, else the short weekday (`Sat`), based on its local date.
 * Weekdays rather than `Tomorrow` so a 48-hour strip reads as a calendar does.
 */
export function hourDayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return day.getTime() === today.getTime() ? 'Today' : SHORT_DAYS[day.getDay()]!;
}

export const speedUnit = (units: Weather['units']) => (units === 'imperial' ? 'mph' : 'km/h');
export const amountUnit = (units: Weather['units']) => (units === 'imperial' ? 'in' : 'mm');
export const distanceUnit = (units: Weather['units']) => (units === 'imperial' ? 'mi' : 'km');

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** `SW` for 225 degrees. */
export const compass = (deg: number) => COMPASS[Math.round(deg / 45) % 8]!;

/** A little moon for the Details tab, as text so it needs no asset. */
export const MOON_GLYPH: Record<MoonPhaseName, string> = {
  new: '🌑',
  waxing_crescent: '🌒',
  first_quarter: '🌓',
  waxing_gibbous: '🌔',
  full: '🌕',
  waning_gibbous: '🌖',
  last_quarter: '🌗',
  waning_crescent: '🌘',
};

/** Rounds rain amounts sensibly: 0.04 in, 1.2 mm, never `0`. Returns null for a dry hour. */
export function formatAmount(amount: number | undefined, units: Weather['units']): string | null {
  if (!amount || amount < (units === 'imperial' ? 0.005 : 0.05)) return null;
  const n =
    units === 'imperial'
      ? amount.toFixed(amount < 1 ? 2 : 1)
      : String(Math.round(amount * 10) / 10);
  return `${n} ${amountUnit(units)}`;
}
