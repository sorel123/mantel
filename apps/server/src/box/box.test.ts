import { mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { DeviceAuth } from '../auth.js';
import { loadConfig } from '../config.js';
import { openDb } from '../db/index.js';
import { SettingsStore } from '../settings.js';
import { BoxService, HOTSPOT_SSID, normaliseServerUrl } from './index.js';
import { FakeNetwork } from './network.js';

const display = mkdtempSync(join(tmpdir(), 'mantel-box-'));
writeFileSync(join(display, 'index.html'), '<!doctype html><html><body>display</body></html>');

/** A real socket, so loopback detection works like on the box. */
const start = async (env: Record<string, string> = {}) => {
  const a = createApp(
    loadConfig({ DATA_DIR: ':memory:', MANTEL_BOX: 'fake', DISPLAY_DIST: display, ...env }),
  );
  const server = serve({ fetch: a.app.fetch, port: 0, hostname: '127.0.0.1' });
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    a,
    base,
    stop: () => {
      server.close();
      a.close();
    },
  };
};

const service = () => {
  const db = openDb(':memory:');
  const auth = new DeviceAuth(db, false);
  const network = new FakeNetwork();
  let now = 1_000_000;
  const box = new BoxService({
    db,
    auth,
    settings: new SettingsStore(db),
    network,
    port: 8787,
    now: () => now,
  });
  return { box, auth, network, advance: (ms: number) => (now += ms) };
};

describe('normaliseServerUrl', () => {
  it('adds the scheme and the default port', () => {
    expect(normaliseServerUrl('192.168.1.20')).toBe('http://192.168.1.20:8787');
    expect(normaliseServerUrl(' http://mantel.local:9000/ ')).toBe('http://mantel.local:9000');
    expect(normaliseServerUrl('https://mantel.example.com')).toBe('https://mantel.example.com');
    expect(normaliseServerUrl('')).toBeNull();
    expect(normaliseServerUrl('http://user:pw@host')).toBeNull();
  });
});

describe('box pages and routes', () => {
  const stops: Array<() => void> = [];
  afterAll(() => stops.forEach((s) => s()));

  it('sends a new box to setup, then serves the display once the role is chosen', async () => {
    const s = await start();
    stops.push(s.stop);
    const first = await fetch(`${s.base}/`, { redirect: 'manual' });
    expect(first.status).toBe(302);
    expect(first.headers.get('location')).toBe('/box');
    expect((await fetch(`${s.base}/box`)).status).toBe(200);

    const state = (await (await fetch(`${s.base}/api/box/state`)).json()) as { role: unknown };
    expect(state.role).toBeNull();

    const set = await fetch(`${s.base}/api/box/role`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'server', touch: false, done: true }),
    });
    expect(set.status).toBe(200);
    const after = await fetch(`${s.base}/`, { redirect: 'manual' });
    expect(after.status).toBe(200);
  });

  it('refuses a screen role when no Mantel answers at the address', async () => {
    const s = await start();
    stops.push(s.stop);
    const res = await fetch(`${s.base}/api/box/role`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'screen', serverUrl: '127.0.0.1:1' }),
    });
    expect(res.status).toBe(400);
  });

  it('sends a screen-only box to the Mantel it shows', async () => {
    const other = await start({ MANTEL_BOX: '' });
    stops.push(other.stop);
    const s = await start();
    stops.push(s.stop);
    const res = await fetch(`${s.base}/api/box/role`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'screen', serverUrl: other.base, touch: false, done: true }),
    });
    expect(res.status).toBe(200);
    const page = await fetch(`${s.base}/`, { redirect: 'manual' });
    expect(page.headers.get('location')).toBe(`${other.base}/?box=1&glance=1`);
  });

  it('is off unless the server runs as a box', async () => {
    const s = await start({ MANTEL_BOX: '' });
    stops.push(s.stop);
    expect((await fetch(`${s.base}/api/box/state`)).status).toBe(404);
    expect((await fetch(`${s.base}/`, { redirect: 'manual' })).status).toBe(200);
  });
});

describe('BoxService', () => {
  it('locks changes once set up, except with the PIN or a paired display', async () => {
    const { box, auth } = service();
    await box.setRole({ role: 'server' });
    const req = (headers: Record<string, string> = {}) =>
      ({ req: { header: (h: string) => headers[h.toLowerCase()] } }) as never;
    expect(box.allowed(req())).toBe(false);
    auth.setPin('2468');
    expect(box.allowed(req({ 'x-mantel-pin': '2468' }))).toBe(true);
    expect(box.allowed(req({ 'x-mantel-pin': '1111' }))).toBe(false);
    const { deviceKey } = auth.pairLocal('Kiosk');
    expect(box.allowed(req({ 'x-mantel-device-key': deviceKey }))).toBe(true);
  });

  it('opens the setup hotspot after a minute offline and closes it once online', async () => {
    const { box, network, advance } = service();
    await box.tick();
    expect((await network.status()).hotspot).toBe(false);
    advance(61_000);
    await box.tick();
    const st = await box.state(true);
    expect(st.network.hotspot).toBe(true);
    expect(st.hotspot?.ssid).toBe(HOTSPOT_SSID);
    expect(st.hotspot?.password).toMatch(/^\d{8}$/);
    // Only the box's own screen sees the password.
    expect((await box.state(false)).hotspot?.password).toBeNull();
    // It remembered the networks in range before the radio became the hotspot.
    expect((await box.scan(false)).map((n) => n.ssid)).toContain('Home');

    await network.connect('Home', network.password);
    await box.tick();
    expect((await network.status()).hotspot).toBe(false);
  });

  it('reports a wrong Wi-Fi password', async () => {
    const { box } = service();
    box.join('Home', 'not it at all');
    await new Promise((r) => setTimeout(r, 700));
    const st = await box.state(true);
    expect(st.joining).toBeNull();
    expect(st.lastError).toMatch(/Could not join "Home"/);
  });

  it('waits longer before the hotspot on a box that is already set up', async () => {
    const { box, network, advance } = service();
    await box.setRole({ role: 'server' });
    await box.tick();
    advance(61_000);
    await box.tick();
    expect((await network.status()).hotspot).toBe(false);
    advance(5 * 60_000);
    await box.tick();
    expect((await network.status()).hotspot).toBe(true);
    advance(10 * 60_000);
    await box.tick();
    expect((await network.status()).hotspot).toBe(false);
  });
});
