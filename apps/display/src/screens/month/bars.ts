/**
 * The Month grid's layout maths: which events become bars across a week and which stay as
 * pills in one day.
 *
 * An event becomes a bar when it covers more than one day: a multi-day all-day event, a timed
 * event of 24 hours or more, or a run of the same all-day event (same title and calendar) on
 * consecutive days, which is how a lot of calendars store "Road closed" every day for a month.
 * Bars are split at week ends and stacked in lanes, first come first served, longest first.
 */
import type { CalendarEvent } from '@mantel/shared';
import { startOfDay } from '@mantel/shared';

export interface Bar {
  event: CalendarEvent;
  /** Columns 0-6 within the week. */
  from: number;
  to: number;
  lane: number;
  /** The event carries on before or after this week's piece. */
  before: boolean;
  after: boolean;
}

export interface WeekLayout {
  bars: Bar[];
  /** Per day, the pill events left over after bars, all-day first then by start. */
  singles: CalendarEvent[][];
}

const DAY = 864e5;

/** Day index (from `start`) of a date, in local days. */
const dayIndex = (start: Date, d: Date) =>
  Math.round((startOfDay(d).getTime() - startOfDay(start).getTime()) / DAY);

/** The first and last day index an event touches, or null when it ends before `start`. */
function span(start: Date, ev: CalendarEvent): [number, number] {
  const a = new Date(ev.start);
  const b = new Date(ev.end);
  const first = dayIndex(start, a);
  // The end is exclusive: an all-day event ending at midnight, or a timed one ending on the
  // hour, does not touch the day it ends on.
  const lastMoment = b.getTime() > a.getTime() ? new Date(b.getTime() - 1) : a;
  const last = dayIndex(start, lastMoment);
  return [first, Math.max(first, last)];
}

const isLong = (ev: CalendarEvent) =>
  ev.allDay || new Date(ev.end).getTime() - new Date(ev.start).getTime() >= DAY;

const byStart = (x: CalendarEvent, y: CalendarEvent) =>
  Number(y.allDay) - Number(x.allDay) || x.start.localeCompare(y.start);

/**
 * Lay out `weeks` weeks from `start` (a Sunday). `events` may include events outside the range;
 * they are clipped.
 */
export function layoutWeeks(start: Date, weeks: number, events: CalendarEvent[]): WeekLayout[] {
  const days = weeks * 7;
  const spans: Array<{ event: CalendarEvent; first: number; last: number }> = [];
  const singles: CalendarEvent[][] = Array.from({ length: days }, () => []);
  const runs = new Map<string, Array<{ event: CalendarEvent; day: number }>>();

  for (const ev of events) {
    const [first, last] = span(start, ev);
    if (last < 0 || first >= days) continue;
    if (last > first && isLong(ev)) {
      spans.push({ event: ev, first, last });
    } else if (ev.allDay && first === last) {
      const key = `${ev.calendarId}\u0000${ev.title.trim().toLowerCase()}`;
      const list = runs.get(key) ?? [];
      list.push({ event: ev, day: first });
      runs.set(key, list);
    } else {
      for (let d = Math.max(0, first); d <= Math.min(days - 1, last); d++) singles[d]!.push(ev);
    }
  }

  // Consecutive days of the same all-day event join into one bar.
  for (const list of runs.values()) {
    list.sort((x, y) => x.day - y.day);
    let i = 0;
    while (i < list.length) {
      let j = i;
      while (j + 1 < list.length && list[j + 1]!.day <= list[j]!.day + 1) j++;
      const run = list.slice(i, j + 1);
      const first = run[0]!.day;
      const last = run[run.length - 1]!.day;
      if (last > first) spans.push({ event: run[0]!.event, first, last });
      else if (first >= 0 && first < days) singles[first]!.push(run[0]!.event);
      i = j + 1;
    }
  }

  const out: WeekLayout[] = [];
  for (let w = 0; w < weeks; w++) {
    const lo = w * 7;
    const hi = lo + 6;
    const pieces = spans
      .filter((s) => s.last >= lo && s.first <= hi)
      .map((s) => ({
        event: s.event,
        from: Math.max(s.first, lo) - lo,
        to: Math.min(s.last, hi) - lo,
        before: s.first < lo,
        after: s.last > hi,
      }))
      .sort(
        (x, y) => x.from - y.from || y.to - y.from - (x.to - x.from) || byStart(x.event, y.event),
      );
    const laneEnds: number[] = [];
    const bars: Bar[] = pieces.map((p) => {
      let lane = laneEnds.findIndex((end) => end < p.from);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = p.to;
      return { ...p, lane };
    });
    out.push({
      bars,
      singles: singles.slice(lo, hi + 1).map((list) => list.sort(byStart)),
    });
  }
  return out;
}

/** How many weeks a month needs: four to six. */
export function weeksIn(month: Date): number {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  return Math.ceil((first.getDay() + days) / 7);
}

/** What one day cell shows: how many bar lanes to leave room for, its pills, and the "+n more". */
export function fillDay(
  week: WeekLayout,
  col: number,
  rows: number,
): { lanes: number; pills: CalendarEvent[]; more: number } {
  // Bars may use every row but one, so a day always has room for "+n more" or a pill.
  const maxLanes = Math.max(1, rows - 1);
  const covering = week.bars.filter((b) => b.from <= col && b.to >= col);
  const shownLanes = covering.filter((b) => b.lane < maxLanes);
  const hiddenBars = covering.length - shownLanes.length;
  const lanes = shownLanes.length ? Math.max(...shownLanes.map((b) => b.lane)) + 1 : 0;
  const singles = week.singles[col] ?? [];
  const room = Math.max(0, rows - lanes);
  if (singles.length + hiddenBars <= room) return { lanes, pills: singles, more: hiddenBars };
  const pills = singles.slice(0, Math.max(0, room - 1));
  return { lanes, pills, more: singles.length - pills.length + hiddenBars };
}
