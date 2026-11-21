/**
 * v4 workstream K: capture from anywhere. Every capture (a forwarded email, something shared from a
 * phone, a photo, pasted text) becomes an inbox item: the original, plus the events, list items
 * and meals read from it. Nothing reaches the calendar or a list until someone presses Add.
 *
 * Routes here are spread into `routes` in api.ts; `inbox.changed` joins the WebSocket union in ws.ts.
 */
import { z } from 'zod';
import {
  ImportCandidates,
  ImportCommitRequest,
  ImportCommitResponse,
  ImportHint,
  type ImportAnalyseResponse,
} from './companion.js';
import { Id, IsoDateTime } from './models.js';
import type { PluginManifest, SetupField } from './plugins.js';
import { addDays, startOfDay, toLocalIso } from './time.js';

const NoQuery = z.object({}).strict();
const NoBody = z.undefined();
const Ok = z.object({ ok: z.literal(true) });

/** Where a capture came from. */
export const InboxSource = z.enum(['email', 'share', 'photo', 'text']);
export type InboxSource = z.infer<typeof InboxSource>;

/** What the original is. `ics` is read directly, without Claude. */
export const InboxOriginalKind = z.enum(['text', 'image', 'pdf', 'ics']);
export type InboxOriginalKind = z.infer<typeof InboxOriginalKind>;

/**
 * `reading`: being read now. `ready`: waiting for someone to check it. `failed`: could not be read
 * (the error says why; Retry tries again). `added`: committed (kept a few days for Undo and history).
 */
export const InboxStatus = z.enum(['reading', 'ready', 'failed', 'added']);
export type InboxStatus = z.infer<typeof InboxStatus>;

export const InboxOriginal = z.object({
  kind: InboxOriginalKind,
  /** File name, when there was one ("Newsletter-Nov.pdf"). */
  name: z.string().nullable(),
  mime: z.string().nullable(),
  /** Text originals and email bodies, cut to 20,000 characters; null for files. */
  text: z.string().nullable(),
  /** Bytes of a stored file (`GET /inbox/:id/original`), 0 for text. */
  size: z.number().int().nonnegative(),
});
export type InboxOriginal = z.infer<typeof InboxOriginal>;

export const InboxItem = z.object({
  id: Id,
  source: InboxSource,
  status: InboxStatus,
  createdAt: IsoDateTime,
  /** The sender's address for email, or the device that shared it ("Jay's phone"). */
  from: z.string().nullable(),
  /** Email subject, or the shared page's title. */
  subject: z.string().nullable(),
  hint: ImportHint,
  original: InboxOriginal,
  /** One sentence on what was found, or why nothing was. */
  summary: z.string(),
  candidates: ImportCandidates,
  error: z.string().nullable(),
  committedAt: IsoDateTime.nullable(),
});
export type InboxItem = z.infer<typeof InboxItem>;

export const InboxResponse = z.object({
  /** Waiting items first (newest first), then ones added in the last three days. */
  items: z.array(InboxItem),
  /** Items waiting for someone: reading, ready or failed. */
  pending: z.number().int().nonnegative(),
});
export type InboxResponse = z.infer<typeof InboxResponse>;

/** Image, PDF or calendar file as a data URL. About 11 MB of file at most. */
const FileDataUrl = z
  .string()
  .max(15_000_000)
  .regex(
    /^data:(image\/(jpeg|png|webp|gif)|application\/pdf|text\/calendar|text\/plain);base64,[A-Za-z0-9+/=]+$/,
    'send a photo, a PDF or a calendar (.ics) file',
  );

export const InboxCreateRequest = z
  .object({
    text: z.string().trim().max(20_000).optional(),
    file: FileDataUrl.optional(),
    name: z.string().trim().max(200).optional(),
    subject: z.string().trim().max(300).optional(),
    hint: ImportHint.default('auto'),
    source: InboxSource.optional(),
  })
  .refine((b) => !!b.file || !!b.text, { message: 'send some text or a file' });
export type InboxCreateRequest = z.input<typeof InboxCreateRequest>;

export const InboxItemResponse = z.object({ item: InboxItem });

export const InboxCommitRequest = ImportCommitRequest;
export type InboxCommitRequest = z.input<typeof InboxCommitRequest>;

export const InboxCommitResponse = ImportCommitResponse.extend({
  item: InboxItem,
  /** Undo works until this time (ten seconds on the toast, a little longer on the server). */
  undoUntil: IsoDateTime,
});
export type InboxCommitResponse = z.infer<typeof InboxCommitResponse>;

export const InboxUndoResponse = z.object({
  item: InboxItem,
  /** How many things were taken back off the calendar, lists and meal plan. */
  removed: z.number().int().nonnegative(),
  problems: z.array(z.string()),
});
export type InboxUndoResponse = z.infer<typeof InboxUndoResponse>;

/** A device key for the iPhone "Send to Mantel" Shortcut, shown once. */
export const InboxShortcutKeyResponse = z.object({
  deviceId: Id,
  key: z.string(),
  /** Where the Shortcut posts (`/api/inbox/upload`). */
  url: z.string(),
});

/** `GET /inbox/status`: how captures can reach this Mantel. */
export const InboxStatusResponse = z.object({
  pending: z.number().int().nonnegative(),
  /** True when text, photos and PDFs can be read (a Claude key, or mock mode). */
  canRead: z.boolean(),
  readMessage: z.string(),
  /** The forwarding address, when Forward to Mantel is set up. */
  mailAddress: z.string().nullable(),
  mailState: z.enum(['off', 'not_set_up', 'connected', 'error']),
  mailSummary: z.string(),
  /** Messages from senders not on the allow-list, ignored since the server started. */
  mailIgnored: z.number().int().nonnegative(),
  /** Addresses allowed to send: everyone's email in Settings, plus the extra ones. */
  allowedSenders: z.array(z.string()),
});
export type InboxStatusResponse = z.infer<typeof InboxStatusResponse>;

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

export const inboxRoutes = {
  inbox: def({
    method: 'GET',
    path: '/inbox',
    query: NoQuery,
    body: NoBody,
    response: InboxResponse,
    auth: true,
  }),
  inboxStatus: def({
    method: 'GET',
    path: '/inbox/status',
    query: NoQuery,
    body: NoBody,
    response: InboxStatusResponse,
    auth: true,
  }),
  /** JSON capture: text, or a file as a data URL. The Shortcut uses `/inbox/upload` (a form). */
  inboxCreate: def({
    method: 'POST',
    path: '/inbox',
    query: NoQuery,
    body: InboxCreateRequest,
    response: InboxItemResponse,
    auth: true,
  }),
  inboxCommit: def({
    method: 'POST',
    path: '/inbox/:id/commit',
    query: NoQuery,
    body: InboxCommitRequest,
    response: InboxCommitResponse,
    auth: true,
  }),
  inboxUndo: def({
    method: 'POST',
    path: '/inbox/:id/undo',
    query: NoQuery,
    body: NoBody,
    response: InboxUndoResponse,
    auth: true,
  }),
  inboxRetry: def({
    method: 'POST',
    path: '/inbox/:id/retry',
    query: NoQuery,
    body: NoBody,
    response: InboxItemResponse,
    auth: true,
  }),
  inboxDelete: def({
    method: 'DELETE',
    path: '/inbox/:id',
    query: NoQuery,
    body: NoBody,
    response: Ok,
    auth: true,
  }),
  /** The stored original (photo, PDF, .ics) for `<img>` or a new tab (`?key=` accepted). */
  inboxOriginal: def({
    method: 'GET',
    path: '/inbox/:id/original',
    query: z.object({ key: z.string().optional() }),
    body: NoBody,
    response: null,
    auth: false,
  }),
  inboxShortcutKey: def({
    method: 'POST',
    path: '/inbox/shortcut-key',
    query: NoQuery,
    body: NoBody,
    response: InboxShortcutKeyResponse,
    auth: true,
  }),
} as const;

/* ---------- WebSocket ---------- */

/** Something arrived, was read, added or dismissed; displays refetch `/inbox`. */
export const InboxChanged = z.object({
  type: z.literal('inbox.changed'),
  payload: z.object({ pending: z.number().int().nonnegative() }),
});

/* ---------- fixtures (mock mode and tests) ---------- */

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** What mock mode reads from the sample school newsletter PDF. */
export function sampleNewsletter(now = new Date()): ImportAnalyseResponse {
  const day = (n: number) => ymd(addDays(startOfDay(now), n));
  return {
    summary: 'The Lincoln Elementary newsletter: 3 dates and 2 things to bring.',
    events: [
      {
        title: 'Picture day',
        date: day(4),
        allDay: true,
        personIds: ['ava', 'leo'],
        notes: 'Order forms due the day before.',
      },
      {
        title: 'Book fair',
        date: day(8),
        endDate: day(10),
        allDay: true,
        location: 'School library',
        personIds: [],
      },
      {
        title: 'Parent-teacher conferences',
        date: day(12),
        allDay: false,
        start: '15:30',
        end: '18:00',
        location: 'Room 12',
        personIds: ['ava'],
      },
    ],
    items: [
      { listId: 'list-grocery', listName: 'Grocery', text: 'Tissues for the classroom' },
      { listId: 'list-todo', listName: 'To-do', text: 'Return picture day form' },
    ],
    meals: [],
  };
}

/** What mock mode reads from the sample party invitation photo. */
export function sampleInvite(now = new Date()): ImportAnalyseResponse {
  const day = (n: number) => ymd(addDays(startOfDay(now), n));
  return {
    summary: "An invitation to Maya's 7th birthday party.",
    events: [
      {
        title: "Maya's birthday party",
        date: day(9),
        allDay: false,
        start: '14:00',
        end: '16:00',
        location: 'Jump Zone, 410 Maple Ave',
        personIds: ['leo'],
        notes: 'RSVP to Priya by the 1st. Bring socks.',
      },
    ],
    items: [{ listId: 'list-grocery', listName: 'Grocery', text: 'Birthday present for Maya' }],
    meals: [],
  };
}

/** What mock mode reads from pasted or shared text. */
export function sampleText(now = new Date()): ImportAnalyseResponse {
  const day = (n: number) => ymd(addDays(startOfDay(now), n));
  return {
    summary: 'A dentist appointment.',
    events: [
      {
        title: 'Dentist',
        date: day(2),
        allDay: false,
        start: '15:00',
        end: '15:45',
        personIds: [],
      },
    ],
    items: [],
    meals: [],
  };
}

export function sampleInboxItems(now = new Date()): InboxItem[] {
  const base = {
    hint: 'auto' as const,
    error: null,
    committedAt: null,
    status: 'ready' as const,
  };
  const nl = sampleNewsletter(now);
  const inv = sampleInvite(now);
  return [
    {
      ...base,
      id: 'inbox-newsletter',
      source: 'email',
      createdAt: toLocalIso(new Date(now.getTime() - 25 * 60_000)),
      from: 'office@lincoln-elementary.example',
      subject: 'Lincoln Lions News: November',
      original: {
        kind: 'pdf',
        name: 'Lincoln-Lions-News-November.pdf',
        mime: 'application/pdf',
        text: null,
        size: 1800,
      },
      summary: nl.summary,
      candidates: { events: nl.events, items: nl.items, meals: nl.meals },
    },
    {
      ...base,
      id: 'inbox-invite',
      source: 'email',
      createdAt: toLocalIso(new Date(now.getTime() - 2 * 3_600_000)),
      from: 'priya@example.com',
      subject: "Maya's party!",
      original: {
        kind: 'image',
        name: 'maya-party-invite.jpg',
        mime: 'image/jpeg',
        text: null,
        size: 42000,
      },
      summary: inv.summary,
      candidates: { events: inv.events, items: inv.items, meals: inv.meals },
    },
  ];
}

export function inboxRouteFixtures(now = new Date()) {
  const items = sampleInboxItems(now);
  const first = items[0]!;
  return {
    inbox: { items, pending: items.length },
    inboxStatus: {
      pending: items.length,
      canRead: true,
      readMessage: 'Mock mode: captures read as sample flyers.',
      mailAddress: 'ourfamily.mantel@gmail.com',
      mailState: 'connected' as const,
      mailSummary: 'ourfamily.mantel@gmail.com, checked 2 minutes ago',
      mailIgnored: 1,
      allowedSenders: ['jay@example.com', 'sam@example.com'],
    },
    inboxCreate: { item: { ...first, id: 'inbox-new', status: 'reading' as const } },
    inboxCommit: {
      events: [],
      items: 2,
      meals: 0,
      problems: [],
      item: { ...first, status: 'added' as const, committedAt: toLocalIso(now) },
      undoUntil: toLocalIso(new Date(now.getTime() + 30_000)),
    },
    inboxUndo: { item: first, removed: 5, problems: [] },
    inboxRetry: { item: { ...first, status: 'reading' as const } },
    inboxDelete: { ok: true as const },
    inboxShortcutKey: {
      deviceId: 'dev-shortcut',
      key: 'mk_mock_shortcut_key',
      url: 'http://localhost:8787/api/inbox/upload',
    },
  };
}

/* ---------- plugin manifests (the server re-exports these; the fixtures list them) ---------- */

export const inboxManifest: PluginManifest = {
  id: 'inbox',
  name: 'Inbox',
  description:
    'Anything forwarded, shared or photographed waits here for a yes before it reaches the calendar and lists.',
  category: 'info',
  step: null,
  connect: 'none',
  optional: true,
  docs: 'capture.md',
  directions: [
    'Forward an email, share from a phone or snap a photo: it lands in the inbox.',
    'Tap the inbox chip in the dock (or the Inbox tab on the phone), check what was found, and press Add.',
  ],
  fields: [],
  contributes: {
    dockChip: { id: 'inbox', data: 'chip' },
    events: ['inbox.changed', 'plugin.changed'],
  },
};

const mailField = (f: Partial<SetupField> & Pick<SetupField, 'key' | 'label' | 'type'>) =>
  ({ required: false, advanced: false, readOnly: false, ...f }) as SetupField;

export const mailinManifest: PluginManifest = {
  id: 'mailin',
  name: 'Forward to Mantel',
  description:
    'A mailbox Mantel checks: forward a school newsletter, an invitation or a booking, and it lands in the inbox.',
  category: 'tasks',
  step: null,
  connect: 'fields',
  optional: true,
  docs: 'capture.md',
  directions: [
    'Make a free mailbox just for Mantel, for example [a new Gmail address](https://accounts.google.com/signup) like yourfamily.mantel@gmail.com. A separate address keeps your own mail private.',
    'Gmail: turn on [2-Step Verification](https://myaccount.google.com/signinoptions/twosv), then make an [app password](https://myaccount.google.com/apppasswords) named Mantel. iCloud: make an [app-specific password](https://account.apple.com/account/manage) under Sign-In and Security.',
    'Paste the address and the app password below, press Test, then Save.',
    'Add everyone who may send in Settings › Capture (their own email addresses). Mail from anyone else is ignored.',
  ],
  fields: [
    mailField({
      key: 'provider',
      label: 'Mail service',
      type: 'select',
      default: 'gmail',
      options: [
        { value: 'gmail', label: 'Gmail' },
        { value: 'icloud', label: 'iCloud Mail' },
        { value: 'other', label: 'Another (IMAP)' },
      ],
      help: 'Sets the server for you. Pick Another for Fastmail, Outlook or your own.',
    }),
    mailField({
      key: 'address',
      label: 'Mantel’s email address',
      type: 'text',
      required: true,
      placeholder: 'yourfamily.mantel@gmail.com',
      pattern: { regex: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', message: 'Type a whole email address.' },
      help: 'The address the family forwards to. Mantel signs in with it.',
      env: 'MAILIN_ADDRESS',
    }),
    mailField({
      key: 'appPassword',
      label: 'App password',
      type: 'secret',
      required: true,
      placeholder: 'abcd efgh ijkl mnop',
      getItHere: { label: 'Google app passwords', url: 'https://myaccount.google.com/apppasswords' },
      help: 'Not the normal password: an app password made for Mantel. For iCloud, make it at account.apple.com.',
      env: 'MAILIN_APP_PASSWORD',
    }),
    mailField({
      key: 'allowFrom',
      label: 'Also accept mail from',
      type: 'text',
      placeholder: 'grandma@example.com, @myschool.org',
      help: 'Besides the people in Settings. Separate with commas; @school.org accepts a whole school.',
    }),
    mailField({
      key: 'host',
      label: 'IMAP server',
      type: 'text',
      placeholder: 'imap.fastmail.com',
      help: 'Only for Another. Gmail and iCloud fill this in themselves.',
      dependsOn: { key: 'provider', equals: 'other' },
    }),
    mailField({
      key: 'username',
      label: 'Sign-in name',
      type: 'text',
      advanced: true,
      help: 'Leave empty to sign in with the address above.',
    }),
    mailField({
      key: 'port',
      label: 'IMAP port',
      type: 'number',
      default: 993,
      min: 1,
      max: 65535,
      advanced: true,
    }),
    mailField({
      key: 'folder',
      label: 'Folder',
      type: 'text',
      default: 'INBOX',
      advanced: true,
      help: 'Mantel reads new mail here and marks it read.',
    }),
    mailField({
      key: 'pollMinutes',
      label: 'Check every (minutes)',
      type: 'number',
      default: 2,
      min: 1,
      max: 60,
      advanced: true,
    }),
  ],
  contributes: { events: ['inbox.changed'] },
};
