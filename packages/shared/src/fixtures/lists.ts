import type { Chore, List, StarTally } from '../models.js';
import type { Reward, Routine, StarBalance, StarLedgerEntry } from '../rewards.js';
import { addDays, startOfWeek, toIsoDate, toLocalIso } from '../time.js';

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

type ChoreSeed = Omit<Chore, 'doneCount' | 'week' | 'timeOfDay'> & {
  timeOfDay?: Chore['timeOfDay'];
  /** Completions Monday to Sunday; days after today are dropped. */
  history: number[];
};

const choreSeed: ChoreSeed[] = [
  {
    id: 'chore-bed-ava',
    icon: 'bed',
    routineId: 'routine-morning',
    timeOfDay: 'morning',
    title: 'Make bed',
    personId: 'ava',
    cadence: 'daily',
    stars: 1,
    target: 1,
    history: [1, 1, 0, 1, 1, 1, 1],
  },
  {
    id: 'chore-table',
    icon: 'table',
    timeOfDay: 'evening',
    title: 'Set the table',
    personId: 'ava',
    cadence: 'daily',
    stars: 1,
    target: 1,
    history: [1, 0, 1, 1, 0, 1, 0],
  },
  {
    id: 'chore-plants',
    icon: 'plant',
    title: 'Water the plants',
    personId: 'ava',
    cadence: 'weekly',
    stars: 2,
    target: 1,
    history: [0, 0, 0, 0, 0, 0, 0],
  },
  {
    id: 'chore-bed-leo',
    icon: 'bed',
    routineId: 'routine-morning',
    timeOfDay: 'morning',
    title: 'Make bed',
    personId: 'leo',
    cadence: 'daily',
    stars: 1,
    target: 1,
    history: [1, 0, 1, 1, 0, 1, 0],
  },
  {
    id: 'chore-mochi',
    icon: 'dog',
    title: 'Feed Mochi',
    personId: 'leo',
    cadence: 'daily',
    stars: 1,
    target: 2,
    history: [2, 2, 1, 2, 2, 1, 1],
  },
  {
    id: 'chore-bins',
    icon: 'trash',
    timeOfDay: 'evening',
    title: 'Take bins out',
    personId: 'leo',
    cadence: 'weekly',
    stars: 2,
    target: 1,
    history: [0, 0, 0, 0, 0, 0, 0],
  },
  {
    id: 'chore-teeth-am-ava',
    title: 'Brush teeth',
    personId: 'ava',
    icon: 'toothbrush',
    routineId: 'routine-morning',
    timeOfDay: 'morning',
    cadence: 'daily',
    stars: 1,
    target: 1,
    history: [1, 1, 1, 1, 1, 1, 1],
  },
  {
    id: 'chore-teeth-am-leo',
    title: 'Brush teeth',
    personId: 'leo',
    icon: 'toothbrush',
    routineId: 'routine-morning',
    timeOfDay: 'morning',
    cadence: 'daily',
    stars: 1,
    target: 1,
    history: [1, 1, 0, 1, 1, 1, 1],
  },
  {
    id: 'chore-backpack-leo',
    title: 'Pack backpack',
    personId: 'leo',
    icon: 'backpack',
    routineId: 'routine-morning',
    timeOfDay: 'morning',
    cadence: 'daily',
    stars: 1,
    target: 1,
    history: [1, 0, 1, 1, 1, 0, 0],
  },
  {
    id: 'chore-teeth-pm-ava',
    title: 'Brush teeth',
    personId: 'ava',
    icon: 'toothbrush',
    routineId: 'routine-bedtime',
    timeOfDay: 'evening',
    cadence: 'daily',
    stars: 1,
    target: 1,
    history: [1, 1, 1, 0, 1, 1, 1],
  },
  {
    id: 'chore-book-ava',
    title: 'Read a book',
    personId: 'ava',
    icon: 'book',
    routineId: 'routine-bedtime',
    timeOfDay: 'evening',
    cadence: 'daily',
    stars: 1,
    target: 1,
    history: [1, 0, 1, 1, 0, 1, 1],
  },
  {
    id: 'chore-teeth-pm-leo',
    title: 'Brush teeth',
    personId: 'leo',
    icon: 'toothbrush',
    routineId: 'routine-bedtime',
    timeOfDay: 'evening',
    cadence: 'daily',
    stars: 1,
    target: 1,
    history: [1, 1, 1, 1, 0, 1, 1],
  },
  {
    id: 'chore-pajamas-leo',
    title: 'Pajamas on',
    personId: 'leo',
    icon: 'shirt',
    routineId: 'routine-bedtime',
    timeOfDay: 'evening',
    cadence: 'daily',
    stars: 1,
    target: 1,
    history: [1, 1, 1, 1, 1, 0, 1],
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
    return { ...c, timeOfDay: c.timeOfDay ?? 'any', doneCount, week };
  });
  return {
    weekStart: toIsoDate(startOfWeek(now)),
    chores: all,
    stars: [...tallies].map(([personId, stars]) => ({ personId, stars })),
  };
}

/* ---- v3 workstream R: routines, rewards and the star bank ---- */

/** A morning and a bedtime routine for Ava and Leo. */
export function routines(): Routine[] {
  return [
    {
      id: 'routine-morning',
      name: 'Morning',
      personIds: ['ava', 'leo'],
      timeOfDay: 'morning',
      icon: 'sun',
    },
    {
      id: 'routine-bedtime',
      name: 'Bedtime',
      personIds: ['ava', 'leo'],
      timeOfDay: 'evening',
      icon: 'moon',
    },
  ];
}

/** Three rewards: two for everyone, one only Leo can pick. */
export function rewards(): Reward[] {
  return [
    {
      id: 'reward-movie',
      title: 'Pick the movie',
      cost: 10,
      icon: 'movie',
      personIds: [],
      active: true,
    },
    {
      id: 'reward-icecream',
      title: 'Ice cream trip',
      cost: 25,
      icon: 'icecream',
      personIds: [],
      active: true,
    },
    {
      id: 'reward-game',
      title: '30 minutes of games',
      cost: 15,
      icon: 'game',
      personIds: ['leo'],
      active: true,
    },
  ];
}

/**
 * Stars banked before this week: last week's chores and a movie night Ava already spent.
 * The mock adds this week's chore taps on top, as completions.
 */
export function starLedgerSeed(now: Date): StarLedgerEntry[] {
  const lastWeek = addDays(startOfWeek(now), -3);
  const at = (h: number) => toLocalIso(new Date(lastWeek.getTime() + h * 3_600_000));
  return [
    {
      id: 'ledger-seed-1',
      personId: 'ava',
      delta: 24,
      reason: 'bonus',
      note: 'Stars from before',
      at: at(9),
    },
    {
      id: 'ledger-seed-2',
      personId: 'leo',
      delta: 17,
      reason: 'bonus',
      note: 'Stars from before',
      at: at(9),
    },
    {
      id: 'ledger-seed-3',
      personId: 'ava',
      delta: -10,
      reason: 'redeem',
      refId: 'reward-movie',
      note: 'Pick the movie',
      at: at(19),
    },
    {
      id: 'ledger-seed-4',
      personId: 'leo',
      delta: 3,
      reason: 'bonus',
      note: 'Helped carry groceries',
      at: at(20),
    },
  ];
}

/** Balances as the mock answers them: the seed plus this week's chore stars. */
export function starBalances(now: Date): StarBalance[] {
  const seed = starLedgerSeed(now);
  return chores(now).stars.map((t) => ({
    personId: t.personId,
    week: t.stars,
    stars: t.stars + seed.filter((e) => e.personId === t.personId).reduce((n, e) => n + e.delta, 0),
  }));
}

/** One sample per workstream R route, for `routeFixtures`. */
export function rewardRouteFixtures(now: Date) {
  const balances = starBalances(now);
  const ledger = starLedgerSeed(now);
  const entry = { ...ledger[2]!, id: 'ledger-redeem', at: toLocalIso(now) };
  const all = rewards();
  const rs = routines();
  return {
    choreUpdate: { chore: chores(now).chores[0]! },
    starsBalance: { balances, celebrations: { celebrationsOff: [], chime: false } },
    starsLedger: { entries: ledger },
    starsAdjust: { entry: ledger[3]!, balance: balances[1]! },
    rewards: { rewards: all },
    rewardCreate: { reward: all[0]! },
    rewardPatch: { reward: all[0]! },
    rewardDelete: { ok: true as const },
    rewardRedeem: { entry, balance: balances[0]! },
    routines: { routines: rs },
    routineCreate: { routine: rs[0]! },
    routinePatch: { routine: rs[0]! },
    routineDelete: { ok: true as const },
  };
}
