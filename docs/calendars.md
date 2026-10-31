# Calendars

The wall shows Google and iCloud calendars together. The server syncs them into SQLite every few minutes, so the display never waits on Google or Apple and keeps working through an outage.

## What it does

- **Today**: the date, the weather card (WS4) and grocery peek (WS5) on the left. On the right the agenda: all-day bands, up to three countdown chips, a timeline with a now line (past events fade, the current one is highlighted, leave-by chips sit under the events they are for), tonight's meal, and the next three days with their dinners. The ＋ button adds an event for today; tapping a day opens its sheet.
- **Month**: six weeks from the Sunday before the 1st, as many event pills as fit plus "+n more", paging with the arrows, a sideways swipe, or Today. Tapping a day opens the day sheet.
- **Day sheet and quick add**: the day's events, and a form with a title, a day, all day or a start time and length, who it is for, and (when there is more than one) which calendar.
- **People and colours**: each calendar belongs to some people (chosen on the setup page). An event takes its calendar's people, narrowed or extended by names in the title: "Leo soccer" on the Kids calendar is Leo's; "Lunch with Sam" on Jay's calendar is Jay's and Sam's. Its colour is the first person's colour, else the calendar's.
- **Countdowns**: any event with ⭐ or `#countdown` in its title or description. The tag is hidden on the wall.
- **Meal plan**: events on the calendar named **Meals** (or the one marked Meals on the setup page). "Breakfast:", "Lunch:" or "Dinner:" at the start of the title picks the slot; otherwise the time does (all-day events are dinner). Meal events stay off the timeline.

## Setting it up

All of this happens once, on any computer on the home network, in **Settings › Calendars** (`http://<server>:8787/settings#calendars`). The page asks for the admin PIN or the 6-digit pairing code from the server log first; the old `/api/calendar/setup` address redirects there.

### Google

1. In the [Google Cloud console](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com), create a project and enable the **Google Calendar API**.
2. In **Google Auth Platform**, set the audience to **External**, then press **Publish app**. Publishing matters: while an app is in "Testing", Google expires its sign-in after 7 days. Google will show an "unverified app" warning when you sign in; for an app only your household uses, that is expected and you can continue.
3. Under **Clients**, create an OAuth client of type **Web application** and add the authorised redirect URI the setup page shows. With the default `PUBLIC_URL` on a home network that is:

   ```
   http://localhost:8787/api/calendar/google/callback
   ```

   Google only accepts `https` addresses or `localhost`, so on a plain `http://192.168.x.x` or `http://tower.local` server the setup page uses `localhost` and a **paste-back** step: after you allow access, your browser lands on a `localhost` page that does not load; copy the whole address from the browser bar into the setup page and press Finish. If the server has an https address (`PUBLIC_URL=https://...`, for example through a reverse proxy or Tailscale Funnel), the redirect is `https://<that address>/api/calendar/google/callback` and there is no paste-back.

4. In **Settings › Calendars** paste the client ID and secret (or drop the downloaded client JSON on the card to fill both), press **Save**, then **Connect Google**. No restart is needed. (`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the environment still work as fallbacks until something is saved.)

Mantel asks for two scopes: see the list of calendars, and view and edit events (quick add writes events). The refresh token is stored in the server's SQLite file in `DATA_DIR`.

### iCloud

1. At [account.apple.com](https://account.apple.com), under Sign-In and Security, create an **app-specific password**.
2. In **Settings › Calendars** enter the Apple ID email and the app-specific password on the iCloud card and press **Test**, then **Save** (`ICLOUD_USERNAME` and `ICLOUD_APP_PASSWORD` in the environment are fallbacks). Calendars shared with that Apple ID appear once the invitation is accepted on an Apple device.

### Choosing what shows

The setup page lists every calendar from both accounts. For each one choose whether it shows, its name and colour on the wall, whose it is, whether it is the meal plan, and which calendar quick add writes to by default. Google calendars start shown if they are ticked in Google Calendar; iCloud calendars start shown.

## How syncing works

- The cache covers 62 days back and 366 days ahead (`CALENDAR_PAST_DAYS`, `CALENDAR_FUTURE_DAYS`). Paging the Month view outside that window asks Google and iCloud directly.
- Every `CALENDAR_POLL_SECONDS` (default 180) the server re-reads each shown calendar and tells the display what changed with `calendar.changed`. iCloud calendars whose `ctag` has not changed are skipped.
- When `PUBLIC_URL` is https, the server also opens Google push channels, so changes made on a phone reach the wall within seconds, and the poll slows to `CALENDAR_PUSH_POLL_SECONDS` (default 900) when there is no iCloud account. Channels are renewed before they expire.
- Recurring events are expanded by Google (`singleEvents`) and, for iCloud, by ical.js, including moved and cancelled occurrences. Events you declined in Google are hidden.
- `/api/health` reports the last good calendar sync; the setup page shows each account's last sync and last error.

## Files

| Where                                        | What                                                                    |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| `apps/server/src/providers/real/calendar/`   | Provider, Google and CalDAV clients, ICS, cache, mapping, setup page    |
| `apps/server/src/providers/mock/calendar.ts` | Fixture-backed provider for `MOCK=1`                                    |
| `apps/display/src/screens/today/`            | Today screen, data hooks and formatting, shared event pieces and styles |
| `apps/display/src/screens/month/`            | Month grid, day sheet, quick add                                        |
