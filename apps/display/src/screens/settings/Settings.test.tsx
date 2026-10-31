import { routeFixtures } from '@mantel/shared/fixtures';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from '.';

const respond = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );

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
    return respond(404, { error: { code: 'not_found', message: path } });
  });
  vi.stubGlobal('fetch', fetch);
  return { calls };
}

afterEach(() => vi.unstubAllGlobals());

describe('Settings page', () => {
  it('edits the schedule and saves the whole settings object', async () => {
    const { calls } = fakeServer();
    render(<SettingsPage />);
    const off = await screen.findByLabelText('Screen off from');
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(off, { target: { value: '22:30' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Chore chart' }));
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    fireEvent.click(save);

    await screen.findByText(/Saved\./);
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.path).toBe('/settings');
    const body = put!.body as ReturnType<typeof routeFixtures>['settings'];
    expect(body.schedule.offFrom).toBe('22:30');
    expect(body.flags.chores).toBe(false);
    expect(body.people.length).toBeGreaterThan(0);
  });

  it('lets a negative longitude be typed and fills both fields from a pasted pair', async () => {
    const { calls } = fakeServer();
    render(<SettingsPage />);
    const lng = (await screen.findByLabelText('Longitude')) as HTMLInputElement;
    const lat = screen.getByLabelText('Latitude') as HTMLInputElement;
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;

    // Typing character by character passes through "-" and "-83." without a NaN in the draft.
    fireEvent.focus(lng);
    for (const typed of ['-', '-8', '-83', '-83.', '-83.33']) {
      fireEvent.change(lng, { target: { value: typed } });
      expect(lng.value).toBe(typed);
      expect(screen.queryByText(/received NaN/)).toBeNull();
    }
    expect(save.disabled).toBe(false);

    // A Google Maps pair pasted into Latitude fills both.
    fireEvent.paste(lat, {
      clipboardData: { getData: () => '42.60032240592796, -83.33092662800189' },
    });
    fireEvent.click(save);
    await screen.findByText(/Saved\./);
    const body = calls.find((c) => c.method === 'PUT')!.body as ReturnType<
      typeof routeFixtures
    >['settings'];
    expect(body.location.latitude).toBeCloseTo(42.6003, 3);
    expect(body.location.longitude).toBeCloseTo(-83.3309, 3);
  });

  it('lists displays, needs a second tap to revoke, and shows a pairing code', async () => {
    const { calls } = fakeServer();
    render(<SettingsPage />);
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

  it('asks to pair when the server does not know this browser', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => respond(401, { error: { code: 'unauthorized', message: 'no key' } })),
    );
    render(<SettingsPage />);
    expect(await screen.findByLabelText('Pairing code')).toBeTruthy();
  });
});
