/**
 * Reading a recipe page: the schema.org `Recipe` most recipe sites publish as JSON-LD (inside
 * `@graph`, in arrays, with `@type` as a list, nested under `mainEntity`), and when a page has
 * none, its readable text for Claude.
 */
import { durationMinutes } from '@mantel/shared';

export interface ExtractedRecipe {
  title: string;
  sourceUrl?: string;
  image?: string;
  servings?: number;
  totalMinutes?: number;
  ingredients: string[];
  steps: string[];
  tags: string[];
}

/* ---- text helpers ---- */

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  frac13: '⅓',
  frac23: '⅔',
  frac18: '⅛',
  deg: '°',
  ndash: '–',
  mdash: '—',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  hellip: '…',
  eacute: 'é',
  egrave: 'è',
  ntilde: 'ñ',
  uuml: 'ü',
  ouml: 'ö',
  auml: 'ä',
  times: '×',
  copy: '©',
  reg: '®',
  trade: '™',
};

/** `&amp;` → `&`, `&#189;` → `½`; twice, for the sites that encode twice. */
export function decodeEntities(s: string): string {
  const once = (t: string) =>
    t.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (all, code: string) => {
      if (code[0] === '#') {
        const n =
          code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
      }
      return NAMED[code.toLowerCase()] ?? all;
    });
  return once(once(s));
}

/** Tags out, entities decoded, whitespace collapsed. */
export function cleanText(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

const str = (v: unknown): string | undefined => {
  if (typeof v === 'string') return cleanText(v) || undefined;
  if (typeof v === 'number') return String(v);
  return undefined;
};

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

const resolveUrl = (u: string | undefined, base?: string): string | undefined => {
  if (!u) return undefined;
  try {
    const url = new URL(u, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
};

/* ---- finding the Recipe node ---- */

const isRecipe = (node: Record<string, unknown>) =>
  asArray(node['@type']).some((t) => typeof t === 'string' && /(^|[/:])Recipe$/i.test(t));

/** Every JSON-LD block of the page, parsed (a block that will not parse is skipped). */
export function jsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    const raw = m[1]!
      .trim()
      .replace(/^<!--|-->$/g, '')
      .replace(/^\s*\/\/\s*<!\[CDATA\[|\/\/\s*\]\]>\s*$/g, '');
    // eslint-disable-next-line no-control-regex -- raw newlines and tabs inside JSON strings
    for (const attempt of [raw, raw.replace(/[\u0000-\u001f]+/g, ' ')]) {
      try {
        out.push(JSON.parse(attempt));
        break;
      } catch {
        /* try the cleaned copy, then give up on this block */
      }
    }
  }
  return out;
}

/** Every `Recipe` node anywhere in the blocks: top level, arrays, `@graph`, `mainEntity`... */
function recipeNodes(blocks: unknown[]): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = [];
  const seen = new Set<unknown>();
  const visit = (v: unknown, depth: number) => {
    if (depth > 8 || v === null || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      for (const x of v) visit(x, depth + 1);
      return;
    }
    const node = v as Record<string, unknown>;
    if (isRecipe(node)) found.push(node);
    for (const [k, x] of Object.entries(node)) if (k !== '@context') visit(x, depth + 1);
  };
  for (const b of blocks) visit(b, 0);
  return found;
}

/* ---- reading its fields ---- */

function imageOf(v: unknown, base?: string): string | undefined {
  for (const x of asArray(v)) {
    if (typeof x === 'string') {
      const u = resolveUrl(x, base);
      if (u) return u;
    } else if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      const u = resolveUrl(str(o.url) ?? str(o.contentUrl) ?? str(o['@id']), base);
      if (u && !u.includes('#')) return u;
    }
  }
  return undefined;
}

/** `4`, `"4 servings"`, `["4", "4 servings"]`, `"Makes 24 cookies"` → the number. */
function servingsOf(v: unknown): number | undefined {
  const all = asArray(v)
    .map((x) => str(x))
    .filter((x): x is string => !!x);
  const pick = all.find((x) => /serv|people|portion/i.test(x)) ?? all[0];
  const m = pick ? /(\d+)/.exec(pick) : null;
  const n = m ? Number(m[1]) : NaN;
  return n >= 1 && n <= 100 ? n : undefined;
}

/** Steps from a string, a list of strings, `HowToStep`s, `HowToSection`s or an `ItemList`. */
function stepsOf(v: unknown, depth = 0): string[] {
  if (depth > 5) return [];
  if (typeof v === 'string') {
    // One blob: split on list items, paragraphs or new lines.
    const parts = /<(li|p)\b/i.test(v)
      ? v.split(/<\/?(?:li|p|ol|ul)\b[^>]*>/i)
      : v.split(/\n+|\r+/);
    return parts.map(cleanText).filter((s) => s.length > 1);
  }
  const out: string[] = [];
  for (const x of asArray(v)) {
    if (typeof x === 'string') out.push(...stepsOf(x, depth + 1));
    else if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      if (o.itemListElement) out.push(...stepsOf(o.itemListElement, depth + 1));
      else {
        const text = str(o.text) ?? str(o.name) ?? str(o.description);
        if (text) out.push(text);
      }
    }
  }
  return out;
}

function tagsOf(node: Record<string, unknown>): string[] {
  const words: string[] = [];
  for (const key of ['recipeCategory', 'recipeCuisine', 'keywords']) {
    for (const v of asArray(node[key])) {
      const s = str(v);
      if (s) words.push(...s.split(/\s*,\s*/));
    }
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    const t = w.toLowerCase().trim();
    if (!t || t.length > 30 || seen.has(t) || /^https?:/.test(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length === 8) break;
  }
  return out;
}

function toExtracted(node: Record<string, unknown>, base?: string): ExtractedRecipe | null {
  const title = str(node.name) ?? str(node.headline);
  const ingredients = asArray(node.recipeIngredient ?? node.ingredients)
    .flatMap((x) => (typeof x === 'string' ? x.split(/\n+/) : [str(x) ?? '']))
    .map(cleanText)
    .filter(Boolean);
  if (!title || ingredients.length === 0) return null;
  const total =
    durationMinutes(node.totalTime) ??
    ((durationMinutes(node.prepTime) ?? 0) + (durationMinutes(node.cookTime) ?? 0) || undefined);
  const sourceUrl = resolveUrl(str(node.url) ?? base, base);
  const image = imageOf(node.image ?? node.thumbnailUrl, base);
  const servings = servingsOf(node.recipeYield ?? node.yield);
  return {
    title: title.slice(0, 200),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(image ? { image } : {}),
    ...(servings ? { servings } : {}),
    ...(total ? { totalMinutes: total } : {}),
    ingredients: ingredients.slice(0, 150).map((s) => s.slice(0, 300)),
    steps: stepsOf(node.recipeInstructions)
      .slice(0, 120)
      .map((s) => s.slice(0, 2000)),
    tags: tagsOf(node),
  };
}

/** The page's recipe, read from its JSON-LD; null when it has none. */
export function recipeFromJsonLd(html: string, pageUrl?: string): ExtractedRecipe | null {
  const nodes = recipeNodes(jsonLdBlocks(html));
  const read = nodes
    .map((n) => toExtracted(n, pageUrl))
    .filter((r): r is ExtractedRecipe => r !== null)
    // A page can hold a few (a main recipe and "you might like"): the fullest one wins.
    .sort(
      (a, b) => b.ingredients.length + b.steps.length - (a.ingredients.length + a.steps.length),
    );
  return read[0] ?? null;
}

/* ---- the fallback: the page as readable text ---- */

/** The page's title and main text (scripts, menus and footers out), capped for Claude. */
export function readableText(
  html: string,
  max = 24_000,
): { title?: string; image?: string; text: string } {
  const meta = (name: string) => {
    for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
      const key = /(?:property|name)\s*=\s*(["'])(.*?)\1/i.exec(tag)?.[2];
      if (key?.toLowerCase() !== name) continue;
      const content = /content\s*=\s*(["'])(.*?)\1/i.exec(tag)?.[2];
      if (content) return content;
    }
    return undefined;
  };
  const title =
    (meta('og:title') && cleanText(meta('og:title')!)) ||
    cleanText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '') ||
    undefined;
  const image = meta('og:image') ? decodeEntities(meta('og:image')!) : undefined;
  const main = /<(main|article)\b[\s\S]*<\/\1>/i.exec(html)?.[0] ?? html;
  const text = decodeEntities(
    main
      .replace(
        /<(script|style|noscript|svg|nav|header|footer|aside|form|iframe)\b[\s\S]*?<\/\1>/gi,
        ' ',
      )
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(br|\/p|\/li|\/h\d|\/div|\/tr)\b[^>]*>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '\n• ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v\u00a0]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
    .slice(0, max);
  return { ...(title ? { title } : {}), ...(image ? { image } : {}), text };
}
