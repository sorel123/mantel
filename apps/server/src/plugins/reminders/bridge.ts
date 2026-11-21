/**
 * Apple Reminders through the Mac helper (v4 L). Reminders can only be read on an Apple device
 * (EventKit; it left CalDAV in iOS 13), and the server can't call the Mac, so the helper calls
 * in every few seconds with its lists and the items of the linked ones. Each check-in runs a
 * normal sync round per linked list against a buffered provider: reads come from what the
 * helper sent, and writes become ops the helper carries out and reports back.
 *
 * Also here: the Shortcuts route, for households with no Mac (one way, best effort).
 */
import { randomUUID } from 'node:crypto';
import {
  RemindersSyncRequest,
  type RemindersOp,
  type RemindersSyncResponse,
  type RemoteItem,
  type RemoteList,
} from '@mantel/shared';
import type { z } from 'zod';
import { kvGet, kvSet, type Db } from '../../db/index.js';
import { HttpError, notFound } from '../../errors.js';
import type { ListStore } from '../../providers/real/lists-store.js';
import type { ListSyncProvider, ListSyncService } from '../../providers/real/lists-sync.js';

interface HelperState {
  name: string;
  version: string;
  lastSeen: string;
  lists: RemoteList[];
}

const HELPER_KEY = 'lists.reminders.helper';
/** The helper counts as away after this long without a check-in (the Mac is asleep). */
const AWAY_MS = 10 * 60_000;

function since(iso: string, now: Date) {
  const mins = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000);
  return mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`;
}

export class RemindersBridge {
  enabled = () => true;

  constructor(
    private readonly db: Db,
    private readonly store: ListStore,
    private readonly sync: ListSyncService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  helper(): HelperState | null {
    return kvGet<HelperState>(this.db, HELPER_KEY) ?? null;
  }

  /** The provider the sync service lists; rounds only run from `checkIn`. */
  provider(): ListSyncProvider {
    const waiting = (): never => {
      throw new Error('Reminders syncs when the Mac helper checks in.');
    };
    return {
      id: 'reminders',
      setup: '/settings#lists',
      pollSeconds: null,
      readiness: () => {
        if (!this.enabled()) return { ready: false, summary: 'Turned off under Integrations.' };
        const h = this.helper();
        if (!h)
          return {
            ready: false,
            summary: 'Install the Mantel Reminders helper on a Mac to start.',
          };
        const away = this.now().getTime() - new Date(h.lastSeen).getTime() > AWAY_MS;
        return away
          ? {
              ready: false,
              summary: `Waiting for ${h.name}: last checked in ${since(h.lastSeen, this.now())}. Is it asleep?`,
            }
          : { ready: true, summary: `${h.name} checked in ${since(h.lastSeen, this.now())}` };
      },
      lists: async () => this.helper()?.lists ?? [],
      pull: async () => waiting(),
      add: async () => waiting(),
      update: async () => waiting(),
      remove: async () => waiting(),
    };
  }

  async checkIn(raw: z.input<typeof RemindersSyncRequest>): Promise<RemindersSyncResponse> {
    if (!this.enabled())
      throw new HttpError('disabled', 'Apple Reminders is turned off under Integrations.');
    const req = RemindersSyncRequest.parse(raw);
    kvSet(this.db, HELPER_KEY, {
      name: req.helper.name,
      version: req.helper.version,
      lastSeen: this.now().toISOString(),
      lists: req.lists,
    } satisfies HelperState);
    this.sync.confirmCreated(req.created);

    const names = new Map(req.lists.map((l) => [l.id, l.name]));
    const links = this.sync.linkRows().filter((r) => r.provider === 'reminders');
    const ops: RemindersOp[] = [];
    for (const link of links) {
      const items = req.snapshots[link.remoteListId];
      if (!items) continue; // the helper sends these once it knows the list is linked
      if (!names.has(link.remoteListId)) continue; // list gone from Reminders: leave the link to Settings
      await this.sync.sync(link.listId, buffered(link.remoteListId, items, ops)).catch(() => {}); // the link shows the error
    }
    return {
      linked: links.map((l) => l.remoteListId),
      ops,
      nextSeconds: ops.length ? 2 : 10,
    };
  }

  /**
   * The Shortcuts route: add the open items not already on the list, and tick the ones the last
   * push listed that have since left Reminders (ticked or deleted there).
   */
  shortcut(listRef: string, incoming: string[] | string) {
    const list = this.store.findList(listRef);
    if (!list) throw notFound(`a list called "${listRef}"`);
    const norm = (s: string) => s.trim().toLowerCase();
    const texts = (Array.isArray(incoming) ? incoming : incoming.split(/\r?\n/))
      .map((s) => s.replace(/^[-•*◦☐□]\s*/, '').trim())
      .filter(Boolean);
    const key = `lists.shortcut.${list.id}`;
    const before = new Set(kvGet<string[]>(this.db, key) ?? []);
    const now = new Set(texts.map(norm));
    const open = this.store.itemsForSync(list.id).filter((i) => !i.done);
    const have = new Set(open.map((i) => norm(i.text)));
    let added = 0;
    let ticked = 0;
    for (const t of texts)
      if (!have.has(norm(t))) {
        this.store.addItem(list.id, { text: t });
        have.add(norm(t));
        added++;
      }
    for (const item of open)
      if (before.has(norm(item.text)) && !now.has(norm(item.text))) {
        this.store.patchItem(item.id, { done: true });
        ticked++;
      }
    kvSet(this.db, key, [...now]);
    return { ok: true as const, listId: list.id, added, ticked };
  }
}

/** Reads from the helper's snapshot; writes become ops for the helper. */
function buffered(remoteListId: string, items: RemoteItem[], ops: RemindersOp[]): ListSyncProvider {
  const pending = (id: string) => id.startsWith('new:');
  return {
    id: 'reminders',
    setup: '/settings#lists',
    pollSeconds: null,
    readiness: () => ({ ready: true, summary: 'Mac helper' }),
    lists: async () => [],
    pull: async () => ({ items, includesDone: true }),
    add: async (_l, { text, done }) => {
      const tempId = `new:${randomUUID()}`;
      ops.push({ op: 'add', remoteListId, tempId, text, done });
      return tempId;
    },
    update: async (_l, remoteId, patch) => {
      if (!pending(remoteId)) ops.push({ op: 'update', remoteListId, remoteId, ...patch });
    },
    remove: async (_l, remoteId) => {
      if (!pending(remoteId)) ops.push({ op: 'delete', remoteListId, remoteId });
    },
  };
}
