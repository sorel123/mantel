/**
 * The meal planner's tables (`meal_favourites`, `planned_meals`): favourites with their
 * ingredients, and one planned meal per date and slot.
 */
import { randomUUID } from 'node:crypto';
import type { Favourite, FavouriteInput, FavouritePatch, PlanSlot } from '@mantel/shared';
import { Favourite as FavouriteSchema, FavouriteInput as InputSchema } from '@mantel/shared';
import { and, asc, eq, gte, lt } from 'drizzle-orm';
import { schema, type Db } from '../../db/index.js';

const { mealFavourites, plannedMeals } = schema;

export interface PlanRow {
  date: string;
  slot: PlanSlot;
  title: string;
  favouriteId: string | null;
  /** Typed with the meal; null means the favourite's. */
  ingredients: string[] | null;
  eventId: string | null;
}

const json = (v: string | null): string[] | null => {
  if (v === null) return null;
  try {
    const parsed: unknown = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

function toFavourite(row: typeof mealFavourites.$inferSelect): Favourite {
  return FavouriteSchema.parse({
    id: row.id,
    title: row.title,
    slot: row.slot,
    ingredients: json(row.ingredients) ?? [],
    tags: json(row.tags) ?? [],
    lastUsed: row.lastUsed,
  });
}

function toPlan(row: typeof plannedMeals.$inferSelect): PlanRow {
  return {
    date: row.date,
    slot: row.slot,
    title: row.title,
    favouriteId: row.favouriteId,
    ingredients: json(row.ingredients),
    eventId: row.eventId,
  };
}

export class MealStore {
  constructor(private readonly db: Db) {}

  /* ---- favourites ---- */

  favourites(): Favourite[] {
    return this.db
      .select()
      .from(mealFavourites)
      .orderBy(asc(mealFavourites.title))
      .all()
      .map(toFavourite);
  }

  favourite(id: string): Favourite | null {
    const row = this.db.select().from(mealFavourites).where(eq(mealFavourites.id, id)).get();
    return row ? toFavourite(row) : null;
  }

  createFavourite(input: FavouriteInput, id = `fav-${randomUUID().slice(0, 8)}`): Favourite {
    const f = InputSchema.parse(input);
    this.db
      .insert(mealFavourites)
      .values({
        id,
        title: f.title,
        slot: f.slot,
        ingredients: JSON.stringify(f.ingredients),
        tags: JSON.stringify(f.tags),
        lastUsed: null,
        createdAt: new Date().toISOString(),
      })
      .run();
    return this.favourite(id)!;
  }

  patchFavourite(id: string, patch: FavouritePatch): Favourite | null {
    const old = this.favourite(id);
    if (!old) return null;
    const next = InputSchema.parse({ ...old, ...patch });
    this.db
      .update(mealFavourites)
      .set({
        title: next.title,
        slot: next.slot,
        ingredients: JSON.stringify(next.ingredients),
        tags: JSON.stringify(next.tags),
      })
      .where(eq(mealFavourites.id, id))
      .run();
    return this.favourite(id);
  }

  /** Remove a favourite; meals planned from it keep their title and a copy of its ingredients. */
  deleteFavourite(id: string): boolean {
    const old = this.favourite(id);
    if (!old) return false;
    this.db.transaction((tx) => {
      for (const row of tx
        .select()
        .from(plannedMeals)
        .where(eq(plannedMeals.favouriteId, id))
        .all()) {
        tx.update(plannedMeals)
          .set({
            favouriteId: null,
            ingredients: row.ingredients ?? JSON.stringify(old.ingredients),
          })
          .where(and(eq(plannedMeals.date, row.date), eq(plannedMeals.slot, row.slot)))
          .run();
      }
      tx.delete(mealFavourites).where(eq(mealFavourites.id, id)).run();
    });
    return true;
  }

  /** Remember the latest date a favourite was planned for. */
  touchFavourite(id: string, date: string): void {
    const f = this.favourite(id);
    if (!f || (f.lastUsed && f.lastUsed >= date)) return;
    this.db.update(mealFavourites).set({ lastUsed: date }).where(eq(mealFavourites.id, id)).run();
  }

  /* ---- the plan ---- */

  /** Planned meals with `from <= date < to` (ISO dates compare as strings). */
  plan(from: string, to: string): PlanRow[] {
    return this.db
      .select()
      .from(plannedMeals)
      .where(and(gte(plannedMeals.date, from), lt(plannedMeals.date, to)))
      .all()
      .map(toPlan);
  }

  get(date: string, slot: PlanSlot): PlanRow | null {
    const row = this.db
      .select()
      .from(plannedMeals)
      .where(and(eq(plannedMeals.date, date), eq(plannedMeals.slot, slot)))
      .get();
    return row ? toPlan(row) : null;
  }

  put(row: PlanRow): void {
    const values = {
      date: row.date,
      slot: row.slot,
      title: row.title,
      favouriteId: row.favouriteId,
      ingredients: row.ingredients ? JSON.stringify(row.ingredients) : null,
      eventId: row.eventId,
      updatedAt: new Date().toISOString(),
    };
    this.db
      .insert(plannedMeals)
      .values(values)
      .onConflictDoUpdate({ target: [plannedMeals.date, plannedMeals.slot], set: values })
      .run();
  }

  clear(date: string, slot: PlanSlot): void {
    this.db
      .delete(plannedMeals)
      .where(and(eq(plannedMeals.date, date), eq(plannedMeals.slot, slot)))
      .run();
  }

  isEmpty(): boolean {
    return (
      !this.db.select().from(mealFavourites).limit(1).get() &&
      !this.db.select().from(plannedMeals).limit(1).get()
    );
  }
}
