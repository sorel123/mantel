/**
 * v4 workstream L: lists everywhere. A Mantel list can be linked to one list in an outside
 * service (Apple Reminders through the Mac helper, Todoist, or any Home Assistant `todo.*`
 * entity) and kept in step both ways. The server runs the sync; this file is the contract.
 *
 * Apple Notes has no API or sync protocol of any kind, so it cannot be a target; Reminders is
 * the Apple route, and Siri adds to Reminders, so "Hey Siri, add milk to Groceries" reaches
 * the wall once that list is linked.
 */
import { z } from 'zod';
import { Id, IsoDateTime } from './models.js';

const Ok = z.object({ ok: z.literal(true) });
const NoQuery = z.object({}).strict();
const NoBody = z.undefined();

export const ListSyncProviderId = z.enum(['reminders', 'todoist', 'ha-todo']);
export type ListSyncProviderId = z.infer<typeof ListSyncProviderId>;

/** How each service is named to a person. */
export const LIST_SYNC_NAMES: Record<ListSyncProviderId, string> = {
  reminders: 'Apple Reminders',
  todoist: 'Todoist',
  'ha-todo': 'Home Assistant',
};

/** A list in the outside service that a Mantel list can be linked to. */
export const RemoteList = z.object({
  id: z.string().min(1).max(300),
  name: z.string().max(200),
  /** One short line under the name: "Shared with 3 people", "todo.shopping_list". */
  detail: z.string().max(200).optional(),
});
export type RemoteList = z.infer<typeof RemoteList>;

/** One item as the outside service has it. */
export const RemoteItem = z.object({
  id: z.string().min(1).max(300),
  text: z.string().max(1000),
  done: z.boolean(),
  /** When it last changed there, if the service says; used for last-writer-wins. */
  updatedAt: z.string().max(40).nullable().optional(),
});
export type RemoteItem = z.infer<typeof RemoteItem>;

/** `ok` synced; `syncing` a round is running; `waiting` for the Mac helper; `error` the last round failed. */
export const ListLinkState = z.enum(['ok', 'syncing', 'waiting', 'error']);
export type ListLinkState = z.infer<typeof ListLinkState>;

export const ListLink = z.object({
  listId: Id,
  provider: ListSyncProviderId,
  remoteListId: z.string(),
  remoteName: z.string(),
  state: ListLinkState,
  /** One sentence for Settings: "Synced 2 minutes ago", "Waiting for Jay's Mac". */
  summary: z.string(),
  linkedAt: IsoDateTime,
  lastSyncAt: IsoDateTime.nullable(),
  lastError: z.string().nullable(),
});
export type ListLink = z.infer<typeof ListLink>;

/** A service a list can be shared with, and whether it is ready to pick a list from. */
export const ListSyncProviderInfo = z.object({
  id: ListSyncProviderId,
  name: z.string(),
  ready: z.boolean(),
  /** Why it is or isn't ready, in one sentence. */
  summary: z.string(),
  /** Where to set it up: a Settings anchor such as `/settings#integrations`. */
  setup: z.string(),
});
export type ListSyncProviderInfo = z.infer<typeof ListSyncProviderInfo>;

export const ListSyncResponse = z.object({
  providers: z.array(ListSyncProviderInfo),
  links: z.array(ListLink),
});
export type ListSyncResponse = z.infer<typeof ListSyncResponse>;

export const RemoteListsResponse = z.object({ lists: z.array(RemoteList) });

export const LinkListRequest = z.object({
  provider: ListSyncProviderId,
  remoteListId: z.string().min(1).max(300),
  remoteName: z.string().max(200).optional(),
});
export const LinkResponse = z.object({ link: ListLink });

/* ---------- the Mac helper (Apple Reminders through EventKit) ---------- */

/** Something the Mac helper does in Reminders, then reports back. */
export const RemindersOp = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add'),
    remoteListId: z.string(),
    /** Report the new reminder's id against this in `created` on the next call. */
    tempId: z.string(),
    text: z.string(),
    done: z.boolean(),
  }),
  z.object({
    op: z.literal('update'),
    remoteListId: z.string(),
    remoteId: z.string(),
    text: z.string().optional(),
    done: z.boolean().optional(),
  }),
  z.object({ op: z.literal('delete'), remoteListId: z.string(), remoteId: z.string() }),
]);
export type RemindersOp = z.infer<typeof RemindersOp>;

/**
 * The helper calls this every few seconds while the Mac is awake: its Reminders lists, the
 * items of the lists Mantel has linked, and the ids of reminders it created for the last ops.
 */
export const RemindersSyncRequest = z.object({
  helper: z.object({
    name: z.string().max(100),
    version: z.string().max(40),
  }),
  lists: z.array(RemoteList).max(500),
  /** Items by Reminders list id; only for lists in the last response's `linked`. */
  snapshots: z.record(z.string(), z.array(RemoteItem).max(5000)).default({}),
  created: z
    .array(z.object({ tempId: z.string(), remoteId: z.string(), remoteListId: z.string() }))
    .max(5000)
    .default([]),
});
export type RemindersSyncRequest = z.input<typeof RemindersSyncRequest>;

export const RemindersSyncResponse = z.object({
  /** Reminders list ids linked to a Mantel list: send their items next time. */
  linked: z.array(z.string()),
  ops: z.array(RemindersOp),
  /** Seconds until the next call; sooner after ops so new ids come back quickly. */
  nextSeconds: z.number().int().positive(),
});
export type RemindersSyncResponse = z.infer<typeof RemindersSyncResponse>;

/**
 * The no-Mac route: an iPhone Shortcuts automation posts a Reminders list's open items here on
 * a schedule. One way and best effort: new items are added to the Mantel list, and items the
 * last push listed that are no longer in Reminders are ticked.
 */
export const ShortcutPushRequest = z.object({
  /** The Mantel list's name (any case) or id. */
  list: z.string().trim().min(1).max(100),
  /** The open items, as a list or as one block of text with one item per line. */
  items: z.union([z.array(z.string().max(1000)).max(2000), z.string().max(100_000)]),
});
export const ShortcutPushResponse = z.object({
  ok: z.literal(true),
  listId: Id,
  added: z.number().int(),
  ticked: z.number().int(),
});

export const listSyncRoutes = {
  /** Every service a list can be shared with, and every link with its sync status. */
  listSync: {
    method: 'GET',
    path: '/lists/sync',
    query: NoQuery,
    body: NoBody,
    response: ListSyncResponse,
    auth: true,
  },
  /** The lists in one service, to pick from. */
  listSyncRemote: {
    method: 'GET',
    path: '/lists/sync/:provider/lists',
    query: NoQuery,
    body: NoBody,
    response: RemoteListsResponse,
    auth: true,
  },
  /** Link a Mantel list to a list in a service and sync it now (same-named items are merged). */
  listLink: {
    method: 'PUT',
    path: '/lists/:id/link',
    query: NoQuery,
    body: LinkListRequest,
    response: LinkResponse,
    auth: true,
  },
  /** Stop sharing; both lists keep their items. */
  listUnlink: {
    method: 'DELETE',
    path: '/lists/:id/link',
    query: NoQuery,
    body: NoBody,
    response: Ok,
    auth: true,
  },
  listSyncNow: {
    method: 'POST',
    path: '/lists/:id/link/sync',
    query: NoQuery,
    body: NoBody,
    response: LinkResponse,
    auth: true,
  },
  /** The Mac helper's check-in (it pairs like a display and sends the device key). */
  remindersSync: {
    method: 'POST',
    path: '/lists/sync/reminders',
    query: NoQuery,
    body: RemindersSyncRequest,
    response: RemindersSyncResponse,
    auth: true,
  },
  /** The Shortcuts route, one way. */
  remindersShortcut: {
    method: 'POST',
    path: '/lists/sync/shortcut',
    query: NoQuery,
    body: ShortcutPushRequest,
    response: ShortcutPushResponse,
    auth: true,
  },
} as const;
