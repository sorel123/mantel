import { fromIsoDate } from '@mantel/shared';
import { describe, expect, it } from 'vitest';
import { buildIcs, expandIcs } from './ics.js';

const VTZ = `BEGIN:VTIMEZONE
TZID:America/Los_Angeles
BEGIN:DAYLIGHT
TZOFFSETFROM:-0800
TZOFFSETTO:-0700
TZNAME:PDT
DTSTART:20070311T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0700
TZOFFSETTO:-0800
TZNAME:PST
DTSTART:20071104T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE`;

const wrap = (body: string) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:test\r\n${VTZ}\r\n${body}\r\nEND:VCALENDAR\r\n`.replace(
    /\r?\n/g,
    '\r\n',
  );

describe('expandIcs', () => {
  it('reads a zoned one-off event', () => {
    const ics = wrap(`BEGIN:VEVENT
UID:one@test
DTSTAMP:20261001T000000Z
DTSTART;TZID=America/Los_Angeles:20261031T090000
DTEND;TZID=America/Los_Angeles:20261031T100000
SUMMARY:Team standup
LOCATION:Video call
END:VEVENT`);
    const [e, ...rest] = expandIcs(
      ics,
      'icloud:/cal/',
      new Date('2026-10-01'),
      new Date('2026-12-01'),
    );
    expect(rest).toHaveLength(0);
    expect(e!.title).toBe('Team standup');
    expect(e!.location).toBe('Video call');
    expect(new Date(e!.start).toISOString()).toBe('2026-10-31T16:00:00.000Z');
    expect(new Date(e!.end).toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect(e!.allDay).toBe(false);
  });

  it('expands a weekly series across a DST change, with an EXDATE and a moved occurrence', () => {
    const ics = wrap(`BEGIN:VEVENT
UID:swim@test
DTSTAMP:20261001T000000Z
DTSTART;TZID=America/Los_Angeles:20261020T160000
DTEND;TZID=America/Los_Angeles:20261020T170000
RRULE:FREQ=WEEKLY;COUNT=5
EXDATE;TZID=America/Los_Angeles:20261027T160000
SUMMARY:Swim lesson
END:VEVENT
BEGIN:VEVENT
UID:swim@test
DTSTAMP:20261001T000000Z
RECURRENCE-ID;TZID=America/Los_Angeles:20261103T160000
DTSTART;TZID=America/Los_Angeles:20261104T170000
DTEND;TZID=America/Los_Angeles:20261104T180000
SUMMARY:Swim lesson (moved)
END:VEVENT`);
    const got = expandIcs(ics, 'c', new Date('2026-10-01'), new Date('2026-12-31'));
    expect(got.map((e) => [e.title, new Date(e.start).toISOString()])).toEqual([
      ['Swim lesson', '2026-10-20T23:00:00.000Z'],
      ['Swim lesson (moved)', '2026-11-05T01:00:00.000Z'],
      ['Swim lesson', '2026-11-11T00:00:00.000Z'],
      ['Swim lesson', '2026-11-18T00:00:00.000Z'],
    ]);
    expect(new Set(got.map((e) => e.uid)).size).toBe(4);
  });

  it('only returns occurrences inside the range', () => {
    const ics = wrap(`BEGIN:VEVENT
UID:gym@test
DTSTAMP:20261001T000000Z
DTSTART;TZID=America/Los_Angeles:20200106T063000
DTEND;TZID=America/Los_Angeles:20200106T073000
RRULE:FREQ=DAILY
SUMMARY:Gym
END:VEVENT`);
    const got = expandIcs(
      ics,
      'c',
      new Date('2026-11-02T00:00:00Z'),
      new Date('2026-11-05T00:00:00Z'),
    );
    expect(got).toHaveLength(3);
  });

  it('treats DATE values as all-day local dates with an exclusive end', () => {
    const ics = wrap(`BEGIN:VEVENT
UID:break@test
DTSTAMP:20261001T000000Z
DTSTART;VALUE=DATE:20261221
DTEND;VALUE=DATE:20270104
SUMMARY:⭐ Winter break
END:VEVENT`);
    const [e] = expandIcs(ics, 'c', new Date('2026-12-01'), new Date('2027-02-01'));
    expect(e!.allDay).toBe(true);
    expect(new Date(e!.start).getTime()).toBe(fromIsoDate('2026-12-21').getTime());
    expect(new Date(e!.end).getTime()).toBe(fromIsoDate('2027-01-04').getTime());
  });

  it('skips cancelled events', () => {
    const ics = wrap(`BEGIN:VEVENT
UID:x@test
DTSTAMP:20261001T000000Z
DTSTART:20261101T180000Z
DTEND:20261101T190000Z
STATUS:CANCELLED
SUMMARY:Gone
END:VEVENT`);
    expect(expandIcs(ics, 'c', new Date('2026-10-01'), new Date('2026-12-01'))).toEqual([]);
  });
});

describe('buildIcs', () => {
  it('round-trips a timed event with people and awkward text', () => {
    const ev = {
      title:
        'Pizza, games; and a very long title that needs folding because it is far past the line limit',
      start: new Date('2026-11-06T02:00:00Z'),
      end: new Date('2026-11-06T03:00:00Z'),
      allDay: false,
      personIds: ['jay', 'leo'],
    };
    const ics = buildIcs('abc@mantel', ev, new Date('2026-10-31T00:00:00Z'));
    expect(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    const [e] = expandIcs(ics, 'c', new Date('2026-11-01'), new Date('2026-11-30'));
    expect(e!.title).toBe(ev.title);
    expect(e!.personIds).toEqual(['jay', 'leo']);
    expect(new Date(e!.start).toISOString()).toBe('2026-11-06T02:00:00.000Z');
  });

  it('writes all-day events as DATE values', () => {
    const ics = buildIcs('d@mantel', {
      title: 'Picture day',
      start: fromIsoDate('2026-11-12'),
      end: fromIsoDate('2026-11-13'),
      allDay: true,
      personIds: [],
    });
    expect(ics).toContain('DTSTART;VALUE=DATE:20261112');
    expect(ics).toContain('DTEND;VALUE=DATE:20261113');
  });
});
