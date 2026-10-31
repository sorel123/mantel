import type { ListItem } from '@mantel/shared';
import { chores, lists } from '@mantel/shared/fixtures';
import { notFound } from '../../errors.js';
import type { ListsProvider, ProviderContext } from '../types.js';

export function mockLists(ctx: ProviderContext): ListsProvider {
  const all = lists();
  const choreState = chores(ctx.now());
  let seq = 0;

  const findItem = (id: string) => {
    for (const list of all) {
      const index = list.items.findIndex((i) => i.id === id);
      if (index >= 0) return { list, index, item: list.items[index]! };
    }
    throw notFound(`item ${id}`);
  };

  return {
    async lists() {
      return { lists: structuredClone(all) };
    },
    async addItem(listId, { text, personId }) {
      const list = all.find((l) => l.id === listId);
      if (!list) throw notFound(`list ${listId}`);
      const item: ListItem = {
        id: `${listId}-new-${seq++}`,
        text,
        done: false,
        ...(personId ? { personId } : {}),
      };
      list.items.push(item);
      ctx.emit({ type: 'list.changed', payload: { listId } });
      return { item };
    },
    async patchItem(itemId, patch) {
      const { list, item } = findItem(itemId);
      if (patch.text !== undefined) item.text = patch.text;
      if (patch.done !== undefined) item.done = patch.done;
      if (patch.personId === null) delete item.personId;
      else if (patch.personId !== undefined) item.personId = patch.personId;
      ctx.emit({ type: 'list.changed', payload: { listId: list.id } });
      return { item };
    },
    async deleteItem(itemId) {
      const { list, index } = findItem(itemId);
      list.items.splice(index, 1);
      ctx.emit({ type: 'list.changed', payload: { listId: list.id } });
      return { ok: true };
    },
    async chores() {
      return structuredClone(choreState);
    },
    async choreDone(choreId, personId) {
      const chore = choreState.chores.find((c) => c.id === choreId);
      if (!chore) throw notFound(`chore ${choreId}`);
      chore.doneCount += 1;
      const who = personId ?? chore.personId;
      const tally = choreState.stars.find((s) => s.personId === who);
      if (tally) tally.stars += chore.stars;
      else choreState.stars.push({ personId: who, stars: chore.stars });
      return { chore, stars: choreState.stars };
    },
  };
}
