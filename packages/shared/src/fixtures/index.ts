/**
 * Fixtures for every REST route, used by the server's mock mode (`MOCK=1`) and by tests.
 * Dates are generated relative to `now` so the mock always looks like "today".
 * Every value here must parse against its route's response schema (see fixtures.test.ts).
 */
import { DEFAULT_PANEL, type JsonRouteName, type ResponseOf } from '../api.js';
import { addDays, startOfDay, toLocalIso } from '../time.js';
import { eventsInRange, countdowns, meals } from './calendar.js';
import { homeConfig, homeConnection, homeDiscovery, homeState, mediaPlayers } from './home.js';
import {
  geocodeCandidates,
  healthDetails,
  integrationStatuses,
  pluginManifests,
  settingsBundle,
  setupState,
} from './integrations.js';
import { chores, lists } from './lists.js';
import { calendars, people } from './people.js';
import { photos } from './photos.js';
import { settings } from './settings.js';
import { commute, weather, weatherForPlace, weatherPlaces, weatherQuip } from './weather.js';

export * from './calendar.js';
export * from './home.js';
export * from './integrations.js';
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
  [N in JsonRouteName]: ResponseOf<N>;
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
    pairLocal: { deviceId: 'dev-mock', deviceKey: MOCK_DEVICE_KEY },
    updateCheck: {
      current: '0.1.0',
      checked: true,
      latest: '0.2.0',
      available: true,
      url: 'https://github.com/sorel123/mantel/releases/latest',
      notes: 'Sample release notes.',
    },
    bootstrap: {
      version: '0.1.0',
      mock: true,
      serverTime: toLocalIso(now),
      timezone: s.timezone,
      people,
      calendars,
      settings: {
        location: s.location,
        units: s.units,
        schedule: s.schedule,
        appearance: s.appearance,
        layout: s.layout,
        screens: s.screens,
        defaultScreen: s.defaultScreen,
        integrations: s.integrations,
      },
      theme: s.theme,
      panel: DEFAULT_PANEL,
      flags: s.flags,
      device: null,
    },
    calendar: { events: eventsInRange(now, addDays(today, -35), addDays(today, 42)) },
    calendarQuick: { event: events[0]! },
    calendarEventPatch: { event: events[0]! },
    calendarEventDelete: { ok: true },
    countdowns: { countdowns: countdowns(now) },
    meals: meals(now),
    weather: weather(now),
    weatherPlace: weatherForPlace(now, weatherPlaces[0]!),
    weatherSearch: { places: weatherPlaces },
    weatherQuip: { quip: weatherQuip(now) },
    commute: commute(now, { force: true }),
    photosNext: {
      photos: photos(DEFAULT_PANEL).map((p) => ({ ...p, url: `/api/photos/${p.id}` })),
    },
    homeState: home,
    homeCall: { ok: true, entity: home.entities[0]! },
    homeAnnounce: { ok: true, targets: home.announceTargets.map((t) => t.id) },
    media: { players },
    mediaCall: { ok: true, player: players[0]! },
    homeConnection: homeConnection(now),
    homeConnectionPut: homeConnection(now),
    homeConnectionTest: { ok: true, message: 'Connected to Home Assistant 2026.10.2.' },
    homeDiscover: homeDiscovery(now),
    homeConfig: homeConfig(now),
    homeConfigPut: homeConfig(now),
    homeConfigImportYaml: homeConfig(now),
    homeConfigExportYaml: { yaml: 'areas:\n  - id: living_room\n    name: Living room\n' },
    lists: { lists: allLists },
    listAddItem: { item: firstItem },
    itemPatch: { item: { ...firstItem, done: true } },
    itemDelete: { ok: true },
    listCreate: { list: { id: 'list-new', name: 'Hardware store', source: 'local', items: [] } },
    listsReorder: { lists: allLists },
    listPatch: { list: { ...allLists[0]!, home: true } },
    listDelete: { ok: true },
    chores: choreSet,
    choreDone: { chore: choreSet.chores[0]!, stars: choreSet.stars },
    choreUndo: { chore: choreSet.chores[0]!, stars: choreSet.stars },
    choreCreate: { chore: choreSet.chores[0]! },
    choreDelete: { ok: true },
    settings: s,
    settingsPut: s,
    devices: {
      devices: [
        {
          id: 'dev-mock',
          name: 'Kitchen iPad',
          createdAt: toLocalIso(addDays(now, -7)),
          lastSeenAt: toLocalIso(now),
          revokedAt: null,
          current: true,
        },
        {
          id: 'dev-old',
          name: 'Surface Pro',
          createdAt: toLocalIso(addDays(now, -30)),
          lastSeenAt: toLocalIso(addDays(now, -9)),
          revokedAt: toLocalIso(addDays(now, -8)),
          current: false,
        },
      ],
    },
    deviceRevoke: { ok: true },
    deviceRename: {
      device: {
        id: 'dev-mock',
        name: 'Kitchen wall',
        createdAt: toLocalIso(addDays(now, -7)),
        lastSeenAt: toLocalIso(now),
        revokedAt: null,
        current: true,
      },
    },
    pairingCode: { code: '482913', expiresAt: toLocalIso(new Date(now.getTime() + 15 * 60_000)) },
    displayState: { at: toLocalIso(now), screen: 'on', ambient: false, brightness: 100 },
    displayReload: { ok: true, clients: 1 },
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
    plugins: { plugins: pluginManifests },
    integrations: { integrations: integrationStatuses(now) },
    integrationPut: { integration: integrationStatuses(now)[2]! },
    integrationTest: { ok: true, message: 'Connected to Home Assistant 2026.10, 3 rooms found.' },
    integrationAuthorizeUrl: {
      url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=mock&scope=calendar',
      redirectUri: 'http://localhost:8787/api/calendar/google/callback',
      pasteBack: true,
    },
    integrationCallback: { integration: integrationStatuses(now)[0]! },
    healthDetails: healthDetails(now),
    adminPin: { ok: true, pinSet: true },
    setupState: setupState(),
    setupStatePut: setupState(),
    settingsExport: settingsBundle(now),
    settingsImport: { ok: true, secretsRestored: ['google', 'homeassistant'] },
    geocode: { candidates: geocodeCandidates },
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
    { type: 'home.presence', payload: { presence: home.presence } },
    { type: 'media.state', payload: { player: { ...mediaPlayers(now)[0]!, state: 'paused' } } },
    { type: 'list.changed', payload: { listId: 'list-grocery' } },
    { type: 'chores.changed', payload: {} },
    { type: 'weather.updated', payload: { weather: weather(now) } },
    {
      type: 'weather.alert',
      payload: {
        locationName: 'Home',
        alert: {
          id: 'alert-wind',
          event: 'High Wind Warning',
          severity: 'severe',
          headline: 'High Wind Warning until 6 PM',
          description: 'South winds 30 to 40 mph with gusts up to 60 mph. Secure loose objects.',
          starts: toLocalIso(now),
          ends: toLocalIso(addDays(today, 1)),
        },
      },
    },
    { type: 'display.reload', payload: {} },
    { type: 'display.wake', payload: { reason: 'presence' } },
    { type: 'display.sleep', payload: { reason: 'schedule' } },
  ] as const;
}
