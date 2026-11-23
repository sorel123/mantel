/**
 * The meal planner plugin (v3 M). Nothing to connect: the plan and favourites live in this
 * server's SQLite. The plugin exists so the planner has a manifest, a status in Health and an
 * on/off switch (`settings.integrations.meals.enabled`); its routes are registered by
 * `registerMealRoutes`, called once from `routes/index.ts`.
 *
 * Mock mode uses a private in-memory database seeded with fixture favourites and this week's
 * plan, so it resets on restart like the other mock stores; `MOCK_EMPTY=1` leaves it empty.
 */
import { addDays, DEVICE_KEY_HEADER, fromIsoDate, startOfWeek, toIsoDate } from '@mantel/shared';
import { mealFavourites, mealPlanSeed, mockRecipes } from '@mantel/shared/fixtures';
import type { AppDeps } from '../../app.js';
import type { Handle } from '../../contract.js';
import { openDb } from '../../db/index.js';
import { HttpError, notFound } from '../../errors.js';
import { recipeArtSvg } from './recipes/art.js';
import { fetchPublic, type PageFetcher } from './recipes/fetch.js';
import { RECIPE_PAGES, recipePageFor } from './recipes/pages.js';
import { RecipesService } from './recipes/service.js';
import { RecipeStore } from './recipes/store.js';
import type { Plugin } from '../types.js';
import { manifest } from './manifest.js';
import { MealsService } from './service.js';
import { MealStore } from './store.js';

export { manifest };
export { MealsService } from './service.js';
export { MealStore } from './store.js';
export { RecipesService } from './recipes/service.js';
export { RecipeStore } from './recipes/store.js';

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

/** Fill an empty mock recipe box with the eight fixture recipes and their drawn photos. */
export function seedMockRecipes(store: RecipeStore, now: Date): void {
  if (!store.isEmpty()) return;
  for (const r of mockRecipes(now)) {
    const { id, createdAt, hasPhoto: _hasPhoto, ...rest } = r;
    store.create(rest, id, createdAt);
    store.setPhoto(id, Buffer.from(recipeArtSvg(id)), 'image/svg+xml');
  }
}

/**
 * Mock mode reads links from the saved pages in `recipes/pages.ts`: a `recipes.example` link
 * gets its page, any other link the salmon page (so pasting a real link still shows the flow).
 * Photos are drawn.
 */
const mockFetch: PageFetcher = async (url, opts) => {
  if (opts?.accept?.startsWith('image/'))
    return { url, status: 200, contentType: 'image/svg+xml', body: Buffer.from(recipeArtSvg(url)) };
  const html = recipePageFor(url) ?? RECIPE_PAGES['yoast-graph']!;
  return { url, status: 200, contentType: 'text/html; charset=utf-8', body: Buffer.from(html) };
};

export function createMealsService(deps: AppDeps, now: () => Date = () => new Date()) {
  const { config } = deps;
  const db = config.MOCK ? openDb(':memory:') : deps.db;
  const store = new MealStore(db);
  const recipeStore = new RecipeStore(db);
  if (config.MOCK && !config.MOCK_EMPTY) {
    seedMockRecipes(recipeStore, now());
    seedMockMeals(store, now());
  }
  const meals = new MealsService({
    store,
    lists: deps.providers.lists,
    calendar: deps.providers.calendar,
    settings: () => deps.settings.get(),
    emit: (e) => deps.hub.broadcast(e),
    now,
  });
  meals.attachRecipes(
    new RecipesService({
      store: recipeStore,
      meals: store,
      lists: deps.providers.lists,
      groceryList: () => meals.groceryList(),
      emit: (e) => deps.hub.broadcast(e),
      fetchPage: config.MOCK ? mockFetch : fetchPublic,
      // The Claude key Magic Import uses (saved under Weather quips).
      claudeKey: () => deps.registry.resolve('quips').secrets.claudeApiKey ?? '',
      mock: config.MOCK,
      mockPhoto: recipeArtSvg,
    }),
  );
  return meals;
}

/** The planner's routes, plus `GET /api/meals` (Today's read model) through the same merge. */
export function registerMealRoutes(
  handle: Handle,
  meals: MealsService,
  deps?: Pick<AppDeps, 'auth'>,
) {
  registerRecipeRoutes(handle, meals, deps);
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

/** v4 B: the recipe box's routes. They answer `disabled` while the meal planner is off. */
function registerRecipeRoutes(handle: Handle, meals: MealsService, deps?: Pick<AppDeps, 'auth'>) {
  const box = () => {
    if (!meals.enabled())
      throw new HttpError(
        'disabled',
        'The recipe box is part of the meal planner, which is turned off in Settings, Meals.',
      );
    return meals.recipes!;
  };
  handle('recipes', async ({ query }) => box().list(query.q, query.tag));
  handle('recipeImport', async ({ body }) => box().import(body));
  handle('recipe', async ({ params }) => ({ recipe: box().get(params.id!) }));
  handle('recipeCreate', async ({ body }) => box().create(body));
  handle('recipePatch', async ({ params, body }) => box().patch(params.id!, body));
  handle('recipeDelete', async ({ params }) => box().delete(params.id!));
  handle('recipeToGrocery', async ({ params, body }) => box().toGrocery(params.id!, body.servings));
  handle('recipeImage', async ({ c, params, query }) => {
    if (deps && !deps.auth.verify(c.req.header(DEVICE_KEY_HEADER) ?? query.key))
      throw new HttpError('unauthorized', 'missing or invalid device key');
    const photo = meals.recipes?.photo(params.id!);
    if (!photo) throw notFound(`photo for recipe ${params.id}`);
    return new Response(new Uint8Array(photo.bytes), {
      headers: {
        'content-type': photo.type,
        'cache-control': 'private, max-age=604800',
        // A cached SVG (mock mode) must not run anything.
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
        'x-content-type-options': 'nosniff',
      },
    });
  });
}
