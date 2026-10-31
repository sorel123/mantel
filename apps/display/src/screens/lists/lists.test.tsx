import { routeFixtures } from '@mantel/shared/fixtures';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, useBootstrapState } from '../../lib/bootstrap';
import { AddPage } from './add/AddPage';
import { GroceryPeek, ListsScreen } from './index';

const fx = routeFixtures();
const respond = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );

/** A fake server answering from the fixtures and recording every write. */
function fakeServer() {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const fetch = vi.fn((url: string, init: RequestInit = {}) => {
    const path = url.replace(/^\/api/, '');
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    if (method !== 'GET') calls.push({ method, path, body });
    if (path === '/bootstrap') return respond(fx.bootstrap);
    if (path === '/lists') return respond(fx.lists);
    if (path === '/chores') return respond(fx.chores);
    if (path.startsWith('/items/')) return respond({ item: { ...fx.itemPatch.item, ...body } });
    if (path.endsWith('/items'))
      return respond({ item: { id: 'new-1', text: body.text, done: false } });
    if (path.endsWith('/done')) {
      const chore = fx.chores.chores.find((c) => path.includes(c.id))!;
      return respond({ chore: { ...chore, doneCount: chore.target }, stars: fx.chores.stars });
    }
    return respond({ error: { code: 'not_found', message: path } }, 404);
  });
  vi.stubGlobal('fetch', fetch);
  return { calls };
}

function Ready({ children }: { children: ReactNode }) {
  const { state } = useBootstrapState();
  return state.status === 'ready' ? <>{children}</> : null;
}

const renderReady = (ui: ReactNode) =>
  render(
    <BootstrapProvider>
      <Ready>{ui}</Ready>
    </BootstrapProvider>,
  );

class FakeSocket {
  close() {}
}

describe('Lists screen', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', FakeSocket);
  });

  it('shows all three lists, checks an item at once and adds one', async () => {
    const { calls } = fakeServer();
    renderReady(<ListsScreen />);
    const grocery = await screen.findByRole('region', { name: 'Grocery' });
    expect(screen.getByRole('region', { name: 'Chores' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'To-do' })).toBeTruthy();
    expect(within(grocery).getByText('4 left')).toBeTruthy();

    const milk = within(grocery).getByRole('checkbox', { name: /Oat milk/ });
    fireEvent.click(milk);
    expect(milk.getAttribute('aria-checked')).toBe('true');
    expect(within(grocery).getByText('3 left')).toBeTruthy();
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'PATCH',
        path: '/items/list-grocery-0',
        body: { done: true },
      }),
    );

    fireEvent.change(within(grocery).getByLabelText('Add to Grocery'), {
      target: { value: 'Eggs' },
    });
    fireEvent.click(within(grocery).getByRole('button', { name: 'Add' }));
    expect(await within(grocery).findByText('Eggs')).toBeTruthy();
    expect(calls).toContainEqual({
      method: 'POST',
      path: '/lists/list-grocery/items',
      body: { text: 'Eggs' },
    });
  });

  it('shows the chore chart with stars and marks a chore done', async () => {
    const { calls } = fakeServer();
    renderReady(<ListsScreen />);
    fireEvent.click(await screen.findByRole('tab', { name: /Chore chart/ }));
    const ava = await screen.findByRole('region', { name: "Ava's chores" });
    const avaStars = fx.chores.stars.find((s) => s.personId === 'ava')!.stars;
    expect(within(ava).getByLabelText(`${avaStars} stars this week`)).toBeTruthy();

    const bed = within(ava).getByRole('checkbox', { name: /Make bed, not done today/ });
    fireEvent.click(bed);
    await waitFor(() => expect(bed.getAttribute('aria-checked')).toBe('true'));
    expect(calls).toContainEqual({
      method: 'POST',
      path: '/chores/chore-bed-ava/done',
      body: undefined,
    });
  });

  it('peeks at the open grocery items', async () => {
    fakeServer();
    const onOpen = vi.fn();
    renderReady(<GroceryPeek onOpen={onOpen} />);
    const peek = await screen.findByRole('button', { name: 'Grocery list' });
    await within(peek).findByText('4 left');
    expect(
      within(peek)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Oat milk', 'Bananas', 'Chicken thighs', 'Birthday candles']);
    fireEvent.click(peek);
    expect(onOpen).toHaveBeenCalled();
  });
});

describe('/add page', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', FakeSocket);
  });

  it('adds to the chosen list for a person', async () => {
    const { calls } = fakeServer();
    render(
      <BootstrapProvider>
        <AddPage />
      </BootstrapProvider>,
    );
    fireEvent.click(await screen.findByRole('tab', { name: /To-do/ }));
    fireEvent.change(screen.getByLabelText('Add to To-do'), { target: { value: 'Call plumber' } });
    fireEvent.click(screen.getAllByRole('radio', { name: /Jay/ })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Add to To-do' }));
    expect(await screen.findByText('Added Call plumber')).toBeTruthy();
    expect(calls).toContainEqual({
      method: 'POST',
      path: '/lists/list-todo/items',
      body: { text: 'Call plumber', personId: 'jay' },
    });
  });

  it('asks a new phone to pair', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => respond({ error: { code: 'unauthorized', message: 'no key' } }, 401)),
    );
    render(
      <BootstrapProvider>
        <AddPage />
      </BootstrapProvider>,
    );
    expect(await screen.findByLabelText('PIN or pairing code')).toBeTruthy();
  });
});
