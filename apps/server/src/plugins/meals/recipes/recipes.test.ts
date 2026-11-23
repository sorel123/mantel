import {
  addDays,
  routes,
  startOfWeek,
  toIsoDate,
  type List,
  type WsEventInput,
} from '@mantel/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../app.js';
import { loadConfig } from '../../../config.js';
import { openDb } from '../../../db/index.js';
import type { ListsProvider } from '../../../providers/types.js';
import { MealStore } from '../store.js';
import { cleanClaudeRecipe } from './claude.js';
import { checkUrl, FetchError, isPrivateAddress, type PageFetcher } from './fetch.js';
import { decodeEntities, readableText, recipeFromJsonLd } from './jsonld.js';
import { RECIPE_PAGES } from './pages.js';
import { RecipesService } from './service.js';
import { RecipeStore } from './store.js';
import { recipeFromText } from './text.js';

const url = (name: string) => `https://recipes.example/${name}`;

describe('reading JSON-LD from saved pages', () => {
  it('a recipe inside Yoast @graph, with HowToSteps and entities', () => {
    const r = recipeFromJsonLd(RECIPE_PAGES['yoast-graph']!, url('yoast-graph'))!;
    expect(r.title).toBe('Lemon Garlic Salmon');
    expect(r.servings).toBe(4);
    expect(r.totalMinutes).toBe(25);
    expect(r.image).toBe('https://recipes.example/img/salmon-1200x1200.jpg');
    expect(r.ingredients).toContain('1 ½ tsp. kosher salt');
    expect(r.ingredients).toContain('½ teaspoon black pepper');
    expect(r.steps).toHaveLength(4);
    expect(r.steps[0]).toBe('Heat the oven to 400°F and line a sheet pan.');
    expect(r.tags).toEqual(['dinner', 'american', 'salmon', 'sheet pan', 'quick dinner']);
  });

  it('a top-level array with @type as a list and an ImageObject', () => {
    const r = recipeFromJsonLd(RECIPE_PAGES['type-array']!, url('type-array'))!;
    expect(r.title).toBe('Classic Meatloaf');
    expect(r.servings).toBe(8);
    expect(r.totalMinutes).toBe(75);
    expect(r.image).toBe('https://recipes.example/img/meatloaf.jpg');
    expect(r.ingredients).toHaveLength(9);
    expect(r.steps[0]).toBe('Preheat the oven to 350 degrees F (175 degrees C).');
    expect(r.sourceUrl).toBe(url('type-array'));
  });

  it('HowToSections flattened in order, prep plus cook time, a "Makes 24" yield', () => {
    const r = recipeFromJsonLd(RECIPE_PAGES.sections!, url('sections'))!;
    expect(r.servings).toBe(24);
    expect(r.totalMinutes).toBe(32);
    expect(r.steps).toHaveLength(5);
    expect(r.steps[4]).toMatch(/^Bake 2-tablespoon balls/);
    expect(r.tags).toEqual(['cookies', 'baking', 'chocolate']);
  });

  it('a recipe under mainEntity with instructions as one HTML string', () => {
    const r = recipeFromJsonLd(RECIPE_PAGES['main-entity']!, url('main-entity'))!;
    expect(r.title).toBe('Slow Cooker Chili');
    expect(r.totalMinutes).toBe(495);
    expect(r.servings).toBe(6);
    expect(r.steps).toEqual([
      'Brown the beef and onion in a skillet, about 10 minutes. Drain.',
      'Put everything except the toppings in the slow cooker.',
      'Cook on low for 8 hours.',
      'Serve with cheddar & sour cream.',
    ]);
  });

  it('skips a broken block, takes the fuller of two recipes, resolves a relative photo', () => {
    const r = recipeFromJsonLd(RECIPE_PAGES.messy!, url('messy'))!;
    expect(r.title).toBe('Weeknight Fried Rice');
    expect(r.servings).toBe(4);
    expect(r.totalMinutes).toBe(20);
    expect(r.image).toBe('https://recipes.example/img/fried-rice.jpg');
    expect(r.sourceUrl).toBe('https://recipes.example/messy');
    expect(r.steps).toHaveLength(4);
  });

  it('finds nothing on a page without recipe data, and reads its text for Claude', () => {
    const html = RECIPE_PAGES['no-recipe-data']!;
    expect(recipeFromJsonLd(html, url('no-recipe-data'))).toBeNull();
    const t = readableText(html);
    expect(t.title).toBe("Nana's Shortbread");
    expect(t.text).toContain('1 cup butter, softened');
    expect(t.text).not.toContain('window.ads');
    expect(t.text).not.toContain('Home · Recipes');
  });

  it('decodes entities, twice-encoded ones too', () => {
    expect(decodeEntities('Mac &amp;amp; cheese &#8211; &frac12; cup &#x2019;')).toBe(
      'Mac & cheese – ½ cup ’',
    );
  });
});

describe('fetching links safely', () => {
  it.each([
    ['127.0.0.1', true],
    ['10.1.2.3', true],
    ['172.20.0.1', true],
    ['192.168.1.10', true],
    ['169.254.169.254', true],
    ['100.64.0.1', true],
    ['0.0.0.0', true],
    ['::1', true],
    ['fd00::1', true],
    ['fe80::1', true],
    ['::ffff:192.168.0.1', true],
    ['8.8.8.8', false],
    ['151.101.1.69', false],
    ['2606:4700::6810:84e5', false],
  ])('%s private: %s', (ip, want) => expect(isPrivateAddress(ip)).toBe(want));

  it('refuses links that are not public web pages before connecting', () => {
    for (const bad of [
      'ftp://example.com/x',
      'file:///etc/passwd',
      'http://localhost:8787/api/settings',
      'http://192.168.1.5/',
      'http://[::1]/',
      'http://user:pw@example.com/',
      'http://nas.local/recipes',
      'not a link',
    ])
      expect(() => checkUrl(bad), bad).toThrow(FetchError);
    expect(checkUrl('https://www.example.com/r').hostname).toBe('www.example.com');
  });
});

describe('reading pasted text without Claude', () => {
  it('by headings', () => {
    const r = recipeFromText(
      "Grandma's scones\nServes 8\nIngredients\n2 cups flour\n1 tbsp baking powder\n½ cup butter\nMethod\nRub the butter into the flour.\nAdd milk and bake for 12 minutes.",
    )!;
    expect(r.title).toBe("Grandma's scones");
    expect(r.servings).toBe(8);
    expect(r.ingredients).toEqual(['2 cups flour', '1 tbsp baking powder', '½ cup butter']);
    expect(r.steps).toHaveLength(2);
  });
  it('by amounts when there are no headings', () => {
    const r = recipeFromText(
      'Pancakes\n1 cup flour\n1 egg\n1 cup milk\nWhisk everything together until smooth.\nCook spoonfuls in a hot pan.',
    )!;
    expect(r.ingredients).toHaveLength(3);
    expect(r.steps).toHaveLength(2);
  });
  it('gives up on text with no recipe', () => {
    expect(recipeFromText('Hello\nhow are you\nsee you soon')).toBeNull();
  });
});

describe("Claude's answer", () => {
  it('is cleaned, and an empty one is no recipe', () => {
    expect(cleanClaudeRecipe({ found: false, title: '', ingredients: [] })).toBeNull();
    expect(
      cleanClaudeRecipe({
        found: true,
        title: ' Shortbread ',
        servings: 0,
        totalMinutes: 45,
        ingredients: ['1 cup butter', 2, ' '],
        steps: ['1. Cream the butter.', 'Bake.'],
        tags: ['Baking'],
      }),
    ).toEqual({
      title: 'Shortbread',
      ingredients: ['1 cup butter'],
      steps: ['Cream the butter.', 'Bake.'],
      tags: ['baking'],
      totalMinutes: 45,
    });
  });
});

/* ---- the service against an in-memory list ---- */

function memoryLists(items: string[]): ListsProvider & { list: List } {
  const list: List = {
    id: 'list-grocery',
    name: 'Grocery',
    source: 'local',
    items: items.map((text, i) => ({ id: `i${i}`, text, done: false })) as List['items'],
  };
  let n = 100;
  return {
    list,
    lists: async () => ({ lists: [list] }),
    addItem: async (_id, req) => {
      const item = { id: `i${n++}`, text: req.text, done: false } as List['items'][number];
      list.items.push(item);
      return { item };
    },
    patchItem: async (id, req) => {
      const item = list.items.find((i) => i.id === id)!;
      Object.assign(item, req);
      return { item };
    },
  } as ListsProvider & { list: List };
}

function service(opts: { items?: string[]; fetchPage?: PageFetcher; key?: string } = {}) {
  const db = openDb(':memory:');
  const lists = memoryLists(opts.items ?? []);
  const events: WsEventInput[] = [];
  const pages: string[] = [];
  const fetchPage: PageFetcher =
    opts.fetchPage ??
    (async (u, o) => {
      pages.push(u);
      if (o?.accept?.startsWith('image/'))
        return {
          url: u,
          status: 200,
          contentType: 'image/jpeg',
          body: Buffer.from([0xff, 0xd8, 0xff]),
        };
      const name = new URL(u).pathname.slice(1);
      return {
        url: u,
        status: 200,
        contentType: 'text/html',
        body: Buffer.from(RECIPE_PAGES[name] ?? ''),
      };
    });
  const s = new RecipesService({
    store: new RecipeStore(db),
    meals: new MealStore(db),
    lists,
    groceryList: async () => lists.list,
    emit: (e) => events.push(e),
    fetchPage,
    claudeKey: () => opts.key ?? '',
    mock: false,
    readWithClaude: async () => ({
      title: "Nana's Shortbread",
      ingredients: ['1 cup butter', '½ cup sugar', '2 cups flour'],
      steps: ['Cream.', 'Bake.'],
      tags: [],
    }),
  });
  return { s, lists, events, pages };
}

describe('importing', () => {
  it('saves a link through JSON-LD, caches its photo, and knows it the second time', async () => {
    const { s, pages } = service();
    const first = await s.import({ url: url('type-array') });
    expect(first.via).toBe('link');
    expect(first.recipe.hasPhoto).toBe(true);
    expect(pages).toContain('https://recipes.example/img/meatloaf.jpg');
    expect(first.recipe.ingredients[0]).toMatchObject({
      quantity: 1.5,
      unit: 'lb',
      item: 'ground beef',
    });
    const again = await s.import({ url: url('type-array') });
    expect(again.existing).toBe(true);
    expect(again.recipe.id).toBe(first.recipe.id);
    expect(s.list().recipes).toHaveLength(1);
  });

  it('falls back to Claude for a page with no recipe data, and says so', async () => {
    const { s } = service({ key: 'sk-test' });
    const r = await s.import({ url: url('no-recipe-data') });
    expect(r.via).toBe('claude');
    expect(r.message).toMatch(/Claude read it/);
    expect(r.recipe.sourceUrl).toBe(url('no-recipe-data'));
  });

  it('without a key, explains what to do for such a page', async () => {
    const { s } = service();
    await expect(s.import({ url: url('no-recipe-data') })).rejects.toThrow(/Claude key/);
  });

  it('reads pasted text line by line when there is no key', async () => {
    const { s } = service();
    const r = await s.import({
      text: 'Toast\nIngredients\n2 slices bread\n1 tbsp butter\nMethod\nToast and butter it.',
    });
    expect(r.via).toBe('text');
    expect(r.recipe.ingredients).toHaveLength(2);
  });

  it('turns fetch failures into sentences', async () => {
    const { s } = service({
      fetchPage: async () => {
        throw new FetchError('That site took too long to answer. Try again.');
      },
    });
    await expect(s.import({ url: 'https://slow.example/r' })).rejects.toThrow('took too long');
  });
});

describe('to the grocery list', () => {
  it('scales to the servings wanted, adds new lines, raises matching amounts, leaves others', async () => {
    const { s, lists, events } = service({ items: ['1 cup milk', 'Eggs', '2 onions'] });
    const { recipe } = s.create({
      title: 'Test pancakes',
      servings: 4,
      ingredients: [
        '2 cups flour',
        '1 cup milk',
        '½ cup milk, warm',
        '2 large eggs',
        '1 tbsp sugar',
        'Salt to taste',
        '1 cup water',
      ],
      steps: ['Mix.', 'Cook.'],
    });
    const res = await s.toGrocery(recipe.id, 8);
    // Flour doubled; sugar doubled; salt with no amount; water skipped.
    expect(res.added).toEqual(['4 cups flour', '2 tbsp sugar', 'Salt']);
    // Milk: 1 + 0.5 = 1.5 cups, doubled = 3, plus the 1 cup already listed = 4 cups.
    expect(res.merged).toEqual(['4 cups milk']);
    // "Eggs" has no amount to add to: left as it was.
    expect(res.skipped).toEqual(['Eggs']);
    expect(lists.list.items.map((i) => i.text)).toEqual([
      '4 cups milk',
      'Eggs',
      '2 onions',
      '4 cups flour',
      '2 tbsp sugar',
      'Salt',
    ]);
    expect(events).toContainEqual({ type: 'list.changed', payload: { listId: 'list-grocery' } });
  });

  it('keeps the recipe amounts when no servings are asked for', async () => {
    const { s } = service();
    const { recipe } = s.create({
      title: 'Toast',
      servings: 2,
      ingredients: ['2 slices bread'],
      steps: [],
    });
    expect((await s.toGrocery(recipe.id)).added).toEqual(['2 slices bread']);
  });
});

describe('recipes in mock mode, through the app', () => {
  const mock = createApp(loadConfig({ MOCK: '1', DATA_DIR: ':memory:' }));
  const empty = createApp(loadConfig({ MOCK: '1', MOCK_EMPTY: '1', DATA_DIR: ':memory:' }));
  afterAll(() => {
    mock.close();
    empty.close();
  });
  const call = (app: typeof mock.app, method: string, path: string, body?: unknown) =>
    app.request(`/api${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = (res: Response): Promise<any> => res.json();
  const thursday = toIsoDate(addDays(startOfWeek(new Date()), 3));

  it('has eight recipes with photos, and an empty box when nothing is set up', async () => {
    const all = routes.recipes.response.parse(await json(await call(mock.app, 'GET', '/recipes')));
    expect(all.recipes).toHaveLength(8);
    expect(all.recipes.every((r) => r.hasPhoto)).toBe(true);
    const photo = await call(mock.app, 'GET', '/recipes/rec-tacos/image');
    expect(photo.headers.get('content-type')).toBe('image/svg+xml');
    expect(await photo.text()).toMatch(/^<svg/);
    const none = await json(await call(empty.app, 'GET', '/recipes'));
    expect(none.recipes).toEqual([]);
    const search = await json(await call(mock.app, 'GET', '/recipes?q=cheddar'));
    expect(search.recipes.map((r: { id: string }) => r.id)).toEqual(['rec-tacos']);
  });

  it('imports a link, plans it for Thursday dinner, sends it to the grocery list', async () => {
    const imp = routes.recipeImport.response.parse(
      await json(await call(mock.app, 'POST', '/recipes/import', { url: url('sections') })),
    );
    expect(imp).toMatchObject({
      via: 'link',
      recipe: { title: 'Brown Butter Chocolate Chip Cookies', hasPhoto: true },
    });
    const plan = await json(
      await call(mock.app, 'PUT', '/meals/plan', {
        date: thursday,
        slot: 'dinner',
        recipeId: imp.recipe.id,
      }),
    );
    expect(plan.meal).toMatchObject({
      title: 'Brown Butter Chocolate Chip Cookies',
      recipeId: imp.recipe.id,
    });
    expect(plan.meal.ingredients).toContain('Dark chocolate');
    const grocery = routes.mealToGrocery.response.parse(
      await json(await call(mock.app, 'POST', `/meals/${thursday}/dinner/to-grocery`)),
    );
    expect(grocery.added).toContain('12 oz dark chocolate');
    const cooked = await json(await call(mock.app, 'GET', `/recipes/${imp.recipe.id}`));
    expect(cooked.recipe.lastCooked).toBe(thursday);
  });

  it('answers every recipe route within the contract, and removing a recipe keeps the plan', async () => {
    const created = await json(
      await call(mock.app, 'POST', '/recipes', {
        title: 'Beans on toast',
        servings: 1,
        ingredients: ['1 can beans', '2 slices bread'],
      }),
    );
    routes.recipeCreate.response.parse(created);
    const id = created.recipe.id;
    routes.recipePatch.response.parse(
      await json(
        await call(mock.app, 'PATCH', `/recipes/${id}`, { rating: 4, notes: 'Add cheese' }),
      ),
    );
    routes.recipeToGrocery.response.parse(
      await json(await call(mock.app, 'POST', `/recipes/${id}/to-grocery`, { servings: 2 })),
    );
    const sat = toIsoDate(addDays(startOfWeek(new Date()), 5));
    await call(mock.app, 'PUT', '/meals/plan', { date: sat, slot: 'lunch', recipeId: id });
    routes.recipeDelete.response.parse(
      await json(await call(mock.app, 'DELETE', `/recipes/${id}`)),
    );
    expect((await call(mock.app, 'GET', `/recipes/${id}`)).status).toBe(404);
    const week = await json(await call(mock.app, 'GET', `/meals/week?start=${sat}`));
    const lunch = week.meals.find(
      (m: { date: string; slot: string }) => m.date === sat && m.slot === 'lunch',
    );
    expect(lunch).toMatchObject({ title: 'Beans on toast', ingredients: ['Beans', 'Bread'] });
    expect(lunch.recipeId).toBeUndefined();
  });

  it('reads a photo as the sample in mock mode, and refuses a bad import body', async () => {
    const res = await json(
      await call(mock.app, 'POST', '/recipes/import', { image: 'data:image/jpeg;base64,/9j/4AAQ' }),
    );
    expect(res).toMatchObject({ via: 'mock', recipe: { title: 'Oatmeal raisin cookies' } });
    expect((await call(mock.app, 'POST', '/recipes/import', {})).status).toBe(400);
  });

  it('favourites that cook a recipe carry it to the planned meal', async () => {
    const week = await json(await call(mock.app, 'GET', '/meals/week'));
    const monday = week.meals.find(
      (m: { slot: string; title: string }) => m.slot === 'dinner' && m.title === 'Tacos',
    );
    expect(monday.recipeId).toBe('rec-tacos');
  });
});
