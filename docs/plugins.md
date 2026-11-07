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
  contributes: { events: ['calendar.changed'] }, // screen?, todayCard?, ambientSlot?, dockChip?, events (see below)
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
5. If it puts something on the display (a Today card, an Ambient line, a dock chip), describe it under `contributes` and answer `blocks`, `chip` and `action` (see "Putting something on the wall" below). The display hides it when the plugin is off.
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

## Putting something on the wall: cards, Ambient lines, dock chips

A plugin can draw on the display without any screen code. Its manifest lists what it adds under
`contributes`, and the server plugin answers with **blocks**: a small JSON shape the display
draws with one component, the same way for every plugin. Trash day (`plugins/trash/`) and the
kitchen timers (`plugins/timers/`) are built this way.

| `contributes`                                           | Where it shows                                                                                                   | What the display fetches                                  |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `todayCard: { name, description, min, comfort?, data }` | A card for the custom Today layout, kind `plugin:<id>`. Settings, Layout, Your own lists it under "From plugins" | `GET /api/plugins/:id/blocks/<data>`                      |
| `ambientSlot: { id, order, data }`                      | A line on Ambient beside the clock (weather is order 0, the next event 1). Null hides it                         | `GET /api/plugins/:id/blocks/<data>`                      |
| `dockChip: { id, data, sheet?, idle? }`                 | A chip in the dock right of the clock. With `sheet`, tapping it opens a sheet drawn from those blocks            | `GET /api/plugins/:id/chip/<data>` (and `blocks/<sheet>`) |

A plain string in those fields (`todayCard: 'weather'`) still names a built-in card the display
draws itself, as the older plugins do.

**Blocks** (`PluginBlocks` in `packages/shared/src/plugins.ts`):

```ts
{
  title: 'Trash and recycling tonight',
  icon: 'trash',                       // from the display's set: trash recycle leaf timer bell check alert calendar star info clock box
  lines: [
    { icon: 'trash', text: 'Trash', sub: 'Put it out tonight', tone: 'warn' },   // tone: normal | warn | good
    { text: 'Pasta', countdownTo: '2026-11-07T18:05:00-08:00',                   // the display counts down by itself
      actions: [{ name: 'stop', label: 'Cancel', args: { id: 't1' } }] },        // buttons post to the plugin
  ],
  empty: 'Shown when there are no lines',
  footer: 'A small line at the bottom',
  progress: 0.4,                       // a bar under the title
  actions: [{ name: 'start', label: '5 min', args: { minutes: 5 } }],            // buttons under the lines
  dial: { action: 'start', label: 'Or set your own', unit: 'min', min: 1, max: 180, step: 1, value: 15 },
}
```

A **chip** is `{ text, icon?, tone?, countdownTo?, label? }`. **Buttons** post
`POST /api/plugins/:id/actions/<name> { args }` and get back `{ ok, message? }`; the message
shows as a toast. Two WebSocket events go to every display: `plugin.changed { id, cleared? }`
makes it refetch that plugin's blocks and chips (they also refresh every two minutes, for cards
that change with the clock), and `plugin.alert { id, key, title, text?, icon?, chime, actions }`
shows a banner over every screen and Ambient, with a chime when asked, until a button is
pressed here or a later `plugin.changed` lists the key in `cleared`. Send `display.wake` with an
alert so a sleeping screen lights up. A plugin that is turned off in Settings shows nothing.

On the server a plugin answers three optional methods (`apps/server/src/plugins/types.ts`):
`blocks(name)`, `chip(name)` and `action(name, args)`. Returning `null` shows nothing; returning
`undefined` (a name it does not know) answers 404.

### Worked example: a moon phase card

A card that says tonight's moon, and a line on Ambient on full-moon nights. No account, no key.

1. Add `'moon'` to `IntegrationId` in `packages/shared/src/integrations.ts`.
2. The manifest, `apps/server/src/plugins/moon/manifest.ts`:

```ts
export const manifest: PluginManifest = {
  id: 'moon',
  name: 'Moon phase',
  description: "Tonight's moon on Today, and a note on Ambient when it is full.",
  category: 'info',
  step: null,
  connect: 'none',
  optional: true,
  fields: [],
  directions: ['Add the Moon card in Settings, Layout, Your own.'],
  contributes: {
    todayCard: {
      name: 'Moon',
      description: "Tonight's phase and the next full moon.",
      min: [2, 1.5], // smallest readable size in cells (the grid is 12 by 8)
      comfort: [3, 2], // drawn for this size; smaller cards shrink their content a little
      data: 'card',
    },
    ambientSlot: { id: 'moon', order: 4, data: 'ambient' },
    events: ['plugin.changed'],
  },
};
```

3. The runtime, `apps/server/src/plugins/moon/index.ts`:

```ts
const SYNODIC = 29.530588853;
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
const age = (d: Date) => ((((d.getTime() - NEW_MOON) / 86_400_000) % SYNODIC) + SYNODIC) % SYNODIC;
const NAMES = [
  'New moon',
  'Waxing crescent',
  'First quarter',
  'Waxing gibbous',
  'Full moon',
  'Waning gibbous',
  'Last quarter',
  'Waning crescent',
];
const phase = (d: Date) => NAMES[Math.round((age(d) / SYNODIC) * 8) % 8]!;

export function moonPlugin(): Plugin {
  let ctx: ProviderContext | null = null;
  const now = () => ctx?.now() ?? new Date();
  return {
    manifest,
    start(c) {
      ctx = c;
    },
    stop() {},
    apply() {},
    async test() {
      return { ok: true, message: `Tonight: ${phase(now())}.` };
    },
    status() {
      return { state: 'connected', summary: phase(now()), lastOkAt: null, lastError: null };
    },
    blocks(name) {
      const days = Math.round((SYNODIC / 2 - age(now()) + SYNODIC) % SYNODIC);
      if (name === 'card')
        return {
          title: phase(now()),
          icon: 'star',
          lines: [{ text: 'Next full moon', sub: days ? `in ${days} days` : 'tonight' }],
          progress: age(now()) / SYNODIC,
        };
      if (name === 'ambient')
        return phase(now()) === 'Full moon'
          ? { title: 'Full moon tonight', icon: 'star', lines: [] }
          : null;
      return undefined; // not a name this plugin serves: 404
    },
  };
}
```

4. Register it: add `moonPlugin()` to `localPlugins()` in `plugins/index.ts` (plugins there run
   for real in mock mode too), and its manifest to `builtInManifests` in `plugins/mock.ts` and
   to `pluginManifests` in `packages/shared/src/fixtures/` (the manifest test checks they match).
5. That is all. The card appears under "From plugins" in Settings, Layout, Your own; the wall
   draws it, refetches it on `plugin.changed { id: 'moon' }` and every two minutes, and Ambient
   shows the line on full-moon nights. Turning the plugin off in Settings hides both.

For buttons, implement `action(name, args)` and put `actions` on lines or blocks; for something
that needs attention now, `ctx.emit({ type: 'plugin.alert', payload: { ... } })` (see
`plugins/timers/index.ts`). To test, call `blocks()` and `action()` on the plugin with a hand-made
context (see `plugins/timers/timers.test.ts`), or the routes on a `MOCK=1` app.

## Candidates

Section 9 of the plan lists the next ones: Microsoft 365 calendar (OAuth, like Google), ICS links, tasks (Google Tasks, Microsoft To Do, Todoist), local-folder and Immich photos, Sonos and Spotify now playing, Mealie, sports scores, RSS, package tracking, birthdays, Life360 presence, stocks, school lunch menus, EV charge, air-quality sensors.
