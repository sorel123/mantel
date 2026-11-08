import { atHour } from '@mantel/shared';
import { routeFixtures } from '@mantel/shared/fixtures';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OverlayProvider } from '../../app/overlay';
import { BootstrapProvider, useBootstrapState } from '../../lib/bootstrap';
import { resetCalendarCache } from '../today/calendar';
import { favouritesFor, groceryToast } from './data';
import { MealsWeekCard, PlannerTap } from './index';

const NOW = atHour(new Date(2026, 10, 4), 17.5); // a Wednesday evening
const fx = routeFixtures(NOW);

type Call = { path: string; method: string; body: unknown };
let calls: Call[];

function stubServer(overrides: Record<string, unknown> = {}) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input, 'http://wall');
      const method = init.method ?? 'GET';
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      const path = url.pathname.replace('/api', '');
      calls.push({ path, method, body });
      const reply =
        path in overrides
          ? overrides[path]
          : path === '/bootstrap'
            ? fx.bootstrap
            : path === '/meals'
              ? fx.meals
              : path === '/meals/week'
                ? fx.mealsWeek
                : path === '/meals/favourites'
                  ? fx.mealFavourites
                  : path === '/meals/plan'
                    ? { meal: null }
                    : path.endsWith('/to-grocery')
                      ? fx.mealToGrocery
                      : {};
      return new Response(JSON.stringify(reply), {
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

class FakeSocket {
  close() {}
}

function Ready({ children }: { children: ReactNode }) {
  const { state } = useBootstrapState();
  return state.status === 'ready' ? (
    <div className="panel">
      <OverlayProvider>{children}</OverlayProvider>
    </div>
  ) : null;
}
const mount = (ui: ReactNode) =>
  render(
    <BootstrapProvider>
      <Ready>{ui}</Ready>
    </BootstrapProvider>,
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.stubGlobal('WebSocket', FakeSocket);
  resetCalendarCache();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function openPlanner() {
  mount(
    <PlannerTap>
      <span>Tonight</span>
    </PlannerTap>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Open the meal planner' }));
  return screen.findByRole('dialog', { name: 'Meal planner' });
}

describe('Meal planner', () => {
  it('shows the week by slot, with what is left to buy and where calendar meals come from', async () => {
    stubServer();
    const sheet = await openPlanner();
    const tacos = await within(sheet).findByRole('button', { name: 'Monday dinner: Tacos' });
    expect(within(tacos).getByLabelText('6 to buy')).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Thursday dinner: Leftovers' })).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Plan Monday breakfast' })).toBeTruthy();
    expect(within(sheet).getByText('Breakfast')).toBeTruthy();
  });

  it('plans an empty slot from a favourite', async () => {
    stubServer();
    const sheet = await openPlanner();
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Plan Sunday lunch' }));
    // Lunch favourites come first.
    const favs = await within(sheet).findAllByRole('button', { name: /^Plan / });
    expect(favs[0]!.getAttribute('aria-label')).toBe('Plan Turkey sandwiches');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Plan Tacos' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/meals/plan')).toBe(true));
    const put = calls.find((c) => c.path === '/meals/plan')!;
    expect(put).toMatchObject({
      method: 'PUT',
      body: { date: fx.mealsWeek.days[6], slot: 'lunch', favouriteId: 'fav-tacos' },
    });
    expect(await screen.findByText(/Tacos for Sunday lunch/)).toBeTruthy();
  });

  it('types a meal with its ingredients, without saving a favourite', async () => {
    stubServer({
      '/meals/favourites': { favourites: [] },
      '/meals/week': { ...fx.mealsWeek, meals: [] },
    });
    const sheet = await openPlanner();
    expect(await within(sheet).findByText(/Nothing planned yet/)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Plan Friday dinner' }));
    const form = await within(sheet).findByRole('form', { name: 'Type a meal' });
    fireEvent.change(within(form).getByPlaceholderText('Chicken curry'), {
      target: { value: 'Chili' },
    });
    fireEvent.change(within(form).getByRole('textbox', { name: /Ingredients/ }), {
      target: { value: 'Beans, Tomatoes\nOnion' },
    });
    // Saving as a favourite is on by default; untick it to plan the meal on its own.
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Save as a favourite' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Plan it' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/meals/plan')).toBe(true));
    expect(calls.find((c) => c.path === '/meals/plan')!.body).toEqual({
      date: fx.mealsWeek.days[4],
      slot: 'dinner',
      title: 'Chili',
      ingredients: ['Beans', 'Tomatoes', 'Onion'],
    });
  });

  it('sends one meal, or the whole week, to the grocery list', async () => {
    stubServer();
    const sheet = await openPlanner();
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Monday dinner: Tacos' }));
    fireEvent.click(
      await within(sheet).findByRole('button', { name: /Add ingredients to Grocery/ }),
    );
    await waitFor(() =>
      expect(calls.some((c) => c.path === `/meals/${fx.mealsWeek.days[0]}/dinner/to-grocery`)).toBe(
        true,
      ),
    );
    expect(await screen.findByText('Added 3 items to Grocery, 1 already there')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Back to the week' }));
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Add the week to Grocery' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/meals/week/to-grocery')).toBe(true));
  });

  it('edits a favourite in the manager', async () => {
    stubServer();
    const sheet = await openPlanner();
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Favourites' }));
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Edit Pancakes' }));
    const form = await within(sheet).findByRole('form', { name: 'Edit Pancakes' });
    fireEvent.change(within(form).getByRole('textbox', { name: /Tags/ }), {
      target: { value: 'weekend, sweet' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({
        title: 'Pancakes',
        slot: 'breakfast',
        tags: ['weekend', 'sweet'],
      }),
    );
  });

  it('does not open when the planner is turned off', async () => {
    stubServer({
      '/bootstrap': {
        ...fx.bootstrap,
        settings: { ...fx.bootstrap.settings, integrations: { meals: { enabled: false } } },
      },
    });
    mount(
      <PlannerTap>
        <span>Tonight</span>
      </PlannerTap>,
    );
    expect(await screen.findByText('Tonight')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open the meal planner' })).toBeNull();
  });
});

describe('meals-week card', () => {
  it("lists the week's dinners and marks today", async () => {
    stubServer();
    mount(<MealsWeekCard />);
    const card = await screen.findByRole('button', { name: /Dinners this week/ });
    await act(async () => {});
    expect(await within(card).findByText('Pasta night')).toBeTruthy();
    expect(within(card).getByText('Pasta night').closest('li')!.className).toBe('today');
  });
});

describe('helpers', () => {
  it('orders favourites for a slot and filters by search and tag', () => {
    const favs = fx.mealFavourites.favourites;
    expect(favouritesFor(favs, 'breakfast', '', null)[0]!.slot).toBe('breakfast');
    expect(favouritesFor(favs, 'dinner', 'beef', null).map((f) => f.title)).toEqual([
      'Tacos',
      'Spaghetti bolognese',
    ]);
    expect(favouritesFor(favs, 'dinner', '', 'vegetarian').map((f) => f.id)).toEqual([
      'fav-stirfry',
    ]);
  });

  it('words the grocery toast', () => {
    expect(groceryToast({ listName: 'Grocery', added: [], skipped: ['Eggs'] })).toBe(
      'Everything is already on Grocery',
    );
    expect(groceryToast({ listName: 'Grocery', added: ['Eggs'], skipped: [] })).toBe(
      'Added 1 item to Grocery',
    );
  });
});
