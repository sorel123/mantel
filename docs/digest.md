# Morning digest, reminders and "since you last looked"

Mantel sends each person their day on their phone, reminds them before things happen, and tells the
family what changed while they were away. Set it up in **Settings, Digest and reminders**
(`/settings#digest`).

## The morning digest

Each person gets one notification at the time they choose (7:00 on weekdays and 8:00 at weekends by
default): today's events with leave-by times, their chores and routines (a missed chore that rolls
over says "since Tuesday"), tonight's dinner, the weather in one line with any warning, birthdays,
and reminders from plugins such as trash day. Tapping it opens the digest page in the phone app
(`/app#digest`); the sun button at the top of the phone app opens it any time. An evening "tomorrow"
preview can be turned on per person. With the Claude key from Weather quips, an optional friendly
first line sums up the day (off by default).

A phone gets a person's digest once it says whose it is: in the phone app tap the bell, turn
notifications on and choose the person. **Send me a test digest** in Settings sends one now and
shows it on the page.

Times follow the household's time zone (`Settings, Your home`), so a server in UTC still sends at
7:00 local, and clock changes move nothing. A send that was missed (the server was off) still goes
within three hours.

## Reminders

- **Events**: 30 minutes before (or 10, 15, 60, or off), with a per-calendar override; sent to the
  phones of the people on the event.
- **Routines**: at 16:30, to a person whose routine steps are still open.
- **Dinner**: at 15:00, "Dinner is not planned" when tonight has no dinner.

**Quiet hours** (21:30 to 06:30 by default) hold all of these back; a digest due inside them goes
when they end. Each kind can be switched off on the phone (Morning digest, Reminders).

## Chores that roll over

A chore that was not finished carries over with a "since Tuesday" marker instead of quietly resetting.
It is on by default for weekly chores and off for daily ones; `PATCH /api/chores/:id { rollover }`
changes it (`null` goes back to the default).

## Since you last looked

The wall's Today screen and the top of the phone app show what changed since that device last
looked ("Sam added Dentist on Thursday", "3 things added to Grocery"). Tap a line to jump to it;
the strip clears itself. It comes from the activity log (`GET /api/activity?since=`), which records
new list items, finished chores, added or moved events, planned meals, wall notes and redeemed
rewards from the server's own change events.

## Deep links

Notifications open the exact thing: `/app#chores/<choreId>`, `/app#calendar/<eventId>`,
`/app#lists/<listId>`, `/app#meals/<date>`, `/app#digest/morning:<personId>`.

## On the wall

Add **Today at a glance** in Settings, Layout, Your own for the digest as a card. For the first hour
after the earliest morning digest, Ambient shows a good-morning line.
