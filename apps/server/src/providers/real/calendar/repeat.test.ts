import ICAL from 'ical.js';
import { describe, expect, it } from 'vitest';
import { buildIcs, expandIcs } from './ics.js';
import { occurrences, offsetMinutes, rrule, shiftSeries, vtimezone, wallClock } from './repeat.js';

const d = (y: number, m: number, day: number, h = 0, min = 0) => new Date(y, m - 1, day, h, min);

describe('repeat', () => {
  it('maps each choice to an RRULE', () => {
    expect(rrule('daily')).toBe('FREQ=DAILY');
    expect(rrule('weekly')).toBe('FREQ=WEEKLY');
    expect(rrule('monthly')).toBe('FREQ=MONTHLY');
    expect(rrule('weekdays')).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
  });

  it('lists occurrences in a window', () => {
    const first = d(2026, 11, 2, 9); // a Monday
    const weekly = occurrences(first, 'weekly', d(2026, 11, 10), d(2026, 11, 30));
    expect(weekly.map((x) => x.getDate())).toEqual([16, 23]);
    const weekdays = occurrences(first, 'weekdays', d(2026, 11, 6), d(2026, 11, 11));
    expect(weekdays.map((x) => x.getDay())).toEqual([5, 1, 2]);
    expect(weekdays.every((x) => x.getHours() === 9)).toBe(true);
    // The 31st skips months without one.
    const monthly = occurrences(d(2026, 1, 31, 9), 'monthly', d(2026, 1, 1), d(2026, 6, 1));
    expect(monthly.map((x) => x.getMonth() + 1)).toEqual([1, 3, 5]);
  });

  it('moves a series by the days an occurrence moved, at its new time', () => {
    const moved = shiftSeries(d(2026, 1, 5, 9), d(2026, 11, 9, 9), d(2026, 11, 10, 18, 30), false);
    expect(moved).toEqual(d(2026, 1, 6, 18, 30));
    expect(shiftSeries(d(2026, 1, 5), d(2026, 11, 9), d(2026, 11, 8), true)).toEqual(d(2026, 1, 4));
  });

  it('builds a VTIMEZONE that reads back the right offsets either side of DST', () => {
    const zone = 'America/Los_Angeles';
    const lines = vtimezone(zone, 2026);
    expect(lines).toContain('RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU');
    expect(lines).toContain('RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU');
    expect(lines).toContain('TZOFFSETTO:-0700');

    // A weekly 9 am event written with it stays at 9 am local in winter and summer.
    const start = new Date('2026-01-05T17:00:00Z'); // 09:00 PST
    const ics = buildIcs('u1@mantel', {
      title: 'Standup',
      start,
      end: new Date(start.getTime() + 1800e3),
      allDay: false,
      personIds: [],
      repeat: 'weekly',
      timeZone: zone,
    });
    expect(ics).toContain(`DTSTART;TZID=${zone}:20260105T090000`);
    const july = expandIcs(
      ics,
      'c',
      new Date('2026-07-06T00:00:00Z'),
      new Date('2026-07-07T00:00:00Z'),
    );
    expect(july).toHaveLength(1);
    expect(wallClock(new Date(july[0]!.start), zone)).toBe('2026-07-06T09:00:00');
    expect(july[0]!.recurring).toBe(true);
    expect(() => new ICAL.Component(ICAL.parse(ics))).not.toThrow();
  });

  it('handles zones without daylight saving', () => {
    expect(vtimezone('Asia/Tokyo', 2026)).toContain('TZOFFSETTO:+0900');
    expect(offsetMinutes('Asia/Kolkata', Date.UTC(2026, 0, 1))).toBe(330);
  });
});
