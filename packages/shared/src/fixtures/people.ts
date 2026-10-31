import type { Calendar, Person } from '../models.js';

/** The mockup's family. Colours match `--p-*` in design/mockup.html. */
export const people: Person[] = [
  {
    id: 'jay',
    name: 'Jay',
    initial: 'J',
    color: '#E2694F',
    calendarIds: ['cal-jay', 'cal-family'],
  },
  {
    id: 'sam',
    name: 'Sam',
    initial: 'S',
    color: '#3F7BD9',
    calendarIds: ['cal-sam', 'cal-family'],
  },
  {
    id: 'ava',
    name: 'Ava',
    initial: 'A',
    color: '#8E63CF',
    calendarIds: ['cal-kids', 'cal-family'],
  },
  {
    id: 'leo',
    name: 'Leo',
    initial: 'L',
    color: '#3BA06F',
    calendarIds: ['cal-kids', 'cal-family'],
  },
];

export const calendars: Calendar[] = [
  {
    id: 'cal-family',
    name: 'Family',
    source: 'google',
    color: '#246B5B',
    personIds: [],
    readOnly: false,
    isMeals: false,
  },
  {
    id: 'cal-jay',
    name: 'Jay',
    source: 'google',
    color: '#E2694F',
    personIds: ['jay'],
    readOnly: false,
    isMeals: false,
  },
  {
    id: 'cal-sam',
    name: 'Sam',
    source: 'icloud',
    color: '#3F7BD9',
    personIds: ['sam'],
    readOnly: false,
    isMeals: false,
  },
  {
    id: 'cal-kids',
    name: 'Kids',
    source: 'google',
    color: '#8E63CF',
    personIds: ['ava', 'leo'],
    readOnly: false,
    isMeals: false,
  },
  {
    id: 'cal-meals',
    name: 'Meals',
    source: 'google',
    color: '#C8761E',
    personIds: [],
    readOnly: false,
    isMeals: true,
  },
];

export const personColor = (id: string | undefined): string =>
  people.find((p) => p.id === id)?.color ?? '#246B5B';
