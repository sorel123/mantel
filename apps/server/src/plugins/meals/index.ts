/**
 * The meal planner plugin (v3 M). Nothing to connect: the plan and favourites live in this
 * server's SQLite. The plugin exists so the planner has a manifest, a status in Health and an
 * on/off switch (`settings.integrations.meals.enabled`); its routes are registered by
 * `registerMealRoutes`, called once from `routes/index.ts`.
 *
 * Mock mode uses a private in-memory database seeded with fixture favourites and this week's
 * plan, so it resets on restart like the other mock stores; `MOCK_EMPTY=1` leaves it empty.
 */
import { addDays, fromIsoDate, startOfWeek, toIsoDate } from '@mantel/shared';
import { mealFavourites, mealPlanSeed } from '@mantel/shared/fixtures';
import type { AppDeps } from '../../app.js';
import type { Handle } from '../../contract.js';
import { openDb } from '../../db/index.js';
import type { Plugin } from '../types.js';
import { manifest } from './manifest.js';
import { MealsService } from './service.js';
import { MealStore } from './store.js';

export { manifest };
export { MealsService } from './service.js';
export { MealStore } from './store.js';

export function mealsPlugin(): Plugin {
  return {
    manifest,
    start() {},
    stop() {},
    apply() {},
    async test() {
      return { ok: true, message: 'The meal planner is built in; nothing to connect.' };
    },
    status() {
      return {
        state: 'connected',
        summary: 'Built in: plan meals on the wall',
        lastOkAt: null,
        lastError: null,
      };
    },
  };
}

/** Fill an empty mock store with fixture favourites and this week's plan. */
export function seedMockMeals(store: MealStore, now: Date): void {
  if (!store.isEmpty()) return;
  for (const f of mealFavourites(now)) {
    const { id, lastUsed, ...input } = f;
    store.createFavourite(input, id);
    if (lastUsed) store.touchFavourite(id, lastUsed);
  }
  const monday = startOfWeek(now);
  for (const p of mealPlanSeed) {
    const fav = p.favouriteId ? store.favourite(p.favouriteId) : null;
    store.put({
      date: toIsoDate(addDays(monday, p.day)),
      slot: p.slot,
      title: p.title ?? fav?.title ?? '',
      favouriteId: p.favouriteId ?? null,
      ingredients: p.ingredients ?? null,
      eventId: null,
    });
  }
}

export function createMealsService(deps: AppDeps, now: () => Date = () => new Date()) {
  const { config } = deps;
  const store = new MealStore(config.MOCK ? openDb(':memory:') : deps.db);
  if (config.MOCK && !config.MOCK_EMPTY) seedMockMeals(store, now());
  return new MealsService({
    store,
    lists: deps.providers.lists,
    calendar: deps.providers.calendar,
    settings: () => deps.settings.get(),
    emit: (e) => deps.hub.broadcast(e),
    now,
  });
}

/** The planner's routes, plus `GET /api/meals` (Today's read model) through the same merge. */
export function registerMealRoutes(handle: Handle, meals: MealsService) {
  handle('meals', async ({ query }) =>
    meals.todayMeals(query.week ? fromIsoDate(query.week) : undefined),
  );
  handle('mealsWeek', async ({ query }) =>
    meals.week(query.start ? fromIsoDate(query.start) : undefined),
  );
  handle('mealsPlan', async ({ body }) => meals.plan(body));
  handle('mealFavourites', async () => meals.favourites());
  handle('mealFavouriteCreate', async ({ body }) => meals.createFavourite(body));
  handle('mealFavouritePatch', async ({ params, body }) => meals.patchFavourite(params.id!, body));
  handle('mealFavouriteDelete', async ({ params }) => meals.deleteFavourite(params.id!));
  handle('mealsWeekToGrocery', async ({ query }) =>
    meals.weekToGrocery(query.start ? fromIsoDate(query.start) : undefined),
  );
  handle('mealToGrocery', async ({ params }) => meals.toGrocery(params.date!, params.slot!));
  handle('mealsUnbought', async ({ query }) =>
    meals.unbought(query.date ? fromIsoDate(query.date) : undefined),
  );
}
