/**
 * Repeating events from quick add: the RRULE for each choice, the household's wall-clock time for
 * Google's `timeZone` field, a VTIMEZONE for iCloud so a 9 am weekly event stays at 9 am across
 * daylight saving, and the arithmetic for "change every occurrence". No I/O.
 */
import type { Repeat } from '@mantel/shared';
import { addDays, daysBetween, startOfDay } from '@mantel/shared';

/** The RRULE value (without `RRULE:`) for a quick-add choice. Repeats have no end. */
export function rrule(repeat: Repeat): string {
  switch (repeat) {
    case 'daily':
      return 'FREQ=DAILY';
    case 'weekly':
      return 'FREQ=WEEKLY';
    case 'monthly':
      return 'FREQ=MONTHLY';
    case 'weekdays':
      return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
  }
}

/** Plain-words label, for logs and errors. */
export const repeatLabel: Record<Repeat, string> = {
  daily: 'every day',
  weekly: 'every week',
  monthly: 'every month',
  weekdays: 'every weekday',
};

/**
 * Occurrence starts of a series from `first`, overlapping [from, to) for events `lengthMs` long.
 * Wall-clock stepping: a 9 am event stays at 9 am across daylight saving. Monthly repeats skip
 * months without that day (the 31st), as Google and iCloud do.
 */
export function occurrences(
  first: Date,
  repeat: Repeat,
  from: Date,
  to: Date,
  lengthMs = 0,
  max = 1000,
): Date[] {
  const out: Date[] = [];
  const at = (day: Date) => {
    const d = new Date(day);
    d.setHours(first.getHours(), first.getMinutes(), first.getSeconds(), 0);
    return d;
  };
  const keep = (d: Date) => {
    if (d.getTime() + lengthMs > from.getTime() && d < to) out.push(d);
  };
  if (repeat === 'monthly') {
    for (let i = 0; out.length < max && i < 1200; i++) {
      const day = new Date(first.getFullYear(), first.getMonth() + i, first.getDate());
      if (day.getDate() !== first.getDate()) continue;
      const d = at(day);
      if (d >= to) break;
      keep(d);
    }
    return out;
  }
  const base = startOfDay(first);
  // Jump close to the window rather than stepping through years of history.
  const skip = Math.max(0, daysBetween(base, startOfDay(from)) - Math.ceil(lengthMs / 864e5) - 1);
  for (let i = skip; out.length < max && i < skip + 4000; i++) {
    const day = addDays(base, i);
    const d = at(day);
    if (d >= to) break;
    if (repeat === 'weekly' && i % 7 !== 0) continue;
    if (repeat === 'weekdays' && (day.getDay() === 0 || day.getDay() === 6)) continue;
    keep(d);
  }
  return out;
}

/**
 * The series' new first start when one occurrence moves from `oldOcc` to `newOcc` and the change
 * applies to all: the same number of days, at the new time of day.
 */
export function shiftSeries(masterStart: Date, oldOcc: Date, newOcc: Date, allDay: boolean): Date {
  const days = daysBetween(startOfDay(oldOcc), startOfDay(newOcc));
  const d = addDays(startOfDay(masterStart), days);
  if (!allDay) d.setHours(newOcc.getHours(), newOcc.getMinutes(), 0, 0);
  return d;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Parts of `d` on the wall clock in `timeZone`. */
function zoned(d: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

/** `2026-11-09T09:00:00`: the wall-clock time in `timeZone`, for Google's dateTime + timeZone. */
export function wallClock(d: Date, timeZone: string): string {
  const z = zoned(d, timeZone);
  return `${z.year}-${pad(z.month)}-${pad(z.day)}T${pad(z.hour)}:${pad(z.minute)}:${pad(z.second)}`;
}

/** `20261109T090000`: the iCalendar local form of the same. */
export function icsLocal(d: Date, timeZone: string): string {
  return wallClock(d, timeZone).replace(/[-:]/g, '');
}

/** Minutes east of UTC in `timeZone` at instant `t`. */
export function offsetMinutes(timeZone: string, t: number): number {
  const z = zoned(new Date(t), timeZone);
  const asUtc = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second);
  return Math.round((asUtc - Math.floor(t / 1000) * 1000) / 60_000);
}

const fmtOffset = (m: number) => {
  const a = Math.abs(m);
  return `${m < 0 ? '-' : '+'}${pad(Math.floor(a / 60))}${pad(a % 60)}`;
};
const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** A yearly transition rule: month, which weekday of it, and the local time it happens. */
interface Transition {
  from: number;
  to: number;
  month: number;
  /** 1-4, or -1 for the last one in the month. */
  nth: number;
  weekday: number;
  hour: number;
  minute: number;
}

/** The daylight-saving changes in `year` for `timeZone` (none for a zone without DST). */
function transitions(timeZone: string, year: number): Transition[] {
  const out: Transition[] = [];
  let prev = offsetMinutes(timeZone, Date.UTC(year, 0, 1, 12));
  for (let day = 1; day <= 366; day++) {
    const noon = Date.UTC(year, 0, day, 12);
    const off = offsetMinutes(timeZone, noon);
    if (off === prev) continue;
    // Find the hour it changed in the 24 hours before this noon.
    let t = noon - 24 * 3600e3;
    while (t < noon && offsetMinutes(timeZone, t + 3600e3) === prev) t += 3600e3;
    const at = t + 3600e3;
    // The local time just before the change, on the old offset (02:00 for most of the world).
    const local = new Date(at + prev * 60_000);
    const dom = local.getUTCDate();
    const dim = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0)).getUTCDate();
    out.push({
      from: prev,
      to: off,
      month: local.getUTCMonth() + 1,
      nth: dom + 7 > dim && dom > 21 ? -1 : Math.ceil(dom / 7),
      weekday: local.getUTCDay(),
      hour: local.getUTCHours(),
      minute: local.getUTCMinutes(),
    });
    prev = off;
  }
  return out;
}

/** The date in 1970 matching a rule, as the observance's DTSTART. */
function ruleDate1970(t: Transition): string {
  const dim = new Date(Date.UTC(1970, t.month, 0)).getUTCDate();
  let day: number;
  if (t.nth === -1) {
    day = dim;
    while (new Date(Date.UTC(1970, t.month - 1, day)).getUTCDay() !== t.weekday) day--;
  } else {
    day = 1;
    while (new Date(Date.UTC(1970, t.month - 1, day)).getUTCDay() !== t.weekday) day++;
    day += 7 * (t.nth - 1);
  }
  return `1970${pad(t.month)}${pad(day)}T${pad(t.hour)}${pad(t.minute)}00`;
}

/**
 * A VTIMEZONE for `timeZone` built from the running Node's time zone data, so an iCloud event
 * with `TZID=<zone>` is read the same everywhere. Lines without CRLF.
 */
export function vtimezone(timeZone: string, year = new Date().getFullYear()): string[] {
  const rules = transitions(timeZone, year);
  const lines = ['BEGIN:VTIMEZONE', `TZID:${timeZone}`];
  if (rules.length < 2) {
    const off = fmtOffset(offsetMinutes(timeZone, Date.UTC(year, 0, 1, 12)));
    lines.push(
      'BEGIN:STANDARD',
      'DTSTART:19700101T000000',
      `TZOFFSETFROM:${off}`,
      `TZOFFSETTO:${off}`,
      'END:STANDARD',
    );
  } else {
    for (const r of rules) {
      const kind = r.to > r.from ? 'DAYLIGHT' : 'STANDARD';
      lines.push(
        `BEGIN:${kind}`,
        `DTSTART:${ruleDate1970(r)}`,
        `RRULE:FREQ=YEARLY;BYMONTH=${r.month};BYDAY=${r.nth}${DAYS[r.weekday]}`,
        `TZOFFSETFROM:${fmtOffset(r.from)}`,
        `TZOFFSETTO:${fmtOffset(r.to)}`,
        `END:${kind}`,
      );
    }
  }
  lines.push('END:VTIMEZONE');
  return lines;
}
