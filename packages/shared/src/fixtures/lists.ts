import type { Chore, List, StarTally } from '../models.js';
import { startOfWeek, toIsoDate } from '../time.js';

type Seed = [text: string, personId: string | null, done?: boolean];

const seed: Array<{ id: string; name: string; items: Seed[] }> = [
  {
    id: 'list-grocery',
    name: 'Grocery',
    items: [
      ['Oat milk', 'sam'],
      ['Bananas', 'sam'],
      ['Chicken thighs', 'jay'],
      ['Birthday candles', 'ava'],
      ['Dish soap', null, true],
      ['Coffee beans', 'jay', true],
    ],
  },
  {
    id: 'list-chores',
    name: 'Chores',
    items: [
      ['Take bins out', 'leo'],
      ['Water the plants', 'ava'],
      ['Vacuum downstairs', 'jay', true],
      ['Fold laundry', 'sam'],
      ['Feed Mochi', 'leo', true],
    ],
  },
  {
    id: 'list-todo',
    name: 'To-do',
    items: [
      ['Book sitter for Friday', 'sam'],
      ['RSVP to Nguyens', 'jay', true],
      ['Order recital tickets', 'sam'],
      ['Renew library books', 'ava'],
      ['Call about gutter', 'jay'],
    ],
  },
];

/** The mockup's three lists. Returns fresh copies so callers can mutate them. */
export function lists(): List[] {
  return seed.map((l) => ({
    id: l.id,
    name: l.name,
    source: 'local',
    items: l.items.map(([text, personId, done], i) => ({
      id: `${l.id}-${i}`,
      text,
      done: done ?? false,
      ...(personId ? { personId } : {}),
    })),
  }));
}

export function chores(now: Date): { weekStart: string; chores: Chore[]; stars: StarTally[] } {
  const all: Chore[] = [
    {
      id: 'chore-bed-ava',
      title: 'Make bed',
      personId: 'ava',
      cadence: 'daily',
      stars: 1,
      doneCount: 1,
      target: 1,
    },
    {
      id: 'chore-bed-leo',
      title: 'Make bed',
      personId: 'leo',
      cadence: 'daily',
      stars: 1,
      doneCount: 0,
      target: 1,
    },
    {
      id: 'chore-mochi',
      title: 'Feed Mochi',
      personId: 'leo',
      cadence: 'daily',
      stars: 1,
      doneCount: 1,
      target: 2,
    },
    {
      id: 'chore-plants',
      title: 'Water the plants',
      personId: 'ava',
      cadence: 'weekly',
      stars: 2,
      doneCount: 0,
      target: 1,
    },
    {
      id: 'chore-bins',
      title: 'Take bins out',
      personId: 'leo',
      cadence: 'weekly',
      stars: 2,
      doneCount: 0,
      target: 1,
    },
    {
      id: 'chore-table',
      title: 'Set the table',
      personId: 'ava',
      cadence: 'daily',
      stars: 1,
      doneCount: 0,
      target: 1,
    },
  ];
  return {
    weekStart: toIsoDate(startOfWeek(now)),
    chores: all,
    stars: [
      { personId: 'ava', stars: 9 },
      { personId: 'leo', stars: 6 },
    ],
  };
}
