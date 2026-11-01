import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

const start = async (env: Record<string, string>) => {
  const a = createApp(loadConfig({ DATA_DIR: ':memory:', ...env }));
  const server = serve({ fetch: a.app.fetch, port: 0, hostname: '127.0.0.1' });
  await new Promise((r) => server.once('listening', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/pair/local`;
  return {
    a,
    url,
    stop: () => {
      server.close();
      a.close();
    },
  };
};

describe('POST /api/pair/local', () => {
  const stops: Array<() => void> = [];
  afterAll(() => stops.forEach((s) => s()));

  it('pairs the same computer when LOCAL_PAIR is on', async () => {
    const s = await start({ LOCAL_PAIR: '1' });
    stops.push(s.stop);
    const res = await fetch(`${s.url}?name=Kiosk`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deviceKey: string };
    expect(s.a.deps.auth.verify(body.deviceKey)).not.toBeNull();
  });

  it('refuses a request that came through a proxy', async () => {
    const s = await start({ LOCAL_PAIR: '1' });
    stops.push(s.stop);
    const res = await fetch(s.url, { method: 'POST', headers: { 'x-forwarded-for': '10.0.0.5' } });
    expect(res.status).toBe(403);
  });

  it('is off unless the installed app turns it on', async () => {
    const s = await start({});
    stops.push(s.stop);
    expect((await fetch(s.url, { method: 'POST' })).status).toBe(403);
  });
});
