import type { ResponseOf } from '@mantel/shared';
import { useSyncExternalStore } from 'react';
import { api } from '../../lib/api';
import { onServerEvent } from '../../lib/events';

export type Weather = ResponseOf<'weather'>;
export type LeaveBy = ResponseOf<'commute'>['leaveBy'][number];

export interface Resource<T> {
  data: T | null;
  error: string | null;
}

/**
 * One shared, self-refreshing copy of a server resource. The first component that subscribes
 * starts loading and polling; the last one to leave stops it.
 */
export function createResource<T>(
  load: () => Promise<T>,
  refreshMs: number,
  onStart?: (set: (data: T) => void) => () => void,
) {
  let state: Resource<T> = { data: null, error: null };
  const listeners = new Set<() => void>();
  let stop: (() => void) | null = null;

  const set = (next: Resource<T>) => {
    state = next;
    listeners.forEach((l) => l());
  };
  const refresh = () =>
    load().then(
      (data) => set({ data, error: null }),
      (err: unknown) =>
        set({ data: state.data, error: err instanceof Error ? err.message : String(err) }),
    );

  function start() {
    void refresh();
    const timer = setInterval(() => void refresh(), refreshMs);
    const off = onStart?.((data) => set({ data, error: null }));
    stop = () => {
      clearInterval(timer);
      off?.();
      stop = null;
    };
  }

  const subscribe = (cb: () => void) => {
    listeners.add(cb);
    if (!stop) start();
    return () => {
      listeners.delete(cb);
      if (!listeners.size) stop?.();
    };
  };

  return {
    subscribe,
    get: () => state,
    refresh,
    /** Replace the data by hand (tests and demos). */
    set: (data: T) => set({ data, error: null }),
    use: () => useSyncExternalStore(subscribe, () => state),
  };
}

/** Weather refetches every 15 minutes (the server's cache) and takes `weather.updated` pushes. */
export const weatherResource = createResource<Weather>(
  () => api.call('weather'),
  15 * 60_000,
  (set) =>
    onServerEvent((e) => {
      if (e.type === 'weather.updated') set(e.payload.weather);
    }),
);

/** Leave-by times follow traffic, so they refetch every five minutes. */
export const commuteResource = createResource<LeaveBy[]>(
  () => api.call('commute').then((r) => r.leaveBy),
  5 * 60_000,
);

export const useWeather = () => weatherResource.use();
export const useCommute = () => commuteResource.use();
