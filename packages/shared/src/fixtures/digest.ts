/**
 * v4 D: the digest plugin's manifest (the server's `plugins/digest/manifest.ts` re-exports it,
 * so the two cannot drift), and samples for the digest and activity routes.
 */
import {
  DEFAULT_DIGEST_SETTINGS,
  type ActivityEntry,
  type Digest,
  type DigestSettings,
} from '../digest.js';
import type { PluginManifest } from '../plugins.js';
import { addDays, startOfDay, toIsoDate, toLocalIso } from '../time.js';

export const digestManifest: PluginManifest = {
  id: 'digest',
  name: 'Morning digest',
  description:
    'Each person’s day on their phone at breakfast, reminders before events and open routines, and what changed since you last looked.',
  category: 'info',
  step: null,
  connect: 'none',
  optional: true,
  directions: [
    'Turn notifications on in the phone app (/app, the bell at the top) and choose whose phone it is.',
    'Pick times and what to include in Settings, Digest and reminders.',
    'Add the Today at a glance card in Settings, Layout, Your own.',
  ],
  fields: [],
  contributes: {
    todayCard: {
      name: 'Today at a glance',
      description: 'The morning digest on the wall: weather, events, chores and dinner.',
      min: [3, 2],
      comfort: [4, 3],
      data: 'card',
    },
    ambientSlot: { id: 'digest', order: 2, data: 'ambient' },
    events: ['plugin.changed', 'activity.added'],
  },
};

export const sampleDigestSettings = (): DigestSettings => structuredClone(DEFAULT_DIGEST_SETTINGS);

/** Sam's morning, around `now`. */
export function sampleDigest(now: Date): Digest {
  const day = startOfDay(now);
  const at = (h: number, m = 0) => toLocalIso(new Date(day.getTime() + (h * 60 + m) * 60_000));
  return {
    personId: 'sam',
    kind: 'morning',
    date: toIsoDate(day),
    generatedAt: toLocalIso(now),
    greeting: 'Good morning, Sam',
    headline: '3 events, 2 chores, tacos for dinner',
    weather: { line: 'Sunny, 18° now, high 22°', icon: 'sun' },
    events: [
      {
        id: 'evt-standup',
        title: 'Team standup',
        start: at(9),
        end: at(9, 30),
        allDay: false,
        personIds: ['sam'],
      },
      {
        id: 'evt-dentist',
        title: 'Dentist',
        start: at(14),
        end: at(15),
        allDay: false,
        location: '12 Main St',
        personIds: ['sam', 'ava'],
        leaveBy: at(13, 35),
      },
      {
        id: 'evt-soccer',
        title: 'Soccer practice',
        start: at(17, 30),
        end: at(18, 30),
        allDay: false,
        personIds: ['ava'],
      },
    ],
    chores: [
      {
        id: 'chore-dishes',
        title: 'Empty the dishwasher',
        personId: 'sam',
        done: false,
        timeOfDay: 'any',
      },
      {
        id: 'chore-plants',
        title: 'Water the plants',
        personId: 'sam',
        done: false,
        timeOfDay: 'any',
        overdueSince: toIsoDate(addDays(day, -2)),
      },
    ],
    dinner: 'Tacos',
    birthdays: [],
    alerts: [{ icon: 'trash', text: 'Trash goes out tonight', tone: 'warn' }],
  };
}

export function sampleActivity(now: Date): ActivityEntry[] {
  const ago = (min: number) => toLocalIso(new Date(now.getTime() - min * 60_000));
  return [
    {
      id: 'act-1',
      at: ago(5),
      kind: 'list.added',
      personId: 'sam',
      who: 'Sam',
      subject: 'Milk',
      where: 'Groceries',
      link: { tab: 'lists', id: 'list-grocery' },
      group: 'list-grocery',
    },
    {
      id: 'act-2',
      at: ago(6),
      kind: 'list.added',
      personId: 'sam',
      who: 'Sam',
      subject: 'Eggs',
      where: 'Groceries',
      link: { tab: 'lists', id: 'list-grocery' },
      group: 'list-grocery',
    },
    {
      id: 'act-3',
      at: ago(40),
      kind: 'event.added',
      personId: 'sam',
      who: 'Sam',
      subject: 'Dentist',
      where: 'Thursday',
      link: { tab: 'calendar', id: 'evt-dentist' },
    },
    {
      id: 'act-4',
      at: ago(90),
      kind: 'chore.done',
      personId: 'ava',
      who: 'Ava',
      subject: 'Feed the cat',
      link: { tab: 'chores', id: 'chore-cat' },
      group: 'ava',
    },
  ];
}

export function digestRouteFixtures(now: Date) {
  const digest = sampleDigest(now);
  const day = startOfDay(now);
  return {
    activity: { entries: sampleActivity(now), now: toLocalIso(now) },
    digest: { digest },
    digestTest: {
      ok: true,
      message: 'Sent to 1 phone.',
      sent: 1,
      url: '/app#digest/morning',
      digest,
    },
    digestStatus: {
      people: ['jay', 'sam'].map((personId) => ({
        personId,
        phones: personId === 'sam' ? 1 : 0,
        nextMorning: toLocalIso(new Date(addDays(day, 1).getTime() + 7 * 3_600_000)),
        nextEvening: null,
      })),
      aiReady: false,
    },
    pushOutbox: { messages: [] },
  };
}
