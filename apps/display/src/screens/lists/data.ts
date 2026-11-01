import type { BodyOf, Chore, List, ListItem, ResponseOf, StarTally } from '@mantel/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { useServerEvent } from '../../lib/events';

/**
 * Server data that the wall changes optimistically. A refetch triggered by a server push is
 * held back while this display still has requests in flight, so quick taps never flicker
 * back to an older state; it runs once the last request settles.
 */
function useSynced<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(0);
  const stale = useRef(false);

  const refetch = useCallback(() => {
    if (pending.current > 0) {
      stale.current = true;
      return;
    }
    stale.current = false;
    load()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [load]);

  useEffect(refetch, [refetch]);

  /** Apply `local` now, send `remote`, and resync from the server if it fails. */
  const mutate = useCallback(
    async <R>(local: (d: T) => T, remote: () => Promise<R>): Promise<R | undefined> => {
      setData((d) => (d ? local(d) : d));
      pending.current++;
      try {
        return await remote();
      } catch {
        stale.current = true;
        return undefined;
      } finally {
        pending.current--;
        if (pending.current === 0 && stale.current) refetch();
      }
    },
    [refetch],
  );

  return { data, error, refetch, mutate, setData };
}

const loadLists = () => api.call('lists').then((r) => r.lists);

export function useLists() {
  const { data, error, refetch, mutate, setData } = useSynced(loadLists);
  useServerEvent('list.changed', refetch);

  const mapItem = (id: string, fn: (i: ListItem) => ListItem) => (lists: List[]) =>
    lists.map((l) => ({ ...l, items: l.items.map((i) => (i.id === id ? fn(i) : i)) }));

  const toggle = (item: ListItem) =>
    mutate(
      mapItem(item.id, (i) => ({ ...i, done: !i.done })),
      () => api.call('itemPatch', { params: { id: item.id }, body: { done: !item.done } }),
    );

  const add = async (listId: string, text: string, personId?: string) => {
    const res = await mutate(
      (d) => d,
      () => api.call('listAddItem', { params: { id: listId }, body: { text, personId } }),
    );
    if (res)
      setData(
        (d) =>
          d?.map((l) =>
            l.id === listId && !l.items.some((i) => i.id === res.item.id)
              ? { ...l, items: [...l.items, res.item] }
              : l,
          ) ?? d,
      );
    return res?.item;
  };

  const remove = (item: ListItem) =>
    mutate(
      (d) => d.map((l) => ({ ...l, items: l.items.filter((i) => i.id !== item.id) })),
      () => api.call('itemDelete', { params: { id: item.id } }),
    );

  const createList = async (name: string) => {
    const { list } = await api.call('listCreate', { body: { name } });
    setData((d) => (d && !d.some((l) => l.id === list.id) ? [...d, list] : d));
    return list;
  };
  const deleteList = (list: List) =>
    mutate(
      (d) => d.filter((l) => l.id !== list.id),
      () => api.call('listDelete', { params: { id: list.id } }),
    );

  /** Show this list on Today (or stop): only one list is there at a time. */
  const setHome = (list: List, home: boolean) =>
    mutate(
      (d) =>
        d.map((l) => ({ ...l, home: home ? l.id === list.id : l.id === list.id ? false : l.home })),
      () => api.call('listPatch', { params: { id: list.id }, body: { home } }),
    );

  /** Lists in a new order: shown at once while dragging, saved by `saveOrder`. */
  const moveLists = (next: List[]) => setData(next);
  const saveOrder = (ids: string[]) =>
    mutate(
      (d) => ids.map((id) => d.find((l) => l.id === id)).filter((l): l is List => !!l),
      () => api.call('listsReorder', { body: { ids } }),
    );

  return {
    lists: data,
    error,
    refetch,
    toggle,
    add,
    remove,
    createList,
    deleteList,
    setHome,
    moveLists,
    saveOrder,
  };
}

const loadChores = () => api.call('chores');

export type ChoreChart = ResponseOf<'chores'>;

/** Whether a chore has reached its target for the current period. */
export const isComplete = (c: Chore) => c.doneCount >= c.target;

export function useChores() {
  const { data, error, refetch, mutate, setData } = useSynced(loadChores);
  useServerEvent('chores.changed', refetch);

  const apply = (res: { chore: Chore; stars: StarTally[] } | undefined) => {
    if (res)
      setData((d) =>
        d
          ? {
              ...d,
              chores: d.chores.map((c) => (c.id === res.chore.id ? res.chore : c)),
              stars: res.stars,
            }
          : d,
      );
  };

  /** Mark one completion, or take one back when the chore is already complete. */
  const tap = async (chore: Chore) => {
    const undo = isComplete(chore);
    const delta = undo ? -1 : 1;
    const today = todayIndex();
    const res = await mutate(
      (d) => ({
        ...d,
        chores: d.chores.map((c) =>
          c.id === chore.id
            ? {
                ...c,
                doneCount: c.doneCount + delta,
                week: c.week?.map((n, i) => (i === today ? Math.max(0, n + delta) : n)),
              }
            : c,
        ),
        stars: d.stars.map((s) =>
          s.personId === chore.personId
            ? { ...s, stars: Math.max(0, s.stars + delta * chore.stars) }
            : s,
        ),
      }),
      () =>
        undo
          ? api.call('choreUndo', { params: { id: chore.id } })
          : api.call('choreDone', { params: { id: chore.id } }),
    );
    apply(res);
  };

  const create = async (req: BodyOf<'choreCreate'>) => {
    await api.call('choreCreate', { body: req });
    refetch();
  };
  const retire = (chore: Chore) =>
    mutate(
      (d) => ({ ...d, chores: d.chores.filter((c) => c.id !== chore.id) }),
      () => api.call('choreDelete', { params: { id: chore.id } }),
    );

  return { chart: data, error, refetch, tap, create, retire };
}

/** Monday-first index of today, matching `Chore.week`. */
export const todayIndex = (now = new Date()) => (now.getDay() + 6) % 7;
