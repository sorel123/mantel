import { routeFixtures } from '@mantel/shared/fixtures';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell } from '../../app/Shell';
import { BootstrapProvider } from '../../lib/bootstrap';

class FakeSocket {
  static last: FakeSocket | null = null;
  onopen?: () => void;
  onclose?: () => void;
  onmessage?: (msg: { data: string }) => void;
  constructor() {
    FakeSocket.last = this;
  }
  close() {}
}

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );

const push = (event: unknown) =>
  act(() => FakeSocket.last?.onmessage?.({ data: JSON.stringify(event) }));

describe('Home screen', () => {
  const fx = routeFixtures();
  let calls: { url: string; body: unknown }[];

  beforeEach(() => {
    calls = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ url, body });
        if (url.startsWith('/api/bootstrap')) return json(fx.bootstrap);
        if (url.startsWith('/api/home/state')) return json(fx.homeState);
        if (url.startsWith('/api/media')) return json(fx.media);
        if (url.startsWith('/api/settings')) return json(body ?? fx.settings);
        if (url.startsWith('/api/home/call')) {
          const entity = fx.homeState.entities.find((e) => e.id === body.entityId)!;
          return json({ ok: true, entity: { ...entity, state: 'unlocked' } });
        }
        return json({ error: { code: 'not_found', message: url } }, 404);
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const open = async () => {
    render(
      <BootstrapProvider>
        <Shell />
      </BootstrapProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Home' }));
    await screen.findByText('Living room');
  };

  it('renders rooms, presence, scenes, thermostats, cameras and now playing from the fixture', async () => {
    await open();
    expect(screen.getByText('Jay and Ava are home')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Morning/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('switch', { name: 'Ceiling' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(screen.getByRole('slider', { name: 'Ceiling brightness' })).toBeTruthy();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Main floor66°',
      'Upstairs67°',
      'Basement64°',
    ]);
    expect(screen.getByText('Open 12 min')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Front door camera/ })).toBeTruthy();
    expect(screen.getByText('Bluey')).toBeTruthy();
    // No announce button while the flag is off.
    expect(screen.queryByRole('button', { name: 'Announce' })).toBeNull();
  });

  it('asks before unlocking, then calls Home Assistant', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: /Front door: Locked/ }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText('Unlock the front door?')).toBeTruthy();
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Unlock' })));
    expect(calls.find((c) => c.url === '/api/home/call')?.body).toEqual({
      entityId: 'lock.front_door',
      service: 'unlock',
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('follows home.state pushes', async () => {
    await open();
    const island = fx.homeState.entities.find((e) => e.id === 'light.kitchen_island')!;
    push({
      type: 'home.state',
      payload: { entity: { ...island, state: 'on', attrs: { brightness: 128 } } },
    });
    expect(screen.getByRole('switch', { name: 'Island' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('opens the colour sheet for a colour light and sends the colour picked', async () => {
    await open();
    // A brightness-only light has no colour button.
    expect(screen.queryByRole('button', { name: 'Ceiling colour' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: "Ava's lamp colour" }));
    const sheet = await screen.findByRole('dialog', { name: "Ava's lamp colour" });
    expect(within(sheet).getByRole('slider', { name: 'Hue' })).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Warm' })).toBeTruthy();
    await act(async () =>
      fireEvent.click(within(sheet).getAllByRole('button', { name: /^Colour, hue 215/ })[0]!),
    );
    expect(calls.find((c) => c.url === '/api/home/call')?.body).toEqual({
      entityId: 'light.ava_lamp',
      service: 'turn_on',
      data: { hs_color: [215, 100] },
    });
  });

  it('arranges the cards and saves the layout to settings', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Arrange the Home screen' }));
    const region = screen.getByRole('region', { name: 'Arrange Home' });
    fireEvent.click(within(region).getByRole('button', { name: 'Separate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide Thermostats' }));
    expect(screen.getByRole('button', { name: 'Show Thermostats' })).toBeTruthy();
    await act(async () => fireEvent.click(within(region).getByRole('button', { name: 'Done' })));
    const put = calls.find((c) => c.url === '/api/settings' && c.body);
    const layout = (
      put?.body as {
        homeLayout: { cameraStyle: string; cards: { key: string; hidden: boolean }[] };
      }
    ).homeLayout;
    expect(layout.cameraStyle).toBe('cards');
    expect(layout.cards.find((c) => c.key === 'climate')?.hidden).toBe(true);
  });

  it('pops the live view over any screen when the doorbell rings', async () => {
    render(
      <BootstrapProvider>
        <Shell />
      </BootstrapProvider>,
    );
    await screen.findByRole('button', { name: 'Today' });
    push({
      type: 'home.doorbell',
      payload: {
        cameraEntityId: 'camera.front_door',
        at: new Date().toISOString(),
        durationSeconds: 30,
      },
    });
    const dialog = await screen.findByRole('dialog', { name: "Someone's at the front door" });
    const img = within(dialog).getByRole('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toMatch(/^\/api\/home\/cameras\/camera\.front_door\/stream/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dismiss' }));
    // The view animates out and drops its stream straight away.
    expect(within(dialog).getByRole('img').getAttribute('src')).toBeNull();
  });
});
