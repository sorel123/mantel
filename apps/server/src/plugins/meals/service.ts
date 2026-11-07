/**
 * The meal planner: the week's plan merged with the Meals calendar, favourites, the bridge to
 * the grocery list, and the optional mirror of planned meals onto the Meals calendar.
 *
 * Merge rule: per date and slot, Mantel's plan wins; otherwise the Meals calendar's entry shows.
 * The calendar's `other` meals (snacks) are kept for Today's read model but not planned here.
 */
import {
  addDays,
  fromIsoDate,
  ingredientKey,
  MealsPlanRequest,
  PlanSlot,
  slotsShown,
  startOfWeek,
  toIsoDate,
  toLocalIso,
  type Favourite,
  type FavouriteInput,
  type FavouritePatch,
  type List,
  type Meal,
  type MealsWeekResponse,
  type PlannedMeal,
  type ResponseOf,
  type Settings,
  type ToGroceryResponse,
  type UnboughtItem,
  type WsEventInput,
} from '@mantel/shared';
import { HttpError } from '../../errors.js';
import { log } from '../../log.js';
import type { CalendarProvider, ListsProvider } from '../../providers/types.js';
import type { MealStore, PlanRow } from './store.js';

export interface MealsDeps {
  store: MealStore;
  lists: ListsProvider;
  calendar: CalendarProvider;
  settings: () => Settings;
  emit: (event: WsEventInput) => void;
  now: () => Date;
}

const SLOT_WORD: Record<PlanSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
};
const slotOrder: Record<Meal['slot'], number> = { breakfast: 0, lunch: 1, dinner: 2, other: 3 };

export class MealsService {
  constructor(private readonly d: MealsDeps) {}

  /** Off in Settings: the planner routes answer `disabled`, Today shows the calendar only. */
  enabled(): boolean {
    return this.d.settings().integrations.meals?.enabled ?? true;
  }

  private requireEnabled() {
    if (!this.enabled())
      throw new HttpError('disabled', 'The meal planner is turned off in Settings, Meals.');
  }

  private settings() {
    return this.d.settings().meals;
  }

  /* ---- reading ---- */

  private async calendarMeals(weekStart: Date): Promise<Meal[]> {
    try {
      return (await this.d.calendar.meals(weekStart)).meals;
    } catch {
      // No calendar connected yet (501) or the upstream is down: the planner still works.
      return [];
    }
  }

  private async groceryList(): Promise<List | null> {
    let all: List[];
    try {
      all = (await this.d.lists.lists()).lists;
    } catch {
      return null;
    }
    const id = this.settings().groceryListId;
    return (
      (id ? all.find((l) => l.id === id) : undefined) ??
      all.find((l) => /grocer/i.test(l.name)) ??
      all.find((l) => /shopping/i.test(l.name)) ??
      all[0] ??
      null
    );
  }

  private ingredientsOf(row: PlanRow, favs: Map<string, Favourite>): string[] {
    if (row.ingredients) return row.ingredients;
    return (row.favouriteId && favs.get(row.favouriteId)?.ingredients) || [];
  }

  /** The week as the planner draws it, with unbought counts from the grocery list. */
  async week(start?: Date): Promise<MealsWeekResponse> {
    this.requireEnabled();
    const { weekStart, meals } = await this.merged(start);
    const list = await this.groceryList();
    const status = itemStatus(list);
    const days = Array.from({ length: 7 }, (_, i) => toIsoDate(addDays(fromIsoDate(weekStart), i)));
    const planned = meals.map((m) => ({
      ...m,
      unbought: m.ingredients.filter((i) => status.get(ingredientKey(i)) !== 'done').length,
    }));
    return {
      weekStart,
      days,
      slots: slotsShown(this.settings()),
      meals: planned,
      groceryList: list ? { id: list.id, name: list.name } : null,
      mirroring: !!(this.settings().mirrorToCalendar && (await this.mirrorCalendar())),
    };
  }

  /** Mantel's plan over the Meals calendar for the week holding `start`. */
  private async merged(
    start?: Date,
  ): Promise<{ weekStart: string; meals: PlannedMeal[]; other: Meal[] }> {
    const ws = startOfWeek(start ?? this.d.now());
    const from = toIsoDate(ws);
    const to = toIsoDate(addDays(ws, 7));
    const rows = this.d.store.plan(from, to);
    const favs = new Map(this.d.store.favourites().map((f) => [f.id, f]));
    const out: PlannedMeal[] = rows.map((r) => ({
      date: r.date,
      slot: r.slot,
      title: r.title,
      ...(r.favouriteId ? { favouriteId: r.favouriteId } : {}),
      ...(r.eventId ? { eventId: r.eventId } : {}),
      source: 'mantel' as const,
      ingredients: this.ingredientsOf(r, favs),
      unbought: 0,
    }));
    const taken = new Set(out.map((m) => `${m.date}|${m.slot}`));
    const other: Meal[] = [];
    for (const m of await this.calendarMeals(ws)) {
      if (m.slot === 'other') {
        other.push(m);
        continue;
      }
      const key = `${m.date}|${m.slot}`;
      if (taken.has(key)) continue;
      taken.add(key);
      out.push({
        date: m.date,
        slot: m.slot,
        title: m.title,
        ...(m.eventId ? { eventId: m.eventId } : {}),
        source: 'calendar',
        ingredients: [],
        unbought: 0,
      });
    }
    out.sort((a, b) => a.date.localeCompare(b.date) || slotOrder[a.slot] - slotOrder[b.slot]);
    return { weekStart: from, meals: out, other };
  }

  /** `GET /api/meals`, Today's read model: the merged plan, or the calendar alone when off. */
  async todayMeals(week?: Date): Promise<ResponseOf<'meals'>> {
    if (!this.enabled()) return this.d.calendar.meals(week);
    const { weekStart, meals, other } = await this.merged(week);
    const all: Meal[] = [
      ...meals.map((m) => ({
        date: m.date,
        slot: m.slot,
        title: m.title,
        ...(m.eventId ? { eventId: m.eventId } : {}),
      })),
      ...other,
    ].sort((a, b) => a.date.localeCompare(b.date) || slotOrder[a.slot] - slotOrder[b.slot]);
    return { weekStart, meals: all };
  }

  /* ---- planning ---- */

  async plan(input: MealsPlanRequest): Promise<{ meal: PlannedMeal | null }> {
    this.requireEnabled();
    const req = MealsPlanRequest.parse(input);
    const old = this.d.store.get(req.date, req.slot);
    const fav = req.favouriteId ? this.d.store.favourite(req.favouriteId) : null;
    if (req.favouriteId && !fav) throw new HttpError('not_found', 'that favourite was removed');
    const title = req.title?.trim() || fav?.title || '';

    if (!title) {
      if (old) {
        this.d.store.clear(req.date, req.slot);
        if (old.eventId) await this.unmirror(old.eventId);
        this.changed(req.date);
      }
      return { meal: null };
    }

    const typed = req.ingredients && (!fav || req.ingredients.length > 0) ? req.ingredients : null;
    const row: PlanRow = {
      date: req.date,
      slot: req.slot,
      title,
      favouriteId: fav?.id ?? null,
      ingredients: typed,
      eventId: old?.eventId ?? null,
    };
    row.eventId = await this.mirror(row, old);
    this.d.store.put(row);
    if (fav) this.d.store.touchFavourite(fav.id, req.date);
    this.changed(req.date);
    const week = await this.week(fromIsoDate(req.date));
    return {
      meal:
        week.meals.find(
          (m) => m.date === req.date && m.slot === req.slot && m.source === 'mantel',
        ) ?? null,
    };
  }

  /* ---- favourites ---- */

  favourites() {
    this.requireEnabled();
    return { favourites: this.d.store.favourites() };
  }

  createFavourite(input: FavouriteInput) {
    this.requireEnabled();
    return { favourite: this.d.store.createFavourite(input) };
  }

  patchFavourite(id: string, patch: FavouritePatch) {
    this.requireEnabled();
    const favourite = this.d.store.patchFavourite(id, patch);
    if (!favourite) throw new HttpError('not_found', 'that favourite was removed');
    this.changed(toIsoDate(this.d.now()));
    return { favourite };
  }

  deleteFavourite(id: string) {
    this.requireEnabled();
    if (!this.d.store.deleteFavourite(id))
      throw new HttpError('not_found', 'that favourite was removed');
    return { ok: true as const };
  }

  /* ---- grocery ---- */

  /** Add one meal's ingredients to the grocery list, skipping ones already there unchecked. */
  async toGrocery(date: string, slot: string): Promise<ToGroceryResponse> {
    this.requireEnabled();
    const s = PlanSlot.safeParse(slot);
    if (!s.success || !/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw new HttpError('bad_request', 'expected /meals/YYYY-MM-DD/breakfast|lunch|dinner');
    const { meals } = await this.merged(fromIsoDate(date));
    const meal = meals.find((m) => m.date === date && m.slot === s.data);
    if (!meal) throw new HttpError('not_found', 'nothing is planned for that meal');
    if (meal.ingredients.length === 0)
      throw new HttpError(
        'bad_request',
        meal.source === 'calendar'
          ? `${meal.title} comes from the Meals calendar and has no ingredients. Plan it here to add some.`
          : `${meal.title} has no ingredients yet. Add some to it first.`,
      );
    return this.addToList(meal.ingredients);
  }

  /** Every planned meal's ingredients for the week, once each. */
  async weekToGrocery(start?: Date): Promise<ToGroceryResponse> {
    this.requireEnabled();
    const { meals } = await this.merged(start);
    const all = meals.flatMap((m) => m.ingredients);
    if (all.length === 0)
      throw new HttpError('bad_request', 'No meal this week has ingredients yet.');
    return this.addToList(all);
  }

  private async addToList(ingredients: string[]): Promise<ToGroceryResponse> {
    const list = await this.groceryList();
    if (!list)
      throw new HttpError(
        'bad_request',
        'There is no list to add to. Create a Grocery list first.',
      );
    const open = new Set(list.items.filter((i) => !i.done).map((i) => ingredientKey(i.text)));
    const added: string[] = [];
    const skipped: string[] = [];
    for (const text of ingredients) {
      const key = ingredientKey(text);
      if (open.has(key)) {
        if (!added.includes(text)) skipped.push(text);
        continue;
      }
      await this.d.lists.addItem(list.id, { text });
      open.add(key);
      added.push(text);
    }
    return { listId: list.id, listName: list.name, added, skipped: [...new Set(skipped)] };
  }

  /** Ingredients of the week's plan that are not on the list, or on it and still unchecked. */
  async unbought(date?: Date) {
    this.requireEnabled();
    const { weekStart, meals } = await this.merged(date);
    const status = itemStatus(await this.groceryList());
    const byKey = new Map<string, UnboughtItem>();
    for (const m of meals)
      for (const ingredient of m.ingredients) {
        const key = ingredientKey(ingredient);
        const st = status.get(key);
        if (st === 'done') continue;
        const item = byKey.get(key) ?? { ingredient, onList: st === 'open', meals: [] };
        item.meals.push({ date: m.date, slot: m.slot, title: m.title });
        byKey.set(key, item);
      }
    return { weekStart, items: [...byKey.values()] };
  }

  /* ---- the calendar mirror ---- */

  private async mirrorCalendar() {
    try {
      return (await this.d.calendar.calendars()).find((c) => c.isMeals && !c.readOnly) ?? null;
    } catch {
      return null;
    }
  }

  /** Write or update the planned meal's event; returns its id (null when not mirroring). */
  private async mirror(row: PlanRow, old: PlanRow | null): Promise<string | null> {
    const cal = this.settings().mirrorToCalendar ? await this.mirrorCalendar() : null;
    if (!cal) return old?.eventId ?? null;
    const title = `${SLOT_WORD[row.slot]}: ${row.title}`;
    try {
      if (old?.eventId) {
        await this.d.calendar.updateEvent(old.eventId, { title });
        return old.eventId;
      }
      const day = fromIsoDate(row.date);
      const { event } = await this.d.calendar.quickAdd({
        title,
        start: toLocalIso(day),
        end: toLocalIso(addDays(day, 1)),
        allDay: true,
        calendarId: cal.id,
      });
      return event.id;
    } catch (err) {
      log.warn('meals: could not write the meal to the Meals calendar', {
        err: err instanceof Error ? err.message : String(err),
      });
      return old?.eventId ?? null;
    }
  }

  private async unmirror(eventId: string) {
    try {
      await this.d.calendar.deleteEvent(eventId);
    } catch (err) {
      log.warn('meals: could not remove the meal from the Meals calendar', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Tell displays: `calendar.changed` refreshes Today's meals and the planner. */
  private changed(date: string) {
    const day = fromIsoDate(date);
    this.d.emit({
      type: 'calendar.changed',
      payload: { from: toLocalIso(day), to: toLocalIso(addDays(day, 1)) },
    });
  }
}

/** Each list item by ingredient key: `open` (unchecked) wins over `done`. */
function itemStatus(list: List | null): Map<string, 'open' | 'done'> {
  const out = new Map<string, 'open' | 'done'>();
  for (const i of list?.items ?? []) {
    const k = ingredientKey(i.text);
    if (!i.done) out.set(k, 'open');
    else if (!out.has(k)) out.set(k, 'done');
  }
  return out;
}
