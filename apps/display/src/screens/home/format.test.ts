import type { HomeEntity } from '@mantel/shared';
import { people } from '@mantel/shared/fixtures';
import { describe, expect, it } from 'vitest';
import { activeScene, dimmable, presenceLines, sensorValue } from './format';

const now = new Date(2026, 9, 31, 15, 0);
const minsAgo = (m: number) => new Date(now.getTime() - m * 60e3).toISOString();
const sensor = (id: string, state: string, attrs: Record<string, unknown> = {}, ago = 12) =>
  ({ id, kind: 'sensor', name: id, state, attrs, lastChanged: minsAgo(ago) }) as HomeEntity;

describe('sensorValue', () => {
  it('reads doors, motion, numbers and words the way the mockup does', () => {
    expect(sensorValue(sensor('binary_sensor.back', 'on', { device_class: 'door' }), now)).toEqual({
      text: 'Open 12 min',
      warn: true,
    });
    expect(
      sensorValue(sensor('binary_sensor.back', 'off', { device_class: 'door' }), now).text,
    ).toBe('Closed');
    expect(
      sensorValue(sensor('binary_sensor.hall', 'off', { device_class: 'motion' }, 2), now).text,
    ).toBe('2 min ago');
    expect(sensorValue(sensor('sensor.t', '66.4', { unit_of_measurement: '°F' }), now).text).toBe(
      '66°',
    );
    expect(sensorValue(sensor('sensor.h', '41', { unit_of_measurement: '%' }), now).text).toBe(
      '41%',
    );
    expect(sensorValue(sensor('sensor.p', '1.25', { unit_of_measurement: 'kW' }), now).text).toBe(
      '1.3 kW',
    );
    expect(sensorValue(sensor('sensor.vac', 'returning_home'), now).text).toBe('Returning home');
    expect(sensorValue(sensor('sensor.vac', 'unavailable'), now).text).toBe('Unavailable');
    expect(
      sensorValue(sensor('binary_sensor.leak', 'on', { device_class: 'moisture' }), now),
    ).toEqual({ text: 'Wet', warn: true });
  });
});

describe('presenceLines', () => {
  it('names who is home and when the others left', () => {
    const lines = presenceLines(
      [
        { personId: 'jay', home: true },
        { personId: 'ava', home: true },
        { personId: 'sam', home: false, since: new Date(2026, 9, 31, 8, 12).toISOString() },
        { personId: 'leo', home: false, since: new Date(2026, 9, 30, 8, 0).toISOString() },
      ],
      people,
      now,
    );
    expect(lines).toEqual({
      headline: 'Jay and Ava are home',
      detail: 'Sam left 8:12 am · Leo is out',
    });
    expect(presenceLines([{ personId: 'jay', home: false }], people, now).headline).toBe(
      'Nobody is home',
    );
  });
});

describe('activeScene', () => {
  const scene = (id: string, ago: number) =>
    ({
      id,
      kind: 'scene',
      name: id,
      state: '',
      attrs: {},
      lastChanged: minsAgo(ago),
    }) as HomeEntity;
  it('is the most recent scene within 12 hours, and nothing on a tie', () => {
    expect(activeScene([scene('a', 30), scene('b', 20)], now)).toBe('b');
    expect(activeScene([scene('a', 30), scene('b', 30)], now)).toBeNull();
    expect(activeScene([scene('a', 13 * 60)], now)).toBeNull();
  });
});

describe('dimmable', () => {
  it('hides the slider for on/off-only lights', () => {
    const light = (modes: string[]) =>
      ({
        id: 'light.x',
        kind: 'light',
        name: 'x',
        state: 'on',
        attrs: { supported_color_modes: modes },
      }) as HomeEntity;
    expect(dimmable(light(['onoff']))).toBe(false);
    expect(dimmable(light(['brightness']))).toBe(true);
    expect(dimmable(light(['color_temp', 'xy']))).toBe(true);
  });
});
