# Open Mantel: tokens, Siri, Alexa, Home Assistant and Claude

Mantel can be reached by other systems with **API tokens**: Siri Shortcuts, an Alexa skill, Home
Assistant, Claude (over MCP) and your own scripts. Everything is set up from **Settings › Siri
and assistants** (`/settings#open`), which fills each guide in with your address and token.

## Tokens

- Made in Settings behind the admin PIN, named ("Siri", "Home Assistant"), shown **once**, stored
  only as a SHA-256 hash. Settings lists each token's first characters and when it was last used.
  Revoking one stops it at once. Paired displays and phones keep their own device keys.
- Sent as `Authorization: Bearer mtl_...` (or the `x-mantel-token` header). Only the Alexa
  endpoint and MCP take `?token=` in the URL, for clients that cannot send headers.
- Scopes:

| Scope      | Lets the token                                                                   |
| ---------- | -------------------------------------------------------------------------------- |
| `read`     | read the calendar, lists, meals, chores, stars, notes, weather, `/api/today.txt` |
| `lists`    | add, tick off and delete list items                                              |
| `calendar` | add, change and delete events                                                    |
| `meals`    | plan meals                                                                       |
| `chores`   | mark chores done and undo them                                                   |
| `capture`  | `POST /api/say` for anything it understands, and post wall notes                 |
| `admin`    | every route a paired display can use                                             |

The route-to-scope table is `TOKEN_ROUTE_SCOPES` in `packages/shared/src/open.ts`; a route that is
not listed answers only to device keys and `admin` tokens. `/api/say` also checks the scope of
what the phrase turned into (a `lists` token may add items by voice but not events).

## Natural add: `POST /api/say`

```http
POST /api/say
Authorization: Bearer mtl_...
Content-Type: application/json

{ "text": "dentist Tuesday at 3", "personId": "ava", "dryRun": false }
```

Answers `{ ok, speech, action, parser, dryRun }`. `speech` is a sentence to read back ("Added
Dentist on Tuesday at 3 PM."). What phrases become:

| Phrase                                                           | Becomes                             |
| ---------------------------------------------------------------- | ----------------------------------- |
| "milk and eggs", "we're out of coffee"                           | items on the default list (Grocery) |
| "add tape to the hardware list", "grocery list: yogurt, berries" | items on that list (made if new)    |
| "dentist Tuesday at 3", "Ava's recital Dec 12 from 2 to 4"       | a calendar event (with people)      |
| "soccer Saturday"                                                | an all-day event                    |
| "tacos Thursday", "pancakes for breakfast Sunday"                | a meal on the planner               |
| "note: back at 5", "leave a note for Ava saying ..."             | a wall note                         |

The rules run first and need no Claude key: list names, people's names, weekdays, "tomorrow",
"tonight", "Dec 3", "the 15th", "12/2", times like "at 3" (1 to 6 means afternoon), "3:30pm",
"noon", "from 2 to 4", "for an hour". With a Claude key saved (Settings › Weather quips) and
**Let Claude help** on, long or unclear phrases go to Claude (`claude-sonnet-5-5`), with the
rules' answer kept if Claude is slow or fails. Choose the default list in Settings.

## Siri

Settings has three Shortcuts recipes with every field and a Copy button:

1. **Add to Mantel**: Dictate Text → Get Contents of URL (POST `/api/say`, JSON `text`) → Speak
   the `speech` value.
2. **Send to Mantel** from the share sheet: the same with Shortcut Input and `source: share`.
3. **What's on today**: GET `/api/today.txt` (or `?day=tomorrow`) → Speak Text.

Events Siri adds to an iCloud or Google calendar that Mantel already reads show up with no setup.

## Alexa

What was verified (November 2026):

- Amazon shut its List API to other apps on **1 July 2024**, so "Alexa, add milk to my shopping
  list" cannot reach Mantel (or any other list app except through Amazon's own).
- Alexa can link an **iCloud, Google or Microsoft calendar** (Alexa app › Settings › Calendar).
  Events added by voice land on that calendar, and so on the wall. Nothing to build.
- A **private custom skill** in the Alexa developer console can use any HTTPS endpoint. Mantel
  answers one at `POST /api/alexa?token=mtl_...` (intents `AddIntent` with an
  `AMAZON.SearchQuery` slot, `TodayIntent`, `TomorrowIntent`). In development mode it works on
  every Echo on the account with no certification and no AWS account: "Alexa, ask Mantel to add
  milk and eggs". Settings gives the interaction model JSON and the endpoint. Mantel must be on
  an https address reachable from the internet (Nabu Casa, a Cloudflare tunnel, Tailscale
  Funnel). Requests older than 150 seconds are refused. The skill's request signature is not
  checked; the token in the URL is the key, so keep that URL private.
- Home Assistant's own Alexa custom skill (`alexa.intent`) also works but needs an AWS Lambda;
  the direct endpoint above is simpler. Alexa routines can still run a Home Assistant script
  that calls `rest_command.mantel_say` with a fixed phrase.

## Home Assistant

**The Mantel integration** (`custom_components/mantel/`, installable with HACS as a custom
repository, `https://github.com/sorel123/mantel`, type Integration). Config flow: address and a
token (`read`, `lists`, `chores`, `capture`). It polls `GET /api/open/state` every 30 seconds and
gives:

- Sensors: Dinner tonight, Next event (and its time), Grocery list (open items, every list's
  count as attributes), Inbox, and per person "chores left" and "stars".
- A calendar entity per Mantel calendar.
- Events on the bus: `mantel_chore_done`, `mantel_reward_redeemed`, `mantel_said`
  (`person`, `person_id`, `title`, `stars`, `at`).
- Services: `mantel.say` (returns `speech`), `mantel.add_item` (`item`, `list`),
  `mantel.post_note` (`text`).

To-do entities for Mantel's lists are left to the lists workstream: add `Platform.TODO` and a
`todo.py` reading `coordinator.data["state"]["lists"]`.

**Without the integration**, Settings generates a `rest_command` plus Assist sentences
("add milk and eggs to Mantel") that call `/api/say`.

Tests: `integrations/home-assistant/` runs pytest with `pytest-homeassistant-custom-component`
against a real Mantel server in mock mode (`pnpm build` first), in CI as its own job.

## Claude and other MCP clients

`POST /mcp` speaks MCP over streamable HTTP (plain JSON answers, stateless). Tools, filtered by
the token's scopes: `get_today`, `get_agenda`, `get_lists`, `get_meals`, `get_chores`,
`add_event`, `add_items`, `plan_meal`, `post_note`, `complete_chore`, `say`.

```sh
claude mcp add --transport http mantel https://mantel.example/mcp --header "Authorization: Bearer mtl_..."
```

Claude Desktop can use `npx mcp-remote <url> --header "Authorization: Bearer ..."`. Claude on the
web adds custom connectors by address, which needs Mantel on a public https address.

## Home Assistant state: `GET /api/open/state`

One call with tonight's dinner, the next event, inbox count, every list's open count, each
person's chores and stars, the calendars, and the last 50 activity entries (chores done,
rewards redeemed, things said). Shape: `OpenState` in `packages/shared/src/open.ts`.
