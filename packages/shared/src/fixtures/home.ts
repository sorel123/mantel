import type { AnnounceTarget } from '../api.js';
import {
  HOME_DOMAIN_KIND,
  type DiscoveredEntity,
  type HomeConfig,
  type HomeConnectionStatus,
  type HomeDiscovery,
} from '../home-setup.js';
import type { HomeArea, HomeEntity, MediaPlayer, Presence } from '../models.js';
import { toLocalIso } from '../time.js';

const bri = (pct: number) => Math.round((pct / 100) * 255);
const light = (id: string, name: string, on: boolean, pct: number): HomeEntity => ({
  id: `light.${id}`,
  kind: 'light',
  name,
  state: on ? 'on' : 'off',
  attrs: { brightness: on ? bri(pct) : null, supported_color_modes: ['brightness'] },
});
const sensor = (
  id: string,
  name: string,
  state: string,
  attrs: Record<string, unknown> = {},
): HomeEntity => ({
  id,
  kind: 'sensor',
  name,
  state,
  attrs,
});

/**
 * Mockup Home screen: four rooms of lights, three ecobee thermostats, front door, sensors,
 * scenes, Meross plugs and Ring cameras.
 */
export function homeState(now: Date): {
  areas: HomeArea[];
  entities: HomeEntity[];
  presence: Presence[];
  announceTargets: AnnounceTarget[];
} {
  const minsAgo = (m: number) => toLocalIso(new Date(now.getTime() - m * 60e3));
  const base: HomeEntity[] = [
    light('living_room_ceiling', 'Ceiling', true, 70),
    light('living_room_lamp', 'Lamp', true, 40),
    light('kitchen_counter', 'Counter', true, 100),
    light('kitchen_island', 'Island', false, 60),
    light('bedroom_bedside', 'Bedside', false, 30),
    light('bedroom_closet', 'Closet', false, 80),
    light('ava_lamp', "Ava's lamp", true, 55),
    light('leo_lamp', "Leo's lamp", false, 50),
    {
      id: 'climate.main_floor',
      kind: 'climate',
      name: 'Thermostat',
      state: 'heat',
      attrs: {
        current_temperature: 66,
        temperature: 68,
        min_temp: 55,
        max_temp: 80,
        hvac_action: 'heating',
        unit_of_measurement: '°F',
      },
    },
    {
      id: 'lock.front_door',
      kind: 'lock',
      name: 'Front door',
      state: 'locked',
      attrs: {},
      lastChanged: toLocalIso(new Date(new Date(now).setHours(8, 12, 0, 0))),
    },
    {
      id: 'cover.garage_door',
      kind: 'cover',
      name: 'Garage door',
      state: 'closed',
      attrs: { device_class: 'garage' },
    },
    sensor('binary_sensor.back_door', 'Back door', 'on', { device_class: 'door' }),
    sensor('binary_sensor.hallway_motion', 'Hallway motion', 'off', { device_class: 'motion' }),
    sensor('sensor.laundry', 'Laundry', 'done'),
    sensor('sensor.indoor_temperature', 'Indoor', '66', {
      unit_of_measurement: '°F',
      device_class: 'temperature',
    }),
    sensor('sensor.indoor_humidity', 'Indoor humidity', '41', {
      unit_of_measurement: '%',
      device_class: 'humidity',
    }),
    sensor('sensor.robot_vac', 'Robot vac', 'docked'),
    sensor('sensor.ev_battery', 'EV charge', '84', {
      unit_of_measurement: '%',
      device_class: 'battery',
    }),
    { id: 'switch.porch_light', kind: 'switch', name: 'Porch light', state: 'off', attrs: {} },
    { id: 'switch.sprinklers', kind: 'switch', name: 'Sprinklers', state: 'off', attrs: {} },
    {
      id: 'scene.morning',
      kind: 'scene',
      name: 'Morning',
      state: 'scening',
      attrs: { icon: 'sun' },
    },
    { id: 'scene.focus', kind: 'scene', name: 'Focus', state: 'scening', attrs: { icon: 'cloud' } },
    { id: 'scene.movie', kind: 'scene', name: 'Movie', state: 'scening', attrs: { icon: 'moon' } },
    {
      id: 'scene.goodnight',
      kind: 'scene',
      name: 'Goodnight',
      state: 'scening',
      attrs: { icon: 'moon' },
    },
    {
      id: 'camera.front_door',
      kind: 'camera',
      name: 'Front door',
      state: 'idle',
      attrs: { doorbell: true, brand: 'Ring' },
    },
    {
      id: 'camera.driveway',
      kind: 'camera',
      name: 'Driveway',
      state: 'idle',
      attrs: { brand: 'Ring' },
    },
    {
      id: 'camera.backyard',
      kind: 'camera',
      name: 'Backyard',
      state: 'idle',
      attrs: { brand: 'Ring' },
    },
    {
      id: 'climate.upstairs',
      kind: 'climate',
      name: 'Upstairs',
      state: 'heat',
      attrs: {
        current_temperature: 67,
        temperature: 67,
        min_temp: 55,
        max_temp: 80,
        hvac_action: 'idle',
        hvac_modes: ['off', 'heat', 'cool', 'heat_cool'],
        unit_of_measurement: '°F',
      },
    },
    {
      id: 'climate.basement',
      kind: 'climate',
      name: 'Basement',
      state: 'heat_cool',
      attrs: {
        current_temperature: 64,
        temperature: null,
        target_temp_low: 63,
        target_temp_high: 75,
        min_temp: 55,
        max_temp: 80,
        hvac_action: 'idle',
        hvac_modes: ['off', 'heat', 'cool', 'heat_cool'],
        unit_of_measurement: '°F',
      },
    },
    { id: 'switch.living_room_tree', kind: 'switch', name: 'Tree lights', state: 'on', attrs: {} },
    { id: 'switch.kitchen_kettle', kind: 'switch', name: 'Kettle', state: 'off', attrs: {} },
  ];
  const entities = base.map((e) => ({ lastChanged: minsAgo(30), ...e }));
  const thermostat = entities.find((e) => e.id === 'climate.main_floor')!;
  thermostat.attrs.hvac_modes = ['off', 'heat', 'cool', 'heat_cool'];
  thermostat.name = 'Main floor';
  // Morning ran most recently, so its chip shows as on.
  entities.find((e) => e.id === 'scene.morning')!.lastChanged = minsAgo(20);
  entities.find((e) => e.id === 'binary_sensor.back_door')!.lastChanged = minsAgo(12);
  entities.find((e) => e.id === 'binary_sensor.hallway_motion')!.lastChanged = minsAgo(2);

  const ids = (prefix: string) => entities.filter((e) => e.id.includes(prefix)).map((e) => e.id);
  const areas: HomeArea[] = [
    { id: 'living_room', name: 'Living room', entityIds: ids('living_room') },
    { id: 'kitchen', name: 'Kitchen', entityIds: ids('kitchen') },
    { id: 'bedroom', name: 'Bedroom', entityIds: ids('bedroom') },
    { id: 'kids', name: 'Kids', entityIds: ['light.ava_lamp', 'light.leo_lamp'] },
    {
      id: 'entry',
      name: 'Front door',
      entityIds: ['lock.front_door', 'binary_sensor.back_door', 'camera.front_door'],
    },
    {
      id: 'house',
      name: 'Around the house',
      entityIds: [
        'climate.main_floor',
        'climate.upstairs',
        'climate.basement',
        'binary_sensor.hallway_motion',
        'sensor.laundry',
        'sensor.indoor_temperature',
        'sensor.indoor_humidity',
        'sensor.robot_vac',
      ],
    },
    {
      id: 'outside',
      name: 'Garage and outside',
      entityIds: [
        'cover.garage_door',
        'switch.porch_light',
        'switch.sprinklers',
        'sensor.ev_battery',
        'camera.driveway',
        'camera.backyard',
      ],
    },
  ];
  const presence: Presence[] = [
    { personId: 'jay', home: true, since: minsAgo(240) },
    { personId: 'ava', home: true, since: minsAgo(90) },
    { personId: 'sam', home: false, since: minsAgo(45) },
    { personId: 'leo', home: false, since: minsAgo(45) },
  ];
  const announceTargets: AnnounceTarget[] = [
    { id: 'media_player.kitchen_echo', name: 'Kitchen' },
    { id: 'media_player.kids_room_echo', name: 'Kids room' },
    { id: 'media_player.basement_echo', name: 'Basement' },
  ];
  return { areas, entities, presence, announceTargets };
}

export function mediaPlayers(now: Date): MediaPlayer[] {
  return [
    {
      id: 'media_player.living_room_apple_tv',
      name: 'Living room Apple TV',
      state: 'playing',
      app: 'Disney+',
      title: 'Bluey',
      artist: 'Season 3 · Episode 12',
      positionSeconds: 312,
      durationSeconds: 470,
      artworkUrl: '/api/media/media_player.living_room_apple_tv/artwork',
      updatedAt: now.toISOString(),
    },
    { id: 'media_player.bedroom_apple_tv', name: 'Bedroom Apple TV', state: 'standby' },
  ];
}

/**
 * What the mock Home Assistant "has": every entity of the Home screen, each in its HA area, plus
 * the things a real install turns up that the picker must cope with: an unassigned lamp, a
 * doorbell event, person entities, Echos and the Apple TVs.
 */
export function homeDiscovery(now: Date): HomeDiscovery {
  const home = homeState(now);
  const areaOf = new Map<string, string>();
  for (const a of home.areas) for (const id of a.entityIds) areaOf.set(id, a.id);
  const fromScreen: DiscoveredEntity[] = home.entities.map((e) => ({
    id: e.id,
    domain: e.id.split('.')[0]!,
    kind: e.kind,
    name: e.name,
    areaId: areaOf.get(e.id) ?? null,
    state: e.state,
    ...(typeof e.attrs.device_class === 'string' ? { deviceClass: e.attrs.device_class } : {}),
    platform: e.id.startsWith('camera.')
      ? 'ring'
      : e.id.startsWith('climate.')
        ? 'ecobee'
        : e.id.startsWith('light.')
          ? 'hue'
          : 'mock',
  }));
  const extra: DiscoveredEntity[] = [
    {
      id: 'light.office_desk',
      domain: 'light',
      kind: 'light',
      name: 'Office desk',
      areaId: null,
      state: 'off',
      platform: 'hue',
    },
    {
      id: 'switch.living_room_plug_led',
      domain: 'switch',
      kind: 'switch',
      name: 'Plug LED',
      areaId: 'living_room',
      state: 'on',
      platform: 'meross_lan',
    },
    {
      id: 'sensor.garage_temperature',
      domain: 'sensor',
      kind: 'sensor',
      name: 'Garage temperature',
      areaId: 'outside',
      state: '52',
      deviceClass: 'temperature',
      platform: 'mock',
    },
    {
      id: 'event.front_door_ding',
      domain: 'event',
      name: 'Front door Ding',
      areaId: 'entry',
      state: now.toISOString(),
      deviceClass: 'doorbell',
      platform: 'ring',
    },
    {
      id: 'event.front_door_motion',
      domain: 'event',
      name: 'Front door Motion',
      areaId: 'entry',
      state: now.toISOString(),
      deviceClass: 'motion',
      platform: 'ring',
    },
    {
      id: 'binary_sensor.driveway_motion',
      domain: 'binary_sensor',
      kind: 'sensor',
      name: 'Driveway motion',
      areaId: 'outside',
      state: 'off',
      deviceClass: 'motion',
      platform: 'ring',
    },
    {
      id: 'person.jay',
      domain: 'person',
      name: 'Jay',
      areaId: null,
      state: 'home',
      platform: 'person',
    },
    {
      id: 'person.sam',
      domain: 'person',
      name: 'Sam',
      areaId: null,
      state: 'not_home',
      platform: 'person',
    },
    {
      id: 'person.ava',
      domain: 'person',
      name: 'Ava',
      areaId: null,
      state: 'home',
      platform: 'person',
    },
    {
      id: 'person.leo',
      domain: 'person',
      name: 'Leo',
      areaId: null,
      state: 'not_home',
      platform: 'person',
    },
    {
      id: 'media_player.living_room_apple_tv',
      domain: 'media_player',
      name: 'Living room Apple TV',
      areaId: 'living_room',
      state: 'playing',
      platform: 'apple_tv',
    },
    {
      id: 'media_player.bedroom_apple_tv',
      domain: 'media_player',
      name: 'Bedroom Apple TV',
      areaId: 'bedroom',
      state: 'standby',
      platform: 'apple_tv',
    },
    {
      id: 'media_player.kitchen_echo',
      domain: 'media_player',
      name: 'Kitchen Echo',
      areaId: 'kitchen',
      state: 'idle',
      platform: 'alexa_media',
    },
    {
      id: 'media_player.kids_room_echo',
      domain: 'media_player',
      name: 'Kids room Echo',
      areaId: 'kids',
      state: 'idle',
      platform: 'alexa_media',
    },
    {
      id: 'media_player.basement_echo',
      domain: 'media_player',
      name: 'Basement Echo',
      areaId: null,
      state: 'idle',
      platform: 'alexa_media',
    },
  ];
  return {
    areas: home.areas.map((a) => ({ id: a.id, name: a.name })),
    entities: [...fromScreen, ...extra],
    haVersion: '2026.10.2',
    temperatureUnit: '°F',
  };
}

/**
 * The stored allow-list that reproduces the mock Home screen exactly: one room per fixture area
 * pulling its area in, sensors listed by hand (they are never pulled in automatically), the
 * garage read-only, the four scenes, the Ring doorbell and presence for everyone.
 */
export function homeConfig(now: Date): HomeConfig {
  const home = homeState(now);
  const kinds = new Map(home.entities.map((e) => [e.id, e.kind]));
  const areas = home.areas.map((a) => {
    const entities = a.entityIds
      .filter((id) => {
        const domain = id.split('.')[0]!;
        return !HOME_DOMAIN_KIND[domain] || kinds.get(id) === 'sensor';
      })
      .map((id) => ({ id }));
    return {
      id: a.id,
      name: a.name,
      ha_area: a.id,
      domains: ['light', 'switch', 'fan', 'input_boolean', 'climate', 'lock', 'cover', 'camera'],
      entities:
        a.id === 'outside' ? [...entities, { id: 'cover.garage_door', read_only: true }] : entities,
      exclude: a.id === 'living_room' ? ['switch.living_room_plug_led'] : [],
    };
  });
  return {
    areas,
    scenes: home.entities.filter((e) => e.kind === 'scene').map((e) => ({ id: e.id })),
    doorbells: [
      {
        camera: 'camera.front_door',
        trigger: 'event.front_door_ding',
        event_types: ['ding'],
        seconds: 30,
      },
    ],
    presence: home.presence.map((p) => ({ person: p.personId, entity: `person.${p.personId}` })),
    presence_display: { wake_on_arrival: true, sleep_when_away: true },
    alexa: {
      service: 'notify.alexa_media',
      targets: home.announceTargets.map((t) => ({ id: t.id, name: t.name })),
    },
  };
}

export function homeConnection(now: Date): HomeConnectionStatus {
  return {
    enabled: true,
    url: 'http://homeassistant.local:8123',
    hasToken: true,
    source: 'settings',
    state: 'connected',
    summary: 'Connected to Home Assistant 2026.10.2 (61 entities).',
    lastOkAt: toLocalIso(now),
    entityCount: 61,
  };
}
