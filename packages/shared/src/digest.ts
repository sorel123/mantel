/**
 * v4 workstream D: the morning digest, nudges, the activity log ("since you last looked") and
 * deep links into the companion.
 *
 * This file only imports zod: `models.ts` imports `DigestSettings` from here for the `Settings`
 * schema, so it must not import `models.ts` back (the same rule as `rewards.ts`). Routes are
 * spread into the route table in `api.ts`; `activity.added` joins the WebSocket union in `ws.ts`.
 */
import { z } from 'zod';

const Id = z.string().min(1);
const IsoDateTime = z.iso.datetime({ offset: true });
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const Hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM');
const NoQuery = z.object({}).strict();
const NoBody = z.undefined();

/* ---------- deep links ---------- */

/** Where a notification or a "since you last looked" line takes you. */
export const DeepTab = z.enum(['lists', 'calendar', 'meals', 'chores', 'note', 'inbox', 'digest']);
export type DeepTab = z.infer<typeof DeepTab>;

export const DeepLink = z.object({
  tab: DeepTab,
  /** The chore, event, list, inbox item or digest kind to open on that tab. */
  id: z.string().optional(),
});
export type DeepLink = z.infer<typeof DeepLink>;

/** `/app#chores/chore-1`: the companion opens the tab, then the item. */
export function deepLinkUrl(link: DeepLink): string {
  return `/app#${link.tab}${link.id ? `/${encodeURIComponent(link.id)}` : ''}`;
}

/** Reads `#chores/chore-1` (or `chores/chore-1`). Unknown tabs give null. */
export function parseDeepLink(hash: string): DeepLink | null {
  const raw = hash.replace(/^#/, '');
  const slash = raw.indexOf('/');
  const tab = slash < 0 ? raw : raw.slice(0, slash);
  const parsed = DeepTab.safeParse(tab);
  if (!parsed.success) return null;
  const id = slash < 0 ? '' : decodeURIComponent(raw.slice(slash + 1));
  return id ? { tab: parsed.data, id } : { tab: parsed.data };
}

/** The wall screen that shows a deep link's target. */
export function wallScreenFor(link: DeepLink): 'today' | 'month' | 'lists' {
  if (link.tab === 'lists' || link.tab === 'chores') return 'lists';
  if (link.tab === 'calendar') return 'month';
  return 'today';
}

/* ---------- activity ---------- */

export const ActivityKind = z.enum([
  'event.added',
  'event.moved',
  'event.removed',
  'list.added',
  'list.done',
  'chore.done',
  'meal.planned',
  'note.posted',
  'reward.redeemed',
  'capture.committed',
]);
export type ActivityKind = z.infer<typeof ActivityKind>;

export const ActivityEntry = z.object({
  id: Id,
  at: IsoDateTime,
  kind: ActivityKind,
  /** The person who did it, when known (their phone, their chore, the item's owner). */
  personId: Id.optional(),
  /** "Sam", "Kitchen wall": the person's name or the device's. */
  who: z.string().optional(),
  /** What changed, without the who: "Dentist", "Milk", "Tacos". */
  subject: z.string(),
  /** Where it happened: a list's name, an event's day ("Thursday"), a meal's day. */
  where: z.string().optional(),
  link: DeepLink,
  /** Entries with the same group fold into one line ("3 things added to Groceries"). */
  group: z.string().optional(),
});
export type ActivityEntry = z.infer<typeof ActivityEntry>;

export const ActivityQuery = z.object({
  since: IsoDateTime.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export const ActivityResponse = z.object({
  entries: z.array(ActivityEntry),
  /** The server's clock, so a device can store "seen up to" without trusting its own. */
  now: IsoDateTime,
});
export type ActivityResponse = z.infer<typeof ActivityResponse>;

/** A line of the "since you last looked" strip: one entry, or several folded together. */
export interface SinceLine {
  key: string;
  text: string;
  link: DeepLink;
  kind: ActivityKind;
  count: number;
  personId?: string;
  at: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One sentence for one entry: "Sam added Dentist on Thursday". */
export function activitySentence(e: ActivityEntry): string {
  const who = e.who;
  switch (e.kind) {
    case 'event.added':
      return who
        ? `${who} added ${e.subject}${e.where ? ` on ${e.where}` : ''}`
        : `${e.subject} added${e.where ? ` on ${e.where}` : ''}`;
    case 'event.moved':
      return `${e.subject} moved${e.where ? ` to ${e.where}` : ''}`;
    case 'event.removed':
      return `${e.subject} was taken off the calendar`;
    case 'list.added':
      return who
        ? `${who} added ${e.subject}${e.where ? ` to ${e.where}` : ''}`
        : `${e.subject} added${e.where ? ` to ${e.where}` : ''}`;
    case 'list.done':
      return `${e.subject} checked off${e.where ? ` ${e.where}` : ''}`;
    case 'chore.done':
      return `${who ?? 'Someone'} did ${e.subject}`;
    case 'meal.planned':
      return `${e.subject} planned${e.where ? ` for ${e.where}` : ''}`;
    case 'note.posted':
      return `${who ? `A note from ${who}` : 'A new note'}: ${e.subject}`;
    case 'reward.redeemed':
      return `${who ?? 'Someone'} cashed in stars for ${e.subject}`;
    case 'capture.committed':
      return `${e.subject} added from the inbox`;
  }
}

function foldedSentence(kind: ActivityKind, group: ActivityEntry[]): string {
  const first = group[0]!;
  const n = group.length;
  const who = new Set(group.map((e) => e.who ?? 'Someone'));
  const whoText = who.size === 1 ? [...who][0]! : 'The family';
  switch (kind) {
    case 'list.added':
      return `${plural(n, 'thing')} added to ${first.where ?? 'a list'}`;
    case 'list.done':
      return `${plural(n, 'thing')} checked off ${first.where ?? 'a list'}`;
    case 'chore.done':
      return `${whoText} did ${plural(n, 'chore')}`;
    case 'event.added':
      return `${plural(n, 'event')} added to the calendar`;
    case 'event.moved':
      return `${plural(n, 'event')} moved`;
    case 'meal.planned':
      return `${plural(n, 'meal')} planned`;
    default:
      return group.map(activitySentence).join(' · ');
  }
}

/**
 * Fold entries for the strip, newest first: list adds to the same list, one person's chores,
 * several meals become one line each. At most `max` lines.
 */
export function summariseActivity(entries: ActivityEntry[], max = 6): SinceLine[] {
  const sorted = [...entries].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const groups = new Map<string, ActivityEntry[]>();
  for (const e of sorted) {
    const key = e.group ? `${e.kind}|${e.group}` : `one|${e.id}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const lines: SinceLine[] = [];
  for (const [key, group] of groups) {
    const first = group[0]!;
    const people = new Set(group.map((g) => g.personId));
    lines.push({
      key,
      text: group.length === 1 ? activitySentence(first) : foldedSentence(first.kind, group),
      link: group.length === 1 ? first.link : { tab: first.link.tab, id: first.link.id },
      kind: first.kind,
      count: group.length,
      ...(people.size === 1 && first.personId ? { personId: first.personId } : {}),
      at: first.at,
    });
  }
  return lines.slice(0, max);
}

/* ---------- settings ---------- */

export const DigestInclude = z.object({
  events: z.boolean().default(true),
  chores: z.boolean().default(true),
  dinner: z.boolean().default(true),
  weather: z.boolean().default(true),
  birthdays: z.boolean().default(true),
  alerts: z.boolean().default(true),
});
export type DigestInclude = z.infer<typeof DigestInclude>;
export const DIGEST_INCLUDE_LABELS: Record<keyof DigestInclude, string> = {
  events: "Today's events and leave-by times",
  chores: 'Their chores and routines',
  dinner: "Tonight's dinner",
  weather: 'Weather in one line, and any warning',
  birthdays: 'Birthdays',
  alerts: 'Trash day and other reminders',
};
const DEFAULT_INCLUDE: DigestInclude = {
  events: true,
  chores: true,
  dinner: true,
  weather: true,
  birthdays: true,
  alerts: true,
};

/** One person's digest. A person with no entry gets `defaultDigestPerson`. */
export const DigestPerson = z.object({
  personId: Id,
  morning: z.boolean().default(true),
  weekdayTime: Hhmm.default('07:00'),
  weekendTime: Hhmm.default('08:00'),
  /** The evening "tomorrow" preview. */
  evening: z.boolean().default(false),
  eveningTime: Hhmm.default('19:30'),
  include: DigestInclude.default(DEFAULT_INCLUDE),
  /** Late-afternoon reminder when their routine items are still open. */
  routineNudge: z.boolean().default(true),
});
export type DigestPerson = z.infer<typeof DigestPerson>;

export const defaultDigestPerson = (personId: string): DigestPerson => ({
  personId,
  morning: true,
  weekdayTime: '07:00',
  weekendTime: '08:00',
  evening: false,
  eveningTime: '19:30',
  include: { ...DEFAULT_INCLUDE },
  routineNudge: true,
});

export const QuietHours = z.object({
  enabled: z.boolean().default(true),
  from: Hhmm.default('21:30'),
  to: Hhmm.default('06:30'),
});
export type QuietHours = z.infer<typeof QuietHours>;

export const NudgeSettings = z.object({
  /** Late-afternoon reminder when routine items are open. */
  routineTime: Hhmm.default('16:30'),
  /** Minutes before an event to remind; 0 turns event reminders off. */
  eventMinutes: z.number().int().min(0).max(240).default(30),
  /** Per calendar override in minutes (0 = no reminders from that calendar). */
  calendarMinutes: z.record(z.string(), z.number().int().min(0).max(240)).default({}),
  /** "Dinner is not planned" at this time, when tonight has no dinner. */
  dinner: z.boolean().default(true),
  dinnerTime: Hhmm.default('15:00'),
});
export type NudgeSettings = z.infer<typeof NudgeSettings>;

export const DigestSettings = z.object({
  people: z.array(DigestPerson).default([]),
  quiet: QuietHours.default({ enabled: true, from: '21:30', to: '06:30' }),
  nudges: NudgeSettings.default({
    routineTime: '16:30',
    eventMinutes: 30,
    calendarMinutes: {},
    dinner: true,
    dinnerTime: '15:00',
  }),
  /** One friendly sentence at the top, written with the Claude key. Off by default. */
  aiSummary: z.boolean().default(false),
  /** Show "since you last looked" on the wall's Today screen and the phone. */
  sinceStrip: z.boolean().default(true),
});
export type DigestSettings = z.infer<typeof DigestSettings>;

export const DEFAULT_DIGEST_SETTINGS: DigestSettings = {
  people: [],
  quiet: { enabled: true, from: '21:30', to: '06:30' },
  nudges: {
    routineTime: '16:30',
    eventMinutes: 30,
    calendarMinutes: {},
    dinner: true,
    dinnerTime: '15:00',
  },
  aiSummary: false,
  sinceStrip: true,
};

/** A person's digest settings, with the defaults for anyone not set up yet. */
export function digestPerson(settings: DigestSettings | undefined, personId: string): DigestPerson {
  return settings?.people.find((p) => p.personId === personId) ?? defaultDigestPerson(personId);
}

/* ---------- time helpers (pure, minutes since local midnight) ---------- */

export const hhmmMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

/** True when `minutes` (since local midnight) falls in quiet hours. Wraps past midnight. */
export function inQuietHours(minutes: number, quiet: QuietHours): boolean {
  if (!quiet.enabled) return false;
  const from = hhmmMinutes(quiet.from);
  const to = hhmmMinutes(quiet.to);
  if (from === to) return false;
  return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

/** The morning time for a day: weekend time on Saturday (6) and Sunday (0). */
export function morningTimeFor(p: DigestPerson, weekday: number): string {
  return weekday === 0 || weekday === 6 ? p.weekendTime : p.weekdayTime;
}

/* ---------- the digest ---------- */

export const DigestKind = z.enum(['morning', 'evening']);
export type DigestKind = z.infer<typeof DigestKind>;

export const DigestEvent = z.object({
  id: Id,
  title: z.string(),
  start: IsoDateTime,
  end: IsoDateTime,
  allDay: z.boolean(),
  location: z.string().optional(),
  personIds: z.array(Id),
  color: z.string().optional(),
  /** When to leave, if a leave-by trip was matched to this event. */
  leaveBy: IsoDateTime.optional(),
});
export type DigestEvent = z.infer<typeof DigestEvent>;

export const DigestChore = z.object({
  id: Id,
  title: z.string(),
  personId: Id,
  done: z.boolean(),
  timeOfDay: z.enum(['morning', 'afternoon', 'evening', 'any']),
  routineId: Id.optional(),
  icon: z.string().optional(),
  /** Rolled over from an earlier day or week that was missed. */
  overdueSince: IsoDate.optional(),
});
export type DigestChore = z.infer<typeof DigestChore>;

export const DigestAlert = z.object({
  icon: z.string(),
  text: z.string(),
  tone: z.enum(['normal', 'warn', 'good']).default('normal'),
});

export const Digest = z.object({
  /** Whose digest; null for the household. */
  personId: Id.nullable(),
  kind: DigestKind,
  /** The day it covers (today for morning, tomorrow for evening), in the household's zone. */
  date: IsoDate,
  generatedAt: IsoDateTime,
  /** "Good morning, Sam" */
  greeting: z.string(),
  /** "3 events, 2 chores, tacos for dinner" */
  headline: z.string(),
  /** One friendly sentence from Claude, when turned on and a key is set. */
  summary: z.string().optional(),
  weather: z
    .object({
      line: z.string(),
      icon: z.string().optional(),
      warning: z.string().optional(),
    })
    .optional(),
  events: z.array(DigestEvent),
  chores: z.array(DigestChore),
  dinner: z.string().nullable(),
  birthdays: z.array(z.string()),
  alerts: z.array(DigestAlert),
});
export type Digest = z.infer<typeof Digest>;

/** The text of a digest notification: the headline, then the first event. */
export function digestPushBody(d: Digest): string {
  const parts = [d.summary ?? d.headline];
  const next = d.events.find((e) => !e.allDay);
  if (next && !d.summary) parts.push(`First up: ${next.title}.`);
  if (d.weather?.warning) parts.push(d.weather.warning);
  return parts.join(' ');
}

export const DigestQuery = z.object({
  personId: Id.optional(),
  kind: DigestKind.optional(),
});
export const DigestResponse = z.object({ digest: Digest });

export const DigestTestRequest = z.object({
  personId: Id.optional(),
  kind: DigestKind.default('morning'),
});
export const DigestTestResponse = z.object({
  ok: z.boolean(),
  message: z.string(),
  /** Phones it went to. */
  sent: z.number().int().nonnegative(),
  /** Where the notification opens. */
  url: z.string(),
  digest: Digest,
});

export const DigestStatusResponse = z.object({
  people: z.array(
    z.object({
      personId: Id,
      /** Phones that said they are this person's and take the digest. */
      phones: z.number().int().nonnegative(),
      nextMorning: IsoDateTime.nullable(),
      nextEvening: IsoDateTime.nullable(),
    }),
  ),
  /** A Claude key is set, so the friendly summary can be turned on. */
  aiReady: z.boolean(),
});
export type DigestStatusResponse = z.infer<typeof DigestStatusResponse>;

/** Mock mode only: what the push service "sent", so the smoke test can open it. */
export const PushOutboxResponse = z.object({
  messages: z.array(
    z.object({
      subscriptionId: z.string(),
      at: IsoDateTime,
      kind: z.string(),
      title: z.string(),
      body: z.string(),
      url: z.string(),
    }),
  ),
});

/** WebSocket: something was added to the activity log. */
export const ActivityAdded = z.object({
  type: z.literal('activity.added'),
  payload: z.object({ entry: ActivityEntry }),
});

/* ---------- routes (spread into `routes` in api.ts) ---------- */

const def = <
  M extends 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  P extends string,
  Q extends z.ZodType,
  B extends z.ZodType,
  R extends z.ZodType | null,
>(d: {
  method: M;
  path: P;
  query: Q;
  body: B;
  response: R;
  auth: boolean;
}) => d;

export const digestRoutes = {
  activity: def({
    method: 'GET',
    path: '/activity',
    query: ActivityQuery,
    body: NoBody,
    response: ActivityResponse,
    auth: true,
  }),
  digest: def({
    method: 'GET',
    path: '/digest',
    query: DigestQuery,
    body: NoBody,
    response: DigestResponse,
    auth: true,
  }),
  digestTest: def({
    method: 'POST',
    path: '/digest/test',
    query: NoQuery,
    body: DigestTestRequest,
    response: DigestTestResponse,
    auth: true,
  }),
  digestStatus: def({
    method: 'GET',
    path: '/digest/status',
    query: NoQuery,
    body: NoBody,
    response: DigestStatusResponse,
    auth: true,
  }),
  pushOutbox: def({
    method: 'GET',
    path: '/push/outbox',
    query: NoQuery,
    body: NoBody,
    response: PushOutboxResponse,
    auth: true,
  }),
};
