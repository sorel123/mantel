/**
 * Clock and calendar helpers in the household timezone (`settings.timezone`), for the WS4
 * providers. They do not depend on the server process's `TZ`.
 */

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday. */
  weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Wall-clock parts of `d` in `timeZone`. An unknown zone falls back to UTC. */
export function zoned(d: Date, timeZone: string): ZonedParts {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = formatter(timeZone).formatToParts(d);
  } catch {
    parts = formatter('UTC').formatToParts(d);
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: WEEKDAYS.indexOf(get('weekday')),
  };
}

const pad = (n: number) => String(Math.abs(Math.trunc(n))).padStart(2, '0');

/** `2026-10-31T09:30:00-07:00`: `d` as wall time in `timeZone`, with that zone's offset. */
export function isoInZone(d: Date, timeZone: string): string {
  const p = zoned(d, timeZone);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const offset = Math.round((wallAsUtc - Math.floor(d.getTime() / 1000) * 1000) / 60_000);
  const sign = offset >= 0 ? '+' : '-';
  return (
    `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}` +
    `${sign}${pad(offset / 60)}:${pad(offset % 60)}`
  );
}

/** `YYYY-MM-DD` of `d` in `timeZone`. */
export function dateInZone(d: Date, timeZone: string): string {
  const p = zoned(d, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Minutes since local midnight in `timeZone`. */
export function minutesInZone(d: Date, timeZone: string): number {
  const p = zoned(d, timeZone);
  return p.hour * 60 + p.minute;
}

/** `HH:MM` to minutes since midnight. */
export const clockMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};
