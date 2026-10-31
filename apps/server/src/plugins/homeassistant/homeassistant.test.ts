import { DEVICE_KEY_HEADER } from '@mantel/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { FakeHa, TOKEN } from '../../providers/real/fake-ha.js';

const until = async (check: () => boolean, ms = 4000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('Home Assistant saved over the API connects live', () => {
  const ha = new FakeHa();
  const app = createApp(loadConfig({ DATA_DIR: ':memory:' }), { env: {} });
  let key = '';
  const call = (method: string, path: string, body?: unknown) =>
    app.app.request(`/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', [DEVICE_KEY_HEADER]: key },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  beforeAll(async () => {
    await ha.listen();
    ha.states.set('light.kitchen', {
      entity_id: 'light.kitchen',
      state: 'on',
      attributes: { friendly_name: 'Kitchen' },
      last_changed: new Date().toISOString(),
      last_updated: new Date().toISOString(),
    });
    const paired = await call('POST', '/pair', { code: app.deps.auth.currentCode() });
    key = ((await paired.json()) as { deviceKey: string }).deviceKey;
  });
  afterAll(async () => {
    app.close();
    await ha.close();
  });

  it('answers 501 before, connected after, and 503 when disabled, all without a restart', async () => {
    expect((await call('GET', '/home/state')).status).toBe(501);
    expect(
      ((await (await call('GET', '/home/connection')).json()) as { state: string }).state,
    ).toBe('not_set_up');
    let status = (await (await call('GET', '/integrations')).json()) as {
      integrations: Array<{ id: string; state: string }>;
    };
    expect(status.integrations.find((i) => i.id === 'homeassistant')?.state).toBe('not_set_up');

    const put = await call('PUT', '/integrations/homeassistant', {
      config: { url: ha.url },
      secrets: { token: TOKEN },
    });
    expect(put.status).toBe(200);
    await until(() => ha.connections > 0);
    await until(() => app.deps.registry.status('homeassistant').state === 'connected');
    expect(app.deps.registry.status('homeassistant').summary).toContain(ha.url);
    expect((await call('GET', '/home/state')).status).toBe(200);
    expect(app.deps.secrets.get('homeassistant', 'token')).toBe(TOKEN);
    const conn = (await (await call('GET', '/home/connection')).json()) as {
      state: string;
      source: string;
      url: string;
    };
    expect(conn).toMatchObject({ state: 'connected', source: 'settings', url: ha.url });

    // A wrong token on Test is reported in a sentence, and nothing was saved.
    const test = (await (
      await call('POST', '/integrations/homeassistant/test', { secrets: { token: 'bad' } })
    ).json()) as { ok: boolean; message: string };
    expect(test.ok).toBe(false);
    expect(test.message).toMatch(/refused the token/);
    expect(app.deps.secrets.get('homeassistant', 'token')).toBe(TOKEN);

    const off = await call('PUT', '/integrations/homeassistant', { enabled: false });
    expect(((await off.json()) as { integration: { state: string } }).integration.state).toBe(
      'disabled',
    );
    // Off is a refusal of its own (503 `disabled`), so the display can hide the Home screen.
    expect((await call('GET', '/home/state')).status).toBe(503);
    expect(
      ((await (await call('GET', '/home/connection')).json()) as { state: string }).state,
    ).toBe('disabled');
    status = (await (await call('GET', '/integrations')).json()) as typeof status;
    expect(status.integrations.find((i) => i.id === 'homeassistant')?.state).toBe('disabled');
  });
});
