# Meals: the meal planner

Mantel keeps its own meal plan and a list of favourite meals in the server's SQLite, and still reads a calendar named **Meals** for households that plan there.

## On the wall

- Tap **Tonight** (on the agenda, or the Tonight card) or the **Meals this week** card to open the planner.
- The week shows seven columns by breakfast, lunch and dinner (or dinner only, in Settings, Meals). Planner meals are tinted; meals from the Meals calendar show a calendar mark. A cart with a number counts ingredients still to buy: not on the grocery list yet, or on it and unchecked.
- Tap a slot to pick a favourite (search, tags, Recent) or **Type a meal** with its ingredients, one per line or with commas. "Save as a favourite" is on by default.
- **Add ingredients to Grocery** on a meal, or **Add the week to Grocery** on the week, adds what is missing and skips anything already on the list unchecked.
- **Favourites** opens the manager: title, the slot it usually suits, ingredients and tags. Deleting a favourite keeps meals already planned from it, with their ingredients.

## How the plan and the Meals calendar combine

Per date and slot, a meal planned in Mantel wins; otherwise the Meals calendar's entry shows. Calendar entries have no ingredients; plan over one to add some. `GET /api/meals` (what Today reads) returns the same merge, so Tonight and the next-days rows show planner meals too. Snacks from the calendar (titles starting "Snack:") stay on Today and are not planned here.

**Write planned meals to the Meals calendar** (Settings, Meals) mirrors each planned meal as an all-day event ("Dinner: Tacos") on the Meals calendar when it is writable (Google or iCloud, not an iCal link), so phones see the plan. Changing the meal updates the event; clearing the slot deletes it.

## From a phone

The companion app's **Meals** tab shows the same merged week and sends a meal's ingredients to the grocery list (a meal without ingredients adds its name). A photo of a menu through **Magic Import** plans the meals it finds, one per date and slot; see [`companion.md`](companion.md).

## Settings

| Setting                      | Where                                                                                            | Default |
| ---------------------------- | ------------------------------------------------------------------------------------------------ | ------- |
| Planner on or off            | `settings.integrations.meals.enabled`                                                            | on      |
| Slots shown                  | `settings.meals.slots`: `all` or `dinner`                                                        | `all`   |
| Mirror to the Meals calendar | `settings.meals.mirrorToCalendar`                                                                | off     |
| Grocery list                 | `settings.meals.groceryListId`; null picks the list named Grocery, then Shopping, then the first | null    |

Turning the planner off makes its routes answer `disabled` (503) and Today shows the Meals calendar alone.

## API

| Route                                                                | Purpose                                                                                                                                      |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /meals/week?start`                                              | The week holding `start` (Monday first): slots, merged meals with ingredients and unbought counts, the grocery list, whether mirroring is on |
| `PUT /meals/plan { date, slot, title?, favouriteId?, ingredients? }` | Plan a slot; neither a title nor a favourite clears it                                                                                       |
| `GET/POST /meals/favourites`, `PATCH/DELETE /meals/favourites/:id`   | Favourites                                                                                                                                   |
| `POST /meals/:date/:slot/to-grocery`                                 | One meal's ingredients to the grocery list; answers what was added and skipped                                                               |
| `POST /meals/week/to-grocery?start`                                  | Every planned meal's ingredients for the week, once each                                                                                     |
| `GET /meals/unbought?date`                                           | Ingredients of the week's plan not on the list or still unchecked, with the meals that need them                                             |

Ingredients match list items ignoring case, spacing, trailing punctuation and a plural "s". Plan changes send `calendar.changed`; grocery adds send `list.changed`.

In mock mode the planner has eight favourites and a part-planned week; `MOCK_EMPTY=1` starts with nothing.
