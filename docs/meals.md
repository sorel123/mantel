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

## The recipe box (v4)

**Recipes** in the planner's toolbar opens the box: a grid of cards with photos, search (titles, tags and ingredients) and tags.

- **Add a recipe**: paste a link from any recipe site (or tap **Paste**), take or pick a **Photo** of a cookbook page or a recipe card, or paste the **Text**. The new recipe opens.
  - A link is read from the recipe data most recipe sites publish for search engines (schema.org `Recipe` in JSON-LD). That needs no account and no key.
  - A page without that data, a photo, and pasted text are read by Claude, with the key saved under Settings › Weather quips (the same key Magic Import uses, model `claude-sonnet-5-5`). Without a key, pasted text is still read line by line (a title, then ingredients by their amounts or under an "Ingredients" heading, then steps).
  - The message after an import says which way it was read. Pasting a link already in the box opens the saved copy.
  - The photo is copied onto this server, so the wall never waits on the recipe site.
- **A recipe** is laid out for the kitchen: the photo, time, servings, source and rating on top; ingredients on the left and steps on the right in large type. Tap a line to strike it. The servings stepper rescales every amount (½, ⅓ and ¾ stay kitchen fractions). **Add ingredients to the grocery list** sends the scaled amounts.
- **Plan this** picks one of the next fourteen days and a slot. Planned meals that cook a recipe open it from the week, with the slot's Change and Remove beside it, and the recipe remembers when it was last made.
- **Start cooking** opens cook mode: one step at a time in large type, the ingredients beside it, and **Set a timer for 8 min** when a step names a time (it starts a kitchen timer, so every display shows and rings it). The screen stays on while cook mode is open, using the dock's keep-awake pin, and goes back to normal when you finish (unless it was pinned already).

### Grocery merge

Each ingredient line is read into an amount, a unit and the thing to buy (`1 ½ cups flour, sifted` is 1.5, `cup`, `flour`). Sending a recipe to the list adds lines for the same thing together, skips water, and compares with unchecked list items by the thing to buy: when one is there with an amount in the same unit, its amount is raised (`1 cup milk` becomes `4 cups milk`); otherwise it is left as it is. The meal planner's own matching uses the same reading, so `Eggs` on the list counts for `2 large eggs`.

### From a phone

The companion's Meals tab has **This week** and **Recipes**. Recipes has the same Link, Photo and Text box at the top (with Paste), the box as a list, and each recipe with a servings stepper, **+ Grocery** and **Plan**.

### Routes

| Route                                                   | Purpose                                                                                       |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `GET /recipes?q&tag`                                    | The box                                                                                       |
| `POST /recipes/import { url } \| { text } \| { image }` | Read and save one; answers the recipe, `via` (`link`, `claude`, `text`, `mock`) and a message |
| `GET/PATCH/DELETE /recipes/:id`, `POST /recipes`        | One recipe; deleting keeps planned meals with their title and ingredients                     |
| `POST /recipes/:id/to-grocery { servings? }`            | Scaled ingredients onto the grocery list: `added`, `merged` and `skipped`                     |
| `GET /recipes/:id/image`                                | The cached photo (device key in the header or `?key=`)                                        |
| `PUT /meals/plan { date, slot, recipeId }`              | Plan a recipe; a favourite can also point at one (`recipeId`)                                 |

Links are fetched with a 12 second timeout, a 4 MB cap (6 MB for photos), up to four redirects, and never from a private address: loopback, the LAN, link-local, carrier NAT and IPv6 private ranges are refused on every hop, checked when the socket connects.

In mock mode the box has eight recipes with drawn photos, and links on `recipes.example` (for example `https://recipes.example/sections`) are read from the saved pages in `apps/server/src/plugins/meals/recipes/pages.ts`; any other link reads as the salmon page, and photos and text read as a sample.
