/**
 * Fixtures for the plugin and integration routes: the manifests of the built-in plugins as
 * the server reports them, and a believable status for each in mock mode.
 */
import { addDays, toLocalIso } from '../time.js';
import type {
  GeocodeCandidate,
  HealthDetails,
  IntegrationStatus,
  SettingsBundle,
  SetupState,
} from '../integrations.js';
import type { PluginManifest } from '../plugins.js';
import { settings } from './settings.js';

const field = (
  f: Partial<PluginManifest['fields'][number]> &
    Pick<PluginManifest['fields'][number], 'key' | 'label' | 'type'>,
): PluginManifest['fields'][number] => ({
  required: false,
  advanced: false,
  readOnly: false,
  ...f,
});

/** The manifests the server's built-in plugins declare. Kept in step with `apps/server/src/plugins/`. */
export const pluginManifests: PluginManifest[] = [
  {
    id: 'google',
    name: 'Google Calendar',
    description: 'Family calendars from Google, two-way, with quick add from the wall.',
    category: 'calendar',
    step: 'calendars',
    connect: 'oauth',
    optional: true,
    docs: 'calendars.md',
    directions: [
      'Open the [Google Cloud console](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com), create a project and enable the Google Calendar API.',
      'In Google Auth Platform set the audience to External and press Publish app, or the sign-in expires after 7 days.',
      'Under Clients create a Web application client and add the redirect URI shown below.',
      'Paste the client ID and secret here (or drop the downloaded client JSON on the field), then press Connect.',
    ],
    fields: [
      field({
        key: 'clientId',
        label: 'Client ID',
        type: 'file-json',
        required: true,
        placeholder: '1234567890-abc.apps.googleusercontent.com',
        help: 'From the OAuth client you created. Dropping the downloaded JSON fills both fields.',
        getItHere: {
          label: 'Google Cloud console, Clients',
          url: 'https://console.cloud.google.com/auth/clients',
        },
        env: 'GOOGLE_CLIENT_ID',
      }),
      field({
        key: 'clientSecret',
        label: 'Client secret',
        type: 'secret',
        required: true,
        env: 'GOOGLE_CLIENT_SECRET',
      }),
      field({
        key: 'redirectUri',
        label: 'Authorised redirect URI',
        type: 'url',
        readOnly: true,
        help: 'Add this to the client in Google Cloud console.',
      }),
      field({
        key: 'pollSeconds',
        label: 'Sync every (seconds)',
        type: 'number',
        min: 30,
        default: 180,
        advanced: true,
        env: 'CALENDAR_POLL_SECONDS',
      }),
    ],
    contributes: { events: ['calendar.changed'] },
  },
  {
    id: 'icloud',
    name: 'iCloud Calendar',
    description: 'Calendars from an Apple ID over CalDAV.',
    category: 'calendar',
    step: 'calendars',
    connect: 'fields',
    optional: true,
    docs: 'calendars.md',
    directions: [
      'Sign in at [appleid.apple.com](https://appleid.apple.com/account/manage) and open Sign-In and Security, App-Specific Passwords.',
      'Generate a password named Mantel and paste it below with the Apple ID email.',
      'Press Test; Mantel lists the calendars it can see.',
    ],
    fields: [
      field({
        key: 'username',
        label: 'Apple ID email',
        type: 'text',
        required: true,
        placeholder: 'you@icloud.com',
        env: 'ICLOUD_USERNAME',
      }),
      field({
        key: 'appPassword',
        label: 'App-specific password',
        type: 'secret',
        required: true,
        placeholder: 'abcd-efgh-ijkl-mnop',
        getItHere: {
          label: 'Apple ID, app-specific passwords',
          url: 'https://appleid.apple.com/account/manage',
        },
        env: 'ICLOUD_APP_PASSWORD',
      }),
      field({
        key: 'caldavUrl',
        label: 'CalDAV server',
        type: 'url',
        default: 'https://caldav.icloud.com/',
        advanced: true,
        env: 'ICLOUD_CALDAV_URL',
      }),
    ],
    contributes: { events: ['calendar.changed'] },
  },
  {
    id: 'ical',
    name: 'Calendar link (iCal)',
    description:
      'The easy way: paste Google Calendar’s secret iCal address, or any .ics link. Read-only, no Cloud console.',
    category: 'calendar',
    step: 'calendars',
    connect: 'fields',
    optional: true,
    docs: 'calendars.md',
    directions: [
      'On a computer, open [Google Calendar settings](https://calendar.google.com/calendar/r/settings). Under Settings for my calendars, click the calendar to share.',
      'Scroll to Integrate calendar and copy Secret address in iCal format (it ends in basic.ics).',
      'Paste it below, one link per box, and press Test. Repeat for each family member’s calendar.',
      'Links are read-only: quick add writes to iCloud or a Google account connected with Google Calendar above. Any .ics link works too (Outlook, school, sports team).',
    ],
    fields: [
      field({
        key: 'url1',
        label: 'Calendar link',
        type: 'secret',
        required: true,
        placeholder: 'https://calendar.google.com/calendar/ical/…/private-…/basic.ics',
        help: 'Google: Settings → your calendar → Integrate calendar → Secret address in iCal format.',
        getItHere: {
          label: 'Google Calendar settings',
          url: 'https://calendar.google.com/calendar/r/settings',
        },
        env: 'ICAL_URLS',
      }),
      field({
        key: 'url2',
        label: 'Second calendar link',
        type: 'secret',
        placeholder: 'Optional',
      }),
      field({ key: 'url3', label: 'Third calendar link', type: 'secret', placeholder: 'Optional' }),
      field({
        key: 'url4',
        label: 'More links',
        type: 'secret',
        advanced: true,
        help: 'Several links separated by spaces or new lines.',
      }),
    ],
    contributes: { events: ['calendar.changed'] },
  },
  {
    id: 'homeassistant',
    name: 'Home Assistant',
    description: 'Lights, locks, thermostats, cameras and the doorbell, picked room by room.',
    category: 'home',
    step: 'homeassistant',
    connect: 'fields',
    optional: true,
    docs: 'home-assistant.md',
    directions: [
      'In Home Assistant open your profile (bottom left), then the Security tab.',
      'Under Long-lived access tokens press Create token, name it Mantel and copy it.',
      'Paste the token and the address of Home Assistant as this server reaches it, then press Test.',
    ],
    fields: [
      field({
        key: 'url',
        label: 'Home Assistant address',
        type: 'url',
        required: true,
        placeholder: 'http://homeassistant.local:8123',
        help: 'As the Mantel server reaches it, not as your phone does.',
        env: 'HA_URL',
      }),
      field({
        key: 'token',
        label: 'Long-lived access token',
        type: 'secret',
        required: true,
        getItHere: {
          label: 'Home Assistant, profile, Security',
          url: 'http://homeassistant.local:8123/profile/security',
        },
        env: 'HA_TOKEN',
      }),
      field({
        key: 'streamMaxSeconds',
        label: 'Longest live camera view (seconds)',
        type: 'number',
        min: 10,
        max: 600,
        default: 120,
        advanced: true,
        env: 'HA_STREAM_MAX_SECONDS',
      }),
    ],
    contributes: { screen: 'home', events: ['home.state', 'home.doorbell', 'media.state'] },
  },
  {
    id: 'photos',
    name: 'Photos',
    description: 'A shared iCloud album plays on the Ambient screen.',
    category: 'photos',
    step: 'extras',
    connect: 'fields',
    optional: true,
    docs: 'weather-commute-photos.md',
    directions: [
      'In Photos, open the shared album, tap the people icon and turn on Public Website.',
      'Copy the link it shows and paste it below.',
    ],
    fields: [
      field({
        key: 'albumUrl',
        label: 'Shared album link',
        type: 'url',
        required: true,
        placeholder: 'https://www.icloud.com/sharedalbum/#B0a...',
        env: 'ICLOUD_SHARED_ALBUM_URL',
      }),
      field({
        key: 'limit',
        label: 'Most photos to keep',
        type: 'number',
        min: 10,
        max: 5000,
        default: 500,
        advanced: true,
        env: 'PHOTO_LIMIT',
      }),
    ],
    contributes: { ambientSlot: 'photos', events: [] },
  },
  {
    id: 'routes',
    name: 'Leave-by times',
    description:
      'Drive times to school and work. Free without a key; a Google key adds live traffic.',
    category: 'info',
    step: 'extras',
    connect: 'fields',
    optional: true,
    docs: 'weather-commute-photos.md',
    directions: [
      'Without a key, Mantel uses OpenStreetMap routing (OSRM) with no traffic.',
      'For live traffic, create a Google Maps Platform key with the Routes API enabled and paste it below.',
      'An OpenRouteService key (free) is a middle option: your own quota, still no traffic.',
    ],
    fields: [
      field({
        key: 'googleKey',
        label: 'Google Maps Platform key',
        type: 'secret',
        getItHere: {
          label: 'Google Cloud console, Credentials',
          url: 'https://console.cloud.google.com/apis/credentials',
        },
        help: 'Optional. Enables live traffic.',
        env: 'GOOGLE_ROUTES_API_KEY',
      }),
      field({
        key: 'openRouteServiceKey',
        label: 'OpenRouteService key',
        type: 'secret',
        advanced: true,
        getItHere: {
          label: 'OpenRouteService dashboard',
          url: 'https://openrouteservice.org/dev/#/signup',
        },
        help: 'Optional. Free, no traffic.',
        env: 'OPENROUTESERVICE_API_KEY',
      }),
      field({
        key: 'osrmUrl',
        label: 'OSRM server',
        type: 'url',
        default: 'https://router.project-osrm.org',
        advanced: true,
        env: 'OSRM_BASE_URL',
      }),
    ],
    contributes: { todayCard: 'leave-by', events: ['commute.updated'] },
  },
  {
    id: 'pollen',
    name: 'Pollen',
    description:
      'Pollen levels on the weather card. Free in Europe; elsewhere a Google key is needed.',
    category: 'weather',
    step: 'extras',
    connect: 'fields',
    optional: true,
    docs: 'weather-commute-photos.md',
    directions: [
      'Create a Google Maps Platform key with the Pollen API enabled, or reuse the Leave-by key.',
    ],
    fields: [
      field({
        key: 'googleKey',
        label: 'Google Pollen API key',
        type: 'secret',
        getItHere: {
          label: 'Google Cloud console, Credentials',
          url: 'https://console.cloud.google.com/apis/credentials',
        },
        help: 'Leave empty to reuse the Leave-by key.',
        env: 'GOOGLE_POLLEN_API_KEY',
      }),
    ],
    contributes: { events: [] },
  },
  {
    id: 'weather',
    name: 'Weather',
    description:
      'Forecast, air quality and alerts from Open-Meteo and the National Weather Service. No key needed.',
    category: 'weather',
    step: 'home',
    connect: 'fields',
    optional: false,
    docs: 'weather-commute-photos.md',
    directions: [],
    fields: [
      field({
        key: 'nwsContact',
        label: 'Contact for weather.gov',
        type: 'text',
        placeholder: 'you@example.com',
        help: 'The US weather service asks who is calling. Any email or website.',
        advanced: true,
        env: 'NWS_CONTACT',
      }),
    ],
    contributes: {
      todayCard: 'weather',
      ambientSlot: 'weather',
      events: ['weather.updated', 'weather.alert'],
    },
  },
  {
    id: 'quips',
    name: 'Weather quips',
    description: 'A line of weather humour each day. Built in; a Claude API key writes fresh ones.',
    category: 'weather',
    step: 'extras',
    connect: 'fields',
    optional: true,
    docs: 'weather-commute-photos.md',
    directions: [
      'Quips work with no key, from a library of lines.',
      'For a new line each morning, create a key at the Claude console and paste it below.',
    ],
    fields: [
      field({
        key: 'claudeApiKey',
        label: 'Claude API key',
        type: 'secret',
        getItHere: {
          label: 'Claude console, API keys',
          url: 'https://platform.claude.com/settings/keys',
        },
        help: 'Optional. One short request a day.',
        env: 'CLAUDE_API_KEY',
      }),
    ],
    contributes: { ambientSlot: 'quip', events: [] },
  },
];

export function integrationStatuses(now = new Date()): IntegrationStatus[] {
  const ok = toLocalIso(new Date(now.getTime() - 5 * 60_000));
  const base = (id: IntegrationStatus['id']): IntegrationStatus => ({
    id,
    enabled: true,
    state: 'not_set_up',
    summary: 'Not set up',
    lastOkAt: null,
    lastError: null,
    config: {},
    hasSecrets: [],
    sources: {},
  });
  return [
    {
      ...base('google'),
      state: 'connected',
      summary: 'Connected as jay@example.com, 4 calendars',
      lastOkAt: ok,
      config: {
        clientId: '1234567890-abc.apps.googleusercontent.com',
        redirectUri: 'http://localhost:8787/api/calendar/google/callback',
        pollSeconds: 180,
      },
      hasSecrets: ['clientSecret'],
      sources: { clientId: 'store', clientSecret: 'store' },
    },
    { ...base('icloud'), summary: 'Add an Apple ID to see iCloud calendars' },
    { ...base('ical'), summary: 'Paste a Google secret iCal address or any .ics link' },
    {
      ...base('homeassistant'),
      state: 'connected',
      summary: 'Connected to Home Assistant 2026.10, 3 rooms',
      lastOkAt: ok,
      config: { url: 'http://homeassistant.local:8123', streamMaxSeconds: 120 },
      hasSecrets: ['token'],
      sources: { url: 'env', token: 'env' },
    },
    {
      ...base('photos'),
      state: 'error',
      summary: 'Album link no longer works',
      lastOkAt: toLocalIso(addDays(now, -2)),
      lastError:
        'Apple answered 404 for the album. Open the album in Photos and check Public Website is still on.',
      config: { albumUrl: 'https://www.icloud.com/sharedalbum/#B0aGWZuqGJu1234', limit: 500 },
      sources: { albumUrl: 'store' },
    },
    {
      ...base('routes'),
      state: 'connected',
      summary: 'OpenStreetMap routing, no traffic. Add a Google key for live traffic.',
      lastOkAt: ok,
      config: { osrmUrl: 'https://router.project-osrm.org' },
    },
    { ...base('pollen'), summary: 'Pollen from Open-Meteo where available' },
    {
      ...base('weather'),
      state: 'connected',
      summary: 'Open-Meteo and weather.gov, no key needed',
      lastOkAt: ok,
    },
    { ...base('quips'), enabled: false, state: 'disabled', summary: 'Turned off' },
  ];
}

export function setupState(): SetupState {
  return {
    firstRun: false,
    pinSet: true,
    completed: true,
    steps: {
      welcome: 'done',
      home: 'done',
      people: 'done',
      calendars: 'done',
      homeassistant: 'skipped',
      extras: 'done',
      wall: 'done',
    },
  };
}

export function healthDetails(now = new Date()): HealthDetails {
  const at = (minutesAgo: number) => toLocalIso(new Date(now.getTime() - minutesAgo * 60_000));
  return {
    version: '0.1.0',
    mock: true,
    uptimeSeconds: 3600,
    firstRun: false,
    pinSet: true,
    publicUrl: 'http://localhost:8787',
    integrations: integrationStatuses(now),
    logTail: [
      {
        at: at(60),
        level: 'info',
        message: 'mantel server 0.1.0 on http://0.0.0.0:8787 (MOCK mode)',
      },
      { at: at(59), level: 'info', message: 'Pairing code: 482913 (valid 15 minutes)' },
      { at: at(5), level: 'info', message: 'calendar: synced 4 calendars, 212 events' },
      { at: at(4), level: 'warn', message: 'photos: Apple answered 404 for the album' },
    ],
    lastSync: { calendar: at(5), weather: at(5), photos: null, home: at(1), lists: at(1) },
  };
}

export function settingsBundle(now = new Date()): SettingsBundle {
  return {
    format: 'mantel-settings',
    version: 1,
    exportedAt: toLocalIso(now),
    appVersion: '0.1.0',
    settings: settings(),
    integrations: Object.fromEntries(
      integrationStatuses(now).map((s) => [s.id, { enabled: s.enabled, config: s.config }]),
    ),
  };
}

export const geocodeCandidates: GeocodeCandidate[] = [
  {
    name: 'Seattle, Washington, United States',
    latitude: 47.6062,
    longitude: -122.3321,
    timezone: 'America/Los_Angeles',
    country: 'United States',
    admin: 'Washington',
  },
  {
    name: 'Seattle, Alabama, United States',
    latitude: 33.5465,
    longitude: -86.7854,
    timezone: 'America/Chicago',
    country: 'United States',
    admin: 'Alabama',
  },
];
