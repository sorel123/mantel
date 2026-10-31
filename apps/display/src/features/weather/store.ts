import {
  weatherPrefsOf,
  type ResponseOf,
  type WeatherAlertPayload,
  type WeatherPlace,
  type WeatherPrefs,
  type WeatherSavedPlace,
} from '@mantel/shared';
import { useSyncExternalStore } from 'react';
import { api } from '../../lib/api';
import { onServerEvent } from '../../lib/events';

export type Weather = ResponseOf<'weather'>;
export type LeaveBy = ResponseOf<'commute'>['leaveBy'][number];
export type Quip = NonNullable<ResponseOf<'weatherQuip'>['quip']>;

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

/** The quip changes a few times a day at most; null when the personality is off. */
export const quipResource = createResource<Quip | null>(
  () => api.call('weatherQuip').then((r) => r.quip),
  30 * 60_000,
);

/** Saved places and the personality, from settings. Refetched hourly; the sheet also writes it. */
export const weatherPrefsResource = createResource<WeatherPrefs>(
  () => api.call('settings').then(weatherPrefsOf),
  60 * 60_000,
);

export const useWeather = () => weatherResource.use();
export const useCommute = () => commuteResource.use();
export const useQuip = () => quipResource.use();
export const useWeatherPrefs = () => weatherPrefsResource.use();

/* ---------- other places ---------- */

const placeCache = new Map<string, { at: number; weather: Weather }>();
const PLACE_CACHE_MS = 10 * 60_000;

/** Forecast for another place, cached briefly so flipping between chips is instant. */
export async function fetchPlace(place: {
  latitude: number;
  longitude: number;
  name?: string;
}): Promise<Weather> {
  const key = `${place.latitude.toFixed(4)},${place.longitude.toFixed(4)}`;
  const hit = placeCache.get(key);
  if (hit && Date.now() - hit.at < PLACE_CACHE_MS) return hit.weather;
  const weather = await api.call('weatherPlace', {
    query: { lat: place.latitude, lon: place.longitude, name: place.name },
  });
  placeCache.set(key, { at: Date.now(), weather });
  return weather;
}

export async function searchPlaces(q: string, signal?: AbortSignal): Promise<WeatherPlace[]> {
  const r = await api.call('weatherSearch', { query: { q }, signal });
  return r.places;
}

/**
 * Save or forget a place. Writes the whole settings object back with `weather.savedPlaces`
 * changed; until the Settings schema carries `weather` the server drops it, and the chip
 * simply does not persist across a reload.
 */
export async function toggleSavedPlace(place: WeatherSavedPlace): Promise<WeatherPrefs> {
  const settings = await api.call('settings');
  const prefs = weatherPrefsOf(settings);
  const same = (p: WeatherSavedPlace) =>
    Math.abs(p.latitude - place.latitude) < 1e-4 && Math.abs(p.longitude - place.longitude) < 1e-4;
  const savedPlaces = prefs.savedPlaces.some(same)
    ? prefs.savedPlaces.filter((p) => !same(p))
    : [...prefs.savedPlaces, place].slice(-8);
  const next: WeatherPrefs = { ...prefs, savedPlaces };
  const body = { ...settings, weather: next } as typeof settings;
  await api.call('settingsPut', { body });
  weatherPrefsResource.set(next);
  return next;
}

/* ---------- the alert banner ---------- */

export interface ActiveAlert extends WeatherAlertPayload {
  receivedAt: number;
}

let activeAlert: ActiveAlert | null = null;
const dismissed = new Set<string>();
const alertListeners = new Set<() => void>();
const notifyAlert = () => alertListeners.forEach((l) => l());

/** Show a warning banner over every screen until it is dismissed (also used by tests and demos). */
export function showAlert(payload: WeatherAlertPayload) {
  if (dismissed.has(payload.alert.id)) return;
  activeAlert = { ...payload, receivedAt: Date.now() };
  notifyAlert();
}

export function dismissAlert() {
  if (activeAlert) dismissed.add(activeAlert.alert.id);
  activeAlert = null;
  notifyAlert();
}

export function useActiveAlert(): ActiveAlert | null {
  return useSyncExternalStore(
    (cb) => {
      alertListeners.add(cb);
      return () => {
        alertListeners.delete(cb);
      };
    },
    () => activeAlert,
    () => activeAlert,
  );
}

// Warnings pushed by the server, whenever the socket is open.
onServerEvent((e) => {
  if (e.type === 'weather.alert') showAlert(e.payload);
});
