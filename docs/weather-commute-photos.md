# Weather, leave-by times and photos

Workstream 4. Server code is in `apps/server/src/providers/real/{weather,commute,photos}*`; display pieces are in `apps/display/src/features/weather/` and `apps/display/src/features/photos/`.

In mock mode (`MOCK=1`) all three serve fixtures. To see the display pieces before the integration pass mounts them, run `MOCK=1 pnpm dev` and open http://localhost:5173/src/features/weather/demo.html (add `?mode=dusk` or `?ambient=1`).

## Weather

Nothing to set up. The server reads the household location, units and timezone from settings and asks:

- **Open-Meteo** for now, the next 24 hours, 7 days, sunrise and sunset, UV, US AQI and pollen. No key.
- **api.weather.gov** for active alerts at the location (US only). Set `NWS_CONTACT` to an email or URL; NWS asks for one in the User-Agent.
- **Google Pollen API**, only when Open-Meteo has no pollen for the location (its pollen model covers Europe only) and a key is set: `GOOGLE_POLLEN_API_KEY`, or the Routes key if the Pollen API is enabled on it. Without either, pollen is hidden.

Results are cached for 15 minutes in memory and in SQLite, so a restart answers at once. Once a display has asked, the server refreshes every 15 minutes and pushes `weather.updated`. If Open-Meteo is down the last snapshot is served (its `updatedAt` says how old it is); air quality, pollen and alerts each drop out on their own if their source fails.

## Leave-by times

1. In [Google Cloud console](https://console.cloud.google.com/), create or pick a project with billing, enable **Routes API** (and **Pollen API** if you want pollen), and create an API key restricted to those APIs.
2. Set `GOOGLE_ROUTES_API_KEY`.
3. Add destinations in settings (name, address, people, arrive-by time, days). The route starts from the household location.

A destination shows on its days from three hours before its arrive-by time until that time, as "Leave by 7:41 · 14 min, +3 traffic", turning to "Leave now" once the time passes. Traffic is re-checked every five minutes while a display is asking. The `commute` feature flag turns it off. Cost: one Routes request per destination per five minutes inside the window, well inside Google's monthly free usage for a household.

## Photos

1. In the Photos app, make a Shared Album (or use one), open its settings and turn on **Public Website**. Copy the link, `https://www.icloud.com/sharedalbum/#B0aGW...`.
2. Set `ICLOUD_SHARED_ALBUM_URL` to it.

Every hour the server re-reads the album. New photos are downloaded, turned upright, cropped to the panel's shape (attention-weighted, so faces stay in frame), sized for a 2x screen, stored as JPEG under `DATA_DIR/photos`, and given a dominant colour. Videos are skipped; photos removed from the album are deleted. `PHOTO_LIMIT` (default 500) keeps only the newest. The slideshow plays them shuffled, with newly shared photos first.

On first start with a large album the photos arrive over a few minutes; the slideshow shows what is ready and checks again every minute while it has none.

## Display pieces

From `features/weather`:

- `WeatherCard`: the Today card. Now, high and low, a one-line outlook ("Rain after 6 pm"), the next six hours, and an extras row (next sunrise or sunset, UV, air quality, pollen). Active alerts sit on top; tap to read.
- `LeaveByChip` and `matchLeaveBy(events, trips)`: the chip, and which event each trip belongs next to (the server's match, else the first timed event of one of the travellers that starts between leaving and an hour after arriving).
- `AmbientWeather`: the icon, temperature and summary for Ambient.
- `useWeather()`, `useCommute()`: shared, self-refreshing data for any screen.

From `features/photos`:

- `PhotoSlideshow`: fills its positioned parent with the album, a new photo every 9 seconds (`intervalMs`), cross-dissolving and drifting as in the mockup; reduced motion swaps without either. `onPhoto` reports each photo's dominant colour for tinting. The photo bytes need the device key, so they are fetched and shown as object URLs.
