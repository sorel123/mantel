/**
 * Pickup days for the trash plugin: weekly or every-other-week streams, with the usual US
 * holiday slide (a holiday on a weekday on or before pickup day pushes pickup back a day).
 * Pure functions on local dates, so the tests can pin any day.
 */
import { addDays, fromIsoDate, startOfDay } from '@mantel/shared';
import type { IntegrationConfig } from '@mantel/shared';

export type StreamId = 'trash' | 'recycling' | 'yard';
export const STREAMS: ReadonlyArray<{ id: StreamId; name: string; icon: string }> = [
  { id: 'trash', name: 'Trash', icon: 'trash' },
  { id: 'recycling', name: 'Recycling', icon: 'recycle' },
  { id: 'yard', name: 'Yard waste', icon: 'leaf' },
];

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export interface StreamRule {
  id: StreamId;
  /** 0 Sunday to 6 Saturday. */
  weekday: number;
  biweekly: boolean;
  /** A known pickup date, for every-other-week streams. */
  since: Date | null;
}

export interface TrashSchedule {
  streams: StreamRule[];
  holidayShift: boolean;
  remindFrom: number;
}

export function scheduleFrom(config: IntegrationConfig): TrashSchedule {
  const streams: StreamRule[] = [];
  for (const s of STREAMS) {
    const weekday = WEEKDAYS.indexOf(String(config[`${s.id}Day`] ?? 'none'));
    if (weekday < 0) continue;
    const since = String(config[`${s.id}Since`] ?? '');
    streams.push({
      id: s.id,
      weekday,
      biweekly: config[`${s.id}Every`] === 'biweekly',
      since: /^\d{4}-\d{2}-\d{2}$/.test(since) ? fromIsoDate(since) : null,
    });
  }
  const remind = Number(config.remindFrom);
  return {
    streams,
    holidayShift: config.holidayShift === true,
    remindFrom: Number.isFinite(remind) && remind >= 12 && remind <= 23 ? remind : 16,
  };
}

/* ---------- holidays ---------- */

/** The nth weekday (0 Sunday) of a month; n = -1 for the last. */
function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  if (n > 0) {
    const first = new Date(year, month, 1);
    const offset = (weekday - first.getDay() + 7) % 7;
    return new Date(year, month, 1 + offset + (n - 1) * 7);
  }
  const last = new Date(year, month + 1, 0);
  return new Date(year, month, last.getDate() - ((last.getDay() - weekday + 7) % 7));
}

/** The holidays most US haulers observe. */
export function holidays(year: number): Date[] {
  return [
    new Date(year, 0, 1), // New Year's Day
    nthWeekday(year, 4, 1, -1), // Memorial Day
    new Date(year, 6, 4), // Independence Day
    nthWeekday(year, 8, 1, 1), // Labor Day
    nthWeekday(year, 10, 4, 4), // Thanksgiving
    new Date(year, 11, 25), // Christmas
  ];
}

const sameDay = (a: Date, b: Date) => a.getTime() === startOfDay(b).getTime();

/** Monday of the week holding `d`. */
const mondayOf = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));

/** Whether a weekday holiday falls between Monday of that week and `day`, inclusive. */
function holidayBefore(day: Date): boolean {
  const monday = mondayOf(day);
  const list = [...holidays(day.getFullYear()), ...holidays(day.getFullYear() - 1)];
  for (let d = monday; d.getTime() <= day.getTime(); d = addDays(d, 1)) {
    const wd = d.getDay();
    if (wd >= 1 && wd <= 5 && list.some((h) => sameDay(h, d))) return true;
  }
  return false;
}

/* ---------- pickups ---------- */

export interface Pickup {
  stream: StreamId;
  date: Date;
  /** Moved a day by a holiday. */
  shifted: boolean;
}

const WEEK = 7 * 86_400_000;

/** Whether the stream's regular day in the week of `day` is a pickup week. */
function onWeek(rule: StreamRule, day: Date): boolean {
  if (!rule.biweekly || !rule.since) return true;
  const weeks = Math.round((mondayOf(day).getTime() - mondayOf(rule.since).getTime()) / WEEK);
  return weeks % 2 === 0;
}

/** Every pickup from the start of `from`'s day through `days` days later, in date order. */
export function pickups(schedule: TrashSchedule, from: Date, days = 21): Pickup[] {
  const start = startOfDay(from);
  const out: Pickup[] = [];
  // Start a week early so a pickup slid into this week by a holiday is found.
  for (let i = -7; i <= days; i++) {
    const day = addDays(start, i);
    for (const rule of schedule.streams) {
      if (day.getDay() !== rule.weekday || !onWeek(rule, day)) continue;
      const shifted =
        schedule.holidayShift && day.getDay() >= 1 && day.getDay() <= 5 && holidayBefore(day);
      const date = shifted ? addDays(day, 1) : day;
      if (date.getTime() < start.getTime() || date.getTime() > addDays(start, days).getTime())
        continue;
      out.push({ stream: rule.id, date, shifted });
    }
  }
  return out.sort(
    (a, b) =>
      a.date.getTime() - b.date.getTime() ||
      STREAMS.findIndex((s) => s.id === a.stream) - STREAMS.findIndex((s) => s.id === b.stream),
  );
}

/** "Trash", "Trash and recycling", "Trash, recycling and yard waste". */
export function streamNames(ids: readonly StreamId[]): string {
  const names = ids.map((id, i) => {
    const n = STREAMS.find((s) => s.id === id)!.name;
    return i === 0 ? n : n.toLowerCase();
  });
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export type Moment =
  /** The evening before pickup, from `remindFrom`. */
  | { kind: 'tonight'; streams: StreamId[]; date: Date }
  /** Pickup day, until noon. */
  | { kind: 'today'; streams: StreamId[]; date: Date }
  | { kind: 'quiet' };

/** Whether now is a time to remind, and for which bins. */
export function momentAt(schedule: TrashSchedule, now: Date): Moment {
  const list = pickups(schedule, now, 2);
  const today = startOfDay(now);
  const on = (d: Date) => list.filter((p) => p.date.getTime() === d.getTime()).map((p) => p.stream);
  const todays = on(today);
  if (todays.length && now.getHours() < 12) return { kind: 'today', streams: todays, date: today };
  const tomorrow = addDays(today, 1);
  const tomorrows = on(tomorrow);
  if (tomorrows.length && now.getHours() >= schedule.remindFrom)
    return { kind: 'tonight', streams: tomorrows, date: tomorrow };
  return { kind: 'quiet' };
}
