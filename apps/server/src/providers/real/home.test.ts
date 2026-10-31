import { HomeStateResponse, MediaResponse, type WsEventInput } from '@mantel/shared';
import { settings as fixtureSettings } from '@mantel/shared/fixtures';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../../config.js';
import type { Db } from '../../db/index.js';
import type { ProviderContext } from '../types.js';
import { FakeHa, TOKEN } from './fake-ha.js';
import { HaClient } from './home-client.js';
import { parseHomeConfig, type HomeConfig } from './home-config.js';
import {
  createHomeProvider,
  displayName,
  isRing,
  realHome,
  toPlayer,
  type HomeLive,
} from './home.js';

const allowList = `
areas:
  - id: living
    name: Living room
    ha_area: living_room
    exclude: [light.living_room_hidden_by_us]
    entities:
      - id: binary_sensor.back_door
        name: Back door
  - id: entry
    name: Front door
    entities:
      - lock.front_door
      - { id: cover.garage, read_only: true }
      - climate.main_floor
scenes: [scene.movie]
doorbells:
  - camera: camera.front_door
    trigger: event.front_door_ding
presence:
  - { person: jay, entity: person.jay }
  - { person: sam, entity: person.sam }
alexa:
  targets:
    - { id: media_player.kitchen_echo, name: Kitchen }
`;

const until = async (check: () => boolean, ms = 2000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('Home Assistant provider against a fake HA', () => {
  let ha: FakeHa;
  let client: HaClient;
  let home: HomeLive;
  let events: WsEventInput[];
  let config: HomeConfig;
  let flags = fixtureSettings().flags;

  beforeEach(async () => {
    ha = new FakeHa();
    ha.registry = {
      areas: [{ area_id: 'living_room', name: 'Living Room' }],
      devices: [{ id: 'dev-hue', area_id: 'living_room' }],
      entities: [
        // Area through its device, as Hue bulbs usually are.
        {
          entity_id: 'light.living_room_ceiling',
          area_id: null,
          device_id: 'dev-hue',
          platform: 'hue',
          hidden_by: null,
          disabled_by: null,
          entity_category: null,
        },
        {
          entity_id: 'switch.living_room_plug',
          area_id: 'living_room',
          device_id: null,
          platform: 'meross_lan',
          hidden_by: null,
          disabled_by: null,
          entity_category: null,
        },
        {
          entity_id: 'switch.living_room_plug_led',
          area_id: 'living_room',
          device_id: null,
          platform: 'meross_lan',
          hidden_by: null,
          disabled_by: null,
          entity_category: 'config',
        },
        {
          entity_id: 'light.living_room_hidden_by_us',
          area_id: 'living_room',
          device_id: null,
          platform: 'lutron_caseta',
          hidden_by: null,
          disabled_by: null,
          entity_category: null,
        },
        {
          entity_id: 'sensor.living_room_temperature',
          area_id: 'living_room',
          device_id: null,
          platform: 'ecobee',
          hidden_by: null,
          disabled_by: null,
          entity_category: null,
        },
        {
          entity_id: 'media_player.living_room',
          area_id: 'living_room',
          device_id: null,
          platform: 'apple_tv',
          hidden_by: null,
          disabled_by: null,
          entity_category: null,
        },
      ],
    };
    ha.set('light.living_room_ceiling', 'on', {
      friendly_name: 'Living Room Ceiling',
      brightness: 180,
      supported_color_modes: ['color_temp', 'xy'],
      rgb_color: [1, 2, 3],
    });
    ha.set('switch.living_room_plug', 'off', { friendly_name: 'Living Room Plug' });
    ha.set('light.living_room_hidden_by_us', 'off', { friendly_name: 'Hidden' });
    ha.set('binary_sensor.back_door', 'on', { friendly_name: 'Back Door', device_class: 'door' });
    ha.set('lock.front_door', 'locked', { friendly_name: 'Front Door Lock' });
    ha.set('cover.garage', 'closed', { friendly_name: 'Garage', device_class: 'garage' });
    ha.set('climate.main_floor', 'heat', {
      friendly_name: 'Main Floor',
      current_temperature: 66,
      temperature: 68,
      hvac_modes: ['off', 'heat', 'cool', 'heat_cool'],
    });
    ha.set('scene.movie', '2026-10-30T20:00:00.000000+00:00', { friendly_name: 'Movie' });
    ha.set('camera.front_door', 'idle', { friendly_name: 'Front Door' });
    ha.set('event.front_door_ding', '2026-10-30T10:00:00.000+00:00', { event_type: 'ding' });
    ha.set('person.jay', 'home', { friendly_name: 'Jay' });
    ha.set('person.sam', 'not_home', { friendly_name: 'Sam' });
    ha.set('media_player.living_room', 'playing', {
      friendly_name: 'Living Room',
      app_name: 'Disney+',
      media_series_title: 'Bluey',
      media_season: 3,
      media_episode: 12,
      media_title: 'Sleepytime',
      media_position: 312,
      media_duration: 470,
      media_position_updated_at: '2026-10-31T05:00:00.000000+00:00',
      entity_picture: '/api/media_player_proxy/media_player.living_room?token=abc&cache=1',
    });
    ha.onCall = ({ domain, service, service_data }) => {
      if (domain === 'light' && service === 'turn_on')
        return {
          state: 'on',
          attributes: {
            brightness:
              typeof service_data.brightness_pct === 'number'
                ? Math.round(service_data.brightness_pct * 2.55)
                : 255,
          },
        };
      if (domain === 'switch') return { state: service === 'turn_on' ? 'on' : 'off' };
      if (domain === 'lock') return { state: service === 'unlock' ? 'unlocked' : 'locked' };
      if (domain === 'media_player' && service === 'media_pause') return { state: 'paused' };
      return null;
    };

    const url = await ha.listen();
    config = parseHomeConfig(allowList);
    events = [];
    flags = fixtureSettings().flags;
    const ctx: ProviderContext = {
      config: {} as Config,
      db: {} as Db,
      emit: (e) => events.push(e),
      now: () => new Date(),
      markSynced: () => {},
      settings: () => ({ ...fixtureSettings(), flags }),
    };
    client = new HaClient({ url, token: TOKEN, minBackoffMs: 20 });
    home = createHomeProvider(ctx, client, () => config, 5);
    client.start();
    await until(() => client.connected);
  });

  afterEach(async () => {
    client.stop();
    await ha.close();
  });

  it('shows only allow-listed entities, grouped into the configured areas', async () => {
    const state = HomeStateResponse.parse(await home.state());
    expect(state.areas).toEqual([
      {
        id: 'living',
        name: 'Living room',
        entityIds: [
          'binary_sensor.back_door',
          'light.living_room_ceiling',
          'switch.living_room_plug',
        ],
      },
      {
        id: 'entry',
        name: 'Front door',
        entityIds: ['lock.front_door', 'cover.garage', 'climate.main_floor'],
      },
    ]);
    const ids = state.entities.map((e) => e.id);
    expect(ids).not.toContain('switch.living_room_plug_led'); // config entity
    expect(ids).not.toContain('light.living_room_hidden_by_us'); // excluded
    expect(ids).not.toContain('sensor.living_room_temperature'); // sensors only when listed
    expect(ids).toContain('scene.movie');
    expect(ids).toContain('camera.front_door');

    const ceiling = state.entities.find((e) => e.id === 'light.living_room_ceiling')!;
    expect(ceiling).toMatchObject({ kind: 'light', name: 'Ceiling', state: 'on' });
    expect(ceiling.attrs).toEqual({ brightness: 180, supported_color_modes: ['color_temp', 'xy'] });
    const thermostat = state.entities.find((e) => e.id === 'climate.main_floor')!;
    expect(thermostat.attrs.unit_of_measurement).toBe('°F');
    expect(state.entities.find((e) => e.id === 'scene.movie')!.lastChanged).toBe(
      '2026-10-30T20:00:00.000000+00:00',
    );
    expect(state.entities.find((e) => e.id === 'camera.front_door')!.attrs.doorbell).toBe(true);
    expect(state.presence.map((p) => [p.personId, p.home])).toEqual([
      ['jay', true],
      ['sam', false],
    ]);
    expect(state.announceTargets).toEqual([{ id: 'media_player.kitchen_echo', name: 'Kitchen' }]);
  });

  it('calls services on allowed entities and returns the new state', async () => {
    const res = await home.call({
      entityId: 'light.living_room_ceiling',
      service: 'turn_on',
      data: { brightness_pct: 40 },
    });
    expect(ha.calls.at(-1)).toMatchObject({
      domain: 'light',
      service: 'turn_on',
      service_data: { brightness_pct: 40 },
      target: { entity_id: 'light.living_room_ceiling' },
    });
    expect(res.entity?.attrs.brightness).toBe(102);
    await until(() =>
      events.some(
        (e) => e.type === 'home.state' && e.payload.entity.id === 'light.living_room_ceiling',
      ),
    );
  });

  it('refuses entities, services and data outside the allow-list', async () => {
    await expect(
      home.call({ entityId: 'light.living_room_hidden_by_us', service: 'turn_on' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      home.call({ entityId: 'cover.garage', service: 'open_cover' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      home.call({ entityId: 'lock.front_door', service: 'set_code' }),
    ).rejects.toMatchObject({ code: 'bad_request' });
    await expect(
      home.call({
        entityId: 'switch.living_room_plug',
        service: 'turn_on',
        data: { entity_id: 'lock.front_door' },
      }),
    ).rejects.toMatchObject({ code: 'bad_request' });
    expect(ha.calls).toHaveLength(0);
  });

  it('reports Home Assistant errors as upstream errors', async () => {
    ha.failCalls = 'Unable to reach the bridge';
    await expect(
      home.call({ entityId: 'switch.living_room_plug', service: 'turn_on' }),
    ).rejects.toMatchObject({ code: 'upstream_error', message: expect.stringContaining('bridge') });
  });

  it('relays state changes of allowed entities only', async () => {
    ha.set('switch.living_room_plug', 'on');
    ha.set('light.living_room_hidden_by_us', 'on');
    await until(() => events.some((e) => e.type === 'home.state'));
    await new Promise((r) => setTimeout(r, 50));
    const ids = events.flatMap((e) => (e.type === 'home.state' ? [e.payload.entity.id] : []));
    expect(ids).toEqual(['switch.living_room_plug']);
  });

  it('pops the doorbell on a Ring ding, once per press, when the flag is on', async () => {
    ha.set('event.front_door_ding', '2026-10-31T05:01:00.000+00:00', { event_type: 'ding' });
    await until(() => events.some((e) => e.type === 'home.doorbell'));
    expect(events.find((e) => e.type === 'home.doorbell')).toMatchObject({
      payload: { cameraEntityId: 'camera.front_door', durationSeconds: 30 },
    });
    // A second press inside the debounce window is ignored.
    ha.set('event.front_door_ding', '2026-10-31T05:01:05.000+00:00', { event_type: 'ding' });
    await new Promise((r) => setTimeout(r, 50));
    expect(events.filter((e) => e.type === 'home.doorbell')).toHaveLength(1);
  });

  it('stays quiet on the doorbell when the pop-over flag is off', async () => {
    flags = { ...flags, doorbellPopover: false };
    ha.set('event.front_door_ding', '2026-10-31T05:02:00.000+00:00', { event_type: 'ding' });
    await new Promise((r) => setTimeout(r, 80));
    expect(events.filter((e) => e.type === 'home.doorbell')).toHaveLength(0);
  });

  it('sends presence changes, waking on arrival and sleeping when everyone is out', async () => {
    ha.set('person.sam', 'home');
    await until(() => events.some((e) => e.type === 'display.wake'));
    ha.set('person.sam', 'not_home');
    ha.set('person.jay', 'not_home');
    await until(() => events.some((e) => e.type === 'display.sleep'));
    const last = events.filter((e) => e.type === 'home.presence').at(-1);
    expect(last).toMatchObject({
      payload: {
        presence: [
          { personId: 'jay', home: false },
          { personId: 'sam', home: false },
        ],
      },
    });
  });

  it('maps the Apple TV to now playing and drives it', async () => {
    const { players } = MediaResponse.parse(await home.media());
    expect(players).toEqual([
      expect.objectContaining({
        id: 'media_player.living_room',
        state: 'playing',
        app: 'Disney+',
        title: 'Bluey',
        artist: 'Season 3 · Episode 12',
        positionSeconds: 312,
        durationSeconds: 470,
        artworkUrl: expect.stringMatching(/^\/api\/media\/media_player\.living_room\/artwork\?v=/),
      }),
    ]);
    const res = await home.mediaCall({ playerId: 'media_player.living_room', action: 'pause' });
    expect(ha.calls.at(-1)).toMatchObject({ domain: 'media_player', service: 'media_pause' });
    expect(res.player.state).toBe('paused');
    const art = await home.mediaArtwork('media_player.living_room');
    expect(art?.contentType).toBe('image/png');
  });

  it('proxies camera snapshots and live streams for allowed cameras', async () => {
    const snap = await home.cameraSnapshot('camera.front_door');
    expect(new TextDecoder().decode(snap!.body as Uint8Array)).toBe('jpeg:camera.front_door');
    expect(await home.cameraSnapshot('camera.not_allowed')).toBeNull();

    const abort = new AbortController();
    const live = await home.cameraStream('camera.front_door', abort.signal);
    expect(live?.contentType).toContain('multipart/x-mixed-replace');
    const reader = (live!.body as ReadableStream<Uint8Array>).getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('frame1');
    abort.abort();
    await expect(
      (async () => {
        for (;;) if ((await reader.read()).done) return;
      })(),
    ).rejects.toThrow();
  });

  it('announces on the configured Echo devices', async () => {
    await home.announce({ message: 'Dinner is ready' });
    expect(ha.calls.at(-1)).toEqual({
      id: expect.any(Number),
      type: 'call_service',
      domain: 'notify',
      service: 'alexa_media',
      service_data: {
        message: 'Dinner is ready',
        target: ['media_player.kitchen_echo'],
        data: { type: 'announce', method: 'all' },
      },
    });
    await expect(
      home.announce({ message: 'hi', targets: ['media_player.office'] }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('reconnects after Home Assistant restarts and pushes what changed meanwhile', async () => {
    const before = ha.connections;
    ha.dropAll();
    await until(() => !client.connected);
    ha.set('switch.living_room_plug', 'on', {}, false);
    await until(() => client.connected && ha.connections > before);
    await until(() =>
      events.some(
        (e) => e.type === 'home.state' && e.payload.entity.id === 'switch.living_room_plug',
      ),
    );
    expect(
      (await home.state()).entities.find((e) => e.id === 'switch.living_room_plug')?.state,
    ).toBe('on');
  });

  it('reconnects when pings go unanswered', async () => {
    client.stop();
    const fast = new HaClient({
      url: ha.url,
      token: TOKEN,
      pingMs: 30,
      minBackoffMs: 20,
      commandTimeoutMs: 100,
    });
    fast.start();
    await until(() => fast.connected);
    const before = ha.connections;
    ha.answerPings = false;
    await until(() => ha.connections > before);
    fast.stop();
  });
});

describe('Home Assistant helpers', () => {
  it('drops the area name from friendly names', () => {
    expect(displayName('Living Room Ceiling', 'Living room')).toBe('Ceiling');
    expect(displayName('Living Room', 'Living room')).toBe('Living Room');
    expect(displayName('Ceiling', 'Kitchen')).toBe('Ceiling');
  });

  it('knows what counts as a ring', () => {
    const s = (state: string, event_type?: string) => ({
      entity_id: 'x',
      state,
      attributes: event_type ? { event_type } : {},
      last_changed: '',
      last_updated: '',
    });
    expect(isRing('binary_sensor.ding', undefined, s('on'), s('off'))).toBe(true);
    expect(isRing('binary_sensor.ding', undefined, s('off'), s('on'))).toBe(false);
    expect(isRing('event.ding', undefined, s('t2', 'ding'), s('t1', 'ding'))).toBe(true);
    expect(isRing('event.ding', ['ding'], s('t2', 'motion'), s('t1', 'ding'))).toBe(false);
    expect(isRing('event.ding', undefined, s('t2', 'ding'), s('unavailable'))).toBe(false);
    expect(isRing('event.ding', undefined, s('unavailable'), s('t1'))).toBe(false);
  });

  it('leaves now-playing details off when nothing is playing', () => {
    const p = toPlayer(
      { id: 'media_player.bedroom' },
      {
        entity_id: 'media_player.bedroom',
        state: 'standby',
        attributes: { friendly_name: 'Bedroom', media_title: 'Old' },
        last_changed: '2026-10-31T05:00:00+00:00',
        last_updated: '2026-10-31T05:00:00+00:00',
      },
    );
    expect(p).toEqual({
      id: 'media_player.bedroom',
      name: 'Bedroom',
      state: 'standby',
      updatedAt: '2026-10-31T05:00:00+00:00',
    });
  });

  it('rejects a malformed allow-list with a readable message', () => {
    expect(() => parseHomeConfig('areas:\n  - id: x\n    entities: [Kitchen Light]')).toThrow(
      /areas\.0\.name|entity id/,
    );
  });

  it('answers 501 until an address and token are saved or set in the environment', async () => {
    const { openDb } = await import('../../db/index.js');
    const ctx = {
      db: openDb(':memory:'),
      emit: () => {},
      settings: () => fixtureSettings(),
    } as unknown as ProviderContext;
    const off = realHome(ctx, { HA_ALLOWLIST: './nope.yaml', HA_STREAM_MAX_SECONDS: 120 });
    await expect(off.state()).rejects.toMatchObject({ code: 'not_implemented' });
    expect(off.setup.connection()).toMatchObject({ state: 'not_set_up', source: 'none' });
  });
});

describe('config/home.example.yaml', () => {
  it('parses', async () => {
    const { readFileSync } = await import('node:fs');
    const text = readFileSync(
      new URL('../../../../../config/home.example.yaml', import.meta.url),
      'utf8',
    );
    const cfg = parseHomeConfig(text);
    expect(cfg.areas.length).toBeGreaterThan(3);
    expect(cfg.doorbells[0]?.seconds).toBe(30);
  });
});
