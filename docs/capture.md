# Capture from anywhere

Anything with a date or a list on it reaches Mantel in one step, from wherever it arrived, and
nothing is added until someone says yes. Every capture lands in the **inbox**: the original (an
email body, a PDF, a photo, a calendar file, pasted text) beside the events, list items and meals
read from it. Each one is editable; **Add all**, **Add selected** or **Dismiss**. After an Add, a
toast offers **Undo** for ten seconds.

Where the inbox shows:

- **On the wall**: a chip with the count in the dock, right of the clock. Tap it for the review.
- **On a phone**: the **Inbox** tab of the phone app (`/app#inbox`), with a badge.

## Ways in

| Way                   | Works on                | Set up in                       |
| --------------------- | ----------------------- | ------------------------------- |
| Forward to Mantel     | any email app           | Settings › Capture              |
| Share sheet           | Android, desktop Chrome | install the phone app           |
| Send to Mantel        | iPhone and iPad         | Settings › Capture (a Shortcut) |
| Photo, file, or paste | the phone app Inbox tab | nothing                         |
| Read a photo (+)      | the wall's + button     | nothing                         |

### Forward to Mantel

Mantel checks a mailbox of its own every two minutes over IMAP and marks what it read as read.
It never sends mail. Mail from a sender who is not allowed is ignored and counted.

- **Allowed senders**: each person's email in Settings › Capture, plus "Also accept mail from"
  (addresses, or `@school.org` for a whole domain).
- **What becomes an item**: each PDF, photo and `.ics` attachment, and the body when it says
  something (a body alone, or one longer than a short "see attached"). Small inline images
  (signature logos) are skipped. A message is never added twice.
- **Gmail**: `imap.gmail.com:993`. Needs 2-Step Verification and an
  [app password](https://myaccount.google.com/apppasswords). A family Gmail can use
  `name+mantel@gmail.com` with a filter that labels it and skips the inbox; set Folder to the label.
- **iCloud Mail**: `imap.mail.me.com:993` with an app-specific password from
  [account.apple.com](https://account.apple.com/account/manage).
- **Another**: any IMAP server over TLS; type the server under the Mail service choice.

**Test** signs in and reports how many messages there are and the newest one. It sends nothing
and changes nothing.

### Share from a phone

**Android and desktop Chrome**: the installed phone app is a
[Web Share Target](https://developer.chrome.com/docs/capabilities/web-apis/web-share-target).
Share, then Mantel, from Gmail, Files, Photos or Chrome. The service worker (`/sw.js`) keeps what
was shared and opens `/app?shared=1#inbox`, which sends it in with the phone's device key.

**iPhone and iPad** have no web share target, so a Shortcut does it. Settings › Capture makes a
key for it (a device named "Send to Mantel (Shortcut)", revocable in Displays) and lists the
steps with Copy buttons:

1. Shortcuts, **+**, name it **Send to Mantel**, turn on **Show in Share Sheet**.
2. **Get Contents of URL**: `https://<your Mantel>/api/inbox/upload`, Method **POST**,
   header `x-mantel-device-key` = the key, Request Body **Form** with a **File** field named
   `file` set to **Shortcut Input**.
3. **Show Notification** with **Contents of URL**.

Camera photos are HEIC, which the server cannot open; the error says so, and adding **Convert
Image** (JPEG) before step 2 fixes it.

`POST /api/inbox/upload` takes `multipart/form-data` (fields `file`, repeated for several, `text`,
`url`, `title`, `hint`) or a raw body, the key in the header or a `key` field, and answers one
sentence the Shortcut can show (`accept: application/json` for JSON).

## Reading

- **Calendar files** (`.ics`, including invitations) are read directly: no key, no model call.
  Events in the next year, a repeating one once per date, at most 20.
- **Photos, PDFs and text** go to Claude (`claude-sonnet-5-5`) with the key saved in Settings ›
  Weather quips. PDFs are sent as documents (up to 100 pages). Without a key the item waits with
  a message saying so, and **Try again** reads it once a key is saved.
- Photos are scaled to 2000 px and turned upright before they are stored and read.

## API

All under `/api`, with the device key.

| Route                      | Purpose                                                     |
| -------------------------- | ----------------------------------------------------------- |
| `GET /inbox`               | Waiting items, then ones added in the last three days       |
| `GET /inbox/status`        | Can read, the forwarding address and state, allowed senders |
| `POST /inbox`              | `{ text }` or `{ file: data URL, name }`, optional `hint`   |
| `POST /inbox/upload`       | The form upload above                                       |
| `POST /inbox/:id/commit`   | The candidates kept, as edited; returns `undoUntil`         |
| `POST /inbox/:id/undo`     | Takes back what the commit wrote (30 s on the server)       |
| `POST /inbox/:id/retry`    | Read a failed item again                                    |
| `DELETE /inbox/:id`        | Dismiss                                                     |
| `GET /inbox/:id/original`  | The stored original (`?key=` accepted)                      |
| `POST /inbox/shortcut-key` | A device key for the Shortcut, shown once                   |

WebSocket: `inbox.changed { pending }`, plus `plugin.changed { id: 'inbox' }` for the dock chip.

## Mock mode

`MOCK=1` runs Forward to Mantel against a mailbox in memory holding the Lincoln Elementary
newsletter (a real PDF), Maya's party invitation (a real JPEG) and one advert from a stranger,
which is ignored. Everything else reads as the sample flyer, newsletter or invite.
`MOCK_EMPTY=1` leaves Forward to Mantel not set up and the inbox empty.
