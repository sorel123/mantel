/**
 * Inbox items in SQLite. Items that were added stay three days (for Undo and "recently added"),
 * then go; items waiting for someone stay until they are added or dismissed.
 */
import { randomUUID } from 'node:crypto';
import {
  ImportCandidates,
  type ImportHint,
  type InboxItem,
  type InboxOriginalKind,
  type InboxSource,
  type InboxStatus,
} from '@mantel/shared';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { schema, type Db } from '../../db/index.js';

const { inboxItems } = schema;
type Row = typeof inboxItems.$inferSelect;

/** Added items are kept this long. */
export const KEEP_ADDED_MS = 3 * 864e5;
/** At most this many waiting items; the oldest goes when another arrives. */
export const MAX_WAITING = 200;

export interface NewCapture {
  source: InboxSource;
  hint: ImportHint;
  kind: InboxOriginalKind;
  name?: string | null;
  mime?: string | null;
  text?: string | null;
  file?: Buffer | null;
  from?: string | null;
  subject?: string | null;
  dedupeKey?: string | null;
}

const parseCandidates = (json: string) => {
  try {
    return ImportCandidates.parse(JSON.parse(json));
  } catch {
    return { events: [], items: [], meals: [] };
  }
};

const toItem = (r: Row): InboxItem => ({
  id: r.id,
  source: r.source,
  status: r.status,
  createdAt: r.createdAt,
  from: r.fromName,
  subject: r.subject,
  hint: r.hint as ImportHint,
  original: {
    kind: r.kind,
    name: r.name,
    mime: r.mime,
    text: r.text,
    size: r.file?.length ?? 0,
  },
  summary: r.summary,
  candidates: parseCandidates(r.candidates),
  error: r.error,
  committedAt: r.committedAt,
});

export class InboxStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date,
    private readonly iso: (d: Date) => string,
  ) {}

  create(c: NewCapture): InboxItem {
    const id = `inbox-${randomUUID().slice(0, 12)}`;
    this.db
      .insert(inboxItems)
      .values({
        id,
        source: c.source,
        status: 'reading',
        hint: c.hint,
        kind: c.kind,
        name: c.name ?? null,
        mime: c.mime ?? null,
        text: c.text ?? null,
        file: c.file ?? null,
        fromName: c.from ?? null,
        subject: c.subject ?? null,
        summary: 'Reading…',
        candidates: JSON.stringify({ events: [], items: [], meals: [] }),
        error: null,
        dedupeKey: c.dedupeKey ?? null,
        createdAt: this.iso(this.now()),
        committedAt: null,
      })
      .run();
    this.trim();
    return this.get(id)!;
  }

  /** Put a ready-made item in (mock mode's sample captures). */
  seed(item: InboxItem, file: Buffer | null, dedupeKey: string) {
    if (this.hasKey(dedupeKey)) return;
    this.db
      .insert(inboxItems)
      .values({
        id: item.id,
        source: item.source,
        status: item.status,
        hint: item.hint,
        kind: item.original.kind,
        name: item.original.name,
        mime: item.original.mime,
        text: item.original.text,
        file,
        fromName: item.from,
        subject: item.subject,
        summary: item.summary,
        candidates: JSON.stringify(item.candidates),
        error: item.error,
        dedupeKey,
        createdAt: item.createdAt,
        committedAt: item.committedAt,
      })
      .run();
  }

  hasKey(key: string): boolean {
    return !!this.db
      .select({ id: inboxItems.id })
      .from(inboxItems)
      .where(eq(inboxItems.dedupeKey, key))
      .get();
  }

  get(id: string): InboxItem | null {
    const row = this.db.select().from(inboxItems).where(eq(inboxItems.id, id)).get();
    return row ? toItem(row) : null;
  }

  /** The stored original: file bytes, or the text. */
  original(id: string): { body: Buffer; mime: string; name: string | null } | null {
    const row = this.db.select().from(inboxItems).where(eq(inboxItems.id, id)).get();
    if (!row) return null;
    if (row.file)
      return { body: row.file, mime: row.mime ?? 'application/octet-stream', name: row.name };
    if (row.text !== null)
      return {
        body: Buffer.from(row.text, 'utf8'),
        mime: 'text/plain; charset=utf-8',
        name: row.name,
      };
    return null;
  }

  /** Raw content for the reader. */
  content(id: string): Row | null {
    return this.db.select().from(inboxItems).where(eq(inboxItems.id, id)).get() ?? null;
  }

  setRead(
    id: string,
    r: {
      status: InboxStatus;
      summary: string;
      candidates?: ImportCandidates;
      error?: string | null;
    },
  ) {
    this.db
      .update(inboxItems)
      .set({
        status: r.status,
        summary: r.summary,
        ...(r.candidates ? { candidates: JSON.stringify(r.candidates) } : {}),
        error: r.error ?? null,
      })
      .where(eq(inboxItems.id, id))
      .run();
  }

  markAdded(id: string, candidates: ImportCandidates) {
    this.db
      .update(inboxItems)
      .set({
        status: 'added',
        committedAt: this.iso(this.now()),
        candidates: JSON.stringify(candidates),
      })
      .where(eq(inboxItems.id, id))
      .run();
  }

  markReady(id: string) {
    this.db
      .update(inboxItems)
      .set({ status: 'ready', committedAt: null })
      .where(eq(inboxItems.id, id))
      .run();
  }

  delete(id: string): boolean {
    return this.db.delete(inboxItems).where(eq(inboxItems.id, id)).run().changes > 0;
  }

  /** Waiting items (newest first), then the recently added ones. */
  list(): InboxItem[] {
    this.sweep();
    const rows = this.db.select().from(inboxItems).orderBy(desc(inboxItems.createdAt)).all();
    const items = rows.map(toItem);
    return [
      ...items.filter((i) => i.status !== 'added'),
      ...items
        .filter((i) => i.status === 'added')
        .sort((a, b) => (b.committedAt ?? '').localeCompare(a.committedAt ?? '')),
    ];
  }

  pending(): number {
    return this.db
      .select({ id: inboxItems.id })
      .from(inboxItems)
      .where(inArray(inboxItems.status, ['reading', 'ready', 'failed']))
      .all().length;
  }

  /** Items left "reading" by a restart. */
  stuck(): string[] {
    return this.db
      .select({ id: inboxItems.id })
      .from(inboxItems)
      .where(eq(inboxItems.status, 'reading'))
      .all()
      .map((r) => r.id);
  }

  private sweep() {
    const cutoff = this.iso(new Date(this.now().getTime() - KEEP_ADDED_MS));
    // committedAt carries the household's offset; a few hours either way does not matter here.
    this.db
      .delete(inboxItems)
      .where(and(eq(inboxItems.status, 'added'), lt(inboxItems.committedAt, cutoff)))
      .run();
  }

  private trim() {
    const waiting = this.db
      .select({ id: inboxItems.id })
      .from(inboxItems)
      .where(inArray(inboxItems.status, ['reading', 'ready', 'failed']))
      .orderBy(desc(inboxItems.createdAt))
      .all();
    const extra = waiting.slice(MAX_WAITING).map((r) => r.id);
    if (extra.length) this.db.delete(inboxItems).where(inArray(inboxItems.id, extra)).run();
  }
}
