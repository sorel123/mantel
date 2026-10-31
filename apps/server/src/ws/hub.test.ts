import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { parseWsEvent } from '@mantel/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';

const open = (url: string) =>
  new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });

describe('WebSocket hub', () => {
  let base = '';
  let server: Server;
  const mock = createApp(loadConfig({ MOCK: '1', DATA_DIR: ':memory:' }));

  beforeAll(async () => {
    server = serve({ fetch: mock.app.fetch, port: 0, hostname: '127.0.0.1' }) as Server;
    mock.deps.hub.attach(server);
    await new Promise((r) => server.once('listening', r));
    base = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    mock.close();
    server.close();
  });

  it('pushes contract events to connected displays', async () => {
    const ws = await open(`ws://${base}/ws`);
    const got = new Promise<string>((r) => ws.once('message', (m) => r(String(m))));
    await fetch(`http://${base}/api/dev/doorbell`, { method: 'POST' });
    const event = parseWsEvent(await got);
    expect(event?.type).toBe('home.doorbell');
    ws.close();
  });

  it('echoes a home.state event after a service call', async () => {
    const ws = await open(`ws://${base}/ws`);
    const got = new Promise<string>((r) => ws.once('message', (m) => r(String(m))));
    await fetch(`http://${base}/api/home/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entityId: 'lock.front_door', service: 'unlock' }),
    });
    const event = parseWsEvent(await got);
    expect(event).toMatchObject({
      type: 'home.state',
      payload: { entity: { id: 'lock.front_door', state: 'unlocked' } },
    });
    ws.close();
  });

  it('refuses unknown keys', async () => {
    await expect(open(`ws://${base}/ws?key=wrong`)).rejects.toThrow('401');
  });
});
