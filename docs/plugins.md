# Plugins: how an integration is built

Every outside service Mantel talks to is a plugin: one folder under `apps/server/src/plugins/<id>/` that exports a `Plugin`. The plugin says, in a manifest, what it needs from the person setting it up; the server stores those values (secrets encrypted), hot-reloads the plugin when they change, and the display renders the Settings card, the setup form and the wizard step from the manifest. Adding an integration never touches Settings or wizard code.

## What the server does for a plugin

| Concern                     | Where it lives                                                                                                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Non-secret values           | SQLite `kv` under `integration.<id>`, edited with `PUT /api/integrations/:id { config }`                                                                                                              |
| Secrets                     | SQLite `secrets`, AES-256-GCM with the key in `DATA_DIR/secret.key` (created on first run, mode 0600). `PUT /api/integrations/:id { secrets }`; a `null` clears one. Never returned, only their names |
| Environment fallbacks       | Each field can name an `env` variable. It is read when nothing is saved and reported as source `env` in the status                                                                                    |
| On/off                      | `settings.integrations[id].enabled` (missing means on). Turning a plugin off calls `apply({}, {})`                                                                                                    |
| Hot reload                  | After every save the registry calls `apply(config, secrets)` with the merged values                                                                                                                   |
| Test                        | `POST /api/integrations/:id/test` with no body tests what is saved; with a body, the posted values merged over the saved ones, without saving                                                         |
| Status and Health           | `GET /api/integrations` and `GET /api/health/details` call `status()`; the registry adds `id`, `enabled`, `config`, `hasSecrets`, `sources`                                                           |
| Manifests for the display   | `GET /api/plugins`                                                                                                                                                                                    |
| OAuth                       | `GET /api/integrations/:id/authorize-url` and `POST /api/integrations/:id/callback { url }` route to `authorizeUrl()` and `callback(url)` when the plugin implements them                             |
| Backup                      | `POST /api/settings/export` includes every plugin's config; secrets only with a passphrase. `POST /api/settings/import` restores through the same `update` path                                       |
| Values from other providers | `integrationValues(ctx, id)` from `providers/types.ts` gives any provider the live values of a plugin (quips reads its Claude key that way)                                                           |

The types are in `packages/shared/src/plugins.ts` (`PluginManifest`, `SetupField`, `PluginContributes`, `PluginRuntime`) and `packages/shared/src/integrations.ts` (`IntegrationId`, `IntegrationStatus`, `TestResult`...). The server-side `Plugin` interface is `apps/server/src/plugins/types.ts`.

## The manifest

```ts
export const manifest: PluginManifest = {
  id: 'icloud', // add the id to IntegrationId in packages/shared/src/integrations.ts
  name: 'iCloud Calendar',
  description: 'Calendars from an Apple ID over CalDAV.', // one line for the card
  category: 'calendar', // calendar | home | media | photos | tasks | weather | info
  step: 'calendars', // the wizard step that offers it, or null
  connect: 'fields', // fields | oauth | none
  optional: true, // false for things the household needs regardless
  docs: 'calendars.md', // guide under docs/
  directions: ['Sign in at [appleid.apple.com](...) ...', 'Generate a password named Mantel ...'],
  fields: [
    { key: 'username', label: 'Apple ID email', type: 'text', required: true, env: 'ICLOUD_USERNAME', ... },
    { key: 'appPassword', label: 'App-specific password', type: 'secret', required: true,
      getItHere: { label: 'Apple ID, app-specific passwords', url: 'https://appleid.apple.com/account/manage' }, ... },
    { key: 'caldavUrl', label: 'CalDAV server', type: 'url', default: 'https://caldav.icloud.com/', advanced: true, ... },
  ],
  contributes: { events: ['calendar.changed'] }, // screen?, todayCard?, ambientSlot?, dockChip?, events
};
```

Field rules, which the display follows for every plugin the same way:

- `type`: `text`, `secret` (stored encrypted, shown as dots), `url` (validated), `file-json` (a box that also takes a dropped JSON file, for Google's client download), `select` (with `options`), `toggle`, `number` (with `min`, `max`).
- Everything that comes from another site has a `getItHere` link to the exact page and a `help` sentence. `directions` are the numbered steps for the side panel.
- `readOnly: true` fields are filled by the server (`computed()`), shown with a Copy button: a redirect URI, a webhook address.
- `advanced: true` collapses the field under Advanced. `dependsOn` shows a field only when another has a value.
- `env` names the variable read when nothing is saved. Keep `.env.example` in step.

The fixture copy of every manifest in `packages/shared/src/fixtures/integrations.ts` is what the display renders in mock mode; `plugins/manifests.test.ts` fails when it drifts from the server's.

## The runtime

```ts
export function icloudPlugin(service: CalendarService): Plugin {
  return {
    manifest,
    start(ctx) { service.attach(ctx); },         // once, before the first apply
    stop() {},                                   // on shutdown
    apply(config, secrets) {                     // every time values change; rebuild or reconfigure here
      service.setIcloud({ ICLOUD_USERNAME: ..., ICLOUD_APP_PASSWORD: secrets.appPassword });
    },
    async test(config, secrets) {                // one sentence, never throws for an upstream failure
      ...
      return { ok: true, message: `Signed in: ${list.length} calendars found.` };
    },
    status() {                                   // cheap and synchronous
      return { state: 'connected', summary: 'jay@icloud.com, 3 calendars', lastOkAt, lastError: null };
    },
  };
}
```

`apply` receives the merged values (saved over env) keyed by field key. The built-in plugins wrap the existing providers: they turn the values back into the env-shaped record the provider's loader expects (`loadCalendarEnv`, `loadHaEnv`, `loadWs4Env`), stop the old instance and build a new one. Routes never notice because they hold a `live()` proxy (`plugins/live.ts`) that forwards to whatever instance is current.

When several plugins share one provider (Google and iCloud share the calendar provider; weather, pollen and routes share the weather provider), a small service object (`calendar-service.ts`, `weather-service.ts`) collects each plugin's slice and rebuilds once per change.

`humanError(err)` in `registry.ts` turns the usual network and HTTP failures into a sentence for `test()` and `lastError`.

## Adding a plugin, step by step

1. Add the id to `IntegrationId` in `packages/shared/src/integrations.ts`.
2. Create `apps/server/src/plugins/<id>/manifest.ts` and `index.ts` as above. Put the provider logic wherever it belongs (`providers/real/...`), with a `stop()` if it holds timers or sockets.
3. Register it in `apps/server/src/plugins/index.ts` (`createPlugins`) and hand its live provider to `providers` if routes call it.
4. Add the manifest to `builtInManifests` in `plugins/mock.ts` and the same manifest plus a believable status to `packages/shared/src/fixtures/integrations.ts`, so mock mode shows it.
5. If it contributes to the display (a screen, a Today card, an Ambient slot), register that under the name in `contributes` and read `settings.integrations[id].enabled` to hide it when off.
6. Write the guide under `docs/` and name it in `manifest.docs`. Add the env variables to `.env.example` as optional fallbacks.
7. Tests: the manifest test picks it up by itself; add a test for `test()` and `apply()` with a fake upstream (see `plugins/homeassistant/homeassistant.test.ts`).

### Worked example: an ICS calendar link

The smallest useful plugin is a read-only calendar from an `.ics` link (a school, a team, a Fastmail share). It needs one field and nothing secret:

```ts
// plugins/ics/manifest.ts
export const manifest: PluginManifest = {
  id: 'ics',
  name: 'Calendar link (ICS)',
  description:
    'Any calendar you can subscribe to by link: school, sports, a shared Fastmail calendar.',
  category: 'calendar',
  step: 'calendars',
  connect: 'fields',
  optional: true,
  docs: 'calendars.md',
  directions: [
    'In the app that owns the calendar, find Share or Subscribe and copy the link ending in .ics (webcal:// links work too).',
    'Paste it below and press Test.',
  ],
  fields: [
    {
      key: 'url',
      label: 'Calendar link',
      type: 'url',
      required: true,
      placeholder: 'https://.../basic.ics',
      pattern: {
        regex: '^(https?|webcal)://',
        message: 'Paste a link starting with https:// or webcal://',
      },
      advanced: false,
      readOnly: false,
    },
    {
      key: 'name',
      label: 'Show it as',
      type: 'text',
      required: false,
      placeholder: 'School',
      advanced: false,
      readOnly: false,
    },
    {
      key: 'pollMinutes',
      label: 'Check every (minutes)',
      type: 'number',
      min: 5,
      default: 30,
      required: false,
      advanced: true,
      readOnly: false,
    },
  ],
  contributes: { events: ['calendar.changed'] },
};
```

The runtime implements the calendar `Source` interface from `providers/real/calendar/types.ts` with `ready()` true when the URL is set, `calendars()` returning one calendar named from `config.name`, `events()` fetching the link and running it through `expandIcs` from `calendar/ics.ts` (already used for iCloud), and `create()` throwing read-only. The calendar service gets a `setIcs(values)` that adds the source to the `RealCalendar` it builds. `test()` fetches the link once and answers "Found 42 events, next: Spirit day on Friday." That is the whole job: no Settings or wizard code changes.

## Candidates

Section 9 of the plan lists the next ones: Microsoft 365 calendar (OAuth, like Google), ICS links, tasks (Google Tasks, Microsoft To Do, Todoist), local-folder and Immich photos, Sonos and Spotify now playing, trash day, Mealie, sports scores, RSS, package tracking, birthdays, Life360 presence, stocks, school lunch menus, EV charge, air-quality sensors.
