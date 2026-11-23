import {
  DEFAULT_DIGEST_SETTINGS,
  inQuietHours,
  summariseActivity,
  type CalendarEvent,
  type Chore,
  type Settings,
} from '@mantel/shared';
import { settings as settingsFixture, weather as weatherFixture } from '@mantel/shared/fixtures';
import { describe, expect, it } from 'vitest';
import { openDb } from '../../db/index.js';
import { overdueSince } from '../../providers/real/lists-chores.js';
import { ActivityLog, dayWords } from '../activity/log.js';
import { wallTime } from '../import/zone.js';
import { assembleDigest, birthdayName, dayBounds } from './assemble.js';
import { DigestService } from './service.js';

const people = settingsFixture().people;
const sam = people.find((p) => p.id === 'sam')!;

const ev = (id: string, start: string, end: string, extra: Partial<CalendarEvent> = {}) =>
  ({
    id,
    calendarId: 'cal-family',
    title: id,
    start,
    end,
    allDay: false,
    personIds: [],
    color: '#000',
    countdown: false,
    ...extra,
  }) as CalendarEvent;

const chore = (id: string, extra: Partial<Chore> = {}): Chore => ({
  id,
  title: id,
  personId: 'sam',
  cadence: 'daily',
  stars: 1,
  doneCount: 0,
  target: 1,
  timeOfDay: 'any',
  ...extra,
});

const include = {
  events: true,
  chores: true,
  dinner: true,
  weather: true,
  birthdays: true,
  alerts: true,
};

describe('assembleDigest', () => {
  it('uses the household day, not the server’s, in Los Angeles', () => {
    // 07:00 in Los Angeles is 15:00 UTC; 23:30 local tonight is already tomorrow in UTC.
    const now = new Date('2026-11-21T15:00:00Z');
    const d = assembleDigest({
      now,
      timeZone: 'America/Los_Angeles',
      kind: 'morning',
      person: sam,
      include,
      events: [
        ev('Late call', '2026-11-21T23:30:00-08:00', '2026-11-22T00:00:00-08:00', {
          personIds: ['sam'],
        }),
        ev('Tomorrow brunch', '2026-11-22T10:00:00-08:00', '2026-11-22T11:00:00-08:00'),
        ev('Ava only', '2026-11-21T16:00:00-08:00', '2026-11-21T17:00:00-08:00', {
          personIds: ['ava'],
        }),
        ev('Grandma birthday', '2026-11-21T00:00:00-08:00', '2026-11-22T00:00:00-08:00', {
          allDay: true,
          title: "Grandma's birthday",
        }),
      ],
      calendars: [],
      leaveBy: [],
      chores: [chore('dishes'), chore('ava-thing', { personId: 'ava' })],
      meals: [{ date: '2026-11-21', slot: 'dinner', title: 'Tacos' }],
      weather: null,
      alerts: [],
    });
    expect(d.date).toBe('2026-11-21');
    expect(d.greeting).toBe('Good morning, Sam');
    expect(d.events.map((e) => e.title)).toEqual(['Late call']);
    expect(d.birthdays).toEqual(['Grandma']);
    expect(d.chores.map((c) => c.id)).toEqual(['dishes']);
    expect(d.dinner).toBe('Tacos');
    expect(d.headline).toBe("1 event, 1 chore, tacos for dinner, Grandma's birthday");
  });

  it('covers tomorrow in the evening preview, in Tokyo', () => {
    const now = new Date('2026-11-21T10:30:00Z'); // 19:30 in Tokyo
    const d = assembleDigest({
      now,
      timeZone: 'Asia/Tokyo',
      kind: 'evening',
      person: null,
      include,
      events: [ev('School trip', '2026-11-22T08:00:00+09:00', '2026-11-22T15:00:00+09:00')],
      calendars: [],
      leaveBy: [],
      chores: [chore('dishes'), chore('plants', { overdueSince: '2026-11-19' })],
      meals: [],
      weather: weatherFixture(now),
      alerts: [{ icon: 'trash', text: 'Trash goes out tonight', tone: 'warn' }],
    });
    expect(d.date).toBe('2026-11-22');
    expect(d.greeting).toBe('Tomorrow');
    expect(d.events).toHaveLength(1);
    // Tomorrow only carries chores already owed.
    expect(d.chores.map((c) => c.id)).toEqual(['plants']);
    expect(d.alerts).toHaveLength(1);
  });

  it('leaves out what a person turned off', () => {
    const d = assembleDigest({
      now: new Date('2026-11-21T15:00:00Z'),
      timeZone: 'UTC',
      kind: 'morning',
      person: sam,
      include: { ...include, chores: false, dinner: false },
      events: [],
      calendars: [],
      leaveBy: [],
      chores: [chore('dishes')],
      meals: [{ date: '2026-11-21', slot: 'dinner', title: 'Tacos' }],
      weather: null,
      alerts: [],
    });
    expect(d.chores).toEqual([]);
    expect(d.dinner).toBeNull();
    expect(d.headline).toBe('Nothing on the calendar');
  });

  it('knows DST days are 23 and 25 hours long', () => {
    const spring = dayBounds('2026-03-08', 'America/New_York');
    expect((spring.to.getTime() - spring.from.getTime()) / 3_600_000).toBe(23);
    const fall = dayBounds('2026-11-01', 'America/New_York');
    expect((fall.to.getTime() - fall.from.getTime()) / 3_600_000).toBe(25);
  });

  it('reads birthday names', () => {
    expect(birthdayName("Ava's birthday")).toBe('Ava');
    expect(birthdayName('Birthday: Leo')).toBe('Leo');
    expect(birthdayName('Grandpa bday party')).toBe('Grandpa');
  });
});

describe('quiet hours', () => {
  const q = { enabled: true, from: '21:30', to: '06:30' };
  it('wraps past midnight', () => {
    expect(inQuietHours(22 * 60, q)).toBe(true);
    expect(inQuietHours(3 * 60, q)).toBe(true);
    expect(inQuietHours(6 * 60 + 30, q)).toBe(false);
    expect(inQuietHours(12 * 60, q)).toBe(false);
  });
  it('works within a day and can be off', () => {
    expect(inQuietHours(13 * 60, { enabled: true, from: '12:00', to: '14:00' })).toBe(true);
    expect(inQuietHours(15 * 60, { enabled: true, from: '12:00', to: '14:00' })).toBe(false);
    expect(inQuietHours(22 * 60, { ...q, enabled: false })).toBe(false);
  });
});

describe('chore rollover', () => {
  const counts = (days: Record<string, number>) => new Map(Object.entries(days));
  it('a daily chore missed since Tuesday is owed since Tuesday', () => {
    expect(
      overdueSince({
        cadence: 'daily',
        target: 1,
        createdDay: '2026-11-01',
        today: '2026-11-20', // Friday
        doneThisPeriod: 0,
        counts: counts({ '2026-11-16': 1 }), // done Monday, missed Tue, Wed, Thu
      }),
    ).toBe('2026-11-17');
  });
  it('doing it today clears it', () => {
    expect(
      overdueSince({
        cadence: 'daily',
        target: 1,
        createdDay: '2026-11-01',
        today: '2026-11-20',
        doneThisPeriod: 1,
        counts: counts({}),
      }),
    ).toBeUndefined();
  });
  it('never reaches back before the chore was made', () => {
    expect(
      overdueSince({
        cadence: 'daily',
        target: 1,
        createdDay: '2026-11-19',
        today: '2026-11-20',
        doneThisPeriod: 0,
        counts: counts({}),
      }),
    ).toBe('2026-11-19');
  });
  it('a weekly chore missed last week is owed since that Monday', () => {
    expect(
      overdueSince({
        cadence: 'weekly',
        target: 2,
        createdDay: '2026-10-01',
        today: '2026-11-20',
        doneThisPeriod: 0,
        counts: counts({ '2026-11-12': 1, '2026-11-05': 1, '2026-11-06': 1 }),
      }),
    ).toBe('2026-11-09');
  });
});

/* ---------- the scheduler ---------- */

function harness(opts: { timeZone: string; digest?: Partial<Settings['digest']>; at: string }) {
  let now = new Date(opts.at);
  const s: Settings = {
    ...settingsFixture(),
    timezone: opts.timeZone,
    people: [sam],
    digest: { ...structuredClone(DEFAULT_DIGEST_SETTINGS), ...opts.digest },
  };
  const sent: Array<{ kind: string; title: string; url: string; people?: string[] }> = [];
  let events: CalendarEvent[] = [];
  let meals: Array<{ date: string; slot: string; title: string }> = [];
  let chores: Chore[] = [];
  const service = new DigestService({
    db: openDb(':memory:'),
    now: () => now,
    settings: () => s,
    providers: {
      calendar: {
        events: async () => ({ events }),
        calendars: async () => [],
      } as never,
      weather: {
        weather: async () => {
          throw new Error('offline');
        },
        commute: async () => ({ leaveBy: [] }),
      } as never,
      lists: { chores: async () => ({ weekStart: '2026-11-16', chores, stars: [] }) } as never,
    },
    meals: { todayMeals: async () => ({ meals }) },
    push: {
      notify: async (kind, message, o) => {
        sent.push({
          kind,
          title: message.title,
          url: message.url ?? '',
          ...(o?.exactPeople ? { people: o.exactPeople } : {}),
        });
        return 1;
      },
      phonesOf: () => 1,
      recordMock: () => undefined,
    },
    registry: null,
    mock: false,
  });
  return {
    service,
    sent,
    set: (iso: string) => (now = new Date(iso)),
    setEvents: (e: CalendarEvent[]) => (events = e),
    setMeals: (m: typeof meals) => (meals = m),
    setChores: (c: Chore[]) => (chores = c),
  };
}

describe('the schedule', () => {
  it('sends the morning digest at 7:00 household time, once', async () => {
    const h = harness({
      timeZone: 'America/Detroit',
      at: '2026-11-23T11:59:00Z', // Monday 06:59 in Detroit
      digest: { nudges: { ...DEFAULT_DIGEST_SETTINGS.nudges, dinner: false, eventMinutes: 0 } },
    });
    await h.service.tick();
    expect(h.sent).toEqual([]);
    h.set('2026-11-23T12:00:00Z');
    await h.service.tick();
    h.set('2026-11-23T12:05:00Z');
    await h.service.tick();
    expect(h.sent.filter((m) => m.kind === 'digest')).toEqual([
      {
        kind: 'digest',
        title: 'Good morning, Sam',
        url: '/app#digest/morning%3Asam',
        people: ['sam'],
      },
    ]);
  });

  it('uses the weekend time on Saturday', async () => {
    const h = harness({ timeZone: 'Europe/London', at: '2026-11-21T07:00:00Z' }); // Sat 07:00
    await h.service.tick();
    expect(h.sent.filter((m) => m.kind === 'digest')).toEqual([]);
    h.set('2026-11-21T08:00:00Z');
    await h.service.tick();
    expect(h.sent.filter((m) => m.kind === 'digest')).toHaveLength(1);
  });

  it('sends a 2:30 digest at 3:00 on the night the clocks spring forward', async () => {
    const p = { personId: 'sam', weekdayTime: '02:30', weekendTime: '02:30' };
    const h = harness({
      timeZone: 'America/New_York',
      at: '2026-03-08T06:59:00Z', // 01:59 EST
      digest: {
        people: [{ ...DEFAULT_PERSON, ...p }],
        quiet: { enabled: false, from: '21:30', to: '06:30' },
      },
    });
    await h.service.tick();
    expect(h.sent.filter((m) => m.kind === 'digest')).toHaveLength(0);
    h.set('2026-03-08T07:00:00Z'); // 03:00 EDT
    await h.service.tick();
    expect(h.sent.filter((m) => m.kind === 'digest')).toHaveLength(1);
  });

  it('sends once when 1:30 happens twice as the clocks fall back', async () => {
    const p = { personId: 'sam', weekdayTime: '01:30', weekendTime: '01:30' };
    const h = harness({
      timeZone: 'America/New_York',
      at: '2026-11-01T05:30:00Z', // 01:30 EDT
      digest: {
        people: [{ ...DEFAULT_PERSON, ...p }],
        quiet: { enabled: false, from: '21:30', to: '06:30' },
      },
    });
    await h.service.tick();
    h.set('2026-11-01T06:30:00Z'); // 01:30 EST, an hour later
    await h.service.tick();
    expect(h.sent.filter((m) => m.kind === 'digest')).toHaveLength(1);
  });

  it('holds everything in quiet hours and sends when they end', async () => {
    const p = { personId: 'sam', weekdayTime: '06:00', weekendTime: '06:00' };
    const h = harness({
      timeZone: 'UTC',
      at: '2026-11-23T06:00:00Z',
      digest: { people: [{ ...DEFAULT_PERSON, ...p }] },
    });
    await h.service.tick();
    expect(h.sent).toEqual([]);
    h.set('2026-11-23T06:30:00Z');
    await h.service.tick();
    expect(h.sent.filter((m) => m.kind === 'digest')).toHaveLength(1);
  });

  it('reminds about an event 30 minutes ahead, to the people on it, once', async () => {
    const h = harness({ timeZone: 'UTC', at: '2026-11-23T13:31:00Z' });
    h.setEvents([
      ev('Dentist', '2026-11-23T14:00:00Z', '2026-11-23T15:00:00Z', {
        personIds: ['sam'],
        location: '12 Main St',
      }),
    ]);
    h.setMeals([{ date: '2026-11-23', slot: 'dinner', title: 'Soup' }]);
    await h.service.tick();
    h.set('2026-11-23T13:32:00Z');
    await h.service.tick();
    const nudges = h.sent.filter((m) => m.kind === 'nudge');
    expect(nudges).toEqual([
      {
        kind: 'nudge',
        title: 'Dentist in 29 min',
        url: '/app#calendar/Dentist',
        people: ['sam'],
      },
    ]);
  });

  it('says dinner is not planned, and stays quiet when it is', async () => {
    const h = harness({ timeZone: 'UTC', at: '2026-11-23T15:00:00Z' });
    await h.service.tick();
    expect(h.sent.find((m) => m.title === 'Dinner is not planned')?.url).toBe(
      '/app#meals/2026-11-23',
    );
    const h2 = harness({ timeZone: 'UTC', at: '2026-11-23T15:00:00Z' });
    h2.setMeals([{ date: '2026-11-23', slot: 'dinner', title: 'Soup' }]);
    await h2.service.tick();
    expect(h2.sent.find((m) => m.title === 'Dinner is not planned')).toBeUndefined();
  });

  it('nudges about open routine steps in the late afternoon', async () => {
    const h = harness({ timeZone: 'UTC', at: '2026-11-23T16:30:00Z' });
    h.setMeals([{ date: '2026-11-23', slot: 'dinner', title: 'Soup' }]);
    h.setChores([
      chore('teeth', { routineId: 'routine-bedtime' }),
      chore('bed', { routineId: 'routine-bedtime', doneCount: 1 }),
      chore('dishes'),
    ]);
    await h.service.tick();
    expect(h.sent.filter((m) => m.kind === 'nudge')).toEqual([
      {
        kind: 'nudge',
        title: 'Sam, 1 routine step left',
        url: '/app#chores/teeth',
        people: ['sam'],
      },
    ]);
  });

  it('says when the next digests go', () => {
    const h = harness({ timeZone: 'America/Detroit', at: '2026-11-21T18:00:00Z' }); // Sat 13:00
    const s = h.service.status();
    // Sunday is the weekend: 08:00 EST.
    expect(s.people[0]!.nextMorning).toBe('2026-11-22T08:00:00-05:00');
    expect(s.people[0]!.nextEvening).toBeNull();
  });
});

const DEFAULT_PERSON = {
  personId: 'sam',
  morning: true,
  weekdayTime: '07:00',
  weekendTime: '08:00',
  evening: false,
  eveningTime: '19:30',
  include,
  routineNudge: true,
};

/* ---------- the activity log ---------- */

describe('activity log', () => {
  it('says who added what to which list, and folds a run of adds', async () => {
    const now = new Date('2026-11-23T12:00:00Z');
    const items: Array<{ id: string; text: string; done: boolean }> = [
      { id: 'i1', text: 'Bread', done: false },
    ];
    const emitted: string[] = [];
    let writer: string | null = null;
    const log = new ActivityLog({
      db: openDb(':memory:'),
      now: () => now,
      timeZone: () => 'UTC',
      people: () => people,
      emit: (e) => emitted.push(e.type),
      writer: () => writer,
      device: (id) => (id === 'phone-sam' ? { name: "Sam's phone", personId: 'sam' } : null),
      sources: {
        lists: async () => [
          {
            id: 'list-grocery',
            name: 'Groceries',
            source: 'local',
            items: items.map((i, n) => ({ ...i, sort: n })) as never,
          },
        ],
        chores: async () => [],
        events: async () => ({ events: [], calendars: [] }),
        meals: async () => [],
        notes: () => [],
      },
    });
    await log.prime();
    writer = 'phone-sam';
    items.push({ id: 'i2', text: 'Milk', done: false }, { id: 'i3', text: 'Eggs', done: false });
    await log.diffLists(true);
    const entries = log.list();
    expect(entries.map((e) => e.subject).sort()).toEqual(['Eggs', 'Milk']);
    expect(entries[0]!.who).toBe('Sam');
    expect(emitted).toEqual(['activity.added', 'activity.added']);
    expect(summariseActivity(entries).map((l) => l.text)).toEqual(['2 things added to Groceries']);
    expect(summariseActivity(entries.slice(0, 1))[0]!.text).toMatch(
      /^Sam added (Milk|Eggs) to Groceries$/,
    );
  });

  it('notices an added and a moved event', async () => {
    const now = new Date('2026-11-23T12:00:00Z'); // Monday
    let events = [ev('Swim', '2026-11-24T17:00:00Z', '2026-11-24T18:00:00Z')];
    const log = new ActivityLog({
      db: openDb(':memory:'),
      now: () => now,
      timeZone: () => 'UTC',
      people: () => people,
      emit: () => undefined,
      writer: () => null,
      device: () => null,
      sources: {
        lists: async () => [],
        chores: async () => [],
        events: async () => ({ events, calendars: [] }),
        meals: async () => [],
        notes: () => [],
      },
    });
    await log.prime();
    events = [
      ev('Swim', '2026-11-25T17:00:00Z', '2026-11-25T18:00:00Z'),
      ev('Dentist', '2026-11-26T14:00:00Z', '2026-11-26T15:00:00Z'),
    ];
    await log.diffEvents(true);
    const lines = summariseActivity(log.list())
      .map((l) => l.text)
      .sort();
    expect(lines).toEqual(['Dentist added on Thursday', 'Swim moved to Wednesday 5:00 PM']);
  });

  it('names days the way people say them', () => {
    const now = new Date('2026-11-23T12:00:00Z');
    expect(dayWords('2026-11-23T20:00:00Z', now, 'UTC')).toBe('today');
    expect(dayWords('2026-11-24', now, 'UTC')).toBe('tomorrow');
    expect(dayWords('2026-11-27', now, 'UTC')).toBe('Friday');
    expect(dayWords('2026-12-25', now, 'UTC')).toBe('Dec 25');
  });
});

it('wallTime finds 7:00 in Detroit', () => {
  expect(wallTime('2026-11-23', '07:00', 'America/Detroit').toISOString()).toBe(
    '2026-11-23T12:00:00.000Z',
  );
});
