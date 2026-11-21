# Mantel Reminders (Mac helper)

A menu-bar app that keeps Apple Reminders lists in step with Mantel lists, both ways, while the
Mac is awake. Reminders can only be read on an Apple device (EventKit), so this small helper
does the reading and writing; the Mantel server holds the sync state and decides what changes.

- `Sources/MantelSyncCore`: the wire format and the check-in loop, plain Foundation, tested with
  XCTest (`swift test`).
- `Sources/MantelReminders`: the app: EventKit, the menu, pairing, Open at login.
- `App/build-app.sh`: builds the universal `.app`, signs it ad hoc and zips it. The packaging
  workflow runs it on a macOS runner and attaches `MantelReminders-mac.zip` to releases.

Setup for a household is in [docs/list-sharing.md](../../docs/list-sharing.md).
