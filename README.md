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

`MOCK=1` serves fixture data for every integration (calendar, weather, photos, Home Assistant, lists) and needs no accounts or pairing. Mock state is in memory: toggling a light or checking an item works and pushes WebSocket events, and resets on restart.

Other scripts: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm format`. CI runs all of them plus a container build on every PR.

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
| 6 Deployment & kiosk       | settings page                                                   | `Dockerfile`, `docker-compose.yml`, `deploy/`, `auth.ts`, `settings.ts`               |

Shared plumbing (`src/lib/api.ts`, `src/lib/events.ts`, `src/lib/bootstrap.tsx`, `server/src/contract.ts`, `server/src/app.ts`) belongs to the scaffold; change it only when a workstream truly needs to, and say so in the PR.

## The contract

Everything the display and server exchange is defined once in `packages/shared/src`:

- `models.ts` — core types: `Person`, `Calendar`, `CalendarEvent`, `Countdown`, `Meal`, `WeatherSnapshot`, `LeaveBy`, `Photo`, `HomeArea`, `HomeEntity`, `Presence`, `MediaPlayer`, `List`, `ListItem`, `Chore`, `Settings`...
- `api.ts` — the route table (`routes`): method, path, query, body and response schema for every endpoint.
- `ws.ts` — WebSocket events (`WsEvent`), server to display, `{ type, payload }`.
- `client.ts` — `createApiClient()`, typed from the route table: `api.call('itemPatch', { params: { id }, body: { done: true } })`.
- `fixtures/` — a sample for every route and event, generated around "now"; the mock providers serve these and the tests check each against its schema.

The server validates every request against the route table and, outside production, every response too, so a shape that drifts from the contract fails loudly in dev and in tests.

### REST (under `/api`, JSON, header `x-mantel-device-key` on every call except pairing and health)

| Route                                                                          | Purpose                                                         |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `POST /pair`                                                                   | Exchange the 6-digit code from the server log for a device key  |
| `GET /bootstrap`                                                               | People, calendars, settings, theme, panel size, feature flags   |
| `GET /calendar?from&to`                                                        | Normalised events from Google and iCloud with people and colour |
| `POST /calendar/quick`                                                         | Create a quick event                                            |
| `GET /countdowns`                                                              | Upcoming tagged events with days remaining                      |
| `GET /meals?week`                                                              | Meal plan for the week (weeks start Monday)                     |
| `GET /weather`                                                                 | Current, hourly, daily, sun, UV, air quality, pollen, alerts    |
| `GET /commute`                                                                 | Leave-by times; empty outside the weekday morning window        |
| `GET /photos/next?n`                                                           | Next n photos sized for the panel, with dominant colour         |
| `GET /photos/:id`                                                              | Image bytes                                                     |
| `GET /home/state`                                                              | Allowed areas, entities, states and presence                    |
| `POST /home/call`                                                              | Call a Home Assistant service on an allowed entity              |
| `GET /media`, `POST /media/call`                                               | Apple TV now playing and transport controls                     |
| `GET /lists`, `POST /lists/:id/items`, `PATCH /items/:id`, `DELETE /items/:id` | Lists, backed by Reminders or the built-in store                |
| `GET /chores`, `POST /chores/:id/done`                                         | Chore chart and stars                                           |
| `GET /settings`, `PUT /settings`                                               | Schedule, people, destinations, feature flags                   |
| `GET /health`                                                                  | Liveness and last sync times (no key needed)                    |

Errors are `{ "error": { "code", "message" } }` with codes `bad_request`, `unauthorized`, `forbidden`, `not_found`, `not_implemented` (501, a real integration not built yet), `upstream_error`, `internal`.

### WebSocket (`/ws?key=<device key>`)

`calendar.changed {from, to}` · `home.state {entity}` · `home.doorbell {cameraEntityId, at, durationSeconds}` · `media.state {player}` · `list.changed {listId}` · `weather.updated {weather}` · `display.reload {}` · `display.wake {reason}` · `display.sleep {reason}`

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
- `src/providers/real/` — real integrations; until a workstream lands, each answers 501 `not_implemented`.
- `src/routes/index.ts` — registers every contract route with `handle(name, handler)`, which parses query and body, checks the device key and validates the response.
- `src/db/` — SQLite via Drizzle. Add tables to `schema.ts` and a `CREATE TABLE IF NOT EXISTS` to `db/index.ts`.
- `src/auth.ts` — pairing codes and device keys (only hashes are stored).

## Pairing a display

Outside mock mode the display shows a pairing screen. The server prints a 6-digit code to its log on start (it rotates every 15 minutes); enter it on the tablet and the display stores a device key. In mock mode no key is needed and `000000` also pairs.

## Configuration

All configuration is environment variables; see [`.env.example`](.env.example). The server loads `.env` from the repo root or `apps/server`. No secrets in the repo.

## Running the container

```sh
docker compose up --build       # http://localhost:8787, data in ./data
```

The image builds the display and serves it from the server on one port. Unraid template, kiosk setup for iPad and Surface, and the settings page arrive with workstream 6.

## Conventions

- TypeScript strict everywhere; `pnpm lint` and `pnpm format:check` must pass.
- Touch targets at least 56 px (`--tap`), landscape only, check at 1180×820 (iPad) and 1440×960 (Surface).
- Use the design tokens in `apps/display/src/styles/tokens.css`, never raw colours or durations.
- Each PR: green CI, a mock-mode screenshot or recording in the description, and no changes to another workstream's folders beyond the shared contract.
