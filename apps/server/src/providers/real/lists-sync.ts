/**
 * v4 workstream L: keep a Mantel list and a list in an outside service in step, both ways.
 *
 * Each service is a `ListSyncProvider` (Todoist and Home Assistant to-do lists are called from
 * here; Apple Reminders is driven by the Mac helper calling in, through a buffered provider). A
 * link pairs one Mantel list with one remote list. A sync round is a three-way merge: both sides
 * are compared with the text and tick they last agreed on (`list_sync_items`), so
 *
 * - a change on one side is carried to the other;
 * - when both sides changed the text, the later change wins (last writer wins);
 * - ticks are never lost: the tick merges on its own, so a rename elsewhere can't undo it, and an
 *   item ticked on one side and deleted on the other ends up gone, not back unticked;
 * - our own writes are not echoed: changes the round makes locally don't start another round,
 *   and when the service later reports our write back it matches the base, so nothing moves;
 * - offline is fine: a failed round changes nothing, and the next one carries everything made
 *   meanwhile, because the base only moves when a change has reached both sides.
 */
import {
  LIST_SYNC_NAMES,
  toLocalIso,
  type ListLink,
  type ListSyncProviderId,
  type ListSyncProviderInfo,
  type RemindersSyncRequest,
  type RemindersSyncResponse,
  type RemoteItem,
  type RemoteList,
} from '@mantel/shared';
import { and, eq } from 'drizzle-orm';
import { schema, type Db } from '../../db/index.js';
import { HttpError, notFound } from '../../errors.js';
import { log } from '../../log.js';
import type { ListStore } from './lists-store.js';

const { listLinks, listSyncItems } = schema;
type LinkRow = typeof listLinks.$inferSelect;

export interface PullResult {
  items: RemoteItem[];
  /**
   * False when the service only shows open items (Todoist): an item that disappears there may
   * have been ticked, so it is ticked here rather than deleted.
   */
  includesDone: boolean;
}

export interface ListSyncProvider {
  id: ListSyncProviderId;
  /** Whether lists can be picked and synced now, and one sentence on why (not). */
  readiness(): { ready: boolean; summary: string };
  /** Where a person sets it up (a Settings anchor). */
  setup: string;
  lists(): Promise<RemoteList[]>;
  pull(remoteListId: string): Promise<PullResult>;
  /** Add an item; resolves with its id in the service. */
  add(remoteListId: string, item: { text: string; done: boolean }): Promise<string>;
  update(
    remoteListId: string,
    remoteId: string,
    patch: { text?: string; done?: boolean },
  ): Promise<void>;
  remove(remoteListId: string, remoteId: string): Promise<void>;
  /** Seconds between rounds when nothing prompts one; null when the service calls in itself. */
  pollSeconds: number | null;
  /** Calls `onChange` when the service says a list changed (Home Assistant state events). */
  watch?(onChange: (remoteListId: string | null) => void): () => void;
}

/** What the Reminders plugin's bridge offers the routes (see `plugins/reminders/bridge.ts`). */
export interface RemindersRoutes {
  checkIn(req: RemindersSyncRequest): Promise<RemindersSyncResponse>;
  shortcut(
    list: string,
    items: string[] | string,
  ): { ok: true; listId: string; added: number; ticked: number };
}

export interface ListSyncOptions {
  now?: () => Date;
  /** Wait after a local change before syncing, so a burst of taps goes in one round. */
  debounceMs?: number;
  /** Called after every round that reached the service (for Health). */
  onSynced?: () => void;
}

/** Text compare that ignores case and spaces at the ends, for merging same-named items. */
const norm = (s: string) => s.trim().toLowerCase();

function ago(iso: string | null, now: Date): string {
  if (!iso) return 'not synced yet';
  const mins = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'synced just now';
  if (mins < 60) return `synced ${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `synced ${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `synced ${Math.round(hours / 24)} days ago`;
}

export class ListSyncService {
  private readonly providers = new Map<ListSyncProviderId, ListSyncProvider>();
  private readonly unwatch = new Map<ListSyncProviderId, () => void>();
  /** Lists whose local changes are this service's own (echo suppression). */
  private readonly applying = new Set<string>();
  private readonly running = new Map<string, Promise<ListLink>>();
  private readonly again = new Set<string>();
  private readonly debounce = new Map<string, NodeJS.Timeout>();
  private readonly lastPoll = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private offChange: (() => void) | null = null;
  private readonly now: () => Date;
  /** Set when the Reminders plugin is loaded; the Mac helper and Shortcuts routes use it. */
  reminders: RemindersRoutes | null = null;

  constructor(
    private readonly db: Db,
    private readonly store: ListStore,
    private readonly opts: ListSyncOptions = {},
  ) {
    this.now = opts.now ?? (() => new Date());
  }

  /* ---------- lifecycle ---------- */

  /** Sync a linked list shortly after it changes here, and poll the services on a timer. */
  start(): this {
    if (this.offChange) return this;
    this.offChange = this.store.onChange((listId) => {
      if (this.applying.has(listId) || !this.linkRow(listId)) return;
      const p = this.providerFor(listId);
      if (!p || p.pollSeconds === null) return; // the Mac helper picks it up on its next call
      clearTimeout(this.debounce.get(listId));
      const t = setTimeout(() => {
        this.debounce.delete(listId);
        void this.sync(listId).catch(() => {});
      }, this.opts.debounceMs ?? 1500);
      t.unref?.();
      this.debounce.set(listId, t);
    });
    this.timer = setInterval(() => void this.tick(), 15_000);
    this.timer.unref?.();
    return this;
  }

  stop() {
    this.offChange?.();
    this.offChange = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const t of this.debounce.values()) clearTimeout(t);
    this.debounce.clear();
    for (const off of this.unwatch.values()) off();
    this.unwatch.clear();
  }

  /** A plugin adds its service when it starts (or its settings change), and removes it when it stops. */
  register(provider: ListSyncProvider) {
    this.unregister(provider.id);
    this.providers.set(provider.id, provider);
    const off = provider.watch?.((remoteListId) => {
      for (const row of this.linkRows())
        if (
          row.provider === provider.id &&
          (remoteListId === null || row.remoteListId === remoteListId)
        )
          void this.sync(row.listId).catch(() => {});
    });
    if (off) this.unwatch.set(provider.id, off);
  }

  unregister(id: ListSyncProviderId) {
    this.unwatch.get(id)?.();
    this.unwatch.delete(id);
    this.providers.delete(id);
  }

  provider(id: ListSyncProviderId): ListSyncProvider | undefined {
    return this.providers.get(id);
  }

  /** Poll every linked list whose service is due. */
  async tick() {
    const nowMs = this.now().getTime();
    for (const row of this.linkRows()) {
      const p = this.providers.get(row.provider as ListSyncProviderId);
      if (!p || p.pollSeconds === null || !p.readiness().ready) continue;
      if (nowMs - (this.lastPoll.get(row.listId) ?? 0) < p.pollSeconds * 1000) continue;
      this.lastPoll.set(row.listId, nowMs);
      await this.sync(row.listId).catch(() => {});
    }
  }

  /* ---------- what Settings shows ---------- */

  providerInfo(): ListSyncProviderInfo[] {
    return (['reminders', 'todoist', 'ha-todo'] as const).map((id) => {
      const p = this.providers.get(id);
      const r = p?.readiness() ?? { ready: false, summary: 'Turned off in Integrations.' };
      return {
        id,
        name: LIST_SYNC_NAMES[id],
        ready: r.ready,
        summary: r.summary,
        setup: p?.setup ?? '/settings#integrations',
      };
    });
  }

  links(): ListLink[] {
    return this.linkRows().map((r) => this.toLink(r));
  }

  link(listId: string): ListLink | null {
    const row = this.linkRow(listId);
    return row ? this.toLink(row) : null;
  }

  async remoteLists(id: ListSyncProviderId): Promise<RemoteList[]> {
    const p = this.providers.get(id);
    if (!p) throw new HttpError('bad_request', `${LIST_SYNC_NAMES[id]} is turned off`);
    const r = p.readiness();
    if (!r.ready) throw new HttpError('bad_request', r.summary);
    return p.lists();
  }

  /* ---------- linking ---------- */

  /**
   * Link a Mantel list to a remote list, replacing any earlier link, and run the first round.
   * Items with the same text on both sides are paired rather than copied twice.
   */
  async linkList(
    listId: string,
    provider: ListSyncProviderId,
    remoteListId: string,
    remoteName?: string,
  ): Promise<ListLink> {
    if (this.store.findList(listId)?.id !== listId) throw notFound(`list ${listId}`);
    const taken = this.linkRows().find(
      (r) => r.provider === provider && r.remoteListId === remoteListId && r.listId !== listId,
    );
    if (taken) {
      const other = this.store.findList(taken.listId)?.name ?? 'another list';
      throw new HttpError('bad_request', `That list is already shared with "${other}" here.`);
    }
    const p = this.providers.get(provider);
    let name = remoteName;
    if (!name && p?.readiness().ready)
      name = (await p.lists().catch(() => [])).find((l) => l.id === remoteListId)?.name;
    this.db.delete(listSyncItems).where(eq(listSyncItems.listId, listId)).run();
    this.db
      .insert(listLinks)
      .values({
        listId,
        provider,
        remoteListId,
        remoteName: name ?? remoteListId,
        linkedAt: toLocalIso(this.now()),
        lastSyncAt: null,
        lastError: null,
      })
      .onConflictDoUpdate({
        target: listLinks.listId,
        set: {
          provider,
          remoteListId,
          remoteName: name ?? remoteListId,
          linkedAt: toLocalIso(this.now()),
          lastSyncAt: null,
          lastError: null,
        },
      })
      .run();
    if (p && p.pollSeconds !== null && p.readiness().ready) return this.sync(listId);
    return this.toLink(this.linkRow(listId)!);
  }

  unlink(listId: string) {
    this.db.delete(listLinks).where(eq(listLinks.listId, listId)).run();
    this.db.delete(listSyncItems).where(eq(listSyncItems.listId, listId)).run();
  }

  /**
   * Run a round for one list now (after any running one). Rejects with an HttpError when the
   * service can't be reached; the link then shows the error until a round succeeds.
   */
  sync(listId: string, via?: ListSyncProvider): Promise<ListLink> {
    const running = this.running.get(listId);
    if (running) {
      if (via) return running.then(() => this.sync(listId, via));
      this.again.add(listId);
      return running;
    }
    const round = this.round(listId, via).finally(() => {
      this.running.delete(listId);
      if (this.again.delete(listId)) void this.sync(listId).catch(() => {});
    });
    this.running.set(listId, round);
    return round;
  }

  /* ---------- the round ---------- */

  private async round(listId: string, via?: ListSyncProvider): Promise<ListLink> {
    const row = this.linkRow(listId);
    if (!row) throw notFound(`no link for list ${listId}`);
    const p = via ?? this.providers.get(row.provider as ListSyncProviderId);
    if (!p) {
      const msg = `${LIST_SYNC_NAMES[row.provider as ListSyncProviderId]} is turned off.`;
      this.setError(listId, msg);
      throw new HttpError('bad_request', msg);
    }
    try {
      await this.merge(row, p);
      this.db
        .update(listLinks)
        .set({ lastSyncAt: toLocalIso(this.now()), lastError: null })
        .where(eq(listLinks.listId, listId))
        .run();
      this.opts.onSynced?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('list sync failed', { listId, provider: row.provider, err: msg });
      this.setError(listId, msg);
      throw err instanceof HttpError ? err : new HttpError('upstream_error', msg);
    }
    return this.toLink(this.linkRow(listId)!, true);
  }

  private async merge(link: LinkRow, p: ListSyncProvider) {
    const { listId, remoteListId: rl } = link;
    const pulled = await p.pull(rl);
    const remote = new Map(pulled.items.map((i) => [i.id, i]));
    const local = new Map(this.store.itemsForSync(listId).map((i) => [i.id, i]));
    const pairs = this.db
      .select()
      .from(listSyncItems)
      .where(eq(listSyncItems.listId, listId))
      .all();
    const pairedLocal = new Set(pairs.map((m) => m.itemId));
    const pairedRemote = new Set(pairs.map((m) => m.remoteId));

    const setBase = (itemId: string, remoteId: string, text: string, done: boolean) =>
      this.db
        .insert(listSyncItems)
        .values({ listId, itemId, remoteId, baseText: text, baseDone: done })
        .onConflictDoUpdate({
          target: [listSyncItems.listId, listSyncItems.itemId],
          set: { remoteId, baseText: text, baseDone: done },
        })
        .run();
    const dropBase = (itemId: string) =>
      this.db
        .delete(listSyncItems)
        .where(and(eq(listSyncItems.listId, listId), eq(listSyncItems.itemId, itemId)))
        .run();

    for (const m of pairs) {
      const L = local.get(m.itemId);
      const R = remote.get(m.remoteId);
      if (!L && !R) {
        dropBase(m.itemId);
        continue;
      }
      if (!R) {
        if (!L) continue;
        if (m.remoteId.startsWith('new:')) {
          // Added for the Mac helper, which never confirmed it: ask again.
          if (!L.done) setBase(L.id, await p.add(rl, { text: L.text, done: false }), L.text, false);
          else dropBase(L.id);
        } else if (!pulled.includesDone) {
          // Gone from a service that hides ticked items: ticked there (or deleted, the same to us).
          if (!m.baseDone && L.done === m.baseDone)
            this.local(listId, () => this.store.patchItem(L.id, { done: true }));
          else if (!L.done && m.baseDone) {
            // Unticked here after being ticked there: reopen it.
            await p.update(rl, m.remoteId, {
              done: false,
              ...(L.text !== m.baseText ? { text: L.text } : {}),
            });
            setBase(L.id, m.remoteId, L.text, false);
            continue;
          }
          setBase(L.id, m.remoteId, L.text, true);
        } else if (L.text !== m.baseText) {
          // Deleted there, edited here: the edit wins, so it goes back.
          setBase(L.id, await p.add(rl, { text: L.text, done: L.done }), L.text, L.done);
        } else {
          this.local(listId, () => this.store.deleteItem(L.id));
          dropBase(L.id);
        }
        continue;
      }
      if (!L) {
        if (R.text !== m.baseText && !R.done) {
          // Deleted here, edited there: keep the edit.
          const item = this.local(listId, () =>
            this.store.addItem(listId, { text: R.text }, { done: R.done }),
          );
          dropBase(m.itemId);
          setBase(item.id, R.id, R.text, R.done);
        } else {
          await p.remove(rl, R.id);
          dropBase(m.itemId);
        }
        continue;
      }
      const lText = L.text !== m.baseText;
      const rText = R.text !== m.baseText;
      let text = L.text;
      if (rText && !lText) text = R.text;
      else if (rText && lText) {
        const rAt = R.updatedAt ? new Date(R.updatedAt).getTime() : NaN;
        const lAt = new Date(L.updatedAt).getTime();
        if (!Number.isNaN(rAt) && rAt > lAt) text = R.text;
      }
      const done = L.done !== m.baseDone ? L.done : R.done !== m.baseDone ? R.done : L.done;
      if (text !== R.text || done !== R.done)
        await p.update(rl, R.id, {
          ...(text !== R.text ? { text } : {}),
          ...(done !== R.done ? { done } : {}),
        });
      if (text !== L.text || done !== L.done)
        this.local(listId, () => this.store.patchItem(L.id, { text, done }));
      setBase(L.id, R.id, text, done);
    }

    // New on both sides: pair same-named open items first, so a first link doesn't double up.
    const newLocal = [...local.values()].filter((i) => !pairedLocal.has(i.id) && !i.done);
    const newRemote = [...remote.values()].filter((i) => !pairedRemote.has(i.id) && !i.done);
    for (const R of newRemote) {
      const twin = newLocal.findIndex((L) => norm(L.text) === norm(R.text));
      if (twin >= 0) {
        const [L] = newLocal.splice(twin, 1);
        setBase(L!.id, R.id, L!.text, false);
        continue;
      }
      const item = this.local(listId, () => this.store.addItem(listId, { text: R.text }));
      setBase(item.id, R.id, R.text, false);
    }
    for (const L of newLocal)
      setBase(L.id, await p.add(rl, { text: L.text, done: false }), L.text, false);
  }

  /** Change the local list without that change starting another round. */
  private local<T>(listId: string, fn: () => T): T {
    this.applying.add(listId);
    try {
      return fn();
    } finally {
      this.applying.delete(listId);
    }
  }

  /** Rename the provisional ids the Mac helper was given once it reports the real ones. */
  confirmCreated(created: Array<{ tempId: string; remoteId: string }>) {
    for (const c of created)
      this.db
        .update(listSyncItems)
        .set({ remoteId: c.remoteId })
        .where(eq(listSyncItems.remoteId, c.tempId))
        .run();
  }

  /* ---------- rows ---------- */

  linkRows(): LinkRow[] {
    return this.db.select().from(listLinks).all();
  }

  private linkRow(listId: string): LinkRow | undefined {
    return this.db.select().from(listLinks).where(eq(listLinks.listId, listId)).get();
  }

  private providerFor(listId: string) {
    const row = this.linkRow(listId);
    return row ? this.providers.get(row.provider as ListSyncProviderId) : undefined;
  }

  private setError(listId: string, msg: string) {
    this.db.update(listLinks).set({ lastError: msg }).where(eq(listLinks.listId, listId)).run();
  }

  private toLink(row: LinkRow, settled = false): ListLink {
    const provider = row.provider as ListSyncProviderId;
    const p = this.providers.get(provider);
    const ready = p?.readiness() ?? {
      ready: false,
      summary: `${LIST_SYNC_NAMES[provider]} is turned off.`,
    };
    const now = this.now();
    let state: ListLink['state'] = 'ok';
    let summary = ago(row.lastSyncAt, now);
    summary = summary[0]!.toUpperCase() + summary.slice(1);
    if (!settled && this.running.has(row.listId)) {
      state = 'syncing';
      summary = 'Syncing…';
    } else if (row.lastError) {
      state = 'error';
      summary = row.lastError;
    } else if (!ready.ready) {
      state = 'waiting';
      summary = ready.summary;
    } else if (!row.lastSyncAt) {
      state = 'waiting';
      summary = p?.pollSeconds === null ? ready.summary : 'Not synced yet';
    }
    return {
      listId: row.listId,
      provider,
      remoteListId: row.remoteListId,
      remoteName: row.remoteName,
      state,
      summary,
      linkedAt: row.linkedAt,
      lastSyncAt: row.lastSyncAt,
      lastError: row.lastError,
    };
  }
}

/** A provider that reports itself not ready while its plugin is switched off in Integrations. */
export function gated(p: ListSyncProvider, enabled: () => boolean): ListSyncProvider {
  return Object.assign(Object.create(p) as ListSyncProvider, {
    readiness: () =>
      enabled() ? p.readiness() : { ready: false, summary: 'Turned off under Integrations.' },
  });
}
