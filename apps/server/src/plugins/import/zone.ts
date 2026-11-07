import { zoned, isoInZone } from '../../providers/real/weather-time.js';

/** The instant when the wall clock in `timeZone` reads `date` at `hhmm` (default midnight). */
export function wallTime(date: string, hhmm: string, timeZone: string): Date {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = hhmm.split(':').map(Number) as [number, number];
  const target = Date.UTC(y, mo - 1, d, h, mi);
  // Guess with the zone's offset at the target, then correct once for a DST edge.
  let at = target;
  for (let i = 0; i < 2; i++) {
    const p = zoned(new Date(at), timeZone);
    const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    at += target - wall;
  }
  return new Date(at);
}

/** `wallTime` as an ISO string with the zone's offset, as the calendar routes take it. */
export const wallIso = (date: string, hhmm: string, timeZone: string) =>
  isoInZone(wallTime(date, hhmm, timeZone), timeZone);

/** `YYYY-MM-DD` plus `n` days. */
export function shiftDate(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return x.toISOString().slice(0, 10);
}
