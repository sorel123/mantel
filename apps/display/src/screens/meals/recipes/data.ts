/**
 * Recipe box data for the wall and the phone: the box (refetched after any change made here),
 * one recipe, and the actions. Every change calls `recipesChanged()` so open views refresh.
 */
import {
  ApiRequestError,
  type BodyOf,
  type PlanSlot,
  type Recipe,
  type RecipeImportRequest,
  type RecipeToGroceryResponse,
} from '@mantel/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { errorText, type Load } from '../data';

export { errorText };

const subscribers = new Set<() => void>();
/** Tell every open recipe view on this display to load again. */
export const recipesChanged = () => subscribers.forEach((f) => f());

function useReload(run: () => void) {
  useEffect(() => {
    subscribers.add(run);
    return () => {
      subscribers.delete(run);
    };
  }, [run]);
}

function useLoad<T>(load: () => Promise<T>): [Load<T>, () => void] {
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
  useReload(run);
  return [state, run];
}

const loadAll = () => api.call('recipes').then((r) => r.recipes);

/** The whole box; search and tags filter on the display so typing is instant. */
export function useRecipes() {
  return useLoad<Recipe[]>(loadAll);
}

export function useRecipe(id: string) {
  const load = useCallback(
    () => api.call('recipe', { params: { id } }).then((r) => r.recipe),
    [id],
  );
  return useLoad<Recipe>(load);
}

const changed = <T>(p: Promise<T>) =>
  p.then((v) => {
    recipesChanged();
    return v;
  });

export const importRecipe = (body: RecipeImportRequest) =>
  changed(api.call('recipeImport', { body }));
export const patchRecipe = (id: string, body: BodyOf<'recipePatch'>) =>
  changed(api.call('recipePatch', { params: { id }, body }));
export const deleteRecipe = (id: string) => changed(api.call('recipeDelete', { params: { id } }));
export const recipeToGrocery = (id: string, servings?: number) =>
  api.call('recipeToGrocery', { params: { id }, body: servings ? { servings } : {} });
export const planRecipe = (date: string, slot: PlanSlot, recipeId: string) =>
  changed(api.call('mealsPlan', { body: { date, slot, recipeId } }));

/** `/api/recipes/:id/image?key=` for an `<img>`; null when there is no cached photo. */
export const recipeImageUrl = (r: Pick<Recipe, 'id' | 'hasPhoto'>) =>
  r.hasPhoto
    ? api.url('recipeImage', { id: r.id }, api.deviceKey ? { key: api.deviceKey } : undefined)
    : null;

/** "Added 6 to Grocery, 2 topped up" for a toast. */
export function groceryText(res: RecipeToGroceryResponse): string {
  const parts: string[] = [];
  if (res.added.length) parts.push(`Added ${res.added.length} to ${res.listName}`);
  if (res.merged.length) parts.push(`${res.merged.length} topped up`);
  if (res.skipped.length) parts.push(`${res.skipped.length} already there`);
  return parts.length ? parts.join(', ') : `Everything is already on ${res.listName}`;
}

/** Search the title, tags and ingredients; then the tag chip. */
export function filterRecipes(all: Recipe[], query: string, tag: string | null): Recipe[] {
  const q = query.trim().toLowerCase();
  return all.filter(
    (r) =>
      (!tag || r.tags.includes(tag)) &&
      (!q ||
        r.title.toLowerCase().includes(q) ||
        r.tags.some((t) => t.includes(q)) ||
        r.ingredients.some((i) => i.text.toLowerCase().includes(q))),
  );
}

/** Tags by how many recipes use them, most first. */
export function recipeTags(all: Recipe[], max = 12): string[] {
  const n = new Map<string, number>();
  for (const r of all) for (const t of r.tags) n.set(t, (n.get(t) ?? 0) + 1);
  return [...n.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([t]) => t);
}

/** `allrecipes.com` from a link. */
export const siteOf = (url?: string) => {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
};
