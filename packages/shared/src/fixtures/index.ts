/**
 * Fixtures for every REST route, used by the server's mock mode (`MOCK=1`) and by tests.
 * Dates are generated relative to `now` so the mock always looks like "today".
 * Every value here must parse against its route's response schema (see fixtures.test.ts).
 */
import { DEFAULT_PANEL, type ResponseOf, type RouteName } from '../api.js';
import { addDays, startOfDay, toLocalIso } from '../time.js';
import { eventsInRange, countdowns, meals } from './calendar.js';
import { homeState, mediaPlayers } from './home.js';
import { chores, lists } from './lists.js';
import { calendars, people } from './people.js';
import { photos } from './photos.js';
import { settings } from './settings.js';
import { commute, weather } from './weather.js';

export * from './calendar.js';
export * from './home.js';
export * from './lists.js';
export * from './people.js';
export * from './photos.js';
export * from './settings.js';
export * from './weather.js';
export { DEFAULT_PANEL };

export const MOCK_DEVICE_KEY = 'mock-device-key-0000000000';
export const MOCK_PAIRING_CODE = '000000';

/** One sample response per JSON route. */
export function routeFixtures(now = new Date()): {
  [N in Exclude<RouteName, 'photo'>]: ResponseOf<N>;
} {
  const s = settings();
  const today = startOfDay(now);
  const allLists = lists();
  const firstItem = allLists[0]!.items[0]!;
  const choreSet = chores(now);
  const players = mediaPlayers(now);
  const home = homeState(now);
  const events = eventsInRange(now, today, addDays(today, 1));
  return {
    pair: { deviceId: 'dev-mock', deviceKey: MOCK_DEVICE_KEY },
    bootstrap: {
      version: '0.1.0',
      mock: true,
      serverTime: toLocalIso(now),
      timezone: s.timezone,
      people,
      calendars,
      settings: { location: s.location, units: s.units, schedule: s.schedule },
      theme: s.theme,
      panel: DEFAULT_PANEL,
      flags: s.flags,
    },
    calendar: { events: eventsInRange(now, addDays(today, -35), addDays(today, 42)) },
    calendarQuick: { event: events[0]! },
    countdowns: { countdowns: countdowns(now) },
    meals: meals(now),
    weather: weather(now),
    commute: commute(now, { force: true }),
    photosNext: {
      photos: photos(DEFAULT_PANEL).map((p) => ({ ...p, url: `/api/photos/${p.id}` })),
    },
    homeState: home,
    homeCall: { ok: true, entity: home.entities[0]! },
    media: { players },
    mediaCall: { ok: true, player: players[0]! },
    lists: { lists: allLists },
    listAddItem: { item: firstItem },
    itemPatch: { item: { ...firstItem, done: true } },
    itemDelete: { ok: true },
    chores: choreSet,
    choreDone: { chore: choreSet.chores[0]!, stars: choreSet.stars },
    settings: s,
    settingsPut: s,
    health: {
      ok: true,
      version: '0.1.0',
      mock: true,
      uptimeSeconds: 12,
      lastSync: {
        calendar: toLocalIso(now),
        weather: toLocalIso(now),
        photos: null,
        home: toLocalIso(now),
        lists: toLocalIso(now),
      },
    },
  };
}

/** One sample of every WebSocket event. */
export function wsFixtures(now = new Date()) {
  const today = startOfDay(now);
  const home = homeState(now);
  return [
    {
      type: 'calendar.changed',
      payload: { from: toLocalIso(today), to: toLocalIso(addDays(today, 7)) },
    },
    {
      type: 'home.state',
      payload: { entity: { ...home.entities[3]!, state: 'on', attrs: { brightness: 153 } } },
    },
    {
      type: 'home.doorbell',
      payload: { cameraEntityId: 'camera.front_door', at: toLocalIso(now), durationSeconds: 30 },
    },
    { type: 'media.state', payload: { player: { ...mediaPlayers(now)[0]!, state: 'paused' } } },
    { type: 'list.changed', payload: { listId: 'list-grocery' } },
    { type: 'weather.updated', payload: { weather: weather(now) } },
    { type: 'display.reload', payload: {} },
    { type: 'display.wake', payload: { reason: 'presence' } },
    { type: 'display.sleep', payload: { reason: 'schedule' } },
  ] as const;
}
