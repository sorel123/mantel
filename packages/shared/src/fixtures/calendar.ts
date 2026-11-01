import type { CalendarEvent, Countdown, Meal } from '../models.js';
import {
  addDays,
  atHour,
  daysBetween,
  startOfDay,
  startOfWeek,
  toIsoDate,
  toLocalIso,
} from '../time.js';
import { personColor } from './people.js';

interface Seed {
  offset: number;
  title: string;
  start?: number;
  end?: number;
  personIds: string[];
  location?: string;
  calendarId?: string;
  countdown?: boolean;
}

/** Fixed events around today, from the mockup. `offset` is days from today. */
const fixed: Seed[] = [
  {
    offset: 0,
    title: 'School drop-off',
    start: 7.5,
    end: 8.25,
    personIds: ['sam', 'leo'],
    location: 'Lincoln Elementary',
  },
  {
    offset: 0,
    title: 'Team standup',
    start: 9,
    end: 10,
    personIds: ['jay'],
    location: 'Video call',
    calendarId: 'cal-jay',
  },
  { offset: 0, title: 'Picture day', personIds: ['ava'], calendarId: 'cal-kids' },
  {
    offset: 0,
    title: 'Soccer practice',
    start: 15.5,
    end: 17,
    personIds: ['leo'],
    location: 'Riverside field',
    calendarId: 'cal-kids',
  },
  {
    offset: 0,
    title: 'Dinner with the Nguyens',
    start: 18.5,
    end: 20,
    personIds: ['jay', 'sam', 'ava', 'leo'],
    location: 'Our place',
  },
  {
    offset: 1,
    title: 'Dentist',
    start: 10,
    end: 11,
    personIds: ['ava'],
    location: 'Dr. Patel',
    calendarId: 'cal-kids',
  },
  { offset: 1, title: 'Farmers market', start: 13, end: 14, personIds: ['sam', 'jay'] },
  { offset: 2, title: "Leo's birthday party", personIds: ['leo'], countdown: true },
  {
    offset: 3,
    title: 'Date night',
    start: 19,
    end: 22,
    personIds: ['jay', 'sam'],
    location: 'Sitter: Maya',
  },
  {
    offset: 5,
    title: 'Piano recital',
    start: 16,
    end: 17.5,
    personIds: ['ava'],
    location: 'Community hall',
    countdown: true,
  },
  {
    offset: 7,
    title: 'Oil change',
    start: 8.5,
    end: 9.5,
    personIds: ['jay'],
    calendarId: 'cal-jay',
  },
  { offset: 18, title: 'Grandma visits', personIds: ['jay', 'sam', 'ava', 'leo'], countdown: true },
  {
    offset: 46,
    title: 'Winter break',
    personIds: ['ava', 'leo'],
    calendarId: 'cal-kids',
    countdown: true,
  },
  {
    offset: -2,
    title: 'Parent teacher night',
    start: 18,
    end: 19.5,
    personIds: ['sam'],
    calendarId: 'cal-sam',
  },
  {
    offset: -5,
    title: 'Book club',
    start: 19.5,
    end: 21,
    personIds: ['sam'],
    calendarId: 'cal-sam',
  },
];

/** Recurring-looking filler for the rest of the month grid, as in the mockup. */
const pool: Array<[string, string, number]> = [
  ['Swim lesson', 'leo', 16],
  ['Dance', 'ava', 17],
  ['Gym', 'jay', 6.5],
  ['Yoga', 'sam', 7],
  ['Scouts', 'leo', 18],
  ['Choir', 'ava', 15.5],
  ['Board meeting', 'jay', 14],
  ['Vet appointment', 'sam', 11],
];

const calendarFor = (personId: string) =>
  personId === 'jay' ? 'cal-jay' : personId === 'sam' ? 'cal-sam' : 'cal-kids';

function toEvent(day: Date, s: Seed, id: string): CalendarEvent {
  const allDay = s.start === undefined;
  const start = allDay ? startOfDay(day) : atHour(day, s.start!);
  const end = allDay ? addDays(startOfDay(day), 1) : atHour(day, s.end ?? s.start! + 1);
  return {
    id,
    calendarId: s.calendarId ?? 'cal-family',
    title: s.title,
    start: toLocalIso(start),
    end: toLocalIso(end),
    allDay,
    ...(s.location ? { location: s.location } : {}),
    personIds: s.personIds,
    color: personColor(s.personIds[0]),
    countdown: s.countdown ?? false,
  };
}

/** Every mock event from the start of last month to the end of next month, plus far countdowns. */
export function calendarEvents(now: Date): CalendarEvent[] {
  const today = startOfDay(now);
  const out: CalendarEvent[] = [];
  const fixedDays = new Set<string>();
  fixed.forEach((s, i) => {
    const day = addDays(today, s.offset);
    fixedDays.add(toIsoDate(day));
    out.push(toEvent(day, s, `evt-fixed-${i}`));
  });
  for (let m = -1; m <= 1; m++) {
    const base = new Date(today.getFullYear(), today.getMonth() + m, 1);
    const days = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    for (let d = 1; d <= days; d++) {
      const day = new Date(base.getFullYear(), base.getMonth(), d);
      if (Math.abs(daysBetween(today, day)) <= 7 && fixedDays.has(toIsoDate(day))) continue;
      const seed = (d * 7 + base.getMonth() * 13) % 11;
      const picks: number[] = [];
      if (seed < 4) picks.push((d + base.getMonth()) % pool.length);
      if (seed === 5) picks.push((d * 3) % pool.length);
      for (const k of picks) {
        const [title, personId, h] = pool[k]!;
        out.push(
          toEvent(
            day,
            {
              offset: 0,
              title,
              start: h,
              end: h + 1,
              personIds: [personId],
              calendarId: calendarFor(personId),
            },
            `evt-${toIsoDate(day)}-${k}`,
          ),
        );
      }
    }
  }
  // An all-day event over several days, drawn as a bar on Month.
  const tripStart = addDays(today, 10);
  out.push({
    id: 'evt-trip',
    calendarId: 'cal-family',
    title: 'Cabin weekend',
    start: toLocalIso(tripStart),
    end: toLocalIso(addDays(tripStart, 4)),
    allDay: true,
    personIds: ['jay', 'sam', 'ava', 'leo'],
    color: personColor('jay'),
    countdown: false,
  });
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

export function eventsInRange(now: Date, from: Date, to: Date): CalendarEvent[] {
  return calendarEvents(now).filter(
    (e) => new Date(e.end).getTime() > from.getTime() && new Date(e.start).getTime() < to.getTime(),
  );
}

export function countdowns(now: Date): Countdown[] {
  const today = startOfDay(now);
  return calendarEvents(now)
    .filter((e) => e.countdown && new Date(e.start).getTime() >= today.getTime())
    .map((e) => ({
      eventId: e.id,
      title: e.title,
      date: toIsoDate(new Date(e.start)),
      daysRemaining: daysBetween(today, new Date(e.start)),
      personIds: e.personIds,
      color: e.color,
    }));
}

const dinners = [
  'Tacos',
  'Salmon and rice',
  'Pasta night',
  'Leftovers',
  'Pizza Friday',
  'Grill out',
  'Roast chicken',
];

export function meals(now: Date, week?: Date): { weekStart: string; meals: Meal[] } {
  const start = startOfWeek(week ?? now);
  const out: Meal[] = [];
  for (let i = 0; i < 7; i++) {
    const date = toIsoDate(addDays(start, i));
    out.push({ date, slot: 'dinner', title: dinners[i]! });
    if (i === 5 || i === 6) out.push({ date, slot: 'breakfast', title: 'Pancakes' });
  }
  return { weekStart: toIsoDate(start), meals: out };
}
