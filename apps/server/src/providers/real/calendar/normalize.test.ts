import type { Calendar, CalendarEvent } from '@mantel/shared';
import { addDays, atHour, startOfDay, toLocalIso } from '@mantel/shared';
import { people } from '@mantel/shared/fixtures';
import { describe, expect, it } from 'vitest';
import {
  cleanTitle,
  countdownsFrom,
  cssColor,
  eventPeople,
  isCountdown,
  mealSlot,
  mealsFrom,
  toCalendar,
  toEvent,
} from './normalize.js';
import type { RawEvent, SourceCalendar } from './types.js';

const kids: Calendar = {
  id: 'google:kids',
  name: 'Kids',
  source: 'google',
  color: '#8E63CF',
  personIds: ['ava', 'leo'],
  readOnly: false,
  isMeals: false,
};
const jayCal: Calendar = { ...kids, id: 'google:jay', name: 'Jay', personIds: ['jay'] };
const family: Calendar = {
  ...kids,
  id: 'google:family',
  name: 'Family',
  personIds: [],
  color: '#246B5B',
};

const raw = (title: string, extra: Partial<RawEvent> = {}): RawEvent => ({
  uid: title,
  calendarId: 'c',
  title,
  start: '2026-10-31T15:30:00-07:00',
  end: '2026-10-31T17:00:00-07:00',
  allDay: false,
  ...extra,
});

describe('people', () => {
  it('uses the calendar owners by default', () => {
    expect(eventPeople(raw('Dentist'), kids, people)).toEqual(['ava', 'leo']);
  });
  it('narrows a shared calendar to the named person', () => {
    expect(eventPeople(raw('Leo soccer'), kids, people)).toEqual(['leo']);
    expect(eventPeople(raw("Leo's birthday party"), kids, people)).toEqual(['leo']);
  });
  it('adds named people on a personal calendar', () => {
    expect(eventPeople(raw('Lunch with Sam'), jayCal, people)).toEqual(['jay', 'sam']);
  });
  it('tags family-calendar events by name, else nobody', () => {
    expect(eventPeople(raw('Ava and Leo swim'), family, people)).toEqual(['ava', 'leo']);
    expect(eventPeople(raw('Trash night'), family, people)).toEqual([]);
  });
  it('does not match names inside other words', () => {
    expect(eventPeople(raw('Leopard exhibit'), family, people)).toEqual([]);
  });
  it('prefers people stored on the event', () => {
    expect(eventPeople(raw('Leo soccer', { personIds: ['sam', 'nobody'] }), kids, people)).toEqual([
      'sam',
    ]);
  });
  it('colours by the first person, else the calendar', () => {
    expect(toEvent(raw('Leo soccer'), kids, people).color).toBe('#3BA06F');
    expect(toEvent(raw('Trash night'), family, people).color).toBe('#246B5B');
  });
});

describe('calendars', () => {
  const src: SourceCalendar = {
    id: 'icloud:/1/cal/',
    source: 'icloud',
    name: 'Meals',
    color: '#C8761EFF',
    readOnly: false,
    selected: true,
    ref: 'https://x/1/cal/',
  };
  it('applies preferences and spots the Meals calendar', () => {
    const c = toCalendar(src, { calendars: {} }, people);
    expect(c.isMeals).toBe(true);
    expect(c.color).toBe('#C8761E');
    const renamed = toCalendar(
      src,
      { calendars: { [src.id]: { name: 'Dinners', personIds: ['sam'], isMeals: false } } },
      people,
    );
    expect(renamed).toMatchObject({ name: 'Dinners', personIds: ['sam'], isMeals: false });
  });
  it('falls back to settings for people', () => {
    const p = people.map((x) => (x.id === 'jay' ? { ...x, calendarIds: [src.id] } : x));
    expect(toCalendar(src, { calendars: {} }, p).personIds).toEqual(['jay']);
  });
  it('normalises colours', () => {
    expect(cssColor('#aabbccdd')).toBe('#aabbcc');
    expect(cssColor('#123456')).toBe('#123456');
    expect(cssColor(undefined)).toBe('#246B5B');
  });
});

describe('countdowns', () => {
  it('detects and strips tags', () => {
    expect(isCountdown({ title: '⭐ Grandma visits' })).toBe(true);
    expect(isCountdown({ title: 'Trip #countdown' })).toBe(true);
    expect(isCountdown({ title: 'Trip', description: 'packing list #Countdown' })).toBe(true);
    expect(isCountdown({ title: 'Trip' })).toBe(false);
    expect(cleanTitle('⭐ Grandma visits')).toBe('Grandma visits');
    expect(cleanTitle('Disneyland  #countdown 🌟')).toBe('Disneyland');
  });

  it('lists future tagged events with days remaining, one per series', () => {
    const now = atHour(new Date(2026, 9, 31), 9);
    const today = startOfDay(now);
    const ev = (title: string, days: number, countdown = true): CalendarEvent => ({
      id: `${title}-${days}`,
      calendarId: 'c',
      title,
      start: toLocalIso(addDays(today, days)),
      end: toLocalIso(addDays(today, days + 1)),
      allDay: true,
      personIds: [],
      color: '#000',
      countdown,
    });
    const got = countdownsFrom(
      [ev('Recital', 5), ev('Past', -1), ev('Plain', 3, false), ev('Today', 0), ev('Recital', 12)],
      now,
    );
    expect(got.map((c) => [c.title, c.daysRemaining])).toEqual([
      ['Today', 0],
      ['Recital', 5],
    ]);
  });
});

describe('meals', () => {
  it('reads the slot from a prefix or the time', () => {
    expect(
      mealSlot({ title: 'Lunch: Soup', start: '2026-11-02T18:00:00-08:00', allDay: false }),
    ).toEqual({
      slot: 'lunch',
      title: 'Soup',
    });
    expect(
      mealSlot({ title: 'Pancakes', start: toLocalIso(atHour(new Date(), 8)), allDay: false }).slot,
    ).toBe('breakfast');
    expect(
      mealSlot({ title: 'Tacos', start: toLocalIso(atHour(new Date(), 18)), allDay: false }).slot,
    ).toBe('dinner');
    expect(mealSlot({ title: 'Tacos', start: toLocalIso(new Date()), allDay: true }).slot).toBe(
      'dinner',
    );
  });

  it('places meals on the days of the week they cover', () => {
    const monday = new Date(2026, 10, 2);
    const day = (n: number) => addDays(monday, n);
    const got = mealsFrom(
      [
        {
          ...raw('Dinner - Tacos'),
          uid: 'a',
          eventId: 'a',
          allDay: true,
          start: toLocalIso(day(0)),
          end: toLocalIso(day(1)),
        },
        {
          ...raw('Leftovers'),
          uid: 'b',
          eventId: 'b',
          allDay: true,
          start: toLocalIso(day(5)),
          end: toLocalIso(day(8)),
        },
        {
          ...raw('Breakfast: Pancakes'),
          uid: 'c',
          eventId: 'c',
          start: toLocalIso(atHour(day(5), 8)),
          end: toLocalIso(atHour(day(5), 9)),
        },
        {
          ...raw('Next week'),
          uid: 'd',
          eventId: 'd',
          allDay: true,
          start: toLocalIso(day(7)),
          end: toLocalIso(day(8)),
        },
      ],
      monday,
    );
    expect(got.map((m) => [m.date, m.slot, m.title])).toEqual([
      ['2026-11-02', 'dinner', 'Tacos'],
      ['2026-11-07', 'breakfast', 'Pancakes'],
      ['2026-11-07', 'dinner', 'Leftovers'],
      ['2026-11-08', 'dinner', 'Leftovers'],
    ]);
  });
});
