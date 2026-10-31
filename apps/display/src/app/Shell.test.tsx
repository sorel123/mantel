import { API_PREFIX, routes } from '@mantel/shared';
import { routeFixtures } from '@mantel/shared/fixtures';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider } from '../lib/bootstrap';
import { Shell } from './Shell';

class FakeSocket {
  static OPEN = 1;
  onopen?: () => void;
  onclose?: () => void;
  onmessage?: () => void;
  close() {}
}

const respond = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );

/** Serve every route its fixture, like the mock server does, so any screen can render. */
const mockFetch = (boot = routeFixtures().bootstrap) =>
  vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input), 'http://display');
    const method = (init?.method ?? 'GET').toUpperCase();
    const fixtures = routeFixtures() as Record<string, unknown>;
    for (const [name, r] of Object.entries(routes)) {
      if (r.method !== method) continue;
      const re = new RegExp(`^${API_PREFIX}${r.path.replace(/:[^/]+/g, '[^/]+')}$`);
      if (!re.test(url.pathname)) continue;
      const body = name === 'bootstrap' ? boot : fixtures[name];
      if (body !== undefined) return respond(200, body);
    }
    return respond(404, { error: { code: 'not_found', message: url.pathname } });
  });

const renderShell = () =>
  render(
    <BootstrapProvider>
      <Shell />
    </BootstrapProvider>,
  );

describe('Shell', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', FakeSocket);
  });
  afterEach(() => {
    vi.useRealTimers();
    delete document.documentElement.dataset.mode;
  });

  it('renders the four screens from mock bootstrap and switches between them', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderShell();
    expect(await screen.findByText(/mock data/i)).toBeTruthy();
    for (const label of ['Today', 'Month', 'Lists', 'Home'])
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Today' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    await waitFor(() => expect(document.querySelector('[data-screen="home"]')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Home' }).getAttribute('aria-current')).toBe('page');
    expect(document.documentElement.dataset.mode).toMatch(/daylight|dusk/);
  });

  it('starts Ambient from the dock and wakes on a tap', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderShell();
    await screen.findByText(/mock data/i);
    fireEvent.click(screen.getByRole('button', { name: 'Ambient mode' }));
    const ambient = await screen.findByRole('button', { name: /Ambient mode. Tap to wake/ });
    fireEvent.pointerDown(ambient);
    // The 700 ms fade-out runs to completion before Ambient leaves the tree.
    await waitFor(() => expect(screen.queryByRole('button', { name: /Tap to wake/ })).toBeNull(), {
      timeout: 3000,
    });
    expect(screen.getByRole('button', { name: 'Today' }).getAttribute('aria-current')).toBe('page');
  });

  it('goes to Ambient after the idle time from settings', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const boot = routeFixtures().bootstrap;
    boot.settings.schedule = {
      ...boot.settings.schedule,
      idleSeconds: 1,
      // Never "off" in this test, whatever the wall clock says.
      ambientFrom: '00:00',
      offFrom: '00:00',
      onAt: '00:00',
    };
    vi.stubGlobal('fetch', mockFetch(boot));
    renderShell();
    await screen.findByText(/mock data/i);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(screen.getByRole('button', { name: /Ambient mode. Tap to wake/ })).toBeTruthy();
  });

  it('asks for a pairing code when the server says unauthorised', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => respond(401, { error: { code: 'unauthorized', message: 'no key' } })),
    );
    renderShell();
    expect(await screen.findByLabelText('PIN or pairing code')).toBeTruthy();
  });

  it('offers a retry when the server is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('connection refused'))),
    );
    renderShell();
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('ScreenBoundary', () => {
  it('shows a retry card instead of blanking the wall', async () => {
    const { ScreenBoundary } = await import('./ScreenBoundary');
    const Boom = () => {
      throw new Error('kaboom');
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ScreenBoundary name="home">
        <Boom />
      </ScreenBoundary>,
    );
    expect(screen.getByRole('alert').textContent).toContain('kaboom');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    spy.mockRestore();
  });
});
