/**
 * v3 workstream C: the companion app's contract. Wall notes, Web Push and Magic Import (a photo
 * of a flyer turned into events, list items and meals). The routes here are spread into the
 * route table in `api.ts`; the `notes.changed` event joins the WebSocket union in `ws.ts`.
 */
import { z } from 'zod';
import { CalendarEvent, ClockTime, Id, IsoDate, IsoDateTime, MealSlot } from './models.js';
import { addDays, startOfDay, toLocalIso } from './time.js';

const Ok = z.object({ ok: z.literal(true) });
const NoQuery = z.object({}).strict();
const NoBody = z.undefined();

/* ---------- wall notes ---------- */

/** Sticky-note colours; the display maps each to a skin token. */
export const NoteColor = z.enum(['sun', 'rose', 'sky', 'mint', 'paper']);
export type NoteColor = z.infer<typeof NoteColor>;
export const NOTE_COLORS = NoteColor.options;

/** How long a note stays: until local midnight, a day, or until someone takes it down. */
export const NoteExpiry = z.enum(['tonight', '24h', 'dismiss']);
export type NoteExpiry = z.infer<typeof NoteExpiry>;

export const WallNote = z.object({
  id: Id,
  kind: z.enum(['text', 'drawing']),
  /** The words; for a drawing, an optional caption. */
  text: z.string().max(280).default(''),
  color: NoteColor,
  /** Who it is from (a person in Settings), if chosen. */
  personId: Id.optional(),
  /** The device that posted it ("Jay's phone", "Kitchen wall"). */
  from: z.string().optional(),
  createdAt: IsoDateTime,
  /** null: stays until dismissed. */
  expiresAt: IsoDateTime.nullable(),
  /** A drawing's PNG is served by `GET /notes/:id/image`. */
  hasImage: z.boolean(),
});
export type WallNote = z.infer<typeof WallNote>;

/** A PNG as a data URL, as `canvas.toDataURL()` makes it. About 1.5 MB at most. */
const PngDataUrl = z
  .string()
  .max(2_000_000)
  .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, 'expected a PNG data URL');

export const NoteCreateRequest = z
  .object({
    kind: z.enum(['text', 'drawing']).default('text'),
    text: z.string().trim().max(280).default(''),
    color: NoteColor.default('sun'),
    expiry: NoteExpiry.default('24h'),
    personId: Id.optional(),
    image: PngDataUrl.optional(),
  })
  .refine((n) => (n.kind === 'drawing' ? !!n.image : n.text.length > 0), {
    message: 'a note needs words, or a drawing',
  });
export type NoteCreateRequest = z.input<typeof NoteCreateRequest>;

export const NotesResponse = z.object({ notes: z.array(WallNote) });
export const NoteResponse = z.object({ note: WallNote });

/* ---------- Web Push ---------- */

/** What a phone can be told about. */
export const PushEventKind = z.enum(['doorbell', 'chores', 'leaveBy', 'reward', 'note']);
export type PushEventKind = z.infer<typeof PushEventKind>;
export const PUSH_EVENT_LABELS: Record<PushEventKind, { label: string; hint: string }> = {
  doorbell: { label: 'Doorbell', hint: 'Someone rang the doorbell.' },
  chores: { label: 'Chores', hint: 'Someone else finished a chore or a routine.' },
  leaveBy: { label: 'Time to leave', hint: 'Ten minutes before a leave-by time.' },
  reward: { label: 'Rewards', hint: 'A reward was redeemed on the wall.' },
  note: { label: 'Wall notes', hint: 'A new note went up on the wall.' },
};

export const PushConfigResponse = z.object({
  /** The server's VAPID public key (URL-safe base64), for `pushManager.subscribe`. */
  publicKey: z.string(),
});

export const PushSubscriptionInfo = z.object({
  id: Id,
  /** The paired device that subscribed. */
  deviceId: Id,
  deviceName: z.string(),
  events: z.array(PushEventKind),
  /** Whose phone this is: their own chores do not notify them. */
  personId: Id.nullable(),
  createdAt: IsoDateTime,
  lastSentAt: IsoDateTime.nullable(),
  lastError: z.string().nullable(),
  /** True for the subscription of the device asking. */
  current: z.boolean(),
});
export type PushSubscriptionInfo = z.infer<typeof PushSubscriptionInfo>;

export const PushSubscribeRequest = z.object({
  /** From `PushSubscription.toJSON()`. */
  endpoint: z.url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  events: z.array(PushEventKind).default(['doorbell', 'chores', 'leaveBy', 'reward']),
  personId: Id.nullable().default(null),
});
export const PushPatchRequest = z
  .object({ events: z.array(PushEventKind), personId: Id.nullable() })
  .partial();
export const PushSubscriptionsResponse = z.object({
  subscriptions: z.array(PushSubscriptionInfo),
});
export const PushSubscriptionResponse = z.object({ subscription: PushSubscriptionInfo });
export const PushTestResponse = z.object({ ok: z.boolean(), message: z.string() });

/** What the service worker receives and shows. */
export const PushMessage = z.object({
  kind: PushEventKind,
  title: z.string(),
  body: z.string(),
  /** Where tapping the notification goes (`/app#chores`). */
  url: z.string().default('/app'),
  tag: z.string().optional(),
});
export type PushMessage = z.infer<typeof PushMessage>;

/* ---------- Magic Import ---------- */

export const ImportHint = z.enum(['auto', 'events', 'list', 'meals']);
export type ImportHint = z.infer<typeof ImportHint>;

/** JPEG, PNG, WebP or GIF as a data URL. The phone converts HEIC before sending. */
const ImageDataUrl = z
  .string()
  .max(8_000_000)
  .regex(/^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/, 'send a JPEG or PNG photo');

export const ImportAnalyseRequest = z.object({
  image: ImageDataUrl,
  hint: ImportHint.default('auto'),
});

export const ImportEvent = z.object({
  title: z.string().min(1).max(200),
  date: IsoDate,
  /** Last day for a multi-day all-day event (inclusive). */
  endDate: IsoDate.optional(),
  allDay: z.boolean(),
  start: ClockTime.optional(),
  end: ClockTime.optional(),
  location: z.string().max(300).optional(),
  /** People named on the flyer, matched against Settings > People. */
  personIds: z.array(Id).default([]),
  notes: z.string().max(500).optional(),
});
export type ImportEvent = z.infer<typeof ImportEvent>;

export const ImportItem = z.object({
  /** An existing list, when the name matched one. */
  listId: Id.optional(),
  listName: z.string().min(1).max(60),
  text: z.string().min(1).max(200),
});
export type ImportItem = z.infer<typeof ImportItem>;

export const ImportMeal = z.object({
  date: IsoDate,
  slot: MealSlot,
  title: z.string().min(1).max(200),
});
export type ImportMeal = z.infer<typeof ImportMeal>;

export const ImportCandidates = z.object({
  events: z.array(ImportEvent).default([]),
  items: z.array(ImportItem).default([]),
  meals: z.array(ImportMeal).default([]),
});
export type ImportCandidates = z.infer<typeof ImportCandidates>;

export const ImportAnalyseResponse = ImportCandidates.extend({
  /** One sentence on what was found ("A school calendar with 4 dates"), or why nothing was. */
  summary: z.string(),
});
export type ImportAnalyseResponse = z.infer<typeof ImportAnalyseResponse>;

export const ImportCommitRequest = ImportCandidates.extend({
  /** Calendar for the events; the default calendar when left out. */
  calendarId: Id.optional(),
});
export type ImportCommitRequest = z.input<typeof ImportCommitRequest>;

export const ImportCommitResponse = z.object({
  events: z.array(CalendarEvent),
  items: z.number().int().nonnegative(),
  meals: z.number().int().nonnegative(),
  /** Anything that could not be written, one sentence each. */
  problems: z.array(z.string()),
});
export type ImportCommitResponse = z.infer<typeof ImportCommitResponse>;

export const ImportStatusResponse = z.object({
  /** True when a photo can be read: a Claude key is set (or mock mode). */
  ready: z.boolean(),
  mock: z.boolean(),
  model: z.string(),
  /** What to tell the person when not ready. */
  message: z.string(),
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

export const companionRoutes = {
  notes: def({
    method: 'GET',
    path: '/notes',
    query: NoQuery,
    body: NoBody,
    response: NotesResponse,
    auth: true,
  }),
  noteCreate: def({
    method: 'POST',
    path: '/notes',
    query: NoQuery,
    body: NoteCreateRequest,
    response: NoteResponse,
    auth: true,
  }),
  noteDelete: def({
    method: 'DELETE',
    path: '/notes/:id',
    query: NoQuery,
    body: NoBody,
    response: Ok,
    auth: true,
  }),
  /** A drawing's PNG for `<img>` (`?key=` accepted). */
  noteImage: def({
    method: 'GET',
    path: '/notes/:id/image',
    query: z.object({ key: z.string().optional() }),
    body: NoBody,
    response: null,
    // The handler checks the header or `?key=` itself, like the camera stills.
    auth: false,
  }),
  pushConfig: def({
    method: 'GET',
    path: '/push/config',
    query: NoQuery,
    body: NoBody,
    response: PushConfigResponse,
    auth: true,
  }),
  pushSubscriptions: def({
    method: 'GET',
    path: '/push/subscriptions',
    query: NoQuery,
    body: NoBody,
    response: PushSubscriptionsResponse,
    auth: true,
  }),
  pushSubscribe: def({
    method: 'POST',
    path: '/push/subscriptions',
    query: NoQuery,
    body: PushSubscribeRequest,
    response: PushSubscriptionResponse,
    auth: true,
  }),
  pushPatch: def({
    method: 'PATCH',
    path: '/push/subscriptions/:id',
    query: NoQuery,
    body: PushPatchRequest,
    response: PushSubscriptionResponse,
    auth: true,
  }),
  pushDelete: def({
    method: 'DELETE',
    path: '/push/subscriptions/:id',
    query: NoQuery,
    body: NoBody,
    response: Ok,
    auth: true,
  }),
  pushTest: def({
    method: 'POST',
    path: '/push/subscriptions/:id/test',
    query: NoQuery,
    body: NoBody,
    response: PushTestResponse,
    auth: true,
  }),
  importStatus: def({
    method: 'GET',
    path: '/import/status',
    query: NoQuery,
    body: NoBody,
    response: ImportStatusResponse,
    auth: true,
  }),
  importAnalyse: def({
    method: 'POST',
    path: '/import/analyse',
    query: NoQuery,
    body: ImportAnalyseRequest,
    response: ImportAnalyseResponse,
    auth: true,
  }),
  importCommit: def({
    method: 'POST',
    path: '/import/commit',
    query: NoQuery,
    body: ImportCommitRequest,
    response: ImportCommitResponse,
    auth: true,
  }),
} as const;

/* ---------- WebSocket ---------- */

/** A note went up or came down; displays refetch `/notes`. */
export const NotesChanged = z.object({ type: z.literal('notes.changed'), payload: z.object({}) });

/* ---------- fixtures (mock mode and tests) ---------- */

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function sampleNotes(now = new Date()): WallNote[] {
  return [
    {
      id: 'note-1',
      kind: 'text',
      text: 'Pizza night! Back by 6 with dough.',
      color: 'sun',
      personId: 'jay',
      from: "Jay's phone",
      createdAt: toLocalIso(new Date(now.getTime() - 40 * 60_000)),
      expiresAt: toLocalIso(addDays(startOfDay(now), 1)),
      hasImage: false,
    },
  ];
}

/**
 * What mock mode "reads" from any photo: a school flyer with two dates, a short supply list and
 * a dinner, all in the coming week, so the preview and commit can be exercised without a key.
 */
export function sampleImport(now = new Date()): ImportAnalyseResponse {
  const day = (n: number) => ymd(addDays(startOfDay(now), n));
  return {
    summary: 'A school flyer: 2 events, 3 things to buy and a dinner.',
    events: [
      {
        title: 'Science fair',
        date: day(3),
        allDay: false,
        start: '18:00',
        end: '19:30',
        location: 'Lincoln Elementary gym',
        personIds: ['ava'],
        notes: 'Projects set up by 5:30.',
      },
      {
        title: 'No school: teacher planning day',
        date: day(6),
        allDay: true,
        personIds: ['ava', 'leo'],
      },
    ],
    items: [
      { listId: 'list-grocery', listName: 'Grocery', text: 'Poster board' },
      { listId: 'list-grocery', listName: 'Grocery', text: 'Glue sticks' },
      { listId: 'list-todo', listName: 'To-do', text: 'Sign the field trip form' },
    ],
    meals: [{ date: day(3), slot: 'dinner', title: 'Tacos before the fair' }],
  };
}

export function companionRouteFixtures(now = new Date()) {
  const notes = sampleNotes(now);
  const sub: PushSubscriptionInfo = {
    id: 'push-1',
    deviceId: 'dev-mock',
    deviceName: "Jay's phone",
    events: ['doorbell', 'chores', 'leaveBy', 'reward'],
    personId: 'jay',
    createdAt: toLocalIso(addDays(now, -2)),
    lastSentAt: null,
    lastError: null,
    current: true,
  };
  return {
    notes: { notes },
    noteCreate: { note: notes[0]! },
    noteDelete: { ok: true as const },
    pushConfig: {
      publicKey:
        'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U',
    },
    pushSubscriptions: { subscriptions: [sub] },
    pushSubscribe: { subscription: sub },
    pushPatch: { subscription: sub },
    pushDelete: { ok: true as const },
    pushTest: { ok: true, message: 'Sent. It should arrive in a few seconds.' },
    importStatus: {
      ready: true,
      mock: true,
      model: 'claude-sonnet-5-5',
      message: 'Mock mode: every photo reads as the same sample flyer.',
    },
    importAnalyse: sampleImport(now),
    importCommit: { events: [], items: 3, meals: 1, problems: [] },
  };
}
