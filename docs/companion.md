# The phone app, wall notes, notifications and Magic Import

Mantel's companion app is the family's remote for the wall. It lives at `/app` on the server
(`http://<server>:8787/app`; the old `/add` opens the same app) and installs on a phone's home
screen like any app. Five tabs along the bottom:

| Tab          | What it does                                                                            |
| ------------ | --------------------------------------------------------------------------------------- |
| **Lists**    | Add to any list with who it's for, tick and remove items, make lists, set up chores.    |
| **Calendar** | The next two weeks; add an event to any day with the same quick add the wall has.       |
| **Meals**    | The week's meals as the wall plans them; send a meal's ingredients to the grocery list. |
| **Chores**   | Each person's chores for today and the stars they have this week.                       |
| **Note**     | Write or draw a note that goes up on the wall.                                          |

Settings has a **Phone app** section with the address, a QR code, the install steps, the phones
that take notifications and the state of Magic Import.

## Install it on a phone

1. Open the address on the phone. The app shows an "Add to home screen" hint the first time.
2. **iPhone:** Safari, Share, **Add to Home Screen**. **Android:** Chrome, menu, **Install app**.
3. Open it from the icon and pair once with the admin PIN (the same PIN a tablet uses). The
   phone shows up under Settings, Displays, where it can be renamed or removed.

The app caches nothing: it is always live from the server, so a phone away from home needs a way
back in (a VPN or a reverse proxy), the same as the wall.

## Notes for the wall

A note is a few words or a finger drawing in one of five colours, from the Note tab or from the
wall's **+** button. It shows on the Today screen's **Notes** card (add it in Settings, Layout,
Your own) and as the newest note in the corner of Ambient. A note stays until tonight, for a
day, or until someone taps it on the wall to take it down. Notes are a plugin: server in
`apps/server/src/plugins/notes/`, the `notes` table, and a `notes.changed` event over the socket
so every screen updates together.

## Notifications

A phone can ask to be told about the **doorbell**, **chores** someone else finished, **leave-by
times** (ten minutes before), **rewards** redeemed on the wall and **new wall notes**. Each phone
picks its own events from the bell icon in the app and says whose phone it is, so nobody is
buzzed for their own chores.

Notifications are Web Push, sent by the server with a VAPID key pair it makes once and keeps in
the secrets store (`plugins/push/`, `push_subscriptions` table). No account with Apple or Google
is needed. Two things browsers require:

- **A secure address.** Phones can only subscribe when the app is opened over **https**, or on the
  computer that runs Mantel as `localhost` (the Windows and Mac installers open it there). Plain
  `http://192.168…` cannot subscribe; the bell explains this on the phone, and the Phone app
  section in Settings shows a note when the wall itself is opened insecurely.
- **On iPhone, the app must be on the home screen** (iOS 16.4 or later). Safari tabs cannot
  take Web Push.

A phone that stops answering (the browser dropped the subscription, a 404 or 410 from the push
service) is forgotten automatically. Settings lists every phone with the last send and any
problem, and can stop notifying one.

## Magic Import: read a flyer, a schedule or a list

Take a photo of a school flyer, a practice schedule, a menu or a shopping list, and Mantel
turns it into events, list items and meals to check over. Nothing is written until **Add** is
pressed: each thing found has a checkbox and editable fields (title, date, time, place, who,
which list). The camera button is on the Calendar and Lists tabs of the phone, and on the wall's
**+** button for the tablet's own camera.

It uses Claude (Anthropic's model) to read the photo, with the same key as the weather quips:
Settings, Weather quips, Claude API key. **The photo is sent to Anthropic to be read and is not
kept on the Mantel server.** The phone shrinks it to 1600 px first. The Phone app section says
plainly whether a key is set, and the import screen repeats the privacy note.

The server side is `plugins/import/`: `POST /api/import/analyse` returns the candidates (JSON
from a strict schema, never free text), and `POST /api/import/commit` writes the checked ones
through the normal calendar and lists routes; meals go into the meal planner (see
[`meals.md`](meals.md)), or onto the Meals calendar as "Dinner: Tacos" events while the planner
is off. In mock mode (`MOCK=1`) any photo returns the fixture flyer, so the flow can be tried
without a key.

## For developers

- Shared contract: `packages/shared/src/companion.ts` (notes, push, import schemas, fixtures).
- Display: `apps/display/src/screens/companion/` (the app, tabs, note composer, Magic Import,
  push helpers) and `screens/companion/wall/` (the wall's notes card, Ambient slot, add menu).
- PWA bits: `apps/display/public/manifest.webmanifest`, `public/sw.js` (push only; no caching),
  `public/icons/`.
- Screenshots: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node e2e/companion-shots.mjs` after
  `pnpm build`, into `docs/screenshots/v3-c-*.png`.
