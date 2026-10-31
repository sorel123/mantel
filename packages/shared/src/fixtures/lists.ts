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

type ChoreSeed = Omit<Chore, 'doneCount' | 'week'> & {
  /** Completions Monday to Sunday; days after today are dropped. */
  history: number[];
};

const choreSeed: ChoreSeed[] = [
  {
    id: 'chore-bed-ava',
    title: 'Make bed',
    personId: 'ava',
    cadence: 'daily',
    stars: 1,
    target: 1,
    history: [1, 1, 0, 1, 1, 1, 1],
  },
  {
    id: 'chore-table',
    title: 'Set the table',
    personId: 'ava',
    cadence: 'daily',
    stars: 1,
    target: 1,
    history: [1, 0, 1, 1, 0, 1, 0],
  },
  {
    id: 'chore-plants',
    title: 'Water the plants',
    personId: 'ava',
    cadence: 'weekly',
    stars: 2,
    target: 1,
    history: [0, 0, 0, 0, 0, 0, 0],
  },
  {
    id: 'chore-bed-leo',
    title: 'Make bed',
    personId: 'leo',
    cadence: 'daily',
    stars: 1,
    target: 1,
    history: [1, 0, 1, 1, 0, 1, 0],
  },
  {
    id: 'chore-mochi',
    title: 'Feed Mochi',
    personId: 'leo',
    cadence: 'daily',
    stars: 1,
    target: 2,
    history: [2, 2, 1, 2, 2, 1, 1],
  },
  {
    id: 'chore-bins',
    title: 'Take bins out',
    personId: 'leo',
    cadence: 'weekly',
    stars: 2,
    target: 1,
    history: [0, 0, 0, 0, 0, 0, 0],
  },
];

/**
 * Ava's and Leo's chore chart for the week containing `now`, with history up to yesterday.
 * Daily chores are left one short of their target today, so the mock has something to tap.
 */
export function chores(now: Date): { weekStart: string; chores: Chore[]; stars: StarTally[] } {
  const today = (now.getDay() + 6) % 7;
  const tallies = new Map<string, number>();
  const all: Chore[] = choreSeed.map(({ history, ...c }) => {
    const week = history.map((n, i) =>
      i > today ? 0 : i === today && c.cadence === 'daily' ? Math.min(n, c.target - 1) : n,
    );
    const doneCount = c.cadence === 'daily' ? week[today]! : week.reduce((a, b) => a + b, 0);
    const earned = week.reduce((a, b) => a + b, 0) * c.stars;
    tallies.set(c.personId, (tallies.get(c.personId) ?? 0) + earned);
    return { ...c, doneCount, week };
  });
  return {
    weekStart: toIsoDate(startOfWeek(now)),
    chores: all,
    stars: [...tallies].map(([personId, stars]) => ({ personId, stars })),
  };
}
