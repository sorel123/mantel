import { describe, expect, it } from 'vitest';
import { describe as speak, findTime, parseSay, splitItems, type SayContext } from './parse.js';

// Saturday 21 November 2026.
const ctx: SayContext = {
  today: '2026-11-21',
  lists: [
    { id: 'g', name: 'Grocery' },
    { id: 't', name: 'To do' },
    { id: 'h', name: 'Hardware store' },
    { id: 'c', name: 'Costco' },
  ],
  people: [
    { id: 'jay', name: 'Jay' },
    { id: 'sam', name: 'Sam' },
    { id: 'ava', name: 'Ava' },
    { id: 'leo', name: 'Leo' },
  ],
  defaultListId: null,
  personId: 'jay',
  mealNames: ['Grandma soup'],
};

const say = (text: string, over: Partial<SayContext> = {}) =>
  parseSay(text, { ...ctx, ...over }).action;

type Case = [string, Record<string, unknown>];

const cases: Case[] = [
  // Items on the default list.
  ['milk and eggs', { kind: 'items', listId: 'g', items: ['Milk', 'Eggs'] }],
  ['Milk, eggs and bread.', { kind: 'items', listId: 'g', items: ['Milk', 'Eggs', 'Bread'] }],
  ['add paper towels', { kind: 'items', listId: 'g', items: ['Paper towels'] }],
  ["we're out of coffee", { kind: 'items', listId: 'g', items: ['Coffee'] }],
  ['we need mac and cheese and apples', { kind: 'items', items: ['Mac and cheese', 'Apples'] }],
  ['some bananas plus a loaf of bread', { kind: 'items', items: ['Bananas', 'Loaf of bread'] }],
  ['2 dozen eggs', { kind: 'items', items: ['2 dozen eggs'] }],
  ['Hey Mantel, add salt and pepper please', { kind: 'items', items: ['Salt and pepper'] }],
  // Items on a named list.
  ['add milk to groceries', { kind: 'items', listId: 'g', items: ['Milk'] }],
  ['add milk to the grocery list', { kind: 'items', listId: 'g', items: ['Milk'] }],
  ['put duct tape on the hardware list', { kind: 'items', listId: 'h', items: ['Duct tape'] }],
  [
    'add call the plumber to my to do list',
    { kind: 'items', listId: 't', items: ['Call the plumber'] },
  ],
  [
    'add paper towels and batteries to Costco',
    { kind: 'items', listId: 'c', items: ['Paper towels', 'Batteries'] },
  ],
  ['grocery list: yogurt, berries', { kind: 'items', listId: 'g', items: ['Yogurt', 'Berries'] }],
  [
    'add balloons to the party list',
    { kind: 'items', listId: null, listName: 'Party', items: ['Balloons'] },
  ],
  ['add cereal to shopping', { kind: 'items', listId: 'g', items: ['Cereal'] }],
  // Events.
  [
    'dentist Tuesday at 3',
    { kind: 'event', title: 'Dentist', date: '2026-11-24', start: '15:00', allDay: false },
  ],
  [
    "Ava's dentist Tuesday at 3:30pm",
    { kind: 'event', title: 'Dentist', date: '2026-11-24', start: '15:30', personIds: ['ava'] },
  ],
  [
    'soccer practice for Leo tomorrow at 9',
    {
      kind: 'event',
      title: 'Soccer practice',
      date: '2026-11-22',
      start: '09:00',
      personIds: ['leo'],
    },
  ],
  [
    'haircut tomorrow at 10am',
    { kind: 'event', title: 'Haircut', date: '2026-11-22', start: '10:00' },
  ],
  [
    'book club tonight at 7',
    { kind: 'event', title: 'Book club', date: '2026-11-21', start: '19:00' },
  ],
  [
    'parent teacher conference on December 3rd at 4:15',
    { kind: 'event', title: 'Parent teacher conference', date: '2026-12-03', start: '16:15' },
  ],
  [
    'piano recital Dec 12 from 2 to 4',
    { kind: 'event', title: 'Piano recital', date: '2026-12-12', start: '14:00', end: '16:00' },
  ],
  [
    'meeting with the builder Monday at 8 for an hour',
    {
      kind: 'event',
      title: 'Meeting with the builder',
      date: '2026-11-23',
      start: '08:00',
      end: '09:00',
    },
  ],
  [
    'grandma visiting Saturday',
    { kind: 'event', title: 'Grandma visiting', date: '2026-11-28', allDay: true },
  ],
  ['soccer Thursday', { kind: 'event', title: 'Soccer', date: '2026-11-26', allDay: true }],
  [
    'school concert on the 15th',
    { kind: 'event', title: 'School concert', date: '2026-12-15', allDay: true },
  ],
  [
    'swim lessons this Saturday at noon',
    { kind: 'event', title: 'Swim lessons', date: '2026-11-21', start: '12:00' },
  ],
  [
    'flu shots 12/2 at 11',
    { kind: 'event', title: 'Flu shots', date: '2026-12-02', start: '11:00' },
  ],
  [
    'lunch with Sam Friday at 12:30',
    { kind: 'event', date: '2026-11-27', start: '12:30', personIds: ['sam'] },
  ],
  [
    'remind me to call mom tomorrow at 5',
    { kind: 'event', title: 'Call mom', date: '2026-11-22', start: '17:00' },
  ],
  [
    'vet appointment in 3 days at 2 pm',
    { kind: 'event', title: 'Vet appointment', date: '2026-11-24', start: '14:00' },
  ],
  [
    'add dentist on Tuesday at 3 to the calendar',
    { kind: 'event', title: 'Dentist', date: '2026-11-24', start: '15:00' },
  ],
  [
    'movie night Friday at 7 in the evening',
    { kind: 'event', title: 'Movie night', date: '2026-11-27', start: '19:00' },
  ],
  [
    'early swim Wednesday at 6 in the morning',
    { kind: 'event', title: 'Early swim', date: '2026-11-25', start: '06:00' },
  ],
  // Meals.
  ['tacos Thursday', { kind: 'meal', date: '2026-11-26', slot: 'dinner', title: 'Tacos' }],
  ['pizza on Friday', { kind: 'meal', date: '2026-11-27', slot: 'dinner', title: 'Pizza' }],
  [
    'spaghetti for dinner tomorrow',
    { kind: 'meal', date: '2026-11-22', slot: 'dinner', title: 'Spaghetti' },
  ],
  [
    'Thursday dinner is chicken curry',
    { kind: 'meal', date: '2026-11-26', slot: 'dinner', title: 'Chicken curry' },
  ],
  [
    'pancakes for breakfast Sunday',
    { kind: 'meal', date: '2026-11-22', slot: 'breakfast', title: 'Pancakes' },
  ],
  [
    "we're having fish and chips Friday",
    { kind: 'meal', date: '2026-11-27', slot: 'dinner', title: 'Fish and chips' },
  ],
  [
    'grandma soup Monday',
    { kind: 'meal', date: '2026-11-23', slot: 'dinner', title: 'Grandma soup' },
  ],
  ['tacos for dinner', { kind: 'meal', date: '2026-11-21', slot: 'dinner', title: 'Tacos' }],
  // Notes.
  ['note: back at 5', { kind: 'note', text: 'Back at 5' }],
  [
    'leave a note for Ava saying practice is cancelled',
    { kind: 'note', text: 'Practice is cancelled', personId: 'ava' },
  ],
  ['post a note, pizza in the fridge', { kind: 'note', text: 'Pizza in the fridge' }],
];

describe('natural add rules (no Claude key)', () => {
  it('covers at least forty phrases', () => expect(cases.length).toBeGreaterThanOrEqual(40));
  it.each(cases)('%s', (text, expected) => {
    expect(say(text)).toMatchObject(expected);
  });

  it('uses the default list from settings', () => {
    expect(say('batteries', { defaultListId: 'h' })).toMatchObject({
      listId: 'h',
      items: ['Batteries'],
    });
  });
  it('names a new list Grocery when there are no lists', () => {
    expect(say('milk', { lists: [] })).toMatchObject({
      kind: 'items',
      listId: null,
      listName: 'Grocery',
    });
  });
  it('says nothing for an empty phrase', () => {
    expect(say('   please ')).toMatchObject({ kind: 'none' });
  });
  it('marks a long sentence with no clue as unsure', () => {
    expect(parseSay('the thing we talked about with the neighbours yesterday', ctx).confident).toBe(
      false,
    );
    expect(parseSay('milk and eggs', ctx).confident).toBe(true);
  });
  it('treats "my" as the speaker', () => {
    expect(say('my yoga class Wednesday at 6')).toMatchObject({
      kind: 'event',
      personIds: ['jay'],
      title: 'Yoga class',
    });
  });
});

describe('pieces', () => {
  it('splits items but keeps compounds', () => {
    expect(splitItems('half and half, bread and butter pickles & limes')).toEqual([
      'Half and half',
      'Bread and butter pickles',
      'Limes',
    ]);
  });
  it('reads times', () => {
    expect(findTime('at 7', true)?.value).toEqual({ start: '19:00' });
    expect(findTime('at 7')?.value).toEqual({ start: '07:00' });
    expect(findTime('3-5pm')?.value).toEqual({ start: '15:00', end: '17:00' });
    expect(findTime('at midnight')?.value).toEqual({ start: '00:00' });
    expect(findTime('at 3 for 90 minutes')?.value).toEqual({ start: '15:00', end: '16:30' });
  });
  it('speaks back what it did', () => {
    expect(
      speak(
        { kind: 'items', listId: 'g', listName: 'Grocery', items: ['Milk', 'Eggs'] },
        ctx.today,
      ),
    ).toBe('Added milk and eggs to Grocery.');
    expect(
      speak(
        {
          kind: 'event',
          title: 'Dentist',
          date: '2026-11-24',
          start: '15:00',
          allDay: false,
          personIds: [],
        },
        ctx.today,
      ),
    ).toBe('Added Dentist on Tuesday at 3 PM.');
    expect(
      speak({ kind: 'meal', date: '2026-11-22', slot: 'dinner', title: 'Tacos' }, ctx.today),
    ).toBe('Planned Tacos for dinner tomorrow.');
    expect(
      speak(
        { kind: 'event', title: 'Recital', date: '2026-12-12', allDay: true, personIds: [] },
        ctx.today,
        true,
      ),
    ).toBe('Would add Recital on Saturday, December 12.');
  });
});
