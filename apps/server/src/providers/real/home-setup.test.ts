import { readFileSync } from 'node:fs';
import { HomeConfig, HomeDiscovery, type WsEventInput } from '@mantel/shared';
import { homeConfig, settings as fixtureSettings } from '@mantel/shared/fixtures';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../../db/index.js';
import type { ProviderContext } from '../types.js';
import { FakeHa, TOKEN } from './fake-ha.js';
import { homeConfigToYaml, parseHomeConfig } from './home-config.js';
import { mapDiscovery, testHaConnection } from './home-discover.js';
import { HomeConfigStore } from './home-store.js';
import { connectionSource, realHome, waitFor, type RealHome } from './home.js';
import { homeAssistantPlugin } from '../../plugins/homeassistant/index.js';

const example = readFileSync(
  new URL('../../../../../config/home.example.yaml', import.meta.url),
  'utf8',
);

describe('allow-list store', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('round-trips the example YAML through the store and back out as YAML', () => {
    const changes: unknown[] = [];
    const store = new HomeConfigStore(db, {}, (c) => changes.push(c));
    expect(store.get().areas).toEqual([]);
    const imported = store.importYaml(example);
    expect(imported).toEqual(parseHomeConfig(example));
    expect(changes).toHaveLength(1);
    // A new store on the same database reads what was saved.
    expect(new HomeConfigStore(db).get()).toEqual(imported);
    // Export, then import again: the same config.
    const yaml = homeConfigToYaml(imported);
    expect(parseHomeConfig(yaml)).toEqual(imported);
    expect(yaml).toContain('ha_area: living_room');
    expect(yaml).toContain('read_only: true');
    expect(yaml).not.toContain('domains:'); // defaults are left out
  });

  it('imports a legacy home.yaml once when the database is empty', () => {
    const path = new URL('../../../../../config/home.example.yaml', import.meta.url).pathname;
    const first = new HomeConfigStore(db, { importFrom: path });
    expect(first.get().areas.length).toBeGreaterThan(3);
    first.put({ ...first.get(), areas: [] });
    // The file is not read again once something is stored.
    expect(new HomeConfigStore(db, { importFrom: path }).get().areas).toEqual([]);
  });

  it('rejects a bad config with readable text and keeps the last good one', () => {
    const store = new HomeConfigStore(db);
    store.put({ areas: [{ id: 'a', name: 'A' }] });
    expect(() =>
      store.put({
        areas: [
          { id: 'a', name: 'A' },
          { id: 'a', name: 'B' },
        ],
      }),
    ).toThrow(/used twice/);
    expect(() => store.importYaml('areas: [\n')).toThrow(/invalid Home Assistant allow-list/);
    expect(store.get().areas).toHaveLength(1);
  });

  it('writes the fixture config as YAML that parses back to the same config', () => {
    const cfg = homeConfig(new Date());
    expect(parseHomeConfig(homeConfigToYaml(cfg))).toEqual(HomeConfig.parse(cfg));
  });
});

describe('discovery mapping', () => {
  it('lists areas and entities with their area, kind and state, skipping hidden and config ones', () => {
    const registry = {
      areas: [
        { area_id: 'kitchen', name: 'Kitchen' },
        { area_id: 'den', name: 'Den' },
      ],
      devices: [{ id: 'dev-1', area_id: 'kitchen' }],
      entities: [
        {
          entity_id: 'light.counter',
          area_id: null,
          device_id: 'dev-1',
          platform: 'hue',
          hidden_by: null,
          disabled_by: null,
          entity_category: null,
        },
        {
          entity_id: 'switch.plug_led',
          area_id: 'kitchen',
          device_id: null,
          platform: 'meross_lan',
          hidden_by: null,
          disabled_by: null,
          entity_category: 'config',
        },
        {
          entity_id: 'light.hidden',
          area_id: 'kitchen',
          device_id: null,
          platform: 'hue',
          hidden_by: 'user',
          disabled_by: null,
          entity_category: null,
        },
        {
          entity_id: 'event.front_ding',
          area_id: 'gone',
          device_id: null,
          platform: 'ring',
          hidden_by: null,
          disabled_by: null,
          entity_category: null,
        },
      ],
    };
    const states = new Map(
      Object.entries({
        'light.counter': { friendly_name: 'Kitchen Counter', state: 'on' },
        'event.front_ding': { device_class: 'doorbell', state: '2026-10-31T00:00:00+00:00' },
        'person.jay': { friendly_name: 'Jay', state: 'home' },
        'automation.night': { friendly_name: 'Night', state: 'on' },
        'sensor.yaml_only': { state: '42' },
      }).map(([id, { state, ...attributes }]) => [
        id,
        { entity_id: id, state, attributes, last_changed: '', last_updated: '' },
      ]),
    );
    const d = HomeDiscovery.parse(mapDiscovery(registry, states, { haVersion: '2026.10.1' }));
    expect(d.areas).toEqual([
      { id: 'den', name: 'Den' },
      { id: 'kitchen', name: 'Kitchen' },
    ]);
    expect(d.entities.map((e) => e.id)).toEqual([
      'event.front_ding',
      'person.jay',
      'light.counter',
      'sensor.yaml_only',
    ]);
    expect(d.entities.find((e) => e.id === 'light.counter')).toEqual({
      id: 'light.counter',
      domain: 'light',
      kind: 'light',
      name: 'Kitchen Counter',
      areaId: 'kitchen', // through its device
      state: 'on',
      platform: 'hue',
    });
    const ding = d.entities.find((e) => e.id === 'event.front_ding')!;
    expect(ding.kind).toBeUndefined();
    expect(ding.areaId).toBeNull(); // its area no longer exists
    expect(ding.deviceClass).toBe('doorbell');
    expect(d.entities.find((e) => e.id === 'sensor.yaml_only')?.name).toBe('Yaml only');
    expect(d.haVersion).toBe('2026.10.1');
  });
});

describe('connection test', () => {
  const answer = (status: number, body?: unknown) => async () =>
    new Response(body === undefined ? null : JSON.stringify(body), { status });

  it('speaks to a person', async () => {
    expect(await testHaConnection('', 'x')).toMatchObject({ ok: false, message: /address/ });
    expect(await testHaConnection('homeassistant', 'x')).toMatchObject({ message: /http:\/\// });
    expect(await testHaConnection('http://ha:8123', '')).toMatchObject({ message: /token/ });
    expect(await testHaConnection('http://ha:8123', 'bad', answer(401))).toMatchObject({
      ok: false,
      message: /refused the token/,
    });
    expect(await testHaConnection('http://ha:8123', 't', answer(200, { hello: 1 }))).toMatchObject({
      message: /not Home Assistant/,
    });
    expect(
      await testHaConnection(
        'http://ha:8123/',
        't',
        answer(200, { version: '2026.10.2', location_name: 'Home' }),
      ),
    ).toEqual({
      ok: true,
      message: 'Connected to Home Assistant 2026.10.2 ("Home").',
      version: '2026.10.2',
      locationName: 'Home',
    });
    const refused = async () => {
      throw Object.assign(new Error('connect ECONNREFUSED'), { name: 'TypeError' });
    };
    expect(await testHaConnection('http://ha:8123', 't', refused)).toMatchObject({
      ok: false,
      message: /Could not reach http:\/\/ha:8123/,
    });
  });
});

describe('realHome', () => {
  let ha: FakeHa;
  let events: WsEventInput[];
  let ctx: ProviderContext;
  let home: RealHome | null = null;
  let haEnabled = true;

  beforeEach(async () => {
    ha = new FakeHa();
    ha.registry = {
      areas: [{ area_id: 'living_room', name: 'Living Room' }],
      devices: [],
      entities: [
        {
          entity_id: 'light.living_room_lamp',
          area_id: 'living_room',
          device_id: null,
          platform: 'hue',
          hidden_by: null,
          disabled_by: null,
          entity_category: null,
        },
      ],
    };
    ha.set('light.living_room_lamp', 'on', { friendly_name: 'Living Room Lamp' });
    await ha.listen();
    events = [];
    haEnabled = true;
    home = null;
    ctx = {
      db: openDb(':memory:'),
      emit: (e: WsEventInput) => events.push(e),
      now: () => new Date(),
      markSynced: () => {},
      settings: () => {
        const s = fixtureSettings();
        return { ...s, integrations: { ...s.integrations, homeassistant: { enabled: haEnabled } } };
      },
    } as unknown as ProviderContext;
  });

  afterEach(async () => {
    home?.stop();
    await ha.close();
  });

  it('connects with the address and token it is given, serves discovery, and applies the picker live', async () => {
    home = realHome(ctx, {
      HA_URL: ha.url,
      HA_TOKEN: TOKEN,
      HA_ALLOWLIST: './nope.yaml',
      HA_STREAM_MAX_SECONDS: 5,
    });
    await home.setup.ready(4000);
    const status = home.setup.connection();
    expect(status).toMatchObject({ state: 'connected', source: 'env', hasToken: true });
    expect(status.url).toBe(ha.url);

    const found = await home.setup.discover();
    expect(found.areas).toEqual([{ id: 'living_room', name: 'Living Room' }]);
    expect(found.entities.map((e) => e.id)).toEqual(['light.living_room_lamp']);

    expect((await home.state()).areas).toEqual([]);
    home.setup.putConfig({
      areas: [{ id: 'living', name: 'Living room', ha_area: 'living_room' }],
    });
    expect(events.some((e) => e.type === 'display.reload')).toBe(true);
    const state = await home.state();
    expect(state.areas).toEqual([
      { id: 'living', name: 'Living room', entityIds: ['light.living_room_lamp'] },
    ]);
    expect(state.entities[0]).toMatchObject({ name: 'Lamp', state: 'on' });
    expect(home.setup.exportYaml()).toContain('ha_area: living_room');
  });

  it('reports a refused token in words, and answers disabled when turned off in settings', async () => {
    home = realHome(ctx, {
      HA_URL: ha.url,
      HA_TOKEN: 'wrong',
      HA_ALLOWLIST: './nope.yaml',
      HA_STREAM_MAX_SECONDS: 5,
    });
    await home.setup.ready(4000);
    const status = home.setup.connection();
    expect(status.state).toBe('error');
    expect(status.summary).toMatch(/refused the token/);

    // The switch is a settings field; the provider reads it on every call.
    haEnabled = false;
    expect(home.setup.connection()).toMatchObject({ state: 'disabled', enabled: false });
    await expect(home.state()).rejects.toMatchObject({ code: 'disabled' });
    await expect(home.setup.discover()).rejects.toMatchObject({ code: 'disabled' });
    // The allow-list is still readable while off.
    expect(home.setup.config().areas).toEqual([]);
  });

  it('serves the setup routes before an address and token exist, naming where values come from', async () => {
    home = realHome(ctx, { HA_ALLOWLIST: './nope.yaml', HA_STREAM_MAX_SECONDS: 5 });
    expect(home.setup.connection()).toMatchObject({ state: 'not_set_up', source: 'none' });
    await expect(home.setup.discover()).rejects.toMatchObject({ code: 'not_implemented' });
    await expect(home.state()).rejects.toMatchObject({ code: 'not_implemented' });
    const env = {
      HA_URL: ha.url,
      HA_TOKEN: TOKEN,
      HA_ALLOWLIST: './nope.yaml',
      HA_STREAM_MAX_SECONDS: 5,
    };
    expect(connectionSource(ctx, env)).toBe('env');
    const withRegistry = {
      ...ctx,
      integration: () => ({
        enabled: true,
        config: {},
        secrets: {},
        sources: { url: 'env' as const, token: 'store' as const },
      }),
    } as ProviderContext;
    expect(connectionSource(withRegistry, env)).toBe('settings');
    await waitFor(() => true, 0);
  });
});

describe('Home Assistant plugin', () => {
  it('keeps the allow-list across rebuilds and serves setup while unconfigured or off', async () => {
    const ha = new FakeHa();
    await ha.listen();
    const events: WsEventInput[] = [];
    const ctx = {
      db: openDb(':memory:'),
      emit: (e: WsEventInput) => events.push(e),
      now: () => new Date(),
      markSynced: () => {},
      settings: () => fixtureSettings(),
    } as unknown as ProviderContext;
    const plugin = homeAssistantPlugin({ env: { HA_ALLOWLIST: './nope.yaml' } });
    try {
      plugin.start(ctx);
      const home = plugin.live.proxy;
      expect(home.setup.connection().state).toBe('not_set_up');
      expect(plugin.status().state).toBe('not_set_up');
      home.setup.putConfig({ areas: [{ id: 'den', name: 'Den' }] });

      plugin.apply({ url: `${ha.url}/` }, { token: TOKEN });
      await home.setup.ready(4000);
      expect(home.setup.connection().state).toBe('connected');
      expect(plugin.status()).toMatchObject({
        state: 'connected',
        summary: `Connected to ${ha.url}`,
      });
      // The rooms picked before connecting are still there.
      expect(home.setup.config().areas.map((a) => a.id)).toEqual(['den']);

      // Turned off: the registry applies nothing; the setup routes still answer.
      plugin.apply({}, {});
      expect(home.setup.connection().state).toBe('not_set_up');
      expect(home.setup.config().areas.map((a) => a.id)).toEqual(['den']);
      expect(ha.connections).toBe(1);

      expect(await plugin.test({ url: ha.url }, { token: 'nope' })).toMatchObject({
        ok: false,
        message: /refused the token/,
      });
    } finally {
      plugin.stop();
      await ha.close();
    }
  });
});
