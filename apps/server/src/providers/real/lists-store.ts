import { randomUUID } from 'node:crypto';
import { startOfDay, toLocalIso, type BodyOf, type List, type ListItem } from '@mantel/shared';
import { and, asc, eq, gte, isNull, lt, max, or } from 'drizzle-orm';
import { kvGet, kvSet, schema, type Db } from '../../db/index.js';
import { notFound } from '../../errors.js';

const { lists, listItems } = schema;
type ItemRow = typeof listItems.$inferSelect;

/** Lists a fresh install starts with, as in the mockup. */
export const DEFAULT_LISTS = ['Grocery', 'Chores', 'To-do'];

/** Completed items stay in the database this long (they leave the wall the day after). */
const KEEP_DONE_DAYS = 30;

const newId = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;

const toItem = (row: ItemRow): ListItem => ({
  id: row.id,
  text: row.text,
  done: row.done,
  ...(row.personId ? { personId: row.personId } : {}),
});

/**
 * The built-in list store in SQLite. It is the source of truth for every list today; a sync
 * source such as Apple Reminders hooks in through `onChange` and the `remote_id` columns.
 */
export class ListStore {
  private readonly listeners = new Set<(listId: string) => void>();

  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Called with the list id after every change, from the wall, a phone or a sync. */
  onChange(listener: (listId: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(listId: string) {
    for (const l of this.listeners) l(listId);
  }

  /** Create the default lists once, on a fresh database. Deleting them later sticks. */
  seedDefaults(names = DEFAULT_LISTS) {
    if (kvGet<boolean>(this.db, 'lists.seeded')) return;
    if (this.db.select().from(lists).all().length === 0) for (const n of names) this.createList(n);
    kvSet(this.db, 'lists.seeded', true);
  }

  /**
   * Every list with its items in the order they were added. Items completed before today are
   * left off, the way Reminders hides them, so lists don't fill up with old ticks. Timestamps
   * are local ISO strings, so they compare correctly as text.
   */
  all(): List[] {
    const today = toLocalIso(startOfDay(this.now()));
    const rows = this.db.select().from(lists).orderBy(asc(lists.sort)).all();
    const items = this.db
      .select()
      .from(listItems)
      .where(
        or(
          eq(listItems.done, false),
          isNull(listItems.completedAt),
          gte(listItems.completedAt, today),
        ),
      )
      .orderBy(asc(listItems.sort))
      .all();
    return rows.map((l) => ({
      id: l.id,
      name: l.name,
      source: 'local' as const,
      items: items.filter((i) => i.listId === l.id).map(toItem),
    }));
  }

  createList(name: string, id = newId('list')): List {
    const sort =
      (this.db
        .select({ m: max(lists.sort) })
        .from(lists)
        .get()?.m ?? -1) + 1;
    this.db
      .insert(lists)
      .values({ id, name: name.trim(), sort, createdAt: toLocalIso(this.now()) })
      .run();
    this.changed(id);
    return { id, name: name.trim(), source: 'local', items: [] };
  }

  deleteList(id: string) {
    const res = this.db.delete(lists).where(eq(lists.id, id)).run();
    if (res.changes === 0) throw notFound(`list ${id}`);
    this.changed(id);
  }

  addItem(
    listId: string,
    { text, personId }: BodyOf<'listAddItem'>,
    { id = newId('item'), done = false } = {},
  ): ListItem {
    if (!this.db.select().from(lists).where(eq(lists.id, listId)).get())
      throw notFound(`list ${listId}`);
    const at = toLocalIso(this.now());
    const sort =
      (this.db
        .select({ m: max(listItems.sort) })
        .from(listItems)
        .where(eq(listItems.listId, listId))
        .get()?.m ?? -1) + 1;
    const row = {
      id,
      listId,
      text: text.trim(),
      done,
      personId: personId ?? null,
      sort,
      createdAt: at,
      updatedAt: at,
      completedAt: done ? at : null,
    };
    this.db.insert(listItems).values(row).run();
    this.changed(listId);
    return toItem({ ...row, remoteId: null });
  }

  patchItem(itemId: string, patch: BodyOf<'itemPatch'>): ListItem {
    const row = this.getItem(itemId);
    const at = toLocalIso(this.now());
    const next = {
      text: patch.text?.trim() ?? row.text,
      done: patch.done ?? row.done,
      personId: patch.personId === undefined ? row.personId : patch.personId,
    };
    const completedAt = next.done ? (row.done ? row.completedAt : at) : null;
    this.db
      .update(listItems)
      .set({ ...next, completedAt, updatedAt: at })
      .where(eq(listItems.id, itemId))
      .run();
    this.changed(row.listId);
    return toItem({ ...row, ...next, completedAt, updatedAt: at });
  }

  deleteItem(itemId: string) {
    const row = this.getItem(itemId);
    this.db.delete(listItems).where(eq(listItems.id, itemId)).run();
    this.changed(row.listId);
  }

  /** Drop items completed more than a month ago. Run on start. */
  prune() {
    const cutoff = new Date(this.now());
    cutoff.setDate(cutoff.getDate() - KEEP_DONE_DAYS);
    this.db
      .delete(listItems)
      .where(and(eq(listItems.done, true), lt(listItems.completedAt, toLocalIso(cutoff))))
      .run();
  }

  private getItem(id: string): ItemRow {
    const row = this.db.select().from(listItems).where(eq(listItems.id, id)).get();
    if (!row) throw notFound(`item ${id}`);
    return row;
  }
}
