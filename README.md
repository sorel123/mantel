# Mantel

A touchscreen family wall display: calendars, weather, photos, lists and chores, and Home Assistant controls, on an iPad or Surface in kiosk mode. One container runs the server (API, WebSocket, SQLite) and serves the display.

The design reference is [`design/mockup.html`](design/mockup.html). Open it in a browser; tokens, type, spacing and the three motion durations (150, 320, 700 ms) come from it.

## Quick start

```sh
corepack enable          # pnpm 10, pinned in package.json
pnpm install
MOCK=1 pnpm dev          # or: pnpm dev:mock
```

- Display: http://localhost:5173 (Vite, proxies `/api` and `/ws` to the server)
- Server: http://localhost:8787 (`/api/health` needs no key)

`MOCK=1` serves fixture data for every integration (calendar, weather, photos, Home Assistant, lists) and needs no accounts or pairing. Mock state is in memory: toggling a light or checking an item works and pushes WebSocket events, and resets on restart. Add `MOCK_EMPTY=1` to see the display as a fresh install with nothing connected: every card shows its empty state (`app/EmptyState.tsx`) with a button into the matching Settings section.

Other scripts: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm format`. CI runs all of them, then the smoke test, plus a container build on every PR.

**Smoke test.** `pnpm build && pnpm e2e` starts the production server in mock mode serving the built display (as the container does) and drives it with Playwright at iPad and Surface sizes: every screen, the day sheet and quick add, the unlock dialog, a doorbell press, Ambient, both looks, the settings and phone pages, with no console errors allowed. `e2e/smoke.spec.ts`; the first run needs `pnpm exec playwright install chromium`.

## Layout

```
apps/display      React 18 + Vite + Framer Motion. The wall display.
apps/server       Node 22 + Hono + ws + better-sqlite3/Drizzle. API, WebSocket, integrations.
packages/shared   The contract: zod schemas, types, route table, WebSocket events, fixtures, typed client.
design/           The mockup.
```

### Who owns what

Each workstream changes only its own folders, plus additions to `packages/shared`.

| Workstream                 | Display                                                         | Server                                                                                |
| -------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1 Shell & design system    | `src/app/`, `src/styles/`, `src/lib/theme.ts`, `src/lib/fit.ts` | schedule reads from settings                                                          |
| 2 Calendars                | `src/screens/today/`, `src/screens/month/`                      | `providers/real/calendar*`, `providers/mock/calendar.ts`, calendar block in `routes/` |
| 3 Home Assistant           | `src/screens/home/`, `src/features/doorbell/`                   | `providers/real/home*`, `providers/mock/home.ts`, home and media block in `routes/`   |
| 4 Weather, commute, photos | `src/features/weather/`, `src/features/photos/`                 | `providers/real/{weather,commute,photos}*`, `providers/mock/{weather,photos}.ts`      |
| 5 Lists & chores           | `src/screens/lists/`, `/add` page                               | `providers/real/lists*`, `providers/mock/lists.ts`, lists block in `routes/`          |
| 6 Deployment & kiosk       | `src/screens/settings/` (the `/settings` page)                  | `Dockerfile`, `docker-compose.yml`, `deploy/`, `auth.ts`, `settings.ts`               |

Shared plumbing (`src/lib/api.ts`, `src/lib/events.ts`, `src/lib/bootstrap.tsx`, `server/src/contract.ts`, `server/src/app.ts`) belongs to the scaffold; change it only when a workstream truly needs to, and say so in the PR.

## The shell and design system (workstream 1)

Everything a screen needs from the shell lives in `apps/display/src/app` and `src/styles`. Open **http://localhost:5173/demo** for a gallery of every token, primitive and overlay, Ambient, screen off and the schedule; it needs no server.

**Styles.** `tokens.css` (colours per `<html data-mode>`, the three durations, radii, spacing, z-layers), `base.css` (type: `.h1` `.h2` `.h3` `.eyebrow` `.display-xl` `.muted` `.tnum`), `ui.css` (primitives: `.card` `.btn` `.seg` `.sw` `.cb` `.input` `.range` `.av` `.band` `.pill` `.chip` `.dot` `.kv` `.skeleton` `.scroll-y`). Person colour goes in `--pc` on the element. Never write a raw colour or duration.

**Shell.** `Shell.tsx` fits the panel to the viewport (`lib/fit.ts`), applies the theme (`lib/theme.ts`: Daylight, Dusk, or auto by clock; call `setSunTimes()` from the weather feature to follow the real sun), switches screens with a 320 ms slide and a swipe (`ScreenSwitcher`), and draws the dock with its sliding highlight (`Dock`). Screens are listed in `screens.ts`.

**Overlays.** `useOverlay()` from `app/overlay` gives every screen `openSheet(render)`, `confirm({ title, body, confirmLabel, danger }) → Promise<boolean>`, `showPopover(render, { durationMs })`, `toast(message)` and `closeAll()`. Sheets, dialogs and pop-overs share one scrim, animate with the standard curve and close on Escape or a tap outside. `SheetHeader` and `PopoverHeader` are ready-made top rows. Every overlay on the wall goes through these: the calendar's day sheet and quick add (`useDaySheet()` in `screens/month/DaySheet.tsx`), the Home screen's unlock and garage confirmations, the Alexa announce sheet, and refused calls as toasts. Switching screens or going Ambient closes them all.

**Moving between screens.** `useNav()` from `app/nav` gives a screen `go(id)`; the grocery card on Today opens Lists with it.

**Settings from the wall.** Hold the clock in the dock for about a second and confirm, and the display opens `/settings`; **Back to the display** returns. There is no visible button, so guests and children do not wander in. `?mode=daylight` or `?mode=dusk` on the URL pins the look (screenshots, kiosk tools, the smoke test).

**Ambient and the schedule.** After `schedule.idleSeconds` without a touch the display fades to Ambient (`app/ambient`): the server's album through `PhotoSlideshow` (`features/photos`, a 1.6 s cross-dissolve and slow drift; `placeholderPhotos()` stands in on the demo page and in tests), the time and date, and whatever features registered with `registerAmbientSlot()` (the shell registers the weather line, the Today screen the next event). From `ambientFrom` idle still goes to Ambient; from `offFrom` to `onAt` the screen is black; the brightness steps drive a software dimmer (`setBrightness()`), which a kiosk hook can mirror to hardware. The server's `display.sleep` and `display.wake` events and a `home.doorbell` override all of this. `prefers-reduced-motion` collapses every duration to 0.

**Layers over every screen.** Any export named `*Layer` from `src/features/<name>/index.tsx` is mounted once inside the panel above the screens and dock (the doorbell live view, for example); no change to the shell is needed.

## The contract

Everything the display and server exchange is defined once in `packages/shared/src`:

- `models.ts` — core types: `Person`, `Calendar`, `CalendarEvent`, `Countdown`, `Meal`, `WeatherSnapshot`, `LeaveBy`, `Photo`, `HomeArea`, `HomeEntity`, `Presence`, `MediaPlayer`, `List`, `ListItem`, `Chore`, `Settings`...
- `api.ts` — the route table (`routes`): method, path, query, body and response schema for every endpoint.
- `ws.ts` — WebSocket events (`WsEvent`), server to display, `{ type, payload }`.
- `client.ts` — `createApiClient()`, typed from the route table: `api.call('itemPatch', { params: { id }, body: { done: true } })`.
- `fixtures/` — a sample for every route and event, generated around "now"; the mock providers serve these and the tests check each against its schema.

The server validates every request against the route table and, outside production, every response too, so a shape that drifts from the contract fails loudly in dev and in tests.

### REST (under `/api`, JSON, header `x-mantel-device-key` on every call except pairing and health)

| Route                                                                          | Purpose                                                                |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `POST /pair`                                                                   | Exchange the 6-digit code from the server log for a device key         |
| `GET /bootstrap`                                                               | People, calendars, settings, theme, panel size, feature flags          |
| `GET /calendar?from&to`                                                        | Normalised events from Google and iCloud with people and colour        |
| `POST /calendar/quick`                                                         | Create a quick event                                                   |
| `GET /countdowns`                                                              | Upcoming tagged events with days remaining                             |
| `GET /meals?week`                                                              | Meal plan for the week (weeks start Monday)                            |
| `GET /weather`                                                                 | Current, hourly, daily, sun, UV, air quality, pollen, alerts           |
| `GET /commute`                                                                 | Leave-by times; empty outside the weekday morning window               |
| `GET /photos/next?n`                                                           | Next n photos sized for the panel, with dominant colour                |
| `GET /photos/:id`                                                              | Image bytes                                                            |
| `GET /home/state`                                                              | Allowed areas, entities, states and presence                           |
| `POST /home/call`                                                              | Call a Home Assistant service on an allowed entity                     |
| `POST /home/announce`                                                          | Alexa announcement on chosen Echos (needs the settings flag)           |
| `GET /home/cameras/:id/snapshot`, `GET /home/cameras/:id/stream`               | Camera still and live view for `<img>` (`?key=` accepted)              |
| `GET /home/connection`, `PUT /home/connection`, `POST /home/connection/test`   | Home Assistant address, token and on/off switch; a PUT reconnects live |
| `GET /home/discover`                                                           | Areas and entities Home Assistant has, for the room and device picker  |
| `GET /home/config`, `PUT /home/config`, `.../import-yaml`, `.../export-yaml`   | The stored allow-list (same shape as `home.yaml`); a PUT applies live  |
| `GET /media`, `POST /media/call`                                               | Apple TV now playing and transport controls                            |
| `GET /media/:id/artwork`                                                       | Now-playing artwork for `<img>` (`?key=` accepted)                     |
| `GET /lists`, `POST /lists/:id/items`, `PATCH /items/:id`, `DELETE /items/:id` | Lists and items, from the built-in store                               |
| `POST /lists`, `DELETE /lists/:id`                                             | Create or delete a list                                                |
| `GET /chores`, `POST /chores/:id/done`, `DELETE /chores/:id/done`              | Chore chart and stars; mark a chore done or take it back               |
| `POST /chores`, `DELETE /chores/:id`                                           | Add or retire a chore                                                  |
| `GET /settings`, `PUT /settings`                                               | Schedule, people, destinations, feature flags; a PUT reloads displays  |
| `GET /devices`, `PATCH /devices/:id`, `DELETE /devices/:id`                    | Paired displays: list, rename, revoke                                  |
| `GET /pairing-code`                                                            | The current pairing code, so a paired display can pair another         |
| `GET /display/state`                                                           | What the screen should do now: on/off, ambient, brightness             |
| `POST /display/reload`                                                         | Tell every display to reload                                           |
| `GET /health`                                                                  | Liveness and last sync times (no key needed)                           |

Errors are `{ "error": { "code", "message" } }` with codes `bad_request`, `unauthorized`, `forbidden`, `not_found`, `not_implemented` (501, a real integration not built yet), `upstream_error`, `internal`, `disabled` (503, the integration is turned off in Settings).

### WebSocket (`/ws?key=<device key>`)

`calendar.changed {from, to}` · `home.state {entity}` · `home.presence {presence}` · `home.doorbell {cameraEntityId, at, durationSeconds}` · `media.state {player}` · `list.changed {listId}` · `chores.changed {}` · `weather.updated {weather}` · `display.reload {}` · `display.wake {reason}` · `display.sleep {reason}`

In the display, `useServerEvent('home.doorbell', handler)` subscribes; the socket reconnects with backoff. `display.reload` is handled by the shell.

In mock mode you can push any event by hand:

```sh
curl -X POST localhost:8787/api/dev/doorbell
curl -X POST localhost:8787/api/dev/emit -H 'content-type: application/json' \
  -d '{"type":"list.changed","payload":{"listId":"list-grocery"}}'
```

### Changing the contract

Add, don't rename. New fields should be optional or have a default so other workstreams' fixtures still parse. Update the fixture in `packages/shared/src/fixtures/` in the same PR; `pnpm test` fails if a fixture and its schema disagree.

## Server internals

- `src/providers/types.ts` — one interface per integration. Routes only call providers.
- `src/providers/mock/` — fixture-backed, in-memory, used when `MOCK=1`.
- `src/providers/real/` — real integrations. One that is not configured (no token, no album link) answers 501 `not_implemented`, and the display leaves that card empty.
- `src/routes/index.ts` — registers every contract route with `handle(name, handler)`, which parses query and body, checks the device key and validates the response.
- `src/db/` — SQLite via Drizzle. Add tables to `schema.ts` and a `CREATE TABLE IF NOT EXISTS` to `db/index.ts`.
- `src/auth.ts` — pairing codes and device keys (only hashes are stored).

## Lists and chores

Lists live in the server's SQLite database. A fresh install starts with Grocery, Chores and To-do; items checked off leave the wall the next day and are deleted after 30 days.

Apple Reminders is not synced yet. iCloud stopped serving Reminders over CalDAV with iOS 13, so a server can't reach them with an app-specific password. A later sync (the native iPad shell or a Mac helper, both using EventKit) hooks into `ListStore.onChange` and the `remote_id` columns.

The chore chart counts completions per day. Each tap earns the chore's stars, a chore stops counting at its daily or weekly target, and tapping a finished chore takes the last tap back. Star tallies cover the current week, so they start again every Monday with no job to run.

**Phones:** open `http://<server>:8787/add` on a phone, pair it once with the code from the server log, and add it to the home screen. It adds to any list (with who it's for), ticks or removes items, creates lists, and sets up chores for the kids.

The Today screen's grocery card is `GroceryPeek` from `src/screens/lists`; tapping it opens the Lists screen.

## Pairing a display

Outside mock mode the display shows a pairing screen. The server prints a 6-digit code to its log on start (it rotates every 15 minutes); enter it on the tablet and the display stores a device key. In mock mode no key is needed and `000000` also pairs.

## Configuration

Everything is configured in the app. Open `/settings` (the first-run wizard at `/setup` walks through the same sections in order): home location, people, calendars, Home Assistant, photos and the other integrations. Values are stored in SQLite; secrets are encrypted at rest with a key the server creates in `DATA_DIR/secret.key` on first run (keep that file with the data folder). Saving takes effect without a restart. An admin PIN, set on first run, pairs new displays and opens Settings; the rotating code in the server log still works too.

Every integration is a plugin with a manifest that declares its setup fields, so Settings renders the cards and forms with no per-integration UI code. [`docs/plugins.md`](docs/plugins.md) explains the framework and how to add one.

Environment variables remain as optional fallbacks (a variable is read only when nothing is saved in Settings); see [`.env.example`](.env.example). The server loads `.env` from the repo root or `apps/server`. No secrets in the repo.

Backup: `POST /api/settings/export` returns one JSON bundle (secrets included only when a passphrase is given); `POST /api/settings/import` restores it. Health for support: `GET /api/health/details` has every integration's state, the last error in plain words and the last 50 log lines.

- Weather, leave-by times and the photo album: [`docs/weather-commute-photos.md`](docs/weather-commute-photos.md).

## Running the container

```sh
docker compose up --build       # http://localhost:8787, data in ./data
```

The image builds the display and serves it from the server on one port. Merges to `main` publish it as `ghcr.io/sorel123/mantel:latest`. [`deploy/README.md`](deploy/README.md) walks from the Unraid template to a paired iPad or Surface in kiosk mode; the settings page is at `/settings`.

## Home Assistant

Lights, plugs, thermostats, cameras and the doorbell, Apple TV and presence all come through Home Assistant. Set it up on the Settings page: address, token, a Test button, then tick rooms and devices from what Home Assistant has (`home.yaml` remains as an import/export format). What each integration gives you and the limits are in [`docs/home-assistant.md`](docs/home-assistant.md).

## Conventions

- TypeScript strict everywhere; `pnpm lint` and `pnpm format:check` must pass.
- Touch targets at least 56 px (`--tap`), landscape only, check at 1180×820 (iPad) and 1440×960 (Surface).
- Use the design tokens in `apps/display/src/styles/tokens.css`, never raw colours or durations.
- Each PR: green CI (including the smoke test) and a mock-mode screenshot or recording in the description.
- Overlays, navigation between screens, idle and the schedule belong to the shell; screens call `useOverlay()`, `useNav()` and `registerAmbientSlot()` rather than adding their own.
