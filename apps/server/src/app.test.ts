import { DEVICE_KEY_HEADER, routes, type RouteName } from '@mantel/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

const mock = createApp(loadConfig({ MOCK: '1', DATA_DIR: ':memory:' }));
const real = createApp(loadConfig({ DATA_DIR: ':memory:' }));
afterAll(() => {
  mock.close();
  real.close();
});

const req = (
  app: typeof mock.app,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) =>
  app.request(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (res: Response): Promise<any> => res.json();

describe('mock mode', () => {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

  const samples: Partial<Record<RouteName, [string, unknown?]>> = {
    bootstrap: ['/bootstrap'],
    calendar: [`/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`],
    calendarQuick: ['/calendar/quick', { title: 'Pizza', start: to }],
    countdowns: ['/countdowns'],
    meals: ['/meals'],
    weather: ['/weather'],
    commute: ['/commute'],
    photosNext: ['/photos/next?n=3'],
    homeState: ['/home/state'],
    homeCall: [
      '/home/call',
      { entityId: 'light.kitchen_island', service: 'turn_on', data: { brightness_pct: 50 } },
    ],
    media: ['/media'],
    mediaCall: ['/media/call', { playerId: 'media_player.living_room_apple_tv', action: 'pause' }],
    lists: ['/lists'],
    listAddItem: ['/lists/list-grocery/items', { text: 'Eggs' }],
    itemPatch: ['/items/list-grocery-0', { done: true }],
    itemDelete: ['/items/list-grocery-1'],
    listCreate: ['/lists', { name: 'Hardware store' }],
    listDelete: ['/lists/list-todo'],
    chores: ['/chores'],
    choreDone: ['/chores/chore-bed-leo/done'],
    choreUndo: ['/chores/chore-mochi/done'],
    choreCreate: ['/chores', { title: 'Feed the fish', personId: 'leo', cadence: 'daily' }],
    choreDelete: ['/chores/chore-plants'],
    settings: ['/settings'],
    health: ['/health'],
  };

  for (const [name, [path, body]] of Object.entries(samples) as [RouteName, [string, unknown?]][]) {
    it(`${routes[name].method} ${routes[name].path} answers within the contract`, async () => {
      const res = await req(mock.app, routes[name].method, path, body);
      expect(res.status, await res.clone().text()).toBe(200);
      routes[name].response!.parse(await json(res));
    });
  }

  it('round-trips settings', async () => {
    const s = await json(await req(mock.app, 'GET', '/settings'));
    s.theme = 'dusk';
    const res = await req(mock.app, 'PUT', '/settings', s);
    expect((await json(res)).theme).toBe('dusk');
  });

  it('serves photo bytes', async () => {
    const res = await req(mock.app, 'GET', '/photos/mock-0');
    expect(res.headers.get('content-type')).toBe('image/svg+xml');
    expect(await res.text()).toContain('<svg');
    expect((await req(mock.app, 'GET', '/photos/nope')).status).toBe(404);
  });

  it('pairs with the mock code', async () => {
    const res = await req(mock.app, 'POST', '/pair', { code: '000000', name: 'Kitchen iPad' });
    const { deviceKey } = await json(res);
    expect(mock.deps.auth.verify(deviceKey)).toBeTruthy();
  });

  it('rejects bad input', async () => {
    expect((await req(mock.app, 'GET', '/calendar?from=nope&to=nope')).status).toBe(400);
    expect(
      (
        await req(mock.app, 'POST', '/home/call', {
          entityId: 'light.not_allowed',
          service: 'turn_on',
        })
      ).status,
    ).toBe(403);
    expect((await req(mock.app, 'GET', '/nope')).status).toBe(404);
  });
});

describe('real mode', () => {
  it('requires a device key', async () => {
    expect((await req(real.app, 'GET', '/bootstrap')).status).toBe(401);
    expect((await req(real.app, 'GET', '/health')).status).toBe(200);
  });

  it('pairs with the logged code and then authorises', async () => {
    const code = real.deps.auth.currentCode();
    expect(
      (await req(real.app, 'POST', '/pair', { code: code === '111111' ? '222222' : '111111' }))
        .status,
    ).toBe(403);
    const { deviceKey } = await json(await req(real.app, 'POST', '/pair', { code }));
    const res = await req(real.app, 'GET', '/bootstrap', undefined, {
      [DEVICE_KEY_HEADER]: deviceKey,
    });
    expect(res.status).toBe(200);
    expect((await json(res)).mock).toBe(false);
  });

  it('serves the built-in lists and chore chart', async () => {
    const { deviceKey } = await json(
      await req(real.app, 'POST', '/pair', { code: real.deps.auth.currentCode() }),
    );
    const auth = { [DEVICE_KEY_HEADER]: deviceKey };
    const { lists } = await json(await req(real.app, 'GET', '/lists', undefined, auth));
    expect(lists.map((l: { name: string }) => l.name)).toEqual(['Grocery', 'Chores', 'To-do']);
    const add = await req(real.app, 'POST', `/lists/${lists[0].id}/items`, { text: 'Eggs' }, auth);
    expect((await json(add)).item).toMatchObject({ text: 'Eggs', done: false });
    const chores = await json(await req(real.app, 'GET', '/chores', undefined, auth));
    expect(chores.chores).toEqual([]);
  });

  it('answers 501 for integrations not built yet', async () => {
    const { deviceKey } = await json(
      await req(real.app, 'POST', '/pair', { code: real.deps.auth.currentCode() }),
    );
    const res = await req(real.app, 'GET', '/weather', undefined, {
      [DEVICE_KEY_HEADER]: deviceKey,
    });
    expect(res.status).toBe(501);
    expect((await json(res)).error.code).toBe('not_implemented');
  });
});
