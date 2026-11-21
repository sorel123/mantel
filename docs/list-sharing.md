# Sharing lists with other apps

Any Mantel list can be kept in step with one list somewhere else, both ways: ticks, adds,
renames and deletes. Set it up in **Settings › Lists and chores › Share lists with other apps**:
press **Share this list with…** beside a list, pick a service, pick its list.

| Service | How | Direction | Speed |
| --- | --- | --- | --- |
| Apple Reminders | Mantel Reminders helper on a Mac | Both ways | Seconds, while the Mac is awake |
| Apple Reminders, no Mac | An iPhone Shortcuts automation | Reminders → Mantel only | When the automation runs |
| Todoist | API token | Both ways | Within a minute |
| Home Assistant to-do lists | The Home Assistant connection | Both ways | Seconds to two minutes |

## Why not Apple Notes

Apple Notes has no API, no sync protocol and no way for another app to read or change a note, on
any platform. Nothing can stay in step with it, so Mantel doesn't pretend to. Apple Reminders is
the Apple route: it syncs over iCloud to every iPhone, iPad and Mac, and shared family lists work.

## Siri and Alexa

- **Siri** adds to Reminders. Once a list is shared with Reminders, "Hey Siri, add milk to
  Groceries" lands on the wall a few seconds later (the helper is woken by the Reminders change).
- **Alexa**: Home Assistant's *Alexa Devices* integration (Home Assistant 2026.7 and later) gives
  Alexa's shopping and to-do lists as to-do entities. Share a Mantel list with that entity and
  "Alexa, add eggs to my shopping list" reaches the wall too.

## Apple Reminders with the Mac helper

Reminders left CalDAV in iOS 13, so only code on an Apple device (EventKit) can read it. The helper
is a small menu-bar app; the server keeps all sync state.

1. Download `MantelReminders-mac.zip` from the [latest release](https://github.com/sorel123/mantel/releases/latest)
   (also built for every pull request that touches `helpers/reminders-mac/`, under the *Package apps*
   run's artifacts) and drag **Mantel Reminders** into Applications.
2. It isn't notarised by Apple yet, so the first time **right-click it › Open**, then Open again.
3. Allow access to Reminders. Enter the Mantel address and a pairing code (Settings › Lists and
   chores › Apple Reminders on a Mac › Show a pairing code, or Settings › Displays).
4. Turn on **Open at login** in its menu.

It checks in every 10 seconds (2 seconds while it has changes to carry), straight away when
Reminders changes, and when the Mac wakes. While the Mac sleeps, changes on both sides wait and
are merged when it wakes. macOS 13 or later.

## Apple Reminders without a Mac (Shortcuts, one way)

In Settings, open *No Mac? Use a Shortcut* and press **Make a key**. Then in Shortcuts:

1. **Find Reminders** where *List* is your list and *Is Completed* is off.
2. **Get Details of Reminders**: *Title*.
3. **Get Contents of URL**: `POST https://<your mantel>/api/lists/sync/shortcut`, header
   `x-mantel-device-key: <the key>`, JSON body `list` = the Mantel list's name, `items` = the titles.
4. **Automation**: run it every hour (or on leaving or arriving home), without asking.

New reminders are added to the Mantel list; items the last run listed that have left Reminders are
ticked. Changes on the wall do not go back. Best effort: it only runs when iOS runs the automation.

## Todoist

Paste your API token (Todoist › Settings › Integrations › Developer) under Integrations › Todoist
and press Test. A Mantel list links to one Todoist project. Mantel uses Todoist's API v1 Sync
endpoint (`https://api.todoist.com/api/v1/sync`) with the token as a Bearer token: full reads of
projects and items, and `item_add`, `item_update`, `item_close`, `item_uncomplete`, `item_delete`
commands. Todoist only returns open tasks, so a task ticked in Todoist shows ticked on the wall, and
unticking it on the wall reopens it. Polled every minute, and synced a moment after any change on
the wall.

## Home Assistant to-do lists

Uses the Home Assistant connection already set up for the Home screen; nothing else to enter. Any
`todo.*` entity can be picked. Mantel calls `todo.get_items` (with a response), `todo.add_item`,
`todo.update_item` (by uid, with `rename` and `status`) and `todo.remove_item`, and syncs as soon
as an entity's state (its open count) changes, otherwise every two minutes.

What that reaches, checked against home-assistant.io on 2026-11-21:

| Home Assistant integration | To-do entity, add, rename, tick, remove | Notes |
| --- | --- | --- |
| Local to-do, Shopping list | Yes | Built in |
| Google Tasks | Yes | Changes made in Google reach HA on its poll (30 min default) |
| Todoist | Yes | Or use Mantel's own Todoist link above |
| AnyList | Yes | Official since 2026.11; unofficial AnyList API, may break |
| Alexa Devices (Alexa lists) | Yes | Official since 2026.7; replaced the HACS "Alexa todo lists" add-on |
| Bring! | Has HA actions; to-do entities not confirmed on the pages checked | |
| Microsoft To Do | No official integration found | A HACS custom integration exists |

## How the sync works

`apps/server/src/providers/real/lists-sync.ts`. Each round is a three-way merge against the text
and tick both sides last agreed on:

- A change on one side is carried to the other. Same-named items are matched on the first link.
- Both sides renamed: the later change wins.
- Ticks are never lost: the tick merges separately from the text. Ticked on one side and deleted on
  the other ends up deleted. Deleted on one side but renamed on the other: the rename survives.
- The round's own changes don't start another round, and a service reporting our write back
  matches the base, so nothing echoes.
- A failed round changes nothing; the next one carries everything made meanwhile.

The status of every link is in Settings (In step, Syncing, Waiting, Problem with the reason), and
each service's card in Integrations and Health summarises its links.
