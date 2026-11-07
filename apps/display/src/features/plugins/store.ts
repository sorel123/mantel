/**
 * Plugin contributions on the display (v3 X): the manifests from `GET /api/plugins`, and the
 * blocks and chips each plugin serves, refetched on `plugin.changed` and on a slow poll (cards
 * like trash day change with the clock). Kept in module state so a card that remounts (a screen
 * swipe) shows its last answer at once.
 */
import {
  setPluginCards,
  type ConfigValue,
  type PluginBlocks,
  type PluginChip,
  type PluginDockChip,
  type PluginManifest,
  type PluginTodayCard,
} from '@mantel/shared';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { api } from '../../lib/api';
import { onServerEvent } from '../../lib/events';

/* ---------- manifests ---------- */

let manifests: PluginManifest[] = [];
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** The plugin cards the layout helpers should know about (names and sizes). */
function publishCards(list: PluginManifest[]) {
  setPluginCards(
    list.flatMap((m) => {
      const c = todayCardOf(m);
      return c
        ? [
            {
              kind: `plugin:${m.id}` as const,
              name: c.name,
              description: c.description,
              min: c.min,
              comfort: c.comfort,
            },
          ]
        : [];
    }),
  );
}

export function loadPluginManifests(): Promise<void> {
  loading ??= api
    .call('plugins')
    .then(({ plugins }) => {
      manifests = plugins;
      publishCards(plugins);
      notify();
    })
    .catch(() => {
      // Try again on the next mount.
      loading = null;
    });
  return loading;
}

/** For tests and the demo page. */
export function setPluginManifests(list: PluginManifest[]) {
  manifests = list;
  loading = Promise.resolve();
  publishCards(list);
  notify();
}

/** Every plugin manifest the server reports, on or off. */
export function usePluginManifests(): PluginManifest[] {
  useEffect(() => {
    void loadPluginManifests();
  }, []);
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => manifests,
    () => manifests,
  );
}

/** A manifest's Today card, when it draws one from blocks (a plain name is a built-in card). */
export const todayCardOf = (m: PluginManifest): PluginTodayCard | null =>
  typeof m.contributes.todayCard === 'object' ? m.contributes.todayCard : null;
export const dockChipOf = (m: PluginManifest): PluginDockChip | null =>
  typeof m.contributes.dockChip === 'object' ? m.contributes.dockChip : null;
export const ambientSlotOf = (m: PluginManifest) =>
  typeof m.contributes.ambientSlot === 'object' ? m.contributes.ambientSlot : null;

/* ---------- blocks and chips ---------- */

const POLL_MS = 2 * 60_000;

type Entry<T> = { value: T | null; loaded: boolean; error: string | null };
const cache = new Map<string, Entry<unknown>>();
const cacheListeners = new Map<string, Set<() => void>>();
/** The newest mounted loader per key, for an action to refresh what it changed. */
const refetch = new Map<string, () => void>();

function put(key: string, entry: Entry<unknown>) {
  cache.set(key, entry);
  cacheListeners.get(key)?.forEach((l) => l());
}

function useLive<T>(key: string, id: string, fetcher: () => Promise<T | null>): Entry<T> {
  const [, force] = useState(0);
  useEffect(() => {
    const set = cacheListeners.get(key) ?? new Set();
    cacheListeners.set(key, set);
    const l = () => force((n) => n + 1);
    set.add(l);
    let alive = true;
    const load = () =>
      fetcher()
        .then((value) => alive && put(key, { value, loaded: true, error: null }))
        .catch((err: unknown) => {
          if (!alive) return;
          const prev = cache.get(key);
          put(key, {
            value: prev?.value ?? null,
            loaded: true,
            error: err instanceof Error ? err.message : String(err),
          });
        });
    void load();
    const mine = () => void load();
    refetch.set(key, mine);
    const timer = setInterval(load, POLL_MS);
    const off = onServerEvent((e) => {
      if (e.type === 'plugin.changed' && e.payload.id === id) void load();
    });
    return () => {
      alive = false;
      set.delete(l);
      if (refetch.get(key) === mine) refetch.delete(key);
      clearInterval(timer);
      off();
    };
    // The fetcher is rebuilt each render; the key names what it fetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, id]);
  return (cache.get(key) as Entry<T> | undefined) ?? { value: null, loaded: false, error: null };
}

/** A plugin's blocks by name (`card`, `ambient`, `sheet`), live. */
export function usePluginBlocks(id: string, name: string): Entry<PluginBlocks> {
  return useLive(`blocks:${id}/${name}`, id, () =>
    api.call('pluginBlocks', { params: { id, name } }).then((r) => r.blocks),
  );
}

export function usePluginChip(id: string, name: string): Entry<PluginChip> {
  return useLive(`chip:${id}/${name}`, id, () =>
    api.call('pluginChip', { params: { id, name } }).then((r) => r.chip),
  );
}

/** Press a plugin's button. Resolves to the sentence for a toast; rejects with one on failure. */
export async function runPluginAction(
  id: string,
  name: string,
  args: Record<string, ConfigValue> = {},
): Promise<string | undefined> {
  const res = await api.call('pluginAction', { params: { id, name }, body: { args } });
  // The server also sends `plugin.changed`; refetch here too so the pressing display is instant.
  for (const key of cache.keys())
    if (key.startsWith(`blocks:${id}/`) || key.startsWith(`chip:${id}/`)) refetch.get(key)?.();
  return res.message;
}
