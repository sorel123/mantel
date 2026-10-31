# Home Assistant on the wall

Mantel talks to Home Assistant (HA) only. Every device reaches the wall through an HA integration, and the display sees only the rooms and devices you tick on the Settings page (nothing from HA shows until you do).

| On the wall                   | HA integration                                | Notes                                                                                         |
| ----------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Hue bulbs                     | Philips Hue (built in)                        | Press the bridge button when HA asks.                                                         |
| Caséta dimmers                | Lutron Caséta (built in)                      | Press the Smart Bridge button when HA asks.                                                   |
| Meross plugs                  | Meross LAN (HACS)                             | Show up as `switch.*`.                                                                        |
| ecobee thermostats            | ecobee (built in)                             | One card with a tab per thermostat; heat, cool and auto (a low–high range).                   |
| Ring cameras and doorbell     | Ring (built in)                               | Snapshot tiles; tap for live; a doorbell press pops the live view over every screen for 30 s. |
| Apple TV now playing          | Apple TV (built in)                           | Found automatically; artwork is proxied through the Mantel server.                            |
| Presence                      | `person.*` (HA companion app on each phone)   | Wakes the screen when someone gets home, sleeps it when everyone is out.                      |
| Alexa announcements, optional | Alexa Media Player (HACS) + the settings flag | Speaks a preset or typed message on chosen Echos.                                             |

## Set up

Everything happens on the Settings page (hold the clock in the dock, or open `/settings` from a phone or laptop), in the **Home Assistant** section. No files, no restart.

1. In HA, add the integrations above (Settings > Devices & services > Add integration). Put devices in areas: Mantel offers each HA area as a room.
2. **Address.** Home Assistant as the Mantel server reaches it, for example `http://homeassistant.local:8123` or `http://192.168.1.20:8123`.
3. **Token.** Tap **Get it here**: it opens your HA profile's Security tab. Create a long-lived access token, paste it once. It is stored on the server and shown as dots from then on.
4. **Test** tells you in one sentence whether that address and token work ("Connected to Home Assistant 2026.10.2", "refused the token", "nothing answered at…"). **Save connection** applies it at once.
5. **Rooms.** Every HA area is listed. Turn on the ones for the wall and drag (or use the arrows) to order them. Open **Devices** in a room to untick the odd plug, rename a light for the display, or mark a lock or garage door **Read-only**. Sensors are never pulled in by themselves: tick the ones you want. **Add a device from elsewhere** puts anything HA has into a room, and **Add a room of your own** makes a room from hand-picked devices ("Kids").
6. **Scenes**, the **Doorbell** (which camera pops over the screen, and what rings it: Ring's `event.*_ding`, a binary sensor, or any entity), and **Who is home** (each person's `person.*`) are below the rooms.
7. **Save rooms and devices.** The server applies it live and every display reloads itself.

The on/off switch at the top hides the Home screen and the doorbell pop-over, and stops the server talking to HA, without forgetting anything.

### Files, if you like them

The same setup can be a `home.yaml` (`config/home.example.yaml` shows the shape): **Import home.yaml**, **Download** and **Copy** are at the bottom of the section. A `home.yaml` at `HA_ALLOWLIST` is imported once, the first time the server starts with an empty database, so an install that used the file keeps its rooms; after that the file is not read again. `HA_URL` and `HA_TOKEN` in the environment are used until an address and token are saved in Settings (the section says "come from the environment for now").

`/api/health` shows `lastSync.home` once HA is connected; the server log says `home: connected to Home Assistant (N entities)`.

## How it works

- One WebSocket to HA (`/api/websocket`): it authenticates with the token, subscribes to state changes, loads states and the area, device and entity registries, and pings every 30 s. If HA restarts the server reconnects with backoff (1 s up to 30 s) and pushes whatever changed while it was away.
- The allow-list lives in SQLite (`kv` key `home.config`, the same shape as `home.yaml`); `GET/PUT /api/home/config`, `POST /api/home/config/import-yaml` and `GET /api/home/config/export-yaml` edit it. `GET /api/home/discover` lists HA's areas and entities for the picker. `GET/PUT /api/home/connection` and `POST /api/home/connection/test` manage the address, token and on/off switch; a PUT reconnects at once. While the switch is off, `/api/home/*` answers `503 disabled` and `GET /api/bootstrap` reports `integrations.homeassistant.enabled: false`, which hides the Home screen and the doorbell layer.
- `GET /api/home/state` and `POST /api/home/call` only touch allow-listed entities. Calls are limited per domain (`light.turn_on` with brightness, `lock.unlock`, `climate.set_temperature`...), unknown data keys are refused, and `read_only: true` entities are view-only.
- State changes go to the display as `home.state`, presence as `home.presence`, Apple TV as `media.state`, and a doorbell press as `home.doorbell` (at most one every 15 s, and only while the "Doorbell pop-over" flag is on).
- Camera images and Apple TV artwork are proxied by the server (`/api/home/cameras/:id/snapshot`, `/stream`, `/api/media/:id/artwork`), so the tablet never needs HA's address or token. Live streams stop when the display closes them and after `HA_STREAM_MAX_SECONDS` at most.

## Limits worth knowing

- **Ring live view.** HA exposes Ring live video over WebRTC, which an `<img>` cannot play, so through HA's MJPEG proxy a Ring camera most likely shows snapshots refreshing every few seconds rather than full-motion video (untested against a real Ring yet). Cameras with an RTSP or MJPEG source show real motion. Full-motion Ring video on the wall means adding WebRTC to the pop-over through HA's built-in go2rtc, a contained follow-up.
- **Ring snapshots** in HA refresh on motion and dings, so a tile can be a few minutes old when nothing is happening.
- **Unlock and garage open** always ask for confirmation on the wall. Tick **Read-only** on a device to keep it view-only.

## Mock mode

`MOCK=1 pnpm dev` serves the same screen from fixtures: four rooms, three thermostats, Meross-style plugs, the front-door lock with confirm, three cameras with generated stills and an animated live view, and a Bluey episode on the living-room Apple TV. The Settings section works too: discovery comes from a fixture "Home Assistant" with the same areas plus a few unassigned things, and saving the picker changes the mock Home screen. Ring the doorbell with:

```sh
curl -X POST localhost:8787/api/dev/doorbell
```

Turn on announcements in mock mode by setting `flags.alexaAnnouncements` with `PUT /api/settings`.
