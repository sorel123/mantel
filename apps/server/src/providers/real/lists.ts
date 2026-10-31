import type { Db } from '../../db/index.js';
import { HttpError } from '../../errors.js';
import type { ListsProvider, ProviderContext } from '../types.js';
import { ChoreStore } from './lists-chores.js';
import { ListStore } from './lists-store.js';

/**
 * Lists and chores from the built-in SQLite store. Apple Reminders can't be reached over
 * iCloud CalDAV since iOS 13, so the server owns the lists; a later Reminders sync (native
 * iPad shell or a Mac helper using EventKit) subscribes to `ListStore.onChange` and fills
 * the `remote_id` columns.
 */
export function storeLists(
  ctx: ProviderContext,
  db: Db = ctx.db,
): ListsProvider & { store: ListStore; choreStore: ChoreStore } {
  const store = new ListStore(db, ctx.now);
  const choreStore = new ChoreStore(db, ctx.now);
  store.onChange((listId) => ctx.emit({ type: 'list.changed', payload: { listId } }));
  const choresChanged = <T>(result: T): T => {
    ctx.emit({ type: 'chores.changed', payload: {} });
    return result;
  };
  const checkPerson = (personId: string | null | undefined) => {
    if (personId && !ctx.settings().people.some((p) => p.id === personId))
      throw new HttpError('bad_request', `unknown person ${personId}`);
  };

  return {
    store,
    choreStore,
    async lists() {
      return { lists: store.all() };
    },
    async addItem(listId, req) {
      checkPerson(req.personId);
      return { item: store.addItem(listId, req) };
    },
    async patchItem(itemId, patch) {
      checkPerson(patch.personId);
      return { item: store.patchItem(itemId, patch) };
    },
    async deleteItem(itemId) {
      store.deleteItem(itemId);
      return { ok: true };
    },
    async createList({ name }) {
      return { list: store.createList(name) };
    },
    async deleteList(listId) {
      store.deleteList(listId);
      return { ok: true };
    },
    async chores() {
      return choreStore.all();
    },
    async choreDone(choreId, personId) {
      checkPerson(personId);
      return choresChanged(choreStore.done(choreId, personId));
    },
    async choreUndo(choreId) {
      return choresChanged(choreStore.undo(choreId));
    },
    async createChore(req) {
      checkPerson(req.personId);
      return choresChanged({ chore: choreStore.create(req) });
    },
    async deleteChore(choreId) {
      choreStore.archive(choreId);
      return choresChanged({ ok: true as const });
    },
  };
}

/** Real mode: the household database, with the default lists on a fresh install. */
export function realLists(ctx: ProviderContext): ListsProvider {
  const lists = storeLists(ctx);
  lists.store.seedDefaults();
  lists.store.prune();
  return lists;
}
