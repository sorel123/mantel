import { routeFixtures } from '@mantel/shared/fixtures';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from '.';

const respond = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );

/** The calendar setup JSON the mock server answers with (`/api/calendar/setup/state`). */
const calendarSetup = () => {
  const fx = routeFixtures();
  return {
    google: {
      configured: true,
      connected: true,
      lastSync: new Date().toISOString(),
      error: null,
      account: 'jay@example.com',
      revoked: false,
      redirectUri: 'http://localhost:8787/api/calendar/google/callback',
      pasteBack: true,
      push: false,
      pushActive: false,
    },
    icloud: { configured: false, connected: false, lastSync: null, error: null, username: null },
    people: fx.settings.people.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    defaultCalendarId: 'cal-family',
    calendars: fx.bootstrap.calendars.map((c) => ({
      ...c,
      sourceName: c.name,
      sourceColor: c.color,
      enabled: true,
      primary: c.id === 'cal-family',
    })),
  };
};

/** A fake server answering from the fixtures, recording each request. */
function fakeServer() {
  const fx = routeFixtures();
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    const path = url.replace(/^\/api/, '');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    if (path === '/settings' && method === 'PUT') return respond(200, body);
    if (path === '/settings') return respond(200, fx.settings);
    if (path === '/bootstrap') return respond(200, fx.bootstrap);
    if (path === '/devices') return respond(200, fx.devices);
    if (path.startsWith('/devices/') && method === 'PATCH') return respond(200, fx.deviceRename);
    if (path.startsWith('/devices/')) return respond(200, fx.deviceRevoke);
    if (path === '/pairing-code') return respond(200, fx.pairingCode);
    if (path === '/display/reload') return respond(200, fx.displayReload);
    if (path === '/plugins') return respond(200, fx.plugins);
    if (path === '/integrations') return respond(200, fx.integrations);
    if (path.match(/^\/integrations\/[^/]+\/test$/)) return respond(200, fx.integrationTest);
    if (path.startsWith('/integrations/') && method === 'PUT') {
      const id = path.split('/')[2]!;
      const current = fx.integrations.integrations.find((i) => i.id === id)!;
      const patch = body as { config?: Record<string, unknown>; secrets?: Record<string, string> };
      return respond(200, {
        integration: {
          ...current,
          state: 'connected',
          config: { ...current.config, ...patch.config },
          hasSecrets: [...current.hasSecrets, ...Object.keys(patch.secrets ?? {})],
        },
      });
    }
    if (path === '/setup/state') return respond(200, fx.setupState);
    if (path === '/health/details') return respond(200, fx.healthDetails);
    if (path === '/home/connection') return respond(200, fx.homeConnection);
    if (path === '/home/config') return respond(200, fx.homeConfig);
    if (path === '/home/discover') return respond(200, fx.homeDiscover);
    if (path === '/calendar/setup/state') return respond(200, calendarSetup());
    if (path === '/calendar/setup/prefs') return respond(200, calendarSetup());
    return respond(404, { error: { code: 'not_found', message: path } });
  });
  vi.stubGlobal('fetch', fetch);
  return { calls };
}

/** Each section is its own page, found by the hash. */
const open = (section: string) => {
  location.hash = section;
  return render(<SettingsPage />);
};

beforeEach(() => {
  location.hash = '';
});
afterEach(() => vi.unstubAllGlobals());

describe('Settings page', () => {
  it('edits the schedule and saves the whole settings object', async () => {
    const { calls } = fakeServer();
    open('schedule');
    const off = await screen.findByLabelText('Screen off from');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();

    fireEvent.change(off, { target: { value: '22:30' } });
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText(/Saved\./);
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.path).toBe('/settings');
    const body = put!.body as ReturnType<typeof routeFixtures>['settings'];
    expect(body.schedule.offFrom).toBe('22:30');
    expect(body.people.length).toBeGreaterThan(0);
  });

  it('takes a Google Maps pair pasted into the location box, and typed coordinates', async () => {
    const { calls } = fakeServer();
    open('home');
    const where = (await screen.findByLabelText('Location')) as HTMLInputElement;
    const pair = screen.getByLabelText('Latitude, longitude') as HTMLInputElement;

    // Typing character by character keeps the text as typed until it parses.
    fireEvent.focus(pair);
    for (const typed of ['4', '42.6, -', '42.6, -8', '42.6, -83.']) {
      fireEvent.change(pair, { target: { value: typed } });
      expect(pair.value).toBe(typed);
    }
    fireEvent.change(pair, { target: { value: '42.6, -83.1' } });
    fireEvent.blur(pair);
    expect(pair.value).toBe('42.6, -83.1');

    // A Google Maps pair pasted into the one location box is used as it is, no lookup.
    fireEvent.paste(where, {
      clipboardData: { getData: () => '42.60032240592796, -83.33092662800189' },
    });
    expect(await screen.findByText(/Using 42\.6003, -83\.3309\./)).toBeTruthy();
    expect(calls.some((c) => c.path === '/geocode')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/Saved\./);
    const body = calls.find((c) => c.method === 'PUT')!.body as ReturnType<
      typeof routeFixtures
    >['settings'];
    expect(body.location.latitude).toBeCloseTo(42.6003, 3);
    expect(body.location.longitude).toBeCloseTo(-83.3309, 3);
    expect(body.location.query).toBe('42.60032240592796, -83.33092662800189');
  });

  it('renders one integration card per plugin manifest, with its state and directions', async () => {
    const { calls } = fakeServer();
    const fx = routeFixtures();
    open('integrations');
    const photos = await screen.findByRole('article', { name: 'Photos' });
    // The last error in plain words, with a Fix link.
    expect(within(photos).getByRole('alert').textContent).toMatch(/Apple answered 404/);
    // Calendars and Home Assistant have their own sections; the rest of the manifests are here.
    expect(screen.queryByRole('article', { name: 'Google Calendar' })).toBeNull();
    expect(screen.queryByRole('article', { name: 'Home Assistant' })).toBeNull();
    for (const p of fx.plugins.plugins.filter(
      (p) => p.category !== 'calendar' && p.id !== 'homeassistant',
    ))
      expect(screen.getByRole('article', { name: p.name })).toBeTruthy();

    // Fields come from the manifest; saving sends only the patch.
    const routes = screen.getByRole('article', { name: 'Leave-by times' });
    fireEvent.click(within(routes).getByRole('button', { name: 'Edit' }));
    const key = within(routes).getByLabelText('Google Maps Platform key') as HTMLInputElement;
    fireEvent.change(key, { target: { value: 'AIzaSyD-test-key' } });
    fireEvent.click(within(routes).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'PUT' && /^\/integrations\//.test(c.path))).toBe(true),
    );
    const put = calls.find((c) => c.method === 'PUT' && /^\/integrations\//.test(c.path))!;
    expect(put.path).toBe('/integrations/routes');
    expect(put.body).toMatchObject({ secrets: { googleKey: 'AIzaSyD-test-key' } });
  });

  it('mounts Home Assistant in its own section', async () => {
    fakeServer();
    open('homeassistant');
    // Workstream C's section: the connection card, then the rooms picker from discovery.
    expect(await screen.findByLabelText('Home Assistant address')).toBeTruthy();
    expect(
      await screen.findByRole('switch', { name: 'Show Home Assistant on the wall' }),
    ).toBeTruthy();
    expect(await screen.findByRole('list', { name: 'Rooms on the Home screen' })).toBeTruthy();
  });

  it('fills the Google client id and secret from a dropped client JSON', async () => {
    fakeServer();
    open('calendars');
    const google = await screen.findByRole('article', { name: 'Google Calendar' });
    fireEvent.click(within(google).getByRole('button', { name: 'Edit' }));
    const id = (await within(google).findByLabelText('Client ID')) as HTMLInputElement;
    fireEvent.paste(id, {
      clipboardData: {
        getData: () =>
          JSON.stringify({
            web: { client_id: 'abc.apps.googleusercontent.com', client_secret: 'GOCSPX-xyz' },
          }),
      },
    });
    expect(await within(google).findByText(/read from the downloaded file/)).toBeTruthy();
    expect(id.value).toBe('abc.apps.googleusercontent.com');
  });

  it('lists the calendars from the setup state and saves the choices', async () => {
    const { calls } = fakeServer();
    open('calendars');
    const table = await screen.findByRole('table', { name: 'Calendars on the wall' });
    expect(within(table).getByLabelText('Show Family')).toBeTruthy();
    fireEvent.click(within(table).getByLabelText('Show Kids'));
    fireEvent.click(screen.getByRole('button', { name: 'Save calendar choices' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/calendar/setup/prefs')).toBe(true));
    const saved = calls.find((c) => c.path === '/calendar/setup/prefs')!.body as {
      calendars: Record<string, { enabled?: boolean }>;
    };
    expect(saved.calendars['cal-kids']).toMatchObject({ enabled: false });
  });

  it('lists displays, needs a second tap to revoke, and shows a pairing code', async () => {
    const { calls } = fakeServer();
    open('displays');
    expect(await screen.findByText('Kitchen iPad')).toBeTruthy();
    expect(screen.getByText('This display')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Kitchen wall' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ name: 'Kitchen wall' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show a code' }));
    expect(await screen.findByText('482913')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Reload all displays' }));
    expect(await screen.findByText(/Sent a reload to 1 connected display\./)).toBeTruthy();

    const reload = vi.fn();
    vi.stubGlobal('location', { ...location, reload });
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to revoke' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/devices/dev-mock')).toBe(true));
  });

  it('asks for the PIN or a code when the server does not know this browser', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => respond(401, { error: { code: 'unauthorized', message: 'no key' } })),
    );
    render(<SettingsPage />);
    expect(await screen.findByLabelText('PIN or pairing code')).toBeTruthy();
  });

  it('offers the wizard on a fresh install', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.endsWith('/setup/state')
          ? respond(200, { firstRun: true, pinSet: false, completed: false, steps: {} })
          : respond(401, { error: { code: 'unauthorized', message: 'no key' } }),
      ),
    );
    const replace = vi.fn();
    vi.stubGlobal('location', { ...location, replace, hash: '' });
    render(<SettingsPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/setup'));
  });
});
