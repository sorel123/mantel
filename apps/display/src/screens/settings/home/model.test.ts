import { HomeConfig, type DiscoveredEntity } from '@mantel/shared';
import { homeConfig, homeDiscovery } from '@mantel/shared/fixtures';
import { describe, expect, it } from 'vitest';
import {
  addCustomRoom,
  entityIncluded,
  moveRoom,
  patchDoorbell,
  patchEntity,
  presenceEntity,
  roomEntities,
  roomRows,
  setEntity,
  setPresence,
  setRoom,
  setScene,
  triggerCandidates,
} from './model';

const now = new Date();
const discovery = homeDiscovery(now);
const config = homeConfig(now);
const living = discovery.areas.find((a) => a.id === 'living_room')!;
const find = (id: string): DiscoveredEntity => discovery.entities.find((e) => e.id === id)!;

describe('room rows', () => {
  it('lists configured rooms in order, then the HA areas not shown yet', () => {
    const rows = roomRows(config, discovery);
    expect(rows.slice(0, config.areas.length).map((r) => r.on)).not.toContain(false);
    const empty = HomeConfig.parse({});
    const fresh = roomRows(empty, discovery);
    expect(fresh.every((r) => !r.on)).toBe(true);
    expect(fresh.map((r) => r.name)).toContain('Kitchen');
  });

  it('turns an HA area into a room and back', () => {
    const on = setRoom(HomeConfig.parse({}), living, true);
    expect(on.areas).toEqual([
      expect.objectContaining({ id: 'living_room', name: 'Living room', ha_area: 'living_room' }),
    ]);
    expect(setRoom(on, living, false).areas).toEqual([]);
    expect(setRoom(on, living, true)).toBe(on);
  });

  it('adds custom rooms with unique ids and moves rooms', () => {
    const a = addCustomRoom(addCustomRoom(HomeConfig.parse({}), 'Kids'), 'Kids');
    expect(a.areas.map((r) => r.id)).toEqual(['kids', 'kids_2']);
    expect(moveRoom(a, 1, 0).areas.map((r) => r.id)).toEqual(['kids_2', 'kids']);
    expect(moveRoom(a, 1, 5)).toBe(a);
  });
});

describe('entities in a room', () => {
  const room = config.areas.find((a) => a.id === 'living_room')!;

  it('offers what the HA area has, plus listed extras, sensors last', () => {
    const ids = roomEntities(room, discovery, living).map((e) => e.id);
    expect(ids).toContain('light.living_room_ceiling');
    expect(ids).toContain('switch.living_room_plug_led'); // excluded, but offered to tick back
    expect(ids).not.toContain('media_player.living_room_apple_tv'); // not showable
    expect(entityIncluded(room, find('switch.living_room_plug_led'), living)).toBe(false);
    expect(entityIncluded(room, find('light.living_room_ceiling'), living)).toBe(true);
  });

  it('ticks an auto-included entity off through exclude, and back on', () => {
    const lamp = find('light.living_room_lamp');
    const off = setEntity(config, 'living_room', lamp, false, living);
    const r = off.areas.find((a) => a.id === 'living_room')!;
    expect(r.exclude).toContain('light.living_room_lamp');
    expect(entityIncluded(r, lamp, living)).toBe(false);
    const on = setEntity(off, 'living_room', lamp, true, living);
    expect(on.areas.find((a) => a.id === 'living_room')!.exclude).not.toContain(
      'light.living_room_lamp',
    );
  });

  it('lists a sensor by hand and drops it again', () => {
    const temp = find('sensor.garage_temperature');
    const empty = setRoom(
      HomeConfig.parse({}),
      discovery.areas.find((a) => a.id === 'outside')!,
      true,
    );
    const outside = discovery.areas.find((a) => a.id === 'outside')!;
    expect(entityIncluded(empty.areas[0]!, temp, outside)).toBe(false);
    const on = setEntity(empty, 'outside', temp, true, outside);
    expect(on.areas[0]!.entities).toEqual([{ id: 'sensor.garage_temperature' }]);
    expect(setEntity(on, 'outside', temp, false, outside).areas[0]!.entities).toEqual([]);
  });

  it('keeps a rename and read-only on a listed ref, and removes the ref when both are cleared', () => {
    const lamp = find('light.living_room_lamp');
    const renamed = patchEntity(config, 'living_room', lamp, { name: 'Reading lamp' }, living);
    const ref = () =>
      renamed.areas.find((a) => a.id === 'living_room')!.entities.find((r) => r.id === lamp.id);
    expect(ref()).toEqual({ id: 'light.living_room_lamp', name: 'Reading lamp' });
    const ro = patchEntity(renamed, 'living_room', lamp, { read_only: true }, living);
    expect(ro.areas[0]!.entities.find((r) => r.id === lamp.id)).toEqual({
      id: 'light.living_room_lamp',
      name: 'Reading lamp',
      read_only: true,
    });
    const cleared = patchEntity(
      patchEntity(ro, 'living_room', lamp, { read_only: false }, living),
      'living_room',
      lamp,
      { name: '' },
      living,
    );
    expect(cleared.areas[0]!.entities.some((r) => r.id === lamp.id)).toBe(false);
    // Still shown: it is pulled in by the area.
    expect(entityIncluded(cleared.areas[0]!, lamp, living)).toBe(true);
  });
});

describe('scenes, doorbell and presence', () => {
  it('toggles scenes', () => {
    const off = setScene(config, 'scene.movie', false);
    expect(off.scenes.map((s) => s.id)).not.toContain('scene.movie');
    expect(setScene(off, 'scene.movie', true).scenes.at(-1)).toEqual({ id: 'scene.movie' });
  });

  it('offers doorbell triggers with Ring dings first', () => {
    const ids = triggerCandidates(discovery).map((e) => e.id);
    expect(ids[0]).toBe('event.front_door_ding');
    expect(ids).toContain('binary_sensor.driveway_motion');
    expect(ids).not.toContain('camera.front_door');
    const patched = patchDoorbell(config, 0, { seconds: 45 });
    expect(patched.doorbells[0]!.seconds).toBe(45);
  });

  it('maps people to person entities, automatic by default', () => {
    const auto = HomeConfig.parse({});
    expect(presenceEntity(auto, 'jay', discovery)).toBe('person.jay');
    expect(presenceEntity(auto, 'nobody', discovery)).toBeNull();
    const set = setPresence(auto, ['jay', 'sam'], 'sam', 'person.ava', discovery);
    expect(set.presence).toEqual([
      { person: 'jay', entity: 'person.jay' },
      { person: 'sam', entity: 'person.ava' },
    ]);
    expect(setPresence(set, ['jay', 'sam'], 'jay', null, discovery).presence).toEqual([
      { person: 'sam', entity: 'person.ava' },
    ]);
  });
});
