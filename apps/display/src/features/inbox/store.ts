/**
 * The capture inbox on the display (v4 K): items from `GET /api/inbox`, refetched on
 * `inbox.changed`. Kept in module state so the dock, the wall's review and the phone tab share one
 * copy and a reopened view shows its last answer at once.
 */
import type { InboxCommitResponse, InboxItem } from '@mantel/shared';
import { ApiRequestError } from '@mantel/shared';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { api } from '../../lib/api';
import { onServerEvent } from '../../lib/events';

interface State {
  items: InboxItem[];
  pending: number;
  loaded: boolean;
  error: string | null;
}

let state: State = { items: [], pending: 0, loaded: false, error: null };
const listeners = new Set<() => void>();
const set = (next: Partial<State>) => {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
};

let inflight: Promise<void> | null = null;
export function loadInbox(): Promise<void> {
  inflight ??= api
    .call('inbox')
    .then((r) => set({ items: r.items, pending: r.pending, loaded: true, error: null }))
    .catch((err: unknown) =>
      set({
        loaded: true,
        error: err instanceof ApiRequestError ? err.message : 'Could not reach Mantel.',
      }),
    )
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

let subscribed = false;
function subscribe(l: () => void) {
  listeners.add(l);
  if (!subscribed) {
    subscribed = true;
    onServerEvent((e) => {
      if (e.type === 'inbox.changed') void loadInbox();
    });
  }
  return () => listeners.delete(l);
}

/** Put one item in place at once (after a commit or undo), before the refetch lands. */
export function patchItem(item: InboxItem) {
  const items = state.items.some((i) => i.id === item.id)
    ? state.items.map((i) => (i.id === item.id ? item : i))
    : [item, ...state.items];
  set({ items, pending: items.filter((i) => i.status !== 'added').length });
}

export function dropItem(id: string) {
  const items = state.items.filter((i) => i.id !== id);
  set({ items, pending: items.filter((i) => i.status !== 'added').length });
}

export function useInbox() {
  const s = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    void loadInbox();
  }, []);
  const waiting = s.items.filter((i) => i.status !== 'added');
  const added = s.items.filter((i) => i.status === 'added');
  return { ...s, waiting, added, reload: loadInbox };
}

/** "Added 2 events and 3 list items" */
export function addedSentence(r: Pick<InboxCommitResponse, 'events' | 'items' | 'meals'>) {
  const bits = [
    r.events.length && `${r.events.length} event${r.events.length === 1 ? '' : 's'}`,
    r.items && `${r.items} list item${r.items === 1 ? '' : 's'}`,
    r.meals && `${r.meals} meal${r.meals === 1 ? '' : 's'}`,
  ].filter(Boolean) as string[];
  if (!bits.length) return 'Nothing added';
  const last = bits.pop()!;
  return `Added ${bits.length ? `${bits.join(', ')} and ${last}` : last}`;
}

/** The Undo that follows every commit: a toast with a button for ten seconds. */
export const UNDO_TOAST_MS = 10_000;

export function useUndo(
  toast: (
    m: string,
    o?: {
      durationMs?: number;
      tone?: 'good' | 'warn' | 'none';
      action?: { label: string; onPress: () => void };
    },
  ) => void,
) {
  return useCallback(
    (result: InboxCommitResponse) => {
      patchItem(result.item);
      const problems = result.problems.length ? ` ${result.problems[0]}` : '';
      toast(`${addedSentence(result)}.${problems}`, {
        durationMs: UNDO_TOAST_MS,
        tone: result.problems.length ? 'warn' : 'good',
        action: {
          label: 'Undo',
          onPress: () => {
            api
              .call('inboxUndo', { params: { id: result.item.id } })
              .then((r) => {
                patchItem(r.item);
                toast(
                  r.problems.length ? r.problems[0]! : 'Undone. It is back in the inbox.',
                  r.problems.length ? { tone: 'warn' } : {},
                );
              })
              .catch((err: unknown) =>
                toast(err instanceof ApiRequestError ? err.message : 'Could not undo.', {
                  tone: 'warn',
                }),
              );
          },
        },
      });
    },
    [toast],
  );
}

/** `/api/inbox/:id/original?key=` for an `<img>`, an `<iframe>` or a new tab. */
export const originalUrl = (item: InboxItem) =>
  api.url('inboxOriginal', { id: item.id }, api.deviceKey ? { key: api.deviceKey } : undefined);

export function timeAgo(iso: string, now = Date.now()): string {
  const min = Math.round((now - Date.parse(iso)) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** What to call an item in a list. */
export function itemTitle(item: InboxItem): string {
  if (item.subject) return item.subject;
  if (item.original.name) return item.original.name;
  if (item.original.text) {
    const first = item.original.text.trim().split('\n')[0]!.trim();
    return first.length > 60 ? `${first.slice(0, 57)}…` : first;
  }
  return item.original.kind === 'image' ? 'A photo' : 'Something shared';
}

export function foundCount(item: InboxItem): number {
  const c = item.candidates;
  return c.events.length + c.items.length + c.meals.length;
}
