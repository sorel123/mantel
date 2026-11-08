import {
  addDays,
  routes,
  startOfWeek,
  toIsoDate,
  type Calendar,
  type CalendarEvent,
  type List,
  type Meal,
  type Settings,
  type WsEventInput,
} from '@mantel/shared';
import { settings as settingsFixture } from '@mantel/shared/fixtures';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { openDb } from '../../db/index.js';
import type { CalendarProvider, ListsProvider } from '../../providers/types.js';
import { MealsService } from './service.js';
import { MealStore } from './store.js';

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

const monday = startOfWeek(new Date());
const day = (n: number) => toIsoDate(addDays(monday, n));

describe('meals in mock mode', () => {
  it('answers every planner route within the contract', async () => {
    const samples: Array<[keyof typeof routes, string, unknown?]> = [
      ['mealsWeek', '/meals/week'],
      ['mealsPlan', '/meals/plan', { date: day(6), slot: 'dinner', favouriteId: 'fav-stirfry' }],
      ['mealFavourites', '/meals/favourites'],
      ['mealFavouriteCreate', '/meals/favourites', { title: 'Chili', ingredients: ['Beans'] }],
      ['mealFavouritePatch', '/meals/favourites/fav-oats', { tags: ['quick', 'cold'] }],
      ['mealsUnbought', `/meals/unbought?date=${day(2)}`],
      ['mealToGrocery', `/meals/${day(0)}/dinner/to-grocery`],
      ['mealsWeekToGrocery', `/meals/week/to-grocery?start=${day(0)}`],
      ['meals', '/meals'],
    ];
    for (const [name, path, body] of samples) {
      const res = await call(mock.app, routes[name].method, path, body);
      expect(res.status, `${name}: ${await res.clone().text()}`).toBe(200);
      routes[name].response!.parse(await json(res));
    }
  });

  it('merges the plan over the Meals calendar: Mantel wins per slot', async () => {
    const week = await json(await call(mock.app, 'GET', `/meals/week?start=${day(3)}`));
    expect(week.weekStart).toBe(day(0));
    const at = (d: number, slot: string) =>
      week.meals.find((m: { date: string; slot: string }) => m.date === day(d) && m.slot === slot);
    expect(at(2, 'dinner')).toMatchObject({ title: 'Spaghetti bolognese', source: 'mantel' });
    expect(at(3, 'dinner')).toMatchObject({ title: 'Leftovers', source: 'calendar' });
    // Today's read model shows the same merge.
    const today = await json(await call(mock.app, 'GET', `/meals?week=${day(0)}`));
    expect(today.meals.find((m: Meal) => m.date === day(2) && m.slot === 'dinner').title).toBe(
      'Spaghetti bolognese',
    );
  });

  it('plans from a favourite, sends its ingredients to the grocery list and skips ones there', async () => {
    const plan = await json(
      await call(mock.app, 'PUT', '/meals/plan', {
        date: day(4),
        slot: 'dinner',
        favouriteId: 'fav-chicken',
      }),
    );
    expect(plan.meal).toMatchObject({ title: 'Sheet-pan chicken', source: 'mantel' });
    // "Chicken thighs" is already on the fixture grocery list, unchecked.
    expect(plan.meal.unbought).toBe(4);
    const sent = await json(await call(mock.app, 'POST', `/meals/${day(4)}/dinner/to-grocery`));
    expect(sent.listName).toBe('Grocery');
    expect(sent.added).toEqual(['Potatoes', 'Carrots', 'Lemon']);
    expect(sent.skipped).toEqual(['Chicken thighs']);
    const again = await json(await call(mock.app, 'POST', `/meals/${day(4)}/dinner/to-grocery`));
    expect(again.added).toEqual([]);
    const fav = (await json(await call(mock.app, 'GET', '/meals/favourites'))).favourites.find(
      (f: { id: string }) => f.id === 'fav-chicken',
    );
    expect(fav.lastUsed).toBe(day(4));
  });

  it('clears a slot, letting the calendar show through again', async () => {
    await call(mock.app, 'PUT', '/meals/plan', { date: day(5), slot: 'dinner', title: 'Ramen' });
    let week = await json(await call(mock.app, 'GET', `/meals/week?start=${day(0)}`));
    expect(week.meals.find((m: Meal) => m.date === day(5) && m.slot === 'dinner').title).toBe(
      'Ramen',
    );
    const res = await json(
      await call(mock.app, 'PUT', '/meals/plan', { date: day(5), slot: 'dinner' }),
    );
    expect(res.meal).toBeNull();
    week = await json(await call(mock.app, 'GET', `/meals/week?start=${day(0)}`));
    expect(week.meals.find((m: Meal) => m.date === day(5) && m.slot === 'dinner')).toMatchObject({
      title: 'Grill out',
      source: 'calendar',
    });
  });

  it('says plainly when a meal has nothing to send', async () => {
    const res = await call(mock.app, 'POST', `/meals/${day(6)}/lunch/to-grocery`);
    expect(res.status).toBe(404);
    const cal = await call(mock.app, 'POST', `/meals/${day(3)}/dinner/to-grocery`);
    expect(cal.status).toBe(400);
    expect((await json(cal)).error.message).toMatch(/Meals calendar/);
    expect((await call(mock.app, 'POST', `/meals/${day(0)}/supper/to-grocery`)).status).toBe(400);
  });

  it('starts empty with MOCK_EMPTY', async () => {
    const week = await json(await call(empty.app, 'GET', '/meals/week'));
    expect(week.meals).toEqual([]);
    expect((await json(await call(empty.app, 'GET', '/meals/favourites'))).favourites).toEqual([]);
  });

  it('answers disabled when turned off, and Today falls back to the calendar', async () => {
    const s = await json(await call(empty.app, 'GET', '/settings'));
    await call(empty.app, 'PUT', '/settings', {
      ...s,
      integrations: { ...s.integrations, meals: { enabled: false } },
    });
    expect((await call(empty.app, 'GET', '/meals/week')).status).toBe(503);
    expect((await call(empty.app, 'GET', '/meals')).status).toBe(200);
  });
});

/* ---- the service with fake lists and calendar ---- */

function fakes(opts: { mealsCalendar?: boolean } = {}) {
  const list: List = {
    id: 'shop',
    name: 'Shopping',
    source: 'local',
    items: [
      { id: 'i1', text: 'eggs', done: false },
      { id: 'i2', text: 'Milk', done: true },
    ],
  };
  const events: CalendarEvent[] = [];
  const emitted: WsEventInput[] = [];
  const lists = {
    lists: async () => ({ lists: [list] }),
    addItem: async (_id: string, req: { text: string }) => {
      const item = { id: `i${list.items.length + 1}`, text: req.text, done: false };
      list.items.push(item);
      return { item };
    },
  } as unknown as ListsProvider;
  const calendar = {
    meals: async (week?: Date): Promise<{ weekStart: string; meals: Meal[] }> => ({
      weekStart: toIsoDate(startOfWeek(week ?? new Date())),
      meals: [{ date: day(0), slot: 'other', title: 'Popcorn' }],
    }),
    calendars: async (): Promise<Calendar[]> =>
      opts.mealsCalendar
        ? [
            {
              id: 'meals-cal',
              name: 'Meals',
              source: 'google',
              color: '#000',
              personIds: [],
              readOnly: false,
              isMeals: true,
            },
          ]
        : [],
    quickAdd: async (req: { title: string; start: string; end?: string }) => {
      const event = {
        id: `meals-cal|e${events.length}`,
        calendarId: 'meals-cal',
        title: req.title,
        start: req.start,
        end: req.end ?? req.start,
        allDay: true,
        personIds: [],
        color: '#000',
        countdown: false,
      };
      events.push(event);
      return { event };
    },
    updateEvent: async (id: string, patch: { title?: string }) => {
      const ev = events.find((e) => e.id === id)!;
      if (patch.title) ev.title = patch.title;
      return { event: ev };
    },
    deleteEvent: async (id: string) => {
      events.splice(
        events.findIndex((e) => e.id === id),
        1,
      );
      return { ok: true as const };
    },
  } as unknown as CalendarProvider;
  let current: Settings = settingsFixture();
  const service = new MealsService({
    store: new MealStore(openDb(':memory:')),
    lists,
    calendar,
    settings: () => current,
    emit: (e) => emitted.push(e),
    now: () => monday,
  });
  const setMeals = (m: Partial<Settings['meals']>) =>
    (current = { ...current, meals: { ...current.meals, ...m } });
  return { service, list, events, emitted, setMeals };
}

describe('MealsService', () => {
  it('picks a list named like Shopping when there is no Grocery list, and counts unbought', async () => {
    const { service } = fakes();
    await service.plan({
      date: day(1),
      slot: 'dinner',
      title: 'Omelette',
      ingredients: ['Eggs', 'Milk', 'Chives'],
    });
    const week = await service.week();
    expect(week.groceryList).toEqual({ id: 'shop', name: 'Shopping' });
    // Eggs is on the list unchecked (unbought), Milk is checked (bought), Chives is missing.
    expect(week.meals.find((m) => m.slot === 'dinner')!.unbought).toBe(2);
    const unbought = await service.unbought();
    expect(unbought.items.map((i) => [i.ingredient, i.onList])).toEqual([
      ['Eggs', true],
      ['Chives', false],
    ]);
  });

  it('keeps calendar snacks for Today but not in the planner', async () => {
    const { service } = fakes();
    expect((await service.week()).meals).toEqual([]);
    expect((await service.todayMeals()).meals).toEqual([
      { date: day(0), slot: 'other', title: 'Popcorn' },
    ]);
  });

  it('adds the week once per ingredient', async () => {
    const { service, list } = fakes();
    const fav = service.createFavourite({ title: 'Tacos', ingredients: ['Tortillas', 'Limes'] });
    await service.plan({ date: day(0), slot: 'dinner', favouriteId: fav.favourite.id });
    await service.plan({ date: day(2), slot: 'dinner', favouriteId: fav.favourite.id });
    await service.plan({ date: day(3), slot: 'lunch', title: 'Wraps', ingredients: ['tortilla'] });
    const res = await service.weekToGrocery();
    expect(res.added).toEqual(['Tortillas', 'Limes']);
    expect(list.items.map((i) => i.text)).toEqual(['eggs', 'Milk', 'Tortillas', 'Limes']);
  });

  it('keeps ingredients on planned meals when their favourite is deleted', async () => {
    const { service } = fakes();
    const fav = service.createFavourite({ title: 'Soup', ingredients: ['Leeks'] }).favourite;
    await service.plan({ date: day(0), slot: 'lunch', favouriteId: fav.id });
    service.deleteFavourite(fav.id);
    const meal = (await service.week()).meals[0]!;
    expect(meal).toMatchObject({ title: 'Soup', ingredients: ['Leeks'] });
    expect(meal.favouriteId).toBeUndefined();
  });

  it('mirrors planned meals to a writable Meals calendar when turned on', async () => {
    const { service, events, setMeals, emitted } = fakes({ mealsCalendar: true });
    await service.plan({ date: day(1), slot: 'dinner', title: 'Tacos' });
    expect(events).toHaveLength(0);
    setMeals({ mirrorToCalendar: true });
    expect((await service.week()).mirroring).toBe(true);
    await service.plan({ date: day(2), slot: 'dinner', title: 'Tacos' });
    expect(events.map((e) => e.title)).toEqual(['Dinner: Tacos']);
    await service.plan({ date: day(2), slot: 'dinner', title: 'Pizza' });
    expect(events.map((e) => e.title)).toEqual(['Dinner: Pizza']);
    await service.plan({ date: day(2), slot: 'dinner' });
    expect(events).toHaveLength(0);
    expect(emitted.every((e) => e.type === 'calendar.changed')).toBe(true);
  });

  it('shows dinner only when the setting says so', async () => {
    const { service, setMeals } = fakes();
    setMeals({ slots: 'dinner' });
    expect((await service.week()).slots).toEqual(['dinner']);
  });
});
