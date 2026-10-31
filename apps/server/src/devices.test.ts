import { DEVICE_KEY_HEADER, routes } from '@mantel/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

const real = createApp(loadConfig({ DATA_DIR: ':memory:' }));
afterAll(() => real.close());

const call = async (method: string, path: string, key?: string, body?: unknown) => {
  const res = await real.app.request(`/api${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(key ? { [DEVICE_KEY_HEADER]: key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

const pair = async (name: string, code = real.deps.auth.currentCode()) =>
  (await call('POST', '/pair', undefined, { code, name })).body as {
    deviceId: string;
    deviceKey: string;
  };

describe('displays and pairing', () => {
  it('lists paired displays, marks the caller, and revokes a key', async () => {
    const kitchen = await pair('Kitchen iPad');
    const surface = await pair('Surface');

    const list = await call('GET', '/devices', kitchen.deviceKey);
    expect(list.status).toBe(200);
    const { devices } = routes.devices.response.parse(list.body);
    expect(devices.map((d) => [d.name, d.current])).toEqual(
      expect.arrayContaining([
        ['Kitchen iPad', true],
        ['Surface', false],
      ]),
    );

    const renamed = await call('PATCH', `/devices/${surface.deviceId}`, kitchen.deviceKey, {
      name: 'Surface in the hall',
    });
    expect(routes.deviceRename.response.parse(renamed.body).device.name).toBe(
      'Surface in the hall',
    );
    expect((await call('PATCH', '/devices/nope', kitchen.deviceKey, { name: 'x' })).status).toBe(
      404,
    );

    expect((await call('DELETE', `/devices/${surface.deviceId}`, kitchen.deviceKey)).status).toBe(
      200,
    );
    expect((await call('GET', '/bootstrap', surface.deviceKey)).status).toBe(401);
    expect((await call('DELETE', `/devices/${surface.deviceId}`, kitchen.deviceKey)).status).toBe(
      404,
    );
    const after = routes.devices.response.parse(
      (await call('GET', '/devices', kitchen.deviceKey)).body,
    );
    expect(after.devices.find((d) => d.id === surface.deviceId)?.revokedAt).toBeTruthy();
  });

  it('gives a paired display the code to pair another', async () => {
    const first = await pair('First');
    expect((await call('GET', '/pairing-code')).status).toBe(401);
    const res = await call('GET', '/pairing-code', first.deviceKey);
    const { code } = routes.pairingCode.response.parse(res.body);
    const second = await pair('Second', code);
    expect(second.deviceKey).toBeTruthy();
  });

  it('reports the schedule state and reloads displays on demand', async () => {
    const { deviceKey } = await pair('Panel');
    const state = routes.displayState.response.parse(
      (await call('GET', '/display/state', deviceKey)).body,
    );
    expect(['on', 'off']).toContain(state.screen);
    const reload = await call('POST', '/display/reload', deviceKey);
    expect(routes.displayReload.response.parse(reload.body).ok).toBe(true);
  });
});
