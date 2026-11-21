# The plugin pack

Nine small plugins that put something useful on the wall. Each has a Today card, most add an
Ambient line, a few add a dock chip and a banner. Turn them on and off, preview them and add
their card to Today from **Settings, Plugins**. All of them work in mock mode with sample data.

| Plugin                      | What it shows                                                                                                              | Set up                                                                                                                                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Birthdays and anniversaries | The next birthdays with ages ("Mia turns 11, in 3 days"), a chip and a morning banner on the day                           | Type `Mia 2015-03-14; Grandma 03-02; Mom and Dad anniversary 2010-06-12`. Events named "birthday" or "anniversary" on your calendars are found by themselves                                                |
| Pet care                    | Each pet's jobs today; tap a name to mark it done by them. Orange at its time, a banner when late, resets at midnight      | `Biscuit: breakfast 7:30, dinner 17:30, walk; Luna: meds 8pm`                                                                                                                                               |
| Family poll                 | "Pizza or tacos?" asked from the card's text box (or a suggestion), one row per person, closes itself and names the winner | Nothing. Close-after minutes and the winner banner are optional                                                                                                                                             |
| Sports                      | Next game, live score (checked every minute while live) and the final, with a banner                                       | `nfl/det; nba/det; eng.1/ars` as ESPN writes them, and/or a team's `.ics` schedule link                                                                                                                     |
| School day                  | Lunch and A/B day today and tomorrow (tomorrow first after 3 PM), the next day off                                         | A menu link (`.ics`) or `Mon: Pizza; Tue: Tacos`, the rotation (`A, B`) and a recent first day, no-school days (`2026-11-26 Thanksgiving; 2026-12-21..2027-01-01 Winter break`) or the school calendar link |
| House status                | Locks with a Lock button, garage doors with Close, doors, washer/dryer, energy today. Orange at night                      | Needs Home Assistant. Leave the list empty to have it pick from the allowed entities                                                                                                                        |
| Habits and plants           | What is due, overdue and coming up, with last-done; Done restarts the count                                                | `Water the plants every 5 days; Vitamins daily for Jay; Furnace filter every 3 months`                                                                                                                      |
| Question of the day         | A conversation starter from 371 bundled questions (344 kid-friendly), the same on every display all day                    | Optional: show it on Ambient at dinner                                                                                                                                                                      |
| Sky                         | Sunrise, sunset, day length, moon phase, next full moon (with its name), solstice/equinox or meteor shower                 | Nothing: it uses the home location                                                                                                                                                                          |

## Notes

- **Times are the server's local time**, like trash day: run the container with `TZ` set to the
  household's zone (the Unraid template and Dockerfile already do).
- **Sports** reads `site.api.espn.com/apis/site/v2/sports/<sport>/<league>/teams/<team>` and its
  `/schedule`: the JSON espn.com itself loads. It has no key and no published terms; it has been
  stable for years and is what most home dashboards use. If it ever changes, the card says "Not
  reachable" and a schedule link still works.
- **Sky** computes everything locally (the standard sunrise equation, the mean lunar cycle and
  Meeus's season formulas), good to a few minutes for the sun and about a day for the moon.
- **Packages** were looked at and left out: no free source tracks USPS, UPS and FedEx reliably
  without a business account or a paid aggregator (AfterShip, 17TRACK, TrackingMore all need a
  key and limit free use). The capture-by-email inbox (workstream K) is the better feed: a
  shipping email forwarded there could become a card later.

## The contract additions

Blocks gained two optional fields, documented in `docs/plugins.md`:

- `lead`: a large line under the title (the question of the day).
- `input: { action, label, placeholder?, submit, suggestions[] }`: a text box with a button and
  one-tap suggestions; pressing it posts `{ text }` to the plugin's `action` (the poll's Ask).

New icons: `cake heart paw vote trophy school lunch house lock unlock door washer bolt sprout pill
chat sun sunrise sunset moon sparkle send`.
