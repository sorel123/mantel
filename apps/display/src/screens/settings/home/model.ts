/**
 * Pure edits to the Home Assistant allow-list for the picker. The config keeps the shape
 * `home.yaml` has (rooms pull an HA area in, with excludes and listed extras), so these helpers
 * turn "tick this entity in this room" into the right combination of `ha_area`, `exclude` and
 * `entities`, and the server's `resolveView` needs no change.
 */
import {
  DEFAULT_AREA_DOMAINS,
  type DiscoveredArea,
  type DiscoveredEntity,
  type DoorbellConfig,
  type HomeAreaConfig,
  type HomeConfig,
  type HomeDiscovery,
  type HomeEntityRef,
} from '@mantel/shared';

/** Entities the Home screen can show at all. */
export const showable = (e: DiscoveredEntity) => e.kind !== undefined;

/** Kinds that can be controlled, so "read-only" means something. */
export const controllable = (e: DiscoveredEntity) =>
  e.kind === 'light' ||
  e.kind === 'switch' ||
  e.kind === 'lock' ||
  e.kind === 'cover' ||
  e.kind === 'climate';

export const domainOf = (id: string) => id.split('.')[0] ?? '';

/** A row of the rooms list: a configured room, an HA area not yet shown, or both. */
export interface RoomRow {
  key: string;
  room?: HomeAreaConfig;
  area?: DiscoveredArea;
  name: string;
  on: boolean;
}

/**
 * Configured rooms in their order, then HA areas that are not shown yet (alphabetical). An HA
 * area matches a room by `ha_area` (id or name) or by sharing the room's id.
 */
export function roomRows(config: HomeConfig, discovery: HomeDiscovery | null): RoomRow[] {
  const areas = discovery?.areas ?? [];
  const areaFor = (room: HomeAreaConfig) =>
    areas.find(
      (a) =>
        a.id === room.ha_area ||
        a.name.toLowerCase() === room.ha_area?.toLowerCase() ||
        (!room.ha_area && a.id === room.id),
    );
  const rows: RoomRow[] = config.areas.map((room) => {
    const area = areaFor(room);
    return { key: room.id, room, area, name: room.name, on: true };
  });
  const used = new Set(rows.flatMap((r) => (r.area ? [r.area.id] : [])));
  for (const area of areas)
    if (!used.has(area.id)) rows.push({ key: `area:${area.id}`, area, name: area.name, on: false });
  return rows;
}

const newRoom = (area: DiscoveredArea): HomeAreaConfig => ({
  id: area.id,
  name: area.name,
  ha_area: area.id,
  domains: [...DEFAULT_AREA_DOMAINS],
  entities: [],
  exclude: [],
});

/** Show or hide a whole HA area. Turning it off forgets its tweaks. */
export function setRoom(config: HomeConfig, area: DiscoveredArea, on: boolean): HomeConfig {
  const rows = roomRows(config, { areas: [area], entities: [] });
  const existing = rows.find((r) => r.area?.id === area.id && r.room)?.room;
  if (on === !!existing) return config;
  if (on) {
    const id = config.areas.some((a) => a.id === area.id) ? `${area.id}_room` : area.id;
    return { ...config, areas: [...config.areas, { ...newRoom(area), id }] };
  }
  return { ...config, areas: config.areas.filter((a) => a !== existing) };
}

/** A room of hand-picked entities, not tied to an HA area ("Kids", say). */
export function addCustomRoom(config: HomeConfig, name = 'New room'): HomeConfig {
  let id = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!id) id = 'room';
  let unique = id;
  for (let n = 2; config.areas.some((a) => a.id === unique); n++) unique = `${id}_${n}`;
  return {
    ...config,
    areas: [
      ...config.areas,
      { id: unique, name, domains: [...DEFAULT_AREA_DOMAINS], entities: [], exclude: [] },
    ],
  };
}

export function removeRoom(config: HomeConfig, roomId: string): HomeConfig {
  return { ...config, areas: config.areas.filter((a) => a.id !== roomId) };
}

export function renameRoom(config: HomeConfig, roomId: string, name: string): HomeConfig {
  return patchRoom(config, roomId, () => ({ name }));
}

export function moveRoom(config: HomeConfig, from: number, to: number): HomeConfig {
  if (from === to || from < 0 || to < 0 || from >= config.areas.length || to >= config.areas.length)
    return config;
  const areas = [...config.areas];
  const [room] = areas.splice(from, 1);
  areas.splice(to, 0, room!);
  return { ...config, areas };
}

function patchRoom(
  config: HomeConfig,
  roomId: string,
  patch: (room: HomeAreaConfig) => Partial<HomeAreaConfig>,
): HomeConfig {
  return {
    ...config,
    areas: config.areas.map((a) => (a.id === roomId ? { ...a, ...patch(a) } : a)),
  };
}

/** Would `ha_area` pull this entity in by itself? */
export function pulledIn(room: HomeAreaConfig, e: DiscoveredEntity, area?: DiscoveredArea) {
  if (!room.ha_area || !area || e.areaId !== area.id) return false;
  return room.domains.includes(e.domain);
}

export function entityIncluded(room: HomeAreaConfig, e: DiscoveredEntity, area?: DiscoveredArea) {
  if (room.entities.some((r) => r.id === e.id)) return true;
  return pulledIn(room, e, area) && !room.exclude.includes(e.id);
}

export function refOf(room: HomeAreaConfig, entityId: string): HomeEntityRef | undefined {
  return room.entities.find((r) => r.id === entityId);
}

/**
 * The entities a room offers: everything showable in its HA area, plus anything listed by hand
 * (an id the discovery does not know is kept, shown by its id).
 */
export function roomEntities(
  room: HomeAreaConfig,
  discovery: HomeDiscovery | null,
  area?: DiscoveredArea,
): DiscoveredEntity[] {
  const all = discovery?.entities ?? [];
  const inArea = area ? all.filter((e) => e.areaId === area.id && showable(e)) : [];
  const listed = room.entities.flatMap((r) => {
    if (inArea.some((e) => e.id === r.id)) return [];
    const known = all.find((e) => e.id === r.id);
    if (known) return [known];
    const domain = domainOf(r.id);
    return [{ id: r.id, domain, name: r.id, areaId: null, state: 'unknown' } as DiscoveredEntity];
  });
  // Sensors last, as on the Home screen.
  const order = (e: DiscoveredEntity) => (e.kind === 'sensor' ? 1 : 0);
  return [...inArea, ...listed].sort((a, b) => order(a) - order(b));
}

/** Tick or untick an entity in a room. */
export function setEntity(
  config: HomeConfig,
  roomId: string,
  e: DiscoveredEntity,
  on: boolean,
  area?: DiscoveredArea,
): HomeConfig {
  return patchRoom(config, roomId, (room) => {
    const auto = pulledIn(room, e, area);
    const ref = refOf(room, e.id);
    if (on) {
      if (auto) return { exclude: room.exclude.filter((id) => id !== e.id) };
      return ref ? {} : { entities: [...room.entities, { id: e.id }] };
    }
    return {
      entities: room.entities.filter((r) => r.id !== e.id),
      exclude: auto && !room.exclude.includes(e.id) ? [...room.exclude, e.id] : room.exclude,
    };
  });
}

/** Rename an entity or mark it read-only. Overrides live on a listed ref; none left, no ref. */
export function patchEntity(
  config: HomeConfig,
  roomId: string,
  e: DiscoveredEntity,
  patch: { name?: string | null; read_only?: boolean },
  area?: DiscoveredArea,
): HomeConfig {
  return patchRoom(config, roomId, (room) => {
    const current = refOf(room, e.id) ?? { id: e.id };
    const next: HomeEntityRef = { id: e.id };
    const name = patch.name === undefined ? current.name : patch.name?.trim() || undefined;
    const ro = patch.read_only === undefined ? current.read_only : patch.read_only;
    if (name !== undefined && name !== e.name) next.name = name;
    if (ro) next.read_only = true;
    const bare = next.name === undefined && next.read_only === undefined;
    const others = room.entities.filter((r) => r.id !== e.id);
    if (bare && pulledIn(room, e, area) && !room.exclude.includes(e.id))
      return { entities: others };
    const at = room.entities.findIndex((r) => r.id === e.id);
    if (at < 0) return { entities: [...room.entities, next] };
    return { entities: room.entities.map((r, i) => (i === at ? next : r)) };
  });
}

/** Scenes and scripts shown as chips across the top. */
export function setScene(config: HomeConfig, id: string, on: boolean): HomeConfig {
  const has = config.scenes.some((s) => s.id === id);
  if (on === has) return config;
  return {
    ...config,
    scenes: on ? [...config.scenes, { id }] : config.scenes.filter((s) => s.id !== id),
  };
}

export const EMPTY_DOORBELL: DoorbellConfig = { camera: '', trigger: '', seconds: 30 };

export function patchDoorbell(
  config: HomeConfig,
  index: number,
  patch: Partial<DoorbellConfig>,
): HomeConfig {
  return {
    ...config,
    doorbells: config.doorbells.map((d, i) => (i === index ? { ...d, ...patch } : d)),
  };
}

/** Candidates for a doorbell trigger: Ring's `event.*`, any `binary_sensor`, doorbell-ish first. */
export function triggerCandidates(discovery: HomeDiscovery | null): DiscoveredEntity[] {
  const score = (e: DiscoveredEntity) =>
    (e.deviceClass === 'doorbell' || /ding|doorbell/.test(e.id) ? 0 : 1) +
    (e.domain === 'event' ? 0 : 2);
  return (discovery?.entities ?? [])
    .filter((e) => e.domain === 'event' || e.domain === 'binary_sensor')
    .sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
}

/** Which HA `person.*` stands for each person in settings, as the picker shows it. */
export function presenceEntity(
  config: HomeConfig,
  personId: string,
  discovery: HomeDiscovery | null,
): string | null {
  if (config.presence) return config.presence.find((p) => p.person === personId)?.entity ?? null;
  const auto = `person.${personId}`;
  return discovery?.entities.some((e) => e.id === auto) ? auto : null;
}

export function setPresence(
  config: HomeConfig,
  people: string[],
  personId: string,
  entity: string | null,
  discovery: HomeDiscovery | null,
): HomeConfig {
  const presence = people.flatMap((id) => {
    const chosen = id === personId ? entity : presenceEntity(config, id, discovery);
    return chosen ? [{ person: id, entity: chosen }] : [];
  });
  return { ...config, presence };
}

/** Comma or space separated event types, as typed, to the list the config keeps. */
export function parseEventTypes(text: string): string[] | undefined {
  const list = text
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : undefined;
}
