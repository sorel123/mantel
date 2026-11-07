/**
 * Meals (v3 workstream M): Mantel's own meal plan and favourites, merged with the Meals
 * calendar, and the bridge from a planned meal to the grocery list.
 *
 *   GET    /api/meals/week?start              the week's plan (Mantel's slot wins, else the calendar)
 *   PUT    /api/meals/plan                    plan or clear one slot
 *   GET    /api/meals/favourites              the household's favourite meals
 *   POST   /api/meals/favourites              add one
 *   PATCH  /api/meals/favourites/:id          change one
 *   DELETE /api/meals/favourites/:id          remove one
 *   POST   /api/meals/:date/:slot/to-grocery  add one meal's ingredients to the grocery list
 *   POST   /api/meals/week/to-grocery?start   the same for every meal in the week
 *   GET    /api/meals/unbought?date           ingredients this week still to buy
 *
 * The existing `Meal` (models.ts) stays the read model for `GET /api/meals`, which now answers
 * the merged plan too, so Today's Tonight row shows planner meals without a change.
 *
 * This file does not import models.ts (models.ts imports `MealsSettings` from here), so the
 * few primitives it needs are local copies.
 */
import { z } from 'zod';

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const Id = z.string().min(1);
const Ok = z.object({ ok: z.literal(true) });
const NoQuery = z.object({}).strict();
const NoBody = z.undefined();

/** The planner's slots. The calendar's `other` meals are shown but cannot be planned. */
export const PlanSlot = z.enum(['breakfast', 'lunch', 'dinner']);
export type PlanSlot = z.infer<typeof PlanSlot>;
export const PLAN_SLOTS: readonly PlanSlot[] = ['breakfast', 'lunch', 'dinner'];

/** The slot a favourite suits; `any` shows it first for every slot. */
export const FavouriteSlot = z.enum(['breakfast', 'lunch', 'dinner', 'any']);
export type FavouriteSlot = z.infer<typeof FavouriteSlot>;

const Ingredient = z.string().trim().min(1).max(80);
const Tag = z.string().trim().min(1).max(24);

export const Favourite = z.object({
  id: Id,
  title: z.string().trim().min(1).max(80),
  slot: FavouriteSlot.default('any'),
  ingredients: z.array(Ingredient).max(60).default([]),
  tags: z.array(Tag).max(10).default([]),
  /** The last date it was planned for; null when never. Drives "Recent". */
  lastUsed: IsoDate.nullable().default(null),
});
export type Favourite = z.infer<typeof Favourite>;

export const FavouriteInput = Favourite.omit({ id: true, lastUsed: true });
export type FavouriteInput = z.input<typeof FavouriteInput>;
export const FavouritePatch = FavouriteInput.partial();
export type FavouritePatch = z.input<typeof FavouritePatch>;

export const PlannedMeal = z.object({
  date: IsoDate,
  slot: PlanSlot,
  title: z.string(),
  favouriteId: Id.optional(),
  /** `mantel` from the planner; `calendar` from the Meals calendar (read-only here). */
  source: z.enum(['mantel', 'calendar']),
  /** The favourite's ingredients, or the ones typed with the meal. Empty for calendar meals. */
  ingredients: z.array(z.string()).default([]),
  /** Ingredients not on the grocery list yet or still unchecked there. */
  unbought: z.number().int().nonnegative().default(0),
  /** The calendar event: the Meals calendar entry, or the mirror of a planner meal. */
  eventId: Id.optional(),
});
export type PlannedMeal = z.infer<typeof PlannedMeal>;

/** Household settings for the planner, on `Settings.meals`. */
export const MealsSettings = z.object({
  /** `all`: breakfast, lunch and dinner. `dinner`: one row, dinner only. */
  slots: z.enum(['all', 'dinner']).default('all'),
  /** Write planner meals to the Meals calendar ("Dinner: Tacos") so phones see them. */
  mirrorToCalendar: z.boolean().default(false),
  /** The list ingredients go to; null picks the list named Grocery (or the first list). */
  groceryListId: Id.nullable().default(null),
});
export type MealsSettings = z.infer<typeof MealsSettings>;
export const DEFAULT_MEALS_SETTINGS: MealsSettings = {
  slots: 'all',
  mirrorToCalendar: false,
  groceryListId: null,
};

/** The slots to draw for a setting. */
export const slotsShown = (s: Pick<MealsSettings, 'slots'>): PlanSlot[] =>
  s.slots === 'dinner' ? ['dinner'] : [...PLAN_SLOTS];

export const MealsWeekQuery = z.object({ start: IsoDate.optional() }).strict();
export const MealsWeekResponse = z.object({
  /** The Monday of the week. */
  weekStart: IsoDate,
  /** The seven dates, Monday first. */
  days: z.array(IsoDate).length(7),
  slots: z.array(PlanSlot).min(1),
  meals: z.array(PlannedMeal),
  /** Where ingredients go; null when there are no lists. */
  groceryList: z.object({ id: Id, name: z.string() }).nullable(),
  /** Whether planner meals are being written to a Meals calendar. */
  mirroring: z.boolean(),
});
export type MealsWeekResponse = z.infer<typeof MealsWeekResponse>;

/** Plan a slot from a favourite or a typed title. Neither a title nor a favourite clears it. */
export const MealsPlanRequest = z
  .object({
    date: IsoDate,
    slot: PlanSlot,
    title: z.string().trim().max(80).optional(),
    favouriteId: Id.nullable().optional(),
    /** Typed ingredients; with a favourite and none given, the favourite's are used. */
    ingredients: z.array(Ingredient).max(60).optional(),
  })
  .strict();
export type MealsPlanRequest = z.input<typeof MealsPlanRequest>;
export const MealsPlanResponse = z.object({ meal: PlannedMeal.nullable() });

export const FavouritesResponse = z.object({ favourites: z.array(Favourite) });
export const FavouriteResponse = z.object({ favourite: Favourite });

export const ToGroceryResponse = z.object({
  listId: Id,
  listName: z.string(),
  /** Ingredients that were added, as written. */
  added: z.array(z.string()),
  /** Ingredients already on the list and unchecked. */
  skipped: z.array(z.string()),
});
export type ToGroceryResponse = z.infer<typeof ToGroceryResponse>;

export const UnboughtQuery = z.object({ date: IsoDate.optional() }).strict();
export const UnboughtItem = z.object({
  ingredient: z.string(),
  /** On the list but unchecked (false: not on the list at all). */
  onList: z.boolean(),
  /** The meals that need it, as `Tue dinner: Tacos`. */
  meals: z.array(z.object({ date: IsoDate, slot: PlanSlot, title: z.string() })),
});
export type UnboughtItem = z.infer<typeof UnboughtItem>;
export const UnboughtResponse = z.object({
  weekStart: IsoDate,
  items: z.array(UnboughtItem),
});

/** How the planner compares an ingredient with a list item: case, spacing and a plural `s`. */
export function ingredientKey(text: string): string {
  const t = text
    .toLowerCase()
    .replace(/[.,;:!]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t;
}

/** Ingredients typed as one line each, or comma-separated; blanks and repeats dropped. */
export function parseIngredients(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\n,]+/)) {
    const t = raw.trim().slice(0, 80);
    const k = ingredientKey(t);
    if (!t || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out.slice(0, 60);
}

/* ---- routes, spread into the contract's `routes` table in api.ts ---- */

interface MealRoute {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query: z.ZodType;
  body: z.ZodType;
  response: z.ZodType | null;
  auth: boolean;
}
const route = <const R extends MealRoute>(def: R) => def;

export const mealRoutes = {
  mealsWeek: route({
    method: 'GET',
    path: '/meals/week',
    query: MealsWeekQuery,
    body: NoBody,
    response: MealsWeekResponse,
    auth: true,
  }),
  mealsPlan: route({
    method: 'PUT',
    path: '/meals/plan',
    query: NoQuery,
    body: MealsPlanRequest,
    response: MealsPlanResponse,
    auth: true,
  }),
  mealFavourites: route({
    method: 'GET',
    path: '/meals/favourites',
    query: NoQuery,
    body: NoBody,
    response: FavouritesResponse,
    auth: true,
  }),
  mealFavouriteCreate: route({
    method: 'POST',
    path: '/meals/favourites',
    query: NoQuery,
    body: FavouriteInput,
    response: FavouriteResponse,
    auth: true,
  }),
  mealFavouritePatch: route({
    method: 'PATCH',
    path: '/meals/favourites/:id',
    query: NoQuery,
    body: FavouritePatch,
    response: FavouriteResponse,
    auth: true,
  }),
  mealFavouriteDelete: route({
    method: 'DELETE',
    path: '/meals/favourites/:id',
    query: NoQuery,
    body: NoBody,
    response: Ok,
    auth: true,
  }),
  mealsWeekToGrocery: route({
    method: 'POST',
    path: '/meals/week/to-grocery',
    query: MealsWeekQuery,
    body: NoBody,
    response: ToGroceryResponse,
    auth: true,
  }),
  mealToGrocery: route({
    method: 'POST',
    path: '/meals/:date/:slot/to-grocery',
    query: NoQuery,
    body: NoBody,
    response: ToGroceryResponse,
    auth: true,
  }),
  mealsUnbought: route({
    method: 'GET',
    path: '/meals/unbought',
    query: UnboughtQuery,
    body: NoBody,
    response: UnboughtResponse,
    auth: true,
  }),
} as const;
