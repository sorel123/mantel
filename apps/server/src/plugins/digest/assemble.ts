/**
 * Putting a digest together from what the other parts already serve. Pure: everything it needs
 * comes in as arguments, so the tests can run it in any time zone and across DST changes.
 */
import type {
  Calendar,
  CalendarEvent,
  Chore,
  Digest,
  DigestChore,
  DigestEvent,
  DigestInclude,
  DigestKind,
  LeaveBy,
  Meal,
  Person,
  WeatherSnapshot,
} from '@mantel/shared';
import { dateInZone, isoInZone, zoned } from '../../providers/real/weather-time.js';
import { shiftDate, wallTime } from '../import/zone.js';

export interface DigestInput {
  now: Date;
  timeZone: string;
  kind: DigestKind;
  /** Whose digest; null for the household (the wall card). */
  person: Person | null;
  include: DigestInclude;
  events: CalendarEvent[];
  calendars: Calendar[];
  leaveBy: LeaveBy[];
  chores: Chore[];
  meals: Meal[];
  weather: WeatherSnapshot | null;
  /** Lines from other plugins (trash day...). */
  alerts: Digest['alerts'];
  summary?: string | undefined;
}

const BIRTHDAY = /\b(birthday|bday|b-day)\b/i;

/** The day a digest covers: today for the morning, tomorrow for the evening preview. */
export function digestDate(now: Date, timeZone: string, kind: DigestKind): string {
  const today = dateInZone(now, timeZone);
  return kind === 'evening' ? shiftDate(today, 1) : today;
}

/** The instants a local day starts and ends (23 or 25 hours long across a DST change). */
export function dayBounds(date: string, timeZone: string): { from: Date; to: Date } {
  return {
    from: wallTime(date, '00:00', timeZone),
    to: wallTime(shiftDate(date, 1), '00:00', timeZone),
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const lowerFirst = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);

/** "Birthday: Ava" or "Ava's birthday" → "Ava". */
export function birthdayName(title: string): string {
  const cleaned = title
    .replace(/[🎂🎉🎈]/gu, '')
    .replace(/(?:['’]s)?\s*\b(birthday|bday|b-day)\b\s*(party)?/i, '')
    .replace(/^[\s:–-]+|[\s:–-]+$/g, '')
    .trim();
  return cleaned || title.trim();
}

function forPerson(e: CalendarEvent, person: Person | null): boolean {
  if (!person) return true;
  // Family events (nobody named) go to everyone.
  return e.personIds.length === 0 || e.personIds.includes(person.id);
}

export function assembleDigest(i: DigestInput): Digest {
  const date = digestDate(i.now, i.timeZone, i.kind);
  const { from, to } = dayBounds(date, i.timeZone);
  const mealsCals = new Set(i.calendars.filter((c) => c.isMeals).map((c) => c.id));
  const calName = new Map(i.calendars.map((c) => [c.id, c.name]));

  const onDay = i.events.filter(
    (e) =>
      !mealsCals.has(e.calendarId) &&
      Date.parse(e.start) < to.getTime() &&
      Date.parse(e.end) > from.getTime(),
  );
  const isBirthday = (e: CalendarEvent) =>
    BIRTHDAY.test(e.title) || BIRTHDAY.test(calName.get(e.calendarId) ?? '');

  const leave = new Map(i.leaveBy.filter((l) => l.eventId).map((l) => [l.eventId!, l.leaveBy]));
  const events: DigestEvent[] = i.include.events
    ? onDay
        .filter((e) => !isBirthday(e) && forPerson(e, i.person))
        .sort(
          (a, b) =>
            Number(b.allDay) - Number(a.allDay) || Date.parse(a.start) - Date.parse(b.start),
        )
        .map((e) => ({
          id: e.id,
          title: e.title,
          start: e.start,
          end: e.end,
          allDay: e.allDay,
          ...(e.location ? { location: e.location } : {}),
          personIds: e.personIds,
          color: e.color,
          ...(leave.has(e.id) ? { leaveBy: leave.get(e.id)! } : {}),
        }))
    : [];

  const birthdays = i.include.birthdays
    ? onDay.filter(isBirthday).map((e) => birthdayName(e.title))
    : [];

  const chores: DigestChore[] = i.include.chores
    ? i.chores
        .filter((c) => !i.person || c.personId === i.person.id)
        .filter((c) => {
          const open = c.doneCount < c.target;
          // Tomorrow's preview only carries what is already owed.
          if (i.kind === 'evening') return open && !!c.overdueSince;
          // A weekly chore already done this week is not news.
          return c.cadence === 'daily' || open;
        })
        .map((c) => ({
          id: c.id,
          title: c.title,
          personId: c.personId,
          done: c.doneCount >= c.target,
          timeOfDay: c.timeOfDay,
          ...(c.routineId ? { routineId: c.routineId } : {}),
          ...(c.icon ? { icon: c.icon } : {}),
          ...(c.overdueSince ? { overdueSince: c.overdueSince } : {}),
        }))
    : [];

  const dinner = i.include.dinner
    ? (i.meals.find((m) => m.date === date && m.slot === 'dinner')?.title ?? null)
    : null;

  const weather = i.include.weather ? weatherLine(i.weather, date, i.kind) : undefined;
  const alerts = i.include.alerts ? i.alerts : [];

  const name = i.person?.name;
  const greeting =
    i.kind === 'evening'
      ? name
        ? `Tomorrow, ${name}`
        : 'Tomorrow'
      : `${greetingFor(zoned(i.now, i.timeZone).hour)}${name ? `, ${name}` : ''}`;

  const open = chores.filter((c) => !c.done);
  const parts: string[] = [];
  if (i.include.events)
    parts.push(events.length ? plural(events.length, 'event') : 'Nothing on the calendar');
  if (i.include.chores && open.length) parts.push(plural(open.length, 'chore'));
  if (i.include.dinner && dinner) parts.push(`${lowerFirst(dinner)} for dinner`);
  if (birthdays.length) parts.push(`${birthdays[0]}'s birthday`);
  const headline = parts.length ? capitalise(parts.join(', ')) : 'A quiet day';

  return {
    personId: i.person?.id ?? null,
    kind: i.kind,
    date,
    generatedAt: isoInZone(i.now, i.timeZone),
    greeting,
    headline,
    ...(i.summary ? { summary: i.summary } : {}),
    ...(weather ? { weather } : {}),
    events,
    chores,
    dinner,
    birthdays,
    alerts,
  };
}

const capitalise = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

const CONDITION_WORDS: Record<string, string> = {
  clear: 'Clear',
  partly_cloudy: 'Partly cloudy',
  cloudy: 'Cloudy',
  fog: 'Foggy',
  drizzle: 'Drizzle',
  rain: 'Rain',
  snow: 'Snow',
  sleet: 'Sleet',
  storm: 'Storms',
  wind: 'Windy',
};

/** "Sunny, 18° now, high 22°" for today; "Rain, 12° to 17°" for tomorrow. */
export function weatherLine(
  w: WeatherSnapshot | null,
  date: string,
  kind: DigestKind,
): Digest['weather'] {
  if (!w) return undefined;
  const day = w.daily.find((d) => d.date === date) ?? (kind === 'morning' ? w.daily[0] : undefined);
  const r = (n: number) => `${Math.round(n)}°`;
  let line: string;
  let icon: string;
  if (kind === 'morning') {
    icon = w.current.condition;
    line = `${w.current.summary || CONDITION_WORDS[w.current.condition] || 'Weather'}, ${r(w.current.temp)} now`;
    if (day) line += `, high ${r(day.high)}`;
    if (day && day.precipChance >= 40) line += `, ${day.precipChance}% chance of rain`;
  } else {
    if (!day) return undefined;
    icon = day.condition;
    line = `${CONDITION_WORDS[day.condition] ?? 'Weather'}, ${r(day.low)} to ${r(day.high)}`;
    if (day.precipChance >= 40) line += `, ${day.precipChance}% chance of rain`;
  }
  const alert =
    w.alerts.find((a) => a.severity === 'severe' || a.severity === 'extreme') ?? w.alerts[0];
  return { line, icon, ...(alert ? { warning: alert.headline } : {}) };
}
