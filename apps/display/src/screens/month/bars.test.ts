import type { CalendarEvent } from '@mantel/shared';
import { describe, expect, it } from 'vitest';
import { fillDay, layoutWeeks, weeksIn } from './bars';

let n = 0;
const ev = (start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: `e${n++}`,
  calendarId: 'c1',
  title: 'Event',
  start,
  end,
  allDay: false,
  personIds: [],
  color: '#3366cc',
  countdown: false,
  ...extra,
});
const allDay = (day: string, days = 1, title = 'Event') => {
  const s = new Date(`${day}T00:00:00`);
  const e = new Date(s);
  e.setDate(e.getDate() + days);
  return ev(s.toISOString(), e.toISOString(), { allDay: true, title });
};

// Sunday 1 November 2026.
const start = new Date(2026, 10, 1);

describe('weeksIn', () => {
  it('uses five weeks when the month fits, six when it does not', () => {
    expect(weeksIn(new Date(2026, 10, 1))).toBe(5); // Nov 2026 starts Sunday, 30 days
    expect(weeksIn(new Date(2026, 7, 1))).toBe(6); // Aug 2026 starts Saturday, 31 days
    expect(weeksIn(new Date(2026, 1, 1))).toBe(4); // Feb 2026 starts Sunday, 28 days
  });

  it('puts a day event in a lane no bar uses that day', () => {
    // Sun-Mon in lane 0, Mon-Sat in lane 1: Tuesday has lane 0 free.
    const short = allDay('2026-11-01', 2, 'Short');
    const long = allDay('2026-11-02', 6, 'Long');
    const one = ev(new Date(2026, 10, 3, 9).toISOString(), new Date(2026, 10, 3, 10).toISOString());
    const [w0] = layoutWeeks(start, 5, [short, long, one]);
    expect(w0!.bars.map((b) => b.lane)).toEqual([0, 1]);
    expect(fillDay(w0!, 2, 4)).toEqual({ slots: [one, null], more: 0 });
  });
});

describe('layoutWeeks', () => {
  it('draws a multi-day all-day event as one bar per week', () => {
    const trip = allDay('2026-11-05', 5, 'Trip'); // Thu 5 to Mon 9
    const [w0, w1] = layoutWeeks(start, 5, [trip]);
    expect(w0!.bars).toMatchObject([{ from: 4, to: 6, lane: 0, before: false, after: true }]);
    expect(w1!.bars).toMatchObject([{ from: 0, to: 1, lane: 0, before: true, after: false }]);
    expect(w0!.singles.flat()).toEqual([]);
  });

  it('joins the same all-day event on consecutive days into a bar', () => {
    const daily = [2, 3, 4, 5].map((d) => allDay(`2026-11-0${d}`, 1, 'Road closed'));
    const [w0] = layoutWeeks(start, 5, daily);
    expect(w0!.bars).toHaveLength(1);
    expect(w0!.bars[0]).toMatchObject({ from: 1, to: 4 });
  });

  it('keeps one-day and short timed events as pills', () => {
    const lunch = ev(
      new Date(2026, 10, 3, 12).toISOString(),
      new Date(2026, 10, 3, 13).toISOString(),
    );
    const holiday = allDay('2026-11-11', 1, 'Veterans Day');
    const weeks = layoutWeeks(start, 5, [lunch, holiday]);
    expect(weeks[0]!.singles[2]).toEqual([lunch]);
    expect(weeks[1]!.singles[3]).toEqual([holiday]);
    expect(weeks.flatMap((w) => w.bars)).toEqual([]);
  });

  it('stacks overlapping bars in lanes', () => {
    const a = allDay('2026-11-02', 3, 'A');
    const b = allDay('2026-11-03', 3, 'B');
    const c = allDay('2026-11-06', 2, 'C');
    const [w0] = layoutWeeks(start, 5, [a, b, c]);
    const lane = (t: string) => w0!.bars.find((x) => x.event.title === t)!.lane;
    expect(lane('A')).toBe(0);
    expect(lane('B')).toBe(1);
    expect(lane('C')).toBe(0);
  });

  it('puts a day event in a lane no bar uses that day', () => {
    // Sun-Mon in lane 0, Mon-Sat in lane 1: Tuesday has lane 0 free.
    const short = allDay('2026-11-01', 2, 'Short');
    const long = allDay('2026-11-02', 6, 'Long');
    const one = ev(new Date(2026, 10, 3, 9).toISOString(), new Date(2026, 10, 3, 10).toISOString());
    const [w0] = layoutWeeks(start, 5, [short, long, one]);
    expect(w0!.bars.map((b) => b.lane)).toEqual([0, 1]);
    expect(fillDay(w0!, 2, 4)).toEqual({ slots: [one, null], more: 0 });
  });
});

describe('fillDay', () => {
  it('leaves room for the bars and folds the rest into +n more', () => {
    const bar = allDay('2026-11-02', 3, 'Trip');
    const pills = [1, 2, 3, 4].map((h) =>
      ev(new Date(2026, 10, 3, 8 + h).toISOString(), new Date(2026, 10, 3, 9 + h).toISOString()),
    );
    const [w0] = layoutWeeks(start, 5, [bar, ...pills]);
    // Tuesday: one bar, four pills, three rows: the bar, one pill, "+3 more".
    const three = fillDay(w0!, 2, 3);
    expect(three.more).toBe(3);
    expect(three.slots).toEqual([null, pills[0]]);
    // Five rows: the bar and all four pills.
    expect(fillDay(w0!, 2, 5)).toEqual({ slots: [null, ...pills], more: 0 });
  });

  it('puts a day event in a lane no bar uses that day', () => {
    // Sun-Mon in lane 0, Mon-Sat in lane 1: Tuesday has lane 0 free.
    const short = allDay('2026-11-01', 2, 'Short');
    const long = allDay('2026-11-02', 6, 'Long');
    const one = ev(new Date(2026, 10, 3, 9).toISOString(), new Date(2026, 10, 3, 10).toISOString());
    const [w0] = layoutWeeks(start, 5, [short, long, one]);
    expect(w0!.bars.map((b) => b.lane)).toEqual([0, 1]);
    expect(fillDay(w0!, 2, 4)).toEqual({ slots: [one, null], more: 0 });
  });
});
