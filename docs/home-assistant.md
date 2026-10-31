# Home Assistant on the wall

Mantel talks to Home Assistant (HA) only. Every device reaches the wall through an HA integration, and the display sees only what `config/home.yaml` allows.

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

1. In HA, add the integrations above (Settings > Devices & services > Add integration). Put devices in areas; Mantel can pull a whole area in.
2. Make a long-lived access token: your HA profile > Security > Long-lived access tokens.
3. On the Mantel container set `HA_URL` (for example `http://192.168.1.20:8123`) and `HA_TOKEN`.
4. Copy `config/home.example.yaml` to `config/home.yaml` (or wherever `HA_ALLOWLIST` points) and edit it. The comments in that file explain each section. Saving the file reloads it, and the wall display refreshes itself.
5. Open `/api/health` on the server: `lastSync.home` fills in once HA is connected. The server log says `home: connected to Home Assistant (N entities)`.

## How it works

- One WebSocket to HA (`/api/websocket`): it authenticates with the token, subscribes to state changes, loads states and the area, device and entity registries, and pings every 30 s. If HA restarts the server reconnects with backoff (1 s up to 30 s) and pushes whatever changed while it was away.
- `GET /api/home/state` and `POST /api/home/call` only touch allow-listed entities. Calls are limited per domain (`light.turn_on` with brightness, `lock.unlock`, `climate.set_temperature`...), unknown data keys are refused, and `read_only: true` entities are view-only.
- State changes go to the display as `home.state`, presence as `home.presence`, Apple TV as `media.state`, and a doorbell press as `home.doorbell` (at most one every 15 s, and only while the "Doorbell pop-over" flag is on).
- Camera images and Apple TV artwork are proxied by the server (`/api/home/cameras/:id/snapshot`, `/stream`, `/api/media/:id/artwork`), so the tablet never needs HA's address or token. Live streams stop when the display closes them and after `HA_STREAM_MAX_SECONDS` at most.

## Limits worth knowing

- **Ring live view.** HA exposes Ring live video over WebRTC, which an `<img>` cannot play, so through HA's MJPEG proxy a Ring camera most likely shows snapshots refreshing every few seconds rather than full-motion video (untested against a real Ring yet). Cameras with an RTSP or MJPEG source show real motion. Full-motion Ring video on the wall means adding WebRTC to the pop-over through HA's built-in go2rtc, a contained follow-up.
- **Ring snapshots** in HA refresh on motion and dings, so a tile can be a few minutes old when nothing is happening.
- **Unlock and garage open** always ask for confirmation on the wall. Mark an entity `read_only: true` to keep it view-only.

## Mock mode

`MOCK=1 pnpm dev` serves the same screen from fixtures: four rooms, three thermostats, Meross-style plugs, the front-door lock with confirm, three cameras with generated stills and an animated live view, and a Bluey episode on the living-room Apple TV. Ring the doorbell with:

```sh
curl -X POST localhost:8787/api/dev/doorbell
```

Turn on announcements in mock mode by setting `flags.alexaAnnouncements` with `PUT /api/settings`.
