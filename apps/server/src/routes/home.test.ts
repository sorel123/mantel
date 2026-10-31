import { DEVICE_KEY_HEADER, routes } from '@mantel/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';

const mock = createApp(loadConfig({ MOCK: '1', DATA_DIR: ':memory:' }));
const real = createApp(loadConfig({ DATA_DIR: ':memory:' }));
afterAll(() => {
  mock.close();
  real.close();
});

const post = (app: typeof mock.app, path: string, body: unknown) =>
  app.request(`/api${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('home routes in mock mode', () => {
  it('announces only when the flag is on', async () => {
    expect((await post(mock.app, '/home/announce', { message: 'Dinner!' })).status).toBe(403);
    const s = mock.deps.settings.get();
    mock.deps.settings.put({ ...s, flags: { ...s.flags, alexaAnnouncements: true } });
    const res = await post(mock.app, '/home/announce', { message: 'Dinner!' });
    expect(res.status).toBe(200);
    routes.homeAnnounce.response.parse(await res.json());
    expect((await post(mock.app, '/home/announce', { message: '  ' })).status).toBe(400);
  });

  it('applies a scene to the lights', async () => {
    await post(mock.app, '/home/call', { entityId: 'scene.movie', service: 'turn_on' });
    const state = routes.homeState.response.parse(
      await (await mock.app.request('/api/home/state')).json(),
    );
    const lamp = state.entities.find((e) => e.id === 'light.living_room_lamp')!;
    const ceiling = state.entities.find((e) => e.id === 'light.living_room_ceiling')!;
    expect([lamp.state, lamp.attrs.brightness, ceiling.state]).toEqual(['on', 38, 'off']);
  });

  it('serves camera stills, live views and artwork as images', async () => {
    for (const path of [
      '/home/cameras/camera.front_door/snapshot',
      '/home/cameras/camera.front_door/stream',
      '/media/media_player.living_room_apple_tv/artwork',
    ]) {
      const res = await mock.app.request(`/api${path}`);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/svg+xml');
      expect(await res.text()).toContain('<svg');
    }
    expect((await mock.app.request('/api/home/cameras/camera.nope/snapshot')).status).toBe(404);
  });
});

describe('home routes in real mode', () => {
  it('checks the device key on image routes, from the header or ?key=', async () => {
    const path = '/api/home/cameras/camera.front_door/snapshot';
    expect((await real.app.request(path)).status).toBe(401);
    const code = real.deps.auth.currentCode();
    const { deviceKey } = (await (await post(real.app, '/pair', { code })).json()) as {
      deviceKey: string;
    };
    // Without HA_URL and HA_TOKEN the integration answers 501 once the key is accepted.
    expect((await real.app.request(`${path}?key=${deviceKey}`)).status).toBe(501);
    expect(
      (await real.app.request(path, { headers: { [DEVICE_KEY_HEADER]: deviceKey } })).status,
    ).toBe(501);
  });
});
