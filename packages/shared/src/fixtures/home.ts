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

/** Mockup Home screen: four rooms of lights, thermostat, front door, sensors, scenes and Ring cameras. */
export function homeState(now: Date): {
  areas: HomeArea[];
  entities: HomeEntity[];
  presence: Presence[];
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
  ];
  const entities = base.map((e) => ({ lastChanged: minsAgo(30), ...e }));
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
  return { areas, entities, presence };
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
      updatedAt: now.toISOString(),
    },
    { id: 'media_player.bedroom_apple_tv', name: 'Bedroom Apple TV', state: 'standby' },
  ];
}
