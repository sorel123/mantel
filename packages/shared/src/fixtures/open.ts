/** v4 O fixtures: sample tokens, a natural-add answer and the state Home Assistant reads. */
import type { ApiToken, OpenState, SayResponse } from '../open.js';
import { addDays, startOfDay, toLocalIso } from '../time.js';
import { calendars, people } from './people.js';

export function sampleTokens(now: Date): ApiToken[] {
  return [
    {
      id: 'tok-ha',
      name: 'Home Assistant',
      scopes: ['read', 'lists', 'chores', 'capture'],
      prefix: 'mtl_h4Q9',
      createdAt: toLocalIso(addDays(now, -12)),
      lastUsedAt: toLocalIso(new Date(now.getTime() - 40_000)),
      revokedAt: null,
    },
    {
      id: 'tok-siri',
      name: "Jay's iPhone (Siri)",
      scopes: ['read', 'capture'],
      prefix: 'mtl_Zx81',
      createdAt: toLocalIso(addDays(now, -3)),
      lastUsedAt: toLocalIso(addDays(now, -1)),
      revokedAt: null,
    },
  ];
}

export function sampleSay(): SayResponse {
  return {
    ok: true,
    speech: 'Added milk and eggs to Grocery.',
    action: { kind: 'items', listId: 'list-grocery', listName: 'Grocery', items: ['Milk', 'Eggs'] },
    parser: 'rules',
    dryRun: false,
  };
}

export function sampleOpenState(now: Date): OpenState {
  const today = startOfDay(now);
  return {
    version: '0.4.0',
    timezone: 'America/Los_Angeles',
    at: toLocalIso(now),
    tonight: { dinner: 'Tacos' },
    nextEvent: {
      title: 'Soccer practice',
      start: toLocalIso(new Date(today.getTime() + 17 * 3_600_000)),
      allDay: false,
      personIds: ['leo'],
    },
    inboxCount: 0,
    groceryList: { id: 'list-grocery', name: 'Grocery', open: 6 },
    lists: [
      { id: 'list-grocery', name: 'Grocery', open: 6 },
      { id: 'list-todo', name: 'To do', open: 3 },
    ],
    people: people.map((p, i) => ({
      id: p.id,
      name: p.name,
      choresOpen: i % 3,
      choresDone: 1 + (i % 2),
      stars: 4 + i * 3,
    })),
    calendars: calendars.map((c) => ({ id: c.id, name: c.name, color: c.color })),
    activity: [
      {
        id: '1',
        type: 'chore_done',
        at: toLocalIso(new Date(now.getTime() - 600_000)),
        personId: 'leo',
        personName: 'Leo',
        title: 'Make bed',
        stars: 1,
      },
    ],
  };
}

export function openRouteFixtures(now: Date) {
  const tokens = sampleTokens(now);
  return {
    openTokens: { tokens },
    openTokenCreate: { token: tokens[1]!, secret: 'mtl_Zx81sampleSecretNotReal000000000000000' },
    openTokenRevoke: { ok: true as const },
    say: sampleSay(),
    openState: sampleOpenState(now),
  };
}
