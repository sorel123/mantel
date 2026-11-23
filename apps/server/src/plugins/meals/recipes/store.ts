/** The `recipes` table: one row per recipe, with its photo's bytes cached beside it. */
import { randomUUID } from 'node:crypto';
import { Recipe as RecipeSchema, type Recipe, type RecipeIngredient } from '@mantel/shared';
import { asc, eq } from 'drizzle-orm';
import { schema, type Db } from '../../../db/index.js';

const { recipes } = schema;
type Row = typeof recipes.$inferSelect;

/** What a row holds, the photo aside. */
export interface RecipeRecord {
  title: string;
  sourceUrl?: string;
  image?: string;
  servings?: number;
  totalMinutes?: number;
  ingredients: RecipeIngredient[];
  steps: string[];
  tags: string[];
  notes: string;
  rating?: number;
  lastCooked?: string;
  via: Recipe['via'];
}

const json = <T>(v: string, fallback: T): T => {
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};

function toRecipe(row: Omit<Row, 'image'> & { hasPhoto: boolean }): Recipe {
  return RecipeSchema.parse({
    id: row.id,
    title: row.title,
    ...(row.sourceUrl ? { sourceUrl: row.sourceUrl } : {}),
    ...(row.imageUrl ? { image: row.imageUrl } : {}),
    hasPhoto: row.hasPhoto,
    ...(row.servings ? { servings: row.servings } : {}),
    ...(row.totalMinutes ? { totalMinutes: row.totalMinutes } : {}),
    ingredients: json(row.ingredients, []),
    steps: json(row.steps, []),
    tags: json(row.tags, []),
    notes: row.notes,
    ...(row.rating ? { rating: row.rating } : {}),
    ...(row.lastCooked ? { lastCooked: row.lastCooked } : {}),
    via: row.via,
    createdAt: row.createdAt,
  });
}

// Every column but the photo's bytes, plus whether there are any.
const cols = {
  id: recipes.id,
  title: recipes.title,
  sourceUrl: recipes.sourceUrl,
  imageUrl: recipes.imageUrl,
  imageType: recipes.imageType,
  servings: recipes.servings,
  totalMinutes: recipes.totalMinutes,
  ingredients: recipes.ingredients,
  steps: recipes.steps,
  tags: recipes.tags,
  notes: recipes.notes,
  rating: recipes.rating,
  lastCooked: recipes.lastCooked,
  via: recipes.via,
  createdAt: recipes.createdAt,
  updatedAt: recipes.updatedAt,
};
const withPhoto = (r: Omit<Row, 'image'>) => ({ ...r, hasPhoto: !!r.imageType });

export class RecipeStore {
  constructor(private readonly db: Db) {}

  all(): Recipe[] {
    return this.db
      .select(cols)
      .from(recipes)
      .orderBy(asc(recipes.title))
      .all()
      .map((r) => toRecipe(withPhoto(r)));
  }

  get(id: string): Recipe | null {
    const row = this.db.select(cols).from(recipes).where(eq(recipes.id, id)).get();
    return row ? toRecipe(withPhoto(row)) : null;
  }

  bySource(url: string): Recipe | null {
    const row = this.db.select(cols).from(recipes).where(eq(recipes.sourceUrl, url)).get();
    return row ? toRecipe(withPhoto(row)) : null;
  }

  create(rec: RecipeRecord, id = `rec-${randomUUID().slice(0, 8)}`, createdAt?: string): Recipe {
    const now = new Date().toISOString();
    this.db
      .insert(recipes)
      .values({ id, ...this.values(rec), createdAt: createdAt ?? now, updatedAt: now })
      .run();
    return this.get(id)!;
  }

  update(id: string, rec: RecipeRecord): Recipe | null {
    if (!this.get(id)) return null;
    this.db
      .update(recipes)
      .set({ ...this.values(rec), updatedAt: new Date().toISOString() })
      .where(eq(recipes.id, id))
      .run();
    return this.get(id);
  }

  delete(id: string): boolean {
    return this.db.delete(recipes).where(eq(recipes.id, id)).run().changes > 0;
  }

  setPhoto(id: string, bytes: Buffer, type: string): void {
    this.db.update(recipes).set({ image: bytes, imageType: type }).where(eq(recipes.id, id)).run();
  }

  photo(id: string): { bytes: Buffer; type: string } | null {
    const row = this.db
      .select({ image: recipes.image, type: recipes.imageType })
      .from(recipes)
      .where(eq(recipes.id, id))
      .get();
    return row?.image && row.type ? { bytes: row.image, type: row.type } : null;
  }

  isEmpty(): boolean {
    return !this.db.select({ id: recipes.id }).from(recipes).limit(1).get();
  }

  private values(r: RecipeRecord) {
    return {
      title: r.title,
      sourceUrl: r.sourceUrl ?? null,
      imageUrl: r.image ?? null,
      servings: r.servings ?? null,
      totalMinutes: r.totalMinutes ?? null,
      ingredients: JSON.stringify(r.ingredients),
      steps: JSON.stringify(r.steps),
      tags: JSON.stringify(r.tags),
      notes: r.notes,
      rating: r.rating ?? null,
      lastCooked: r.lastCooked ?? null,
      via: r.via,
    };
  }
}
