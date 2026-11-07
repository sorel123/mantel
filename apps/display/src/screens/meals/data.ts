/**
 * Meal planner data: the week (refetched on `calendar.changed` and `list.changed`, which the
 * server sends after every plan change and grocery add) and the favourites.
 */
import {
  addDays,
  ApiRequestError,
  fromIsoDate,
  startOfWeek,
  toIsoDate,
  type BodyOf,
  type Favourite,
  type MealsWeekResponse,
  type PlannedMeal,
  type PlanSlot,
} from '@mantel/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { onServerEvent } from '../../lib/events';
import { dayNames } from '../today/calendar';

export type Load<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'off' }
  | { status: 'error'; message: string };

export const errorText = (err: unknown): string =>
  err instanceof ApiRequestError
    ? err.message
    : err instanceof Error
      ? err.message
      : 'Something went wrong';

/** Re-run `load` whenever one of the events fires, keeping the last good data meanwhile. */
function useLoad<T>(load: () => Promise<T>, events: ReadonlyArray<string>): [Load<T>, () => void] {
  const [state, setState] = useState<Load<T>>({ status: 'loading' });
  const seq = useRef(0);
  const run = useCallback(() => {
    const n = ++seq.current;
    load()
      .then((data) => n === seq.current && setState({ status: 'ready', data }))
      .catch((err: unknown) => {
        if (n !== seq.current) return;
        if (err instanceof ApiRequestError && err.status === 503) setState({ status: 'off' });
        else
          setState((s) =>
            s.status === 'ready' ? s : { status: 'error', message: errorText(err) },
          );
      });
  }, [load]);
  useEffect(run, [run]);
  useEffect(
    () =>
      onServerEvent((e) => {
        if (events.includes(e.type)) run();
      }),
    [run, events],
  );
  return [state, run];
}

const WEEK_EVENTS = ['calendar.changed', 'list.changed'] as const;

export function useMealWeek(start: Date) {
  const iso = toIsoDate(startOfWeek(start));
  const load = useCallback(() => api.call('mealsWeek', { query: { start: iso } }), [iso]);
  return useLoad<MealsWeekResponse>(load, WEEK_EVENTS);
}

const FAV_EVENTS = ['calendar.changed'] as const;
const loadFavourites = () => api.call('mealFavourites').then((r) => r.favourites);

export function useFavourites() {
  return useLoad<Favourite[]>(loadFavourites, FAV_EVENTS);
}

export const planMeal = (body: BodyOf<'mealsPlan'>) => api.call('mealsPlan', { body });
export const clearMeal = (date: string, slot: PlanSlot) =>
  api.call('mealsPlan', { body: { date, slot } });
export const mealToGrocery = (date: string, slot: PlanSlot) =>
  api.call('mealToGrocery', { params: { date, slot } });
export const weekToGrocery = (start: string) =>
  api.call('mealsWeekToGrocery', { query: { start } });
export const createFavourite = (body: BodyOf<'mealFavouriteCreate'>) =>
  api.call('mealFavouriteCreate', { body });
export const patchFavourite = (id: string, body: BodyOf<'mealFavouritePatch'>) =>
  api.call('mealFavouritePatch', { params: { id }, body });
export const deleteFavourite = (id: string) => api.call('mealFavouriteDelete', { params: { id } });

/** The meal in a slot, if any. */
export const mealAt = (week: MealsWeekResponse, date: string, slot: PlanSlot) =>
  week.meals.find((m) => m.date === date && m.slot === slot);

/** "Added 3 to Grocery" / "Already on Grocery" for a toast. */
export function groceryToast(res: { listName: string; added: string[]; skipped: string[] }) {
  if (res.added.length === 0) return `Everything is already on ${res.listName}`;
  const n = res.added.length;
  const also = res.skipped.length ? `, ${res.skipped.length} already there` : '';
  return `Added ${n} ${n === 1 ? 'item' : 'items'} to ${res.listName}${also}`;
}

/** Favourites for a slot: ones that suit it first, then the rest, each by most recently used. */
export function favouritesFor(
  favs: Favourite[],
  slot: PlanSlot,
  query: string,
  tag: string | null,
) {
  const q = query.trim().toLowerCase();
  const hit = (f: Favourite) =>
    (!q ||
      f.title.toLowerCase().includes(q) ||
      f.ingredients.some((i) => i.toLowerCase().includes(q)) ||
      f.tags.some((t) => t.toLowerCase().includes(q))) &&
    (!tag || f.tags.includes(tag));
  const suits = (f: Favourite) => (f.slot === slot ? 0 : f.slot === 'any' ? 1 : 2);
  const recent = (f: Favourite) => f.lastUsed ?? '';
  return favs
    .filter(hit)
    .sort(
      (a, b) =>
        suits(a) - suits(b) || recent(b).localeCompare(recent(a)) || a.title.localeCompare(b.title),
    );
}

/** The most recently planned favourites, newest first. */
export const recentFavourites = (favs: Favourite[], n = 4) =>
  favs
    .filter((f) => f.lastUsed)
    .sort((a, b) => b.lastUsed!.localeCompare(a.lastUsed!))
    .slice(0, n);

export const allTags = (favs: Favourite[]) =>
  [...new Set(favs.flatMap((f) => f.tags))].sort((a, b) => a.localeCompare(b));

export const shiftWeek = (weekStart: string, weeks: number) =>
  addDays(fromIsoDate(weekStart), weeks * 7);

export type { PlannedMeal };

export const SLOT_NAME: Record<PlanSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
};

/** `Tuesday dinner`. */
export const slotLabel = (date: string, slot: PlanSlot) =>
  `${dayNames[fromIsoDate(date).getDay()]} ${slot}`;
