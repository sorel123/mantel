/**
 * The recipe box: saving recipes from a link, a photo or pasted text, editing them, and sending
 * their ingredients to the grocery list scaled and merged with what is already there.
 *
 * Import order for a link: the page's own schema.org recipe (JSON-LD); when it has none, its
 * readable text goes to Claude (when a key is saved). Pasted text goes to Claude too, or is read
 * line by line without a key. Photos need Claude.
 */
import {
  groceryKey,
  groceryLine,
  parseIngredient,
  RecipeInput as RecipeInputSchema,
  RecipePatch as RecipePatchSchema,
  scaleFactor,
  toRecipeIngredient,
  type List,
  type Recipe,
  type RecipeImportRequest,
  type RecipeImportResponse,
  type RecipeIngredient,
  type RecipeInput,
  type RecipePatch,
  type RecipeToGroceryResponse,
  type WsEventInput,
} from '@mantel/shared';
import { sampleRecipeImport } from '@mantel/shared/fixtures';
import { HttpError } from '../../../errors.js';
import { log } from '../../../log.js';
import type { ListsProvider } from '../../../providers/types.js';
import type { MealStore } from '../store.js';
import { RecipeReadError, readRecipeWithClaude } from './claude.js';
import { FetchError, type PageFetcher } from './fetch.js';
import { readableText, recipeFromJsonLd, type ExtractedRecipe } from './jsonld.js';
import type { RecipeRecord, RecipeStore } from './store.js';
import { recipeFromText } from './text.js';

export interface RecipesDeps {
  store: RecipeStore;
  meals: MealStore;
  lists: ListsProvider;
  groceryList: () => Promise<List | null>;
  emit: (e: WsEventInput) => void;
  fetchPage: PageFetcher;
  /** The saved Claude key, or '' when there is none. */
  claudeKey: () => string;
  /** Mock mode: photos and pasted text read as the sample, photos drawn. */
  mock: boolean;
  /** Mock photos: SVG bytes for a recipe id. */
  mockPhoto?: (seed: string) => string;
  readWithClaude?: typeof readRecipeWithClaude;
}

const IMAGE_TYPES = /^image\/(jpeg|png|webp|gif|avif)$/;
const NO_KEY =
  'Add a Claude key in Settings › Weather quips so Mantel can read photos and pages without recipe data.';

/** Plain lines become parsed ingredients; parsed ones keep their parts. */
const normaliseIngredients = (list: RecipeInput['ingredients']): RecipeIngredient[] =>
  list.map((x) => {
    if (typeof x === 'string') return toRecipeIngredient(x);
    const read = toRecipeIngredient(x.text);
    return { ...read, ...x };
  });

const tagsOf = (tags: string[]) =>
  [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20);

export class RecipesService {
  constructor(private readonly d: RecipesDeps) {}

  /* ---- reading and editing ---- */

  list(q?: string, tag?: string): { recipes: Recipe[] } {
    const query = q?.trim().toLowerCase();
    const recipes = this.d.store
      .all()
      .filter(
        (r) =>
          (!tag || r.tags.includes(tag.toLowerCase())) &&
          (!query ||
            r.title.toLowerCase().includes(query) ||
            r.tags.some((t) => t.includes(query)) ||
            r.ingredients.some((i) => i.text.toLowerCase().includes(query))),
      );
    return { recipes };
  }

  get(id: string): Recipe {
    const r = this.d.store.get(id);
    if (!r) throw new HttpError('not_found', 'That recipe was removed.');
    return r;
  }

  create(input: RecipeInput): { recipe: Recipe } {
    const r = RecipeInputSchema.parse(input);
    const recipe = this.d.store.create({
      title: r.title,
      ...(r.sourceUrl ? { sourceUrl: r.sourceUrl } : {}),
      ...(r.image ? { image: r.image } : {}),
      ...(r.servings ? { servings: r.servings } : {}),
      ...(r.totalMinutes ? { totalMinutes: r.totalMinutes } : {}),
      ingredients: normaliseIngredients(r.ingredients),
      steps: r.steps,
      tags: tagsOf(r.tags),
      notes: r.notes,
      ...(r.rating ? { rating: r.rating } : {}),
      via: 'typed',
    });
    return { recipe };
  }

  patch(id: string, patch: RecipePatch): { recipe: Recipe } {
    const old = this.get(id);
    const p = RecipePatchSchema.parse(patch);
    const next: RecipeRecord = {
      title: p.title ?? old.title,
      sourceUrl: p.sourceUrl ?? old.sourceUrl,
      image: p.image ?? old.image,
      servings: p.servings ?? old.servings,
      totalMinutes: p.totalMinutes ?? old.totalMinutes,
      ingredients: p.ingredients ? normaliseIngredients(p.ingredients) : old.ingredients,
      steps: p.steps ?? old.steps,
      tags: p.tags ? tagsOf(p.tags) : old.tags,
      notes: p.notes ?? old.notes,
      rating: p.rating === null ? undefined : (p.rating ?? old.rating),
      lastCooked: p.lastCooked === null ? undefined : (p.lastCooked ?? old.lastCooked),
      via: old.via,
    };
    return { recipe: this.d.store.update(id, next)! };
  }

  delete(id: string): { ok: true } {
    const old = this.get(id);
    this.d.meals.detachRecipe(id, groceryNames(old));
    this.d.store.delete(id);
    return { ok: true };
  }

  /** Remember the latest date it was cooked or planned for. */
  cooked(id: string, date: string): void {
    const r = this.d.store.get(id);
    if (!r || (r.lastCooked && r.lastCooked >= date)) return;
    this.d.store.update(id, { ...r, lastCooked: date });
  }

  photo(id: string) {
    return this.d.store.photo(id);
  }

  /* ---- import ---- */

  async import(req: RecipeImportRequest): Promise<RecipeImportResponse> {
    if (req.url) return this.importUrl(req.url);
    if (req.image) {
      const read = this.d.mock ? sampleExtracted() : await this.claude({ image: req.image });
      if (!read)
        throw new HttpError(
          'bad_request',
          'No recipe was found in that photo. Try a closer, straighter shot.',
        );
      return this.save(
        read,
        this.d.mock ? 'mock' : 'claude',
        'Read from the photo by Claude. Check the amounts before you cook.',
      );
    }
    const text = req.text ?? '';
    if (this.d.mock)
      return this.save(recipeFromText(text) ?? sampleExtracted(), 'mock', 'Read from the text.');
    if (this.d.claudeKey()) {
      const read = await this.claude({ text });
      if (!read) throw new HttpError('bad_request', 'Claude found no recipe in that text.');
      return this.save(read, 'claude', 'Read by Claude. Check the amounts before you cook.');
    }
    const read = recipeFromText(text);
    if (!read)
      throw new HttpError(
        'bad_request',
        `Put the title on the first line, then the ingredients, then the steps. Or: ${NO_KEY}`,
      );
    return this.save(
      read,
      'text',
      'Read line by line. Check it over, or add a Claude key for a better read.',
    );
  }

  private async importUrl(url: string): Promise<RecipeImportResponse> {
    const existing = this.d.store.bySource(url);
    if (existing)
      return {
        recipe: existing,
        via: 'link',
        message: 'Already in the recipe box.',
        existing: true,
      };
    let page;
    try {
      page = await this.d.fetchPage(url);
    } catch (err) {
      if (err instanceof FetchError) throw new HttpError('bad_request', err.message);
      throw err;
    }
    if (IMAGE_TYPES.test(page.contentType.split(';')[0]!.trim()))
      throw new HttpError(
        'bad_request',
        'That link is a picture, not a page. Use Photo to read a recipe from a picture.',
      );
    const html = page.body.toString('utf8');
    const ld = recipeFromJsonLd(html, page.url);
    if (ld) {
      const again = ld.sourceUrl ? this.d.store.bySource(ld.sourceUrl) : null;
      if (again)
        return {
          recipe: again,
          via: 'link',
          message: 'Already in the recipe box.',
          existing: true,
        };
      return this.save(
        { ...ld, sourceUrl: ld.sourceUrl ?? page.url },
        'link',
        'Read from the recipe data on the page.',
      );
    }
    if (!this.d.claudeKey())
      throw new HttpError(
        'bad_request',
        `That page has no recipe data Mantel can read on its own. ${NO_KEY} Or paste the recipe as text.`,
      );
    const { title, image, text } = readableText(html);
    const read = await this.claude({ text: `${title ?? ''}\n${text}` });
    if (!read) throw new HttpError('bad_request', 'Claude found no recipe on that page.');
    return this.save(
      { ...read, sourceUrl: page.url, ...(image ? { image: new URL(image, page.url).href } : {}) },
      'claude',
      'This page has no recipe data, so Claude read it. Check the amounts before you cook.',
    );
  }

  private async claude(input: { text?: string; image?: string }): Promise<ExtractedRecipe | null> {
    const apiKey = this.d.claudeKey();
    if (!apiKey) throw new HttpError('forbidden', NO_KEY);
    try {
      return await (this.d.readWithClaude ?? readRecipeWithClaude)({ apiKey, ...input });
    } catch (err) {
      if (err instanceof RecipeReadError) throw new HttpError('upstream_error', err.message);
      log.error('recipes: Claude read failed', { err: String(err) });
      throw new HttpError('upstream_error', 'Could not read that recipe. Try again.');
    }
  }

  private async save(
    read: ExtractedRecipe,
    via: RecipeImportResponse['via'],
    message: string,
  ): Promise<RecipeImportResponse> {
    const recipe = this.d.store.create({
      title: read.title,
      ...(read.sourceUrl ? { sourceUrl: read.sourceUrl } : {}),
      ...(read.image ? { image: read.image } : {}),
      ...(read.servings ? { servings: read.servings } : {}),
      ...(read.totalMinutes ? { totalMinutes: read.totalMinutes } : {}),
      ingredients: read.ingredients.map(toRecipeIngredient),
      steps: read.steps,
      tags: tagsOf(read.tags),
      notes: '',
      via: via === 'mock' ? 'claude' : via,
    });
    await this.cachePhoto(recipe);
    return { recipe: this.d.store.get(recipe.id)!, via, message, existing: false };
  }

  /** Keep a copy of the photo so the wall never waits on (or loses) someone else's site. */
  private async cachePhoto(recipe: Recipe): Promise<void> {
    if (this.d.mock && this.d.mockPhoto) {
      this.d.store.setPhoto(recipe.id, Buffer.from(this.d.mockPhoto(recipe.id)), 'image/svg+xml');
      return;
    }
    if (!recipe.image) return;
    try {
      const res = await this.d.fetchPage(recipe.image, {
        accept: 'image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8',
        maxBytes: 6_000_000,
      });
      const type = res.contentType.split(';')[0]!.trim().toLowerCase();
      if (!IMAGE_TYPES.test(type) || res.body.length === 0) return;
      this.d.store.setPhoto(recipe.id, res.body, type);
    } catch (err) {
      log.warn('recipes: could not cache the photo', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /* ---- grocery ---- */

  /**
   * The recipe's ingredients onto the grocery list, scaled to `servings`. Lines for the same thing
   * are added together; an unchecked list item for it has its amount raised when the units match,
   * and is left alone otherwise.
   */
  async toGrocery(id: string, servings?: number): Promise<RecipeToGroceryResponse> {
    const recipe = this.get(id);
    const list = await this.d.groceryList();
    if (!list)
      throw new HttpError(
        'bad_request',
        'There is no list to add to. Create a Grocery list first.',
      );
    const factor = scaleFactor(recipe.servings, servings);
    const wanted = combine(recipe.ingredients, factor);
    if (wanted.length === 0)
      throw new HttpError('bad_request', `${recipe.title} has no ingredients yet.`);
    const open = new Map(list.items.filter((i) => !i.done).map((i) => [groceryKey(i.text), i]));
    const added: string[] = [];
    const merged: string[] = [];
    const skipped: string[] = [];
    for (const w of wanted) {
      const have = open.get(w.key);
      if (!have) {
        const text = groceryLine(w, w.text);
        await this.d.lists.addItem(list.id, { text });
        added.push(text);
        continue;
      }
      const p = parseIngredient(have.text);
      if (w.quantity !== undefined && p.quantity !== undefined && p.unit === w.unit) {
        const text = groceryLine(
          { quantity: p.quantity + w.quantity, unit: w.unit, item: p.item ?? w.item },
          have.text,
        );
        await this.d.lists.patchItem(have.id, { text });
        merged.push(text);
      } else skipped.push(have.text);
    }
    this.d.emit({ type: 'list.changed', payload: { listId: list.id } });
    return { listId: list.id, listName: list.name, added, merged, skipped };
  }
}

interface Wanted {
  key: string;
  text: string;
  item?: string;
  quantity?: number;
  unit?: string;
}

/** Things to buy: water skipped, the same thing in the same unit added up. */
function combine(ingredients: RecipeIngredient[], factor: number): Wanted[] {
  const out: Wanted[] = [];
  for (const ing of ingredients) {
    const p =
      ing.item !== undefined || ing.quantity !== undefined ? ing : { ...parseIngredient(ing.text) };
    const item = p.item ?? parseIngredient(ing.text).item;
    if (!item || /^(water|ice|boiling water|hot water|cold water)$/i.test(item)) continue;
    const key = groceryKey(item);
    const quantity = p.quantity !== undefined ? p.quantity * factor : undefined;
    const same = out.find((w) => w.key === key);
    if (same) {
      if (same.quantity !== undefined && quantity !== undefined && same.unit === p.unit)
        same.quantity += quantity;
      continue;
    }
    out.push({
      key,
      text: ing.text,
      item,
      ...(quantity !== undefined ? { quantity } : {}),
      ...(p.unit ? { unit: p.unit } : {}),
    });
  }
  return out;
}

/** The recipe's things to buy, for the planner's ingredient list: `Ground beef`, `Tortillas`. */
export function groceryNames(r: Pick<Recipe, 'ingredients'>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const i of r.ingredients) {
    const item = i.item ?? parseIngredient(i.text).item;
    if (!item || /^(water|ice)$/i.test(item)) continue;
    const name = item.slice(0, 80);
    const key = groceryKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name[0]!.toUpperCase() + name.slice(1));
  }
  return out.slice(0, 60);
}

function sampleExtracted(): ExtractedRecipe {
  const s = sampleRecipeImport();
  return {
    title: s.title,
    ingredients: s.ingredients.map((i) => i.text),
    steps: s.steps,
    tags: s.tags,
    ...(s.servings ? { servings: s.servings } : {}),
    ...(s.totalMinutes ? { totalMinutes: s.totalMinutes } : {}),
  };
}
