import { addDays, startOfWeek, toIsoDate } from '@mantel/shared';
import { chores, lists } from '@mantel/shared/fixtures';
import { openDb } from '../../db/index.js';
import { storeLists } from '../real/lists.js';
import type { ListsProvider, ProviderContext } from '../types.js';

/**
 * The real store on a private in-memory database, seeded with the mockup's lists and chore
 * chart. Everything works (checks, adds, stars, undo) and resets on restart.
 */
export function mockLists(ctx: ProviderContext): ListsProvider {
  const provider = storeLists(ctx, openDb(':memory:'));
  const { store, choreStore } = provider;

  for (const list of lists()) {
    store.createList(list.name, list.id);
    for (const item of list.items) store.addItem(list.id, item, { id: item.id, done: item.done });
  }

  const now = ctx.now();
  const monday = startOfWeek(now);
  for (const c of chores(now).chores) {
    choreStore.create(c, c.id);
    c.week?.forEach((n, i) => {
      for (let k = 0; k < n; k++) choreStore.done(c.id, c.personId, toIsoDate(addDays(monday, i)));
    });
  }
  return provider;
}
