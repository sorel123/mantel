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
    // v2 workstream A contract (fixtures until the implementation lands)
    plugins: ['/plugins'],
    integrations: ['/integrations'],
    integrationPut: ['/integrations/homeassistant', { enabled: true }],
    integrationTest: ['/integrations/homeassistant/test'],
    integrationAuthorizeUrl: ['/integrations/google/authorize-url'],
    integrationCallback: [
      '/integrations/google/callback',
      { url: 'http://localhost/cb?code=x&state=y' },
    ],
    healthDetails: ['/health/details'],
    adminPin: ['/admin/pin', { pin: '1234' }],
    setupState: ['/setup/state'],
    setupStatePut: ['/setup/state', { steps: { people: 'done' } }],
    settingsExport: ['/settings/export', { passphrase: 'hunter2' }],
    geocode: ['/geocode', { query: 'Seattle' }],
  };

  for (const [name, [path, body]] of Object.entries(samples) as [RouteName, [string, unknown?]][]) {
    it(`${routes[name].method} ${routes[name].path} answers within the contract`, async () => {
      const res = await req(mock.app, routes[name].method, path, body);
      expect(res.status, await res.clone().text()).toBe(200);
      routes[name].response!.parse(await json(res));
    });
  }

  it('geocodes a pasted coordinate pair without a lookup', async () => {
    const res = await req(mock.app, 'POST', '/geocode', { query: '47.6062, -122.3321' });
    const { candidates } = await json(res);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ latitude: 47.6062, longitude: -122.3321 });
  });

  it('pairs with a PIN in mock mode', async () => {
    const res = await req(mock.app, 'POST', '/pair', { pin: '1234', name: 'Phone' });
    expect(res.status).toBe(200);
    expect((await req(mock.app, 'POST', '/pair', { name: 'Phone' })).status).toBe(400);
  });

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

describe('settings-first server (real mode, fresh data dir)', () => {
  const fresh = createApp(loadConfig({ DATA_DIR: ':memory:' }), { env: {} });
  afterAll(() => fresh.close());
  const r = (method: string, path: string, body?: unknown, headers?: Record<string, string>) =>
    req(fresh.app, method, path, body, headers);
  let key = '';

  it('boots with no env, reports first run, and lets the first browser set a PIN', async () => {
    const state = await json(await r('GET', '/setup/state'));
    expect(state).toMatchObject({ firstRun: true, pinSet: false, completed: false });
    expect(state.steps.welcome).toBe('todo');
    expect((await r('POST', '/pair', { pin: '1234' })).status).toBe(403);

    expect((await r('POST', '/admin/pin', { pin: '12' })).status).toBe(400);
    expect((await r('POST', '/admin/pin', { pin: '2468' })).status).toBe(200);
    // A second browser cannot just overwrite it.
    expect((await r('POST', '/admin/pin', { pin: '9999' })).status).toBe(403);
    expect((await r('POST', '/admin/pin', { pin: '9999', currentPin: '0000' })).status).toBe(403);

    expect((await r('POST', '/pair', { pin: '0000', name: 'Phone' })).status).toBe(403);
    const paired = await json(await r('POST', '/pair', { pin: '2468', name: 'Phone' }));
    key = paired.deviceKey;
    expect(fresh.deps.auth.verify(key)).toBe(paired.deviceId);
    const after = await json(await r('GET', '/setup/state'));
    expect(after).toMatchObject({ firstRun: false, pinSet: true });
    expect(after.steps.welcome).toBe('done');
    expect(after.steps.wall).toBe('done');
  });

  it('lists plugins and integrations, all not set up', async () => {
    const auth = { [DEVICE_KEY_HEADER]: key };
    const { plugins } = await json(await r('GET', '/plugins', undefined, auth));
    expect(plugins.map((p: { id: string }) => p.id).sort()).toEqual(
      [
        'google',
        'homeassistant',
        'icloud',
        'photos',
        'pollen',
        'quips',
        'routes',
        'weather',
      ].sort(),
    );
    const { integrations } = await json(await r('GET', '/integrations', undefined, auth));
    routes.integrations.response.parse({ integrations });
    const byId = Object.fromEntries(integrations.map((i: { id: string }) => [i.id, i]));
    expect(byId.google.state).toBe('not_set_up');
    expect(byId.homeassistant.state).toBe('not_set_up');
    expect(byId.weather.state).toBe('connected');
    expect(byId.google.config.redirectUri).toMatch(/\/api\/calendar\/google\/callback$/);
  });

  it('saves Google client values over the API and the OAuth flow starts without a restart', async () => {
    const auth = { [DEVICE_KEY_HEADER]: key };
    expect((await r('GET', '/integrations/google/authorize-url', undefined, auth)).status).toBe(
      400,
    );
    const put = await json(
      await r(
        'PUT',
        '/integrations/google',
        {
          config: { clientId: 'abc.apps.googleusercontent.com' },
          secrets: { clientSecret: 'shh' },
        },
        auth,
      ),
    );
    expect(put.integration).toMatchObject({
      state: 'not_set_up',
      summary: expect.stringMatching(/Connect/),
      hasSecrets: ['clientSecret'],
      sources: { clientId: 'store', clientSecret: 'store' },
    });
    expect(put.integration.config.clientSecret).toBeUndefined();
    const url = await json(await r('GET', '/integrations/google/authorize-url', undefined, auth));
    expect(url.url).toContain('client_id=abc.apps.googleusercontent.com');
    const test = await json(await r('POST', '/integrations/google/test', undefined, auth));
    expect(test).toEqual({ ok: true, message: expect.stringMatching(/Press Connect/) });
  });

  it('turns an integration off and on through settings', async () => {
    const auth = { [DEVICE_KEY_HEADER]: key };
    const off = await json(await r('PUT', '/integrations/photos', { enabled: false }, auth));
    expect(off.integration).toMatchObject({ enabled: false, state: 'disabled' });
    const s = await json(await r('GET', '/settings', undefined, auth));
    expect(s.integrations.photos).toEqual({ enabled: false });
    const boot = await json(await r('GET', '/bootstrap', undefined, auth));
    expect(boot.settings.integrations.photos).toEqual({ enabled: false });
    expect(boot.device).toMatchObject({ name: 'Phone', current: true });
    s.integrations.photos = { enabled: true };
    await r('PUT', '/settings', s, auth);
    const { integrations } = await json(await r('GET', '/integrations', undefined, auth));
    expect(integrations.find((i: { id: string }) => i.id === 'photos').state).toBe('not_set_up');
  });

  it('rejects values that do not fit the manifest with a sentence', async () => {
    const auth = { [DEVICE_KEY_HEADER]: key };
    const res = await r(
      'PUT',
      '/integrations/homeassistant',
      { config: { url: 'homeassistant' } },
      auth,
    );
    expect(res.status).toBe(400);
    expect((await json(res)).error.message).toMatch(/http:\/\//);
    expect((await r('PUT', '/integrations/nope', {}, auth)).status).toBe(404);
  });

  it('exports and imports a bundle, secrets only with the passphrase', async () => {
    const auth = { [DEVICE_KEY_HEADER]: key };
    const plain = await json(await r('POST', '/settings/export', {}, auth));
    routes.settingsExport.response.parse(plain);
    expect(plain.secrets).toBeUndefined();
    expect(plain.integrations.google.config.clientId).toBe('abc.apps.googleusercontent.com');
    const locked = await json(await r('POST', '/settings/export', { passphrase: 'pw' }, auth));
    expect(locked.secrets.cipher).toBe('aes-256-gcm');
    expect(JSON.stringify(locked)).not.toContain('shh');

    fresh.deps.secrets.delete('google', 'clientSecret');
    expect((await r('POST', '/settings/import', { bundle: locked }, auth)).status).toBe(400);
    expect(
      (await r('POST', '/settings/import', { bundle: locked, passphrase: 'no' }, auth)).status,
    ).toBe(403);
    const restored = await json(
      await r('POST', '/settings/import', { bundle: locked, passphrase: 'pw' }, auth),
    );
    expect(restored).toEqual({ ok: true, secretsRestored: ['google'] });
    expect(fresh.deps.secrets.get('google', 'clientSecret')).toBe('shh');
  });

  it('reports health details with a log tail', async () => {
    const auth = { [DEVICE_KEY_HEADER]: key };
    const health = await json(await r('GET', '/health/details', undefined, auth));
    routes.healthDetails.response.parse(health);
    expect(health).toMatchObject({
      firstRun: false,
      pinSet: true,
      publicUrl: 'http://localhost:8787',
    });
    expect(health.logTail.some((l: { message: string }) => /Admin PIN set/.test(l.message))).toBe(
      true,
    );
    expect(health.logTail.length).toBeLessThanOrEqual(50);
  });

  it('stores per-display overrides on PATCH /devices/:id', async () => {
    const auth = { [DEVICE_KEY_HEADER]: key };
    const { devices } = await json(await r('GET', '/devices', undefined, auth));
    const me = devices.find((d: { current: boolean }) => d.current);
    const patched = await json(
      await r('PATCH', `/devices/${me.id}`, { look: 'dusk', fit: 'fill' }, auth),
    );
    expect(patched.device).toMatchObject({ look: 'dusk', fit: 'fill', name: 'Phone' });
    expect((await r('PATCH', `/devices/${me.id}`, {}, auth)).status).toBe(400);
    const boot = await json(await r('GET', '/bootstrap', undefined, auth));
    expect(boot.device).toMatchObject({ look: 'dusk', fit: 'fill' });
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
    const res = await req(real.app, 'GET', '/home/state', undefined, {
      [DEVICE_KEY_HEADER]: deviceKey,
    });
    expect(res.status).toBe(501);
    expect((await json(res)).error.code).toBe('not_implemented');
  });
});
