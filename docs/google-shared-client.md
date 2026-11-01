# Mantel's shared Google sign-in

Mantel can ship one Google OAuth client so a household only presses **Connect Google** and signs in, with no Google Cloud console. The project makes this client once. This page is for whoever maintains the Mantel build (today, Jay), not for households.

## Why a Desktop client

- Google treats a **Desktop app** client's secret as public, because it ships inside every installed copy. So it can live in the source (`apps/server/src/plugins/google/shared-client.ts`).
- A Desktop client accepts a loopback redirect (`http://127.0.0.1:<any port>/...`) with nothing to register. Mantel sends sign-in back to `http://127.0.0.1:<PORT>/api/calendar/google/callback`. On the computer running Mantel that finishes by itself; anywhere else the card shows the paste-back box.
- Google's device flow (enter a code on your phone) would be nicer on a wall, but it doesn't allow Calendar scopes.

## Make the client (about 15 minutes, once)

1. Open the [Google Cloud console](https://console.cloud.google.com/projectcreate) and create a project named **Mantel**.
2. Enable the [Google Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com) for it.
3. Open [Google Auth Platform › Branding](https://console.cloud.google.com/auth/branding). App name **Mantel**, your email as support and developer contact. Logo and homepage can wait until verification.
4. [Audience](https://console.cloud.google.com/auth/audience): **External**, then **Publish app**. Don't leave it in Testing, or every sign-in expires after 7 days.
5. [Data access](https://console.cloud.google.com/auth/scopes): add `https://www.googleapis.com/auth/calendar.calendarlist.readonly` and `https://www.googleapis.com/auth/calendar.events`.
6. [Clients](https://console.cloud.google.com/auth/clients) › **Create client** › Application type **Desktop app**, name **Mantel**. Download the JSON.
7. Put the client ID and secret into `BUILT_IN` in `apps/server/src/plugins/google/shared-client.ts` (or send them to Claude to commit). A build can also set `MANTEL_GOOGLE_CLIENT_ID` and `MANTEL_GOOGLE_CLIENT_SECRET` instead.

## What households see until it's verified

- A "Google hasn't verified this app" screen. They press **Advanced › Go to Mantel (unsafe)** and continue.
- Google caps an unverified app at **100 users** in total (each Google account that ever signs in counts).

## Getting verified later (free)

When more than a handful of people use it, submit the app for verification in [Verification centre](https://console.cloud.google.com/auth/verification). Google wants:

- A homepage on a domain you own (a GitHub Pages site for the repo is fine once the domain is verified in Search Console).
- A privacy policy page. Mantel keeps calendar data only on the household's own server and sends it nowhere else, which makes this short.
- A YouTube video (unlisted is fine) showing the sign-in and what the app does with the calendar.
- Why each scope is needed: the calendar list to choose calendars, and events to show, add and edit them on the wall.

`calendar.events` is a _sensitive_ scope, not a _restricted_ one, so there is no paid security assessment. Expect a few days to a few weeks.

## If the client is ever replaced

Refresh tokens belong to the client that issued them. After swapping the client, every household presses **Connect Google** once more. Households using their own client (Advanced fields) are unaffected.
