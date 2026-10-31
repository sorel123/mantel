import { routeFixtures } from '@mantel/shared/fixtures';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('Shell', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', FakeSocket);
  });

  it('renders the four screens from mock bootstrap', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => respond(200, routeFixtures().bootstrap)),
    );
    render(
      <BootstrapProvider>
        <Shell />
      </BootstrapProvider>,
    );
    expect(await screen.findByText(/mock data/)).toBeTruthy();
    for (const label of ['Today', 'Month', 'Lists', 'Home'])
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(screen.getByRole('heading', { name: 'Home' })).toBeTruthy();
  });

  it('asks for a pairing code when the server says unauthorised', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => respond(401, { error: { code: 'unauthorized', message: 'no key' } })),
    );
    render(
      <BootstrapProvider>
        <Shell />
      </BootstrapProvider>,
    );
    expect(await screen.findByLabelText('Pairing code')).toBeTruthy();
  });
});
