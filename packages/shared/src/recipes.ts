/**
 * Recipe box (v4 B): recipes saved from a link, a photo or pasted text, planned into the meal
 * planner, and sent to the grocery list scaled to the servings wanted.
 *
 *   GET    /api/recipes                       the box (search with `q`, filter with `tag`)
 *   GET    /api/recipes/:id                   one recipe
 *   POST   /api/recipes                       add one typed by hand
 *   PATCH  /api/recipes/:id                   change one (notes, rating, tags, cooked...)
 *   DELETE /api/recipes/:id                   remove one
 *   POST   /api/recipes/import                from `{ url }`, `{ text }` or `{ image }`
 *   POST   /api/recipes/:id/to-grocery        ingredients onto the grocery list, scaled
 *   GET    /api/recipes/:id/image             the cached photo (header or `?key=`)
 *
 * Planning a recipe goes through the planner's own `PUT /api/meals/plan` with `recipeId`.
 *
 * This file also holds the ingredient reader (`parseIngredient`) and quantity scaling, shared by
 * the server (grocery merge) and the display (servings stepper).
 */
import { z } from 'zod';
import { ingredientKey } from './meals.js';

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const Id = z.string().min(1);
const Ok = z.object({ ok: z.literal(true) });
const NoQuery = z.object({}).strict();
const NoBody = z.undefined();

export const RecipeIngredient = z.object({
  /** As written in the recipe: `1 1/2 cups flour, sifted`. */
  text: z.string().trim().min(1).max(300),
  /** The amount read from the text, for scaling and merging. */
  quantity: z.number().positive().optional(),
  /** Canonical unit (`cup`, `tbsp`, `g`...), when the text has one. */
  unit: z.string().max(20).optional(),
  /** The thing to buy: `flour`. */
  item: z.string().max(120).optional(),
});
export type RecipeIngredient = z.infer<typeof RecipeIngredient>;

const Tag = z.string().trim().min(1).max(30);

export const Recipe = z.object({
  id: Id,
  title: z.string().trim().min(1).max(200),
  /** The page it came from. */
  sourceUrl: z.string().url().max(2000).optional(),
  /** The photo's original address. The bytes are cached here: see `hasPhoto`. */
  image: z.string().max(2000).optional(),
  /** A cached photo is served at `/api/recipes/:id/image`. */
  hasPhoto: z.boolean().default(false),
  servings: z.number().int().min(1).max(100).optional(),
  totalMinutes: z.number().int().min(1).max(10_000).optional(),
  ingredients: z.array(RecipeIngredient).max(150).default([]),
  steps: z.array(z.string().trim().min(1).max(2000)).max(120).default([]),
  tags: z.array(Tag).max(20).default([]),
  notes: z.string().max(4000).default(''),
  rating: z.number().int().min(1).max(5).optional(),
  /** The last date it was cooked (or planned for), `YYYY-MM-DD`. */
  lastCooked: IsoDate.optional(),
  /** How it got here: `link` (the page's recipe data), `claude` (read by Claude), `text` (pasted text read without Claude), `typed`. */
  via: z.enum(['link', 'claude', 'text', 'typed']).default('typed'),
  createdAt: z.string().optional(),
});
export type Recipe = z.infer<typeof Recipe>;

/** A recipe as typed or edited: ingredients may be plain lines; they are read on save. */
export const RecipeInput = z.object({
  title: z.string().trim().min(1).max(200),
  sourceUrl: z.string().url().max(2000).optional(),
  image: z.string().max(2000).optional(),
  servings: z.number().int().min(1).max(100).optional(),
  totalMinutes: z.number().int().min(1).max(10_000).optional(),
  ingredients: z.array(z.union([z.string().trim().min(1).max(300), RecipeIngredient])).max(150),
  steps: z.array(z.string().trim().min(1).max(2000)).max(120).default([]),
  tags: z.array(Tag).max(20).default([]),
  notes: z.string().max(4000).default(''),
  rating: z.number().int().min(1).max(5).optional(),
});
export type RecipeInput = z.input<typeof RecipeInput>;

export const RecipePatch = RecipeInput.partial().extend({
  /** `null` clears. */
  rating: z.number().int().min(1).max(5).nullable().optional(),
  lastCooked: IsoDate.nullable().optional(),
});
export type RecipePatch = z.input<typeof RecipePatch>;

export const RecipesQuery = z
  .object({ q: z.string().max(100).optional(), tag: z.string().max(30).optional() })
  .strict();
export const RecipesResponse = z.object({ recipes: z.array(Recipe) });
export const RecipeResponse = z.object({ recipe: Recipe });

/** Exactly one of a link, pasted text or a photo (`data:image/...;base64,`). */
export const RecipeImportRequest = z
  .object({
    url: z.string().trim().url().max(2000).optional(),
    text: z.string().trim().min(20).max(30_000).optional(),
    image: z
      .string()
      .max(8_000_000)
      .regex(/^data:image\/(jpeg|png|webp|gif);base64,/, 'expected a JPEG or PNG photo')
      .optional(),
  })
  .strict()
  .refine((r) => [r.url, r.text, r.image].filter(Boolean).length === 1, {
    message: 'send a link, some text or a photo',
  });
export type RecipeImportRequest = z.input<typeof RecipeImportRequest>;
export const RecipeImportResponse = z.object({
  recipe: Recipe,
  /** `link`: the page's own recipe data. `claude`: read by Claude. `text`: pasted text read line by line. `mock`: the sample. */
  via: z.enum(['link', 'claude', 'text', 'mock']),
  /** One sentence for the person: where it came from and anything to check. */
  message: z.string(),
  /** The same link was saved before: this is that recipe, unchanged. */
  existing: z.boolean().default(false),
});
export type RecipeImportResponse = z.infer<typeof RecipeImportResponse>;

export const RecipeToGroceryRequest = z
  .object({ servings: z.number().int().min(1).max(100).optional() })
  .strict();
export const RecipeToGroceryResponse = z.object({
  listId: Id,
  listName: z.string(),
  /** New items, as written to the list. */
  added: z.array(z.string()),
  /** Items already on the list whose amount was raised: the new text. */
  merged: z.array(z.string()),
  /** Already on the list unchecked, amounts not comparable: left as they were. */
  skipped: z.array(z.string()),
});
export type RecipeToGroceryResponse = z.infer<typeof RecipeToGroceryResponse>;

/* ---- reading an ingredient line ---- */

const FRACTIONS: Record<string, number> = {
  '½': 1 / 2,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '¼': 1 / 4,
  '¾': 3 / 4,
  '⅕': 1 / 5,
  '⅖': 2 / 5,
  '⅗': 3 / 5,
  '⅘': 4 / 5,
  '⅙': 1 / 6,
  '⅚': 5 / 6,
  '⅛': 1 / 8,
  '⅜': 3 / 8,
  '⅝': 5 / 8,
  '⅞': 7 / 8,
};
const FRACTION_CHARS = Object.keys(FRACTIONS).join('');

/** Canonical unit, then the words that mean it (lower case, without a trailing dot). */
const UNIT_WORDS: Array<[string, string[]]> = [
  ['cup', ['cup', 'cups', 'c']],
  ['tbsp', ['tbsp', 'tbsps', 'tbs', 'tbl', 'tablespoon', 'tablespoons']],
  ['tsp', ['tsp', 'tsps', 'teaspoon', 'teaspoons']],
  ['oz', ['oz', 'ounce', 'ounces']],
  ['fl oz', ['fl oz', 'fluid ounce', 'fluid ounces']],
  ['lb', ['lb', 'lbs', 'pound', 'pounds']],
  ['g', ['g', 'gram', 'grams', 'gr']],
  ['kg', ['kg', 'kgs', 'kilogram', 'kilograms']],
  ['ml', ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres']],
  ['l', ['l', 'liter', 'liters', 'litre', 'litres']],
  ['pint', ['pint', 'pints', 'pt']],
  ['quart', ['quart', 'quarts', 'qt']],
  ['clove', ['clove', 'cloves']],
  ['can', ['can', 'cans', 'tin', 'tins']],
  ['package', ['package', 'packages', 'pkg', 'packet', 'packets']],
  ['jar', ['jar', 'jars']],
  ['bag', ['bag', 'bags']],
  ['slice', ['slice', 'slices']],
  ['stick', ['stick', 'sticks']],
  ['pinch', ['pinch', 'pinches']],
  ['dash', ['dash', 'dashes']],
  ['bunch', ['bunch', 'bunches']],
  ['head', ['head', 'heads']],
  ['sprig', ['sprig', 'sprigs']],
  ['handful', ['handful', 'handfuls']],
  ['piece', ['piece', 'pieces']],
];
const UNIT_OF = new Map<string, string>();
for (const [unit, words] of UNIT_WORDS) for (const w of words) UNIT_OF.set(w, unit);
// Case matters for the one-letter spoons: `T` is a tablespoon, `t` a teaspoon.
const CASED_UNITS: Record<string, string> = { T: 'tbsp', t: 'tsp', Tbsp: 'tbsp', C: 'cup' };

const UNIT_LABEL: Record<string, [string, string]> = {
  cup: ['cup', 'cups'],
  clove: ['clove', 'cloves'],
  can: ['can', 'cans'],
  package: ['package', 'packages'],
  jar: ['jar', 'jars'],
  bag: ['bag', 'bags'],
  slice: ['slice', 'slices'],
  stick: ['stick', 'sticks'],
  pinch: ['pinch', 'pinches'],
  dash: ['dash', 'dashes'],
  bunch: ['bunch', 'bunches'],
  head: ['head', 'heads'],
  sprig: ['sprig', 'sprigs'],
  handful: ['handful', 'handfuls'],
  piece: ['piece', 'pieces'],
  pint: ['pint', 'pints'],
  quart: ['quart', 'quarts'],
  l: ['L', 'L'],
};

/** `cups` for 2, `cup` for 1; abbreviations stay as they are. */
export const unitLabel = (unit: string, quantity = 1): string => {
  const pair = UNIT_LABEL[unit];
  return pair ? (quantity > 1 ? pair[1] : pair[0]) : unit;
};

/** Words dropped from the front of the thing to buy: `2 large eggs` buys eggs. */
const PREP_WORDS = new Set([
  'chopped',
  'diced',
  'minced',
  'sliced',
  'grated',
  'shredded',
  'fresh',
  'freshly',
  'large',
  'medium',
  'small',
  'finely',
  'roughly',
  'thinly',
  'coarsely',
  'softened',
  'melted',
  'packed',
  'lightly',
  'firmly',
  'heaping',
  'level',
  'heaped',
  'about',
  'approximately',
  'scant',
  'generous',
  'cold',
  'warm',
  'whole',
  'of',
  'a',
  'an',
  'plus',
  'more',
  'to',
  'taste',
]);

const NUM = `(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:[.,]\\d+)?(?:\\s*[${FRACTION_CHARS}])?|[${FRACTION_CHARS}])`;
const QTY_RE = new RegExp(`^\\s*(${NUM})(?:\\s*(?:-|–|—|to|or)\\s*(${NUM}))?\\s*`);

/** `1 1/2` → 1.5, `½` → 0.5, `2½` → 2.5, `1,5` → 1.5. */
export function readNumber(raw: string): number | null {
  const s = raw.trim().replace(',', '.');
  let m = /^(\d+)\s+(\d+)\/(\d+)$/.exec(s);
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  m = /^(\d+)\/(\d+)$/.exec(s);
  if (m) return Number(m[2]) ? Number(m[1]) / Number(m[2]) : null;
  m = new RegExp(`^(\\d+(?:\\.\\d+)?)?\\s*([${FRACTION_CHARS}])$`).exec(s);
  if (m) return (m[1] ? Number(m[1]) : 0) + FRACTIONS[m[2]!]!;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export interface ParsedIngredient {
  quantity?: number;
  /** The top of a range: `2-3 carrots`. */
  quantityMax?: number;
  unit?: string;
  /** The thing to buy, lower case unless the text had capitals mid-word. */
  item?: string;
  /** The text after the amount and unit, as written: `flour, sifted`. */
  rest: string;
}

/** Read the amount, unit and thing from one ingredient line. Never throws. */
export function parseIngredient(text: string): ParsedIngredient {
  let s = text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-•*▢□☐]\s*/, '');
  const out: ParsedIngredient = { rest: s };
  const q = QTY_RE.exec(s);
  if (q) {
    const a = readNumber(q[1]!);
    const b = q[2] ? readNumber(q[2]) : null;
    if (a !== null && a > 0) {
      out.quantity = a;
      if (b !== null && b > a) out.quantityMax = b;
      s = s.slice(q[0].length);
    }
  }
  // A size in brackets after the amount: `1 (14 oz) can tomatoes` keeps the bracket in rest.
  const bracket = /^\([^)]*\)\s*/.exec(s);
  const afterBracket = bracket ? s.slice(bracket[0].length) : s;
  const u = /^([A-Za-z]+(?:\s+oz|\s+ounces?)?)\.?(?=\s|$)/.exec(afterBracket);
  if (u && out.quantity !== undefined) {
    const word = u[1]!;
    const unit = CASED_UNITS[word] ?? UNIT_OF.get(word.toLowerCase());
    if (unit) {
      out.unit = unit;
      s = (bracket ? bracket[0] : '') + afterBracket.slice(u[0].length).trimStart();
    }
  }
  out.rest = s.trim();
  const item = itemOf(out.rest);
  if (item) out.item = item;
  return out;
}

/** `(14 oz) can diced tomatoes, drained` → `diced tomatoes`; `of flour` → `flour`. */
function itemOf(rest: string): string | undefined {
  let s = rest
    .replace(/\([^)]*\)/g, ' ')
    .split(/,|;| - | – /)[0]!
    .replace(/\s*\b(?:for (?:serving|garnish|the .*)|to (?:taste|serve)|as needed|optional)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  // A unit can follow a bracket (`1 (14 oz) can tomatoes`): drop it from the thing too.
  const first = /^([A-Za-z]+)\s+/.exec(s);
  if (first && UNIT_OF.has(first[1]!.toLowerCase()) && first[1]!.length > 1)
    s = s.slice(first[0].length);
  const words = s.split(' ');
  while (words.length > 1 && PREP_WORDS.has(words[0]!.toLowerCase())) words.shift();
  s = words
    .join(' ')
    .replace(/[.:]+$/, '')
    .trim();
  if (!s) return undefined;
  s = s.slice(0, 120);
  // `Parmesan` → `parmesan`, but `BBQ sauce` keeps its capitals.
  return /^[A-Z][A-Z]/.test(s) ? s : s[0]!.toLowerCase() + s.slice(1);
}

/** An ingredient line with its parts read, ready to save. */
export function toRecipeIngredient(text: string): RecipeIngredient {
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, 300);
  const p = parseIngredient(clean);
  return {
    text: clean,
    ...(p.quantity !== undefined ? { quantity: round(p.quantity) } : {}),
    ...(p.unit ? { unit: p.unit } : {}),
    ...(p.item ? { item: p.item } : {}),
  };
}

/** How the grocery list compares a line with an item: the thing to buy, case and plural aside. */
export function groceryKey(text: string): string {
  const p = parseIngredient(text);
  return ingredientKey(p.item ?? text);
}

/* ---- amounts ---- */

const round = (n: number) => Math.round(n * 1000) / 1000;

const NICE: Array<[number, string]> = [
  [0, ''],
  [1 / 8, '⅛'],
  [1 / 4, '¼'],
  [1 / 3, '⅓'],
  [3 / 8, '⅜'],
  [1 / 2, '½'],
  [5 / 8, '⅝'],
  [2 / 3, '⅔'],
  [3 / 4, '¾'],
  [7 / 8, '⅞'],
  [1, ''],
];

/** 1.5 → `1½`, 0.333 → `⅓`, 2 → `2`, 2.4 → `2.4`, 13.3 → `13`. */
export function formatQuantity(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n >= 10) return String(Math.round(n));
  const whole = Math.floor(n);
  const frac = n - whole;
  let best = NICE[0]!;
  for (const c of NICE) if (Math.abs(c[0] - frac) < Math.abs(best[0] - frac)) best = c;
  if (Math.abs(best[0] - frac) <= 0.02) {
    const w = whole + (best[0] === 1 ? 1 : 0);
    if (!best[1]) return String(w || '');
    return w ? `${w}${best[1]}` : best[1];
  }
  return String(Math.round(n * 10) / 10);
}

/** The line with its amount multiplied: `1 cup flour` ×2 → `2 cups flour`. Lines without an amount are unchanged. */
export function scaleIngredientText(text: string, factor: number): string {
  if (!(factor > 0) || Math.abs(factor - 1) < 1e-9) return text;
  const p = parseIngredient(text);
  if (p.quantity === undefined) return text;
  const q = p.quantity * factor;
  const amount =
    formatQuantity(q) + (p.quantityMax ? `–${formatQuantity(p.quantityMax * factor)}` : '');
  const top = (p.quantityMax ?? p.quantity) * factor;
  const unit = p.unit ? ` ${unitLabel(p.unit, top)}` : '';
  return `${amount}${unit}${p.rest ? ` ${p.rest}` : ''}`;
}

/** Servings wanted over the recipe's, or 1 when either is unknown. */
export const scaleFactor = (recipeServings: number | undefined, wanted: number | undefined) =>
  recipeServings && wanted ? wanted / recipeServings : 1;

/** `2 cups flour` as a grocery line: amount, unit, thing; the thing alone when there is no amount. */
export function groceryLine(p: { quantity?: number; unit?: string; item?: string }, text: string) {
  const thing = p.item ?? parseIngredient(text).item ?? text;
  if (p.quantity === undefined) return thing[0]!.toUpperCase() + thing.slice(1);
  const unit = p.unit ? ` ${unitLabel(p.unit, p.quantity)}` : '';
  return `${formatQuantity(p.quantity)}${unit} ${thing}`;
}

/* ---- durations ---- */

/** ISO 8601 `PT1H30M`, `P0DT0H45M0.000S`, or loose `45 minutes`, `1 hr 10 min` → minutes. */
export function durationMinutes(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const s = value.trim();
  const iso =
    /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(
      s,
    );
  if (iso && /\d/.test(s)) {
    const [, d, h, m, sec] = iso;
    const total =
      Number(d ?? 0) * 1440 + Number(h ?? 0) * 60 + Number(m ?? 0) + Number(sec ?? 0) / 60;
    return total > 0 ? Math.round(total) : undefined;
  }
  const h = /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/i.exec(s);
  const m = /(\d+)\s*(?:m|min|mins|minute|minutes)\b/i.exec(s);
  const total = (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
  return total > 0 ? Math.round(total) : undefined;
}

/** `45 min`, `1 h 15 min`, `3 h`. */
export function minutesLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Times a step mentions, for one-tap timers: `bake for 25 to 30 minutes` → 30 min. */
export function stepTimers(step: string): Array<{ label: string; seconds: number }> {
  const out: Array<{ label: string; seconds: number }> = [];
  const re =
    /(\d+(?:\.\d+)?|an?|one|half an?)(?:\s*(?:-|–|to|or)\s*(\d+(?:\.\d+)?))?\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)\b/gi;
  for (const m of step.matchAll(re)) {
    const word = m[1]!.toLowerCase();
    const n = /^half/.test(word) ? 0.5 : /^(an?|one)$/.test(word) ? 1 : Number(word);
    const top = m[2] ? Number(m[2]) : n;
    const unit = m[3]!.toLowerCase();
    const per = unit.startsWith('h') ? 3600 : unit.startsWith('m') ? 60 : 1;
    const seconds = Math.round(top * per);
    if (seconds < 10 || seconds > 12 * 3600) continue;
    if (out.some((t) => t.seconds === seconds)) continue;
    out.push({ seconds, label: timerLabel(seconds) });
    if (out.length === 3) break;
  }
  return out;
}

const timerLabel = (seconds: number) =>
  seconds < 60
    ? `${seconds} s`
    : seconds % 60
      ? `${Math.round(seconds / 6) / 10} min`
      : minutesLabel(seconds / 60);

/* ---- routes, spread into the contract's `routes` table in api.ts ---- */

interface RecipeRoute {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query: z.ZodType;
  body: z.ZodType;
  response: z.ZodType | null;
  auth: boolean;
}
const route = <const R extends RecipeRoute>(def: R) => def;

export const recipeRoutes = {
  recipes: route({
    method: 'GET',
    path: '/recipes',
    query: RecipesQuery,
    body: NoBody,
    response: RecipesResponse,
    auth: true,
  }),
  recipeImport: route({
    method: 'POST',
    path: '/recipes/import',
    query: NoQuery,
    body: RecipeImportRequest,
    response: RecipeImportResponse,
    auth: true,
  }),
  recipe: route({
    method: 'GET',
    path: '/recipes/:id',
    query: NoQuery,
    body: NoBody,
    response: RecipeResponse,
    auth: true,
  }),
  recipeCreate: route({
    method: 'POST',
    path: '/recipes',
    query: NoQuery,
    body: RecipeInput,
    response: RecipeResponse,
    auth: true,
  }),
  recipePatch: route({
    method: 'PATCH',
    path: '/recipes/:id',
    query: NoQuery,
    body: RecipePatch,
    response: RecipeResponse,
    auth: true,
  }),
  recipeDelete: route({
    method: 'DELETE',
    path: '/recipes/:id',
    query: NoQuery,
    body: NoBody,
    response: Ok,
    auth: true,
  }),
  recipeToGrocery: route({
    method: 'POST',
    path: '/recipes/:id/to-grocery',
    query: NoQuery,
    body: RecipeToGroceryRequest,
    response: RecipeToGroceryResponse,
    auth: true,
  }),
  recipeImage: route({
    method: 'GET',
    path: '/recipes/:id/image',
    query: z.object({ key: z.string().optional(), v: z.string().optional() }),
    body: NoBody,
    response: null,
    // The handler checks the header or `?key=` itself, like the wall-note drawings.
    auth: false,
  }),
} as const;
