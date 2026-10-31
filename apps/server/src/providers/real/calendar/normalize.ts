/**
 * Pure mapping from source data to the contract: calendar preferences, people, colours,
 * countdown tags and the meal plan. No I/O, so it is easy to test.
 */
import type { Calendar, CalendarEvent, Countdown, Meal, MealSlot, Person } from '@mantel/shared';
import { addDays, daysBetween, startOfDay, toIsoDate } from '@mantel/shared';
import type { CalendarPrefs, RawEvent, SourceCalendar } from './types.js';

const FALLBACK_COLOR = '#246B5B';
const COUNTDOWN_TAG = /#countdown\b/i;
const STAR = /[⭐\u{1F31F}]️?/u;

/** Turn `#RRGGBBAA` (iCloud) into `#RRGGBB`; pass anything else through. */
export function cssColor(c: string | undefined): string {
  if (!c) return FALLBACK_COLOR;
  const m = /^#([0-9a-f]{6})[0-9a-f]{2}$/i.exec(c.trim());
  return m ? `#${m[1]}` : c.trim();
}

export function isEnabled(cal: SourceCalendar, prefs: CalendarPrefs): boolean {
  return prefs.calendars[cal.id]?.enabled ?? cal.selected;
}

/** Calendars named "Meals" are the meal plan unless the setup page says otherwise. */
export function isMeals(cal: SourceCalendar, prefs: CalendarPrefs): boolean {
  return prefs.calendars[cal.id]?.isMeals ?? /^meals?$/i.test(cal.name.trim());
}

/** People a calendar belongs to: the setup page's choice, else people whose settings list it. */
export function calendarPeople(calId: string, prefs: CalendarPrefs, people: Person[]): string[] {
  const chosen = prefs.calendars[calId]?.personIds;
  if (chosen) return people.filter((p) => chosen.includes(p.id)).map((p) => p.id);
  return people.filter((p) => p.calendarIds.includes(calId)).map((p) => p.id);
}

export function toCalendar(cal: SourceCalendar, prefs: CalendarPrefs, people: Person[]): Calendar {
  const pref = prefs.calendars[cal.id] ?? {};
  return {
    id: cal.id,
    name: pref.name?.trim() || cal.name,
    source: cal.source,
    color: cssColor(pref.color || cal.color),
    personIds: calendarPeople(cal.id, prefs, people),
    readOnly: cal.readOnly,
    isMeals: isMeals(cal, prefs),
  };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** People named in a title, by whole word ("Leo", "Leo's"), in household order. */
export function mentionedPeople(title: string, people: Person[]): string[] {
  return people
    .filter((p) => p.name.trim() && new RegExp(`\\b${escapeRe(p.name.trim())}\\b`).test(title))
    .map((p) => p.id);
}

/**
 * Who an event is for:
 * - people stored on the event (quick add) win;
 * - on a shared calendar, naming some of its people narrows the event to them
 *   ("Leo soccer" on the Kids calendar is Leo's);
 * - otherwise named people are added to the calendar's people ("Lunch with Sam" on Jay's
 *   calendar is Jay's and Sam's).
 */
export function eventPeople(raw: RawEvent, calendar: Calendar, people: Person[]): string[] {
  const known = new Set(people.map((p) => p.id));
  if (raw.personIds?.length) return raw.personIds.filter((id) => known.has(id));
  const owners = calendar.personIds;
  const named = mentionedPeople(raw.title, people);
  if (!named.length) return owners;
  if (owners.length > 1 && named.every((id) => owners.includes(id))) return named;
  const all = new Set([...owners, ...named]);
  return people.filter((p) => all.has(p.id)).map((p) => p.id);
}

export function isCountdown(raw: Pick<RawEvent, 'title' | 'description'>): boolean {
  const text = `${raw.title}\n${raw.description ?? ''}`;
  return COUNTDOWN_TAG.test(text) || STAR.test(text);
}

/** The title without countdown tags. */
export function cleanTitle(title: string): string {
  return (
    title
      .replace(new RegExp(COUNTDOWN_TAG.source, 'gi'), '')
      .replace(new RegExp(STAR.source, 'gu'), '')
      .replace(/\s{2,}/g, ' ')
      .trim() || title.trim()
  );
}

export function toEvent(raw: RawEvent, calendar: Calendar, people: Person[]): CalendarEvent {
  const personIds = eventPeople(raw, calendar, people);
  const first = people.find((p) => p.id === personIds[0]);
  return {
    id: `${calendar.id}|${raw.uid}`,
    calendarId: calendar.id,
    title: cleanTitle(raw.title),
    start: raw.start,
    end: raw.end,
    allDay: raw.allDay,
    ...(raw.location?.trim() ? { location: raw.location.trim() } : {}),
    personIds,
    color: first?.color ?? calendar.color,
    countdown: isCountdown(raw),
  };
}

/** Upcoming tagged events, soonest first. Events already under way are left out. */
export function countdownsFrom(events: CalendarEvent[], now: Date, limit = 12): Countdown[] {
  const today = startOfDay(now).getTime();
  const seen = new Set<string>();
  return events
    .filter((e) => e.countdown && new Date(e.start).getTime() >= today)
    .sort((a, b) => a.start.localeCompare(b.start))
    .filter((e) => {
      // A recurring tagged event counts down to its next occurrence only.
      const key = `${e.calendarId}|${e.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map((e) => ({
      eventId: e.id,
      title: e.title,
      date: toIsoDate(new Date(e.start)),
      daysRemaining: daysBetween(now, new Date(e.start)),
      personIds: e.personIds,
      color: e.color,
    }));
}

const SLOT_PREFIX = /^\s*(breakfast|brunch|lunch|dinner|supper|snack)\s*[:\-–—]\s*/i;

/** The meal slot and dish for a meal-calendar event: a "Lunch:" prefix wins, else the time of day. */
export function mealSlot(raw: Pick<RawEvent, 'title' | 'start' | 'allDay'>): {
  slot: MealSlot;
  title: string;
} {
  const m = SLOT_PREFIX.exec(raw.title);
  if (m) {
    const word = m[1]!.toLowerCase();
    const slot: MealSlot =
      word === 'breakfast' || word === 'brunch'
        ? 'breakfast'
        : word === 'lunch'
          ? 'lunch'
          : word === 'snack'
            ? 'other'
            : 'dinner';
    return { slot, title: raw.title.slice(m[0].length).trim() || raw.title.trim() };
  }
  if (raw.allDay) return { slot: 'dinner', title: raw.title.trim() };
  const d = new Date(raw.start);
  const h = d.getHours() + d.getMinutes() / 60;
  const slot: MealSlot = h < 10.5 ? 'breakfast' : h < 15 ? 'lunch' : 'dinner';
  return { slot, title: raw.title.trim() };
}

const slotOrder: Record<MealSlot, number> = { breakfast: 0, lunch: 1, dinner: 2, other: 3 };

/** Meals for the seven days from `weekStart`, one per event per day it covers. */
export function mealsFrom(raws: Array<RawEvent & { eventId: string }>, weekStart: Date): Meal[] {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const out: Meal[] = [];
  for (const raw of raws) {
    const { slot, title } = mealSlot(raw);
    const s = new Date(raw.start).getTime();
    const e = new Date(raw.end).getTime();
    for (const day of days) {
      const ds = day.getTime();
      const de = addDays(day, 1).getTime();
      // Timed meals belong to the day they start; all-day ones to every day they cover.
      const hit = raw.allDay ? s < de && e > ds : s >= ds && s < de;
      if (hit)
        out.push({ date: toIsoDate(day), slot, title: cleanTitle(title), eventId: raw.eventId });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || slotOrder[a.slot] - slotOrder[b.slot]);
}
