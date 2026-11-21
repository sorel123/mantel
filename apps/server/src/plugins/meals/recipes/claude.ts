/**
 * Reading a recipe with Claude: a page with no recipe data, pasted text, or a photo of a
 * cookbook page or Grandma's card. Uses the Claude key Magic Import uses (Settings › Weather
 * quips) and the same model.
 */
import Anthropic from '@anthropic-ai/sdk';
import { IMPORT_MODEL } from '../../import/claude.js';
import type { ExtractedRecipe } from './jsonld.js';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['found', 'title', 'servings', 'totalMinutes', 'ingredients', 'steps', 'tags'],
  properties: {
    found: { type: 'boolean', description: 'False when there is no recipe to read.' },
    title: { type: 'string' },
    servings: { type: 'integer', description: 'How many it serves, or 0 when not given' },
    totalMinutes: { type: 'integer', description: 'Total time in minutes, or 0 when not given' },
    ingredients: {
      type: 'array',
      items: { type: 'string' },
      description: 'One ingredient per entry, amount first, exactly as written ("1 ½ cups flour")',
    },
    steps: {
      type: 'array',
      items: { type: 'string' },
      description: 'The method, one step per entry, without step numbers',
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Up to four short lower-case tags (dinner, baking, vegetarian, soup)',
    },
  },
} as const;

const SYSTEM = [
  'You copy recipes into a family recipe box: from web page text, pasted text, or a photo of a cookbook page or a handwritten card.',
  'Copy what is there; never invent ingredients, amounts, times or steps. Fix obvious typos and expand abbreviations only where certain.',
  'Keep every ingredient with its amount and any note ("2 eggs, beaten"). Split a method written as one paragraph into short steps.',
  'If several recipes are present, take the main one. If there is no recipe, set found to false and leave the rest empty.',
].join('\n');

export class RecipeReadError extends Error {}

export interface ClaudeRecipeInput {
  apiKey: string;
  /** Page text or pasted text. */
  text?: string;
  /** `data:image/jpeg;base64,...` */
  image?: string;
  client?: Pick<Anthropic, 'beta'>;
}

export async function readRecipeWithClaude(
  input: ClaudeRecipeInput,
): Promise<ExtractedRecipe | null> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (input.image) {
    const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(input.image);
    if (!m) throw new RecipeReadError('Send a JPEG or PNG photo.');
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: m[1] as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
        data: m[2]!,
      },
    });
    content.push({ type: 'text', text: 'Copy the recipe in this photo.' });
  } else {
    content.push({
      type: 'text',
      text: `Copy the recipe from this text.\n\n<text>\n${input.text ?? ''}\n</text>`,
    });
  }
  const client =
    input.client ?? new Anthropic({ apiKey: input.apiKey, maxRetries: 1, timeout: 90_000 });
  let response;
  try {
    response = await client.beta.messages.create({
      model: IMPORT_MODEL,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError)
      throw new RecipeReadError(
        'Claude refused the key. Copy it again in Settings › Weather quips.',
      );
    if (err instanceof Anthropic.RateLimitError)
      throw new RecipeReadError('Claude is busy right now. Try again in a minute.');
    if (err instanceof Anthropic.BadRequestError)
      throw new RecipeReadError('Claude could not read that. Try a clearer, closer photo.');
    if (err instanceof Anthropic.APIError)
      throw new RecipeReadError(
        `Claude answered with an error (${err.status ?? 'no status'}). Try again.`,
      );
    throw new RecipeReadError(
      'Could not reach Claude. Check the internet connection and try again.',
    );
  }
  if (response.stop_reason === 'refusal') return null;
  const text = response.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new RecipeReadError('Claude answered in a way Mantel could not read. Try again.');
  }
  return cleanClaudeRecipe(raw);
}

const strings = (v: unknown, max: number, len: number) =>
  Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === 'string')
        .map((s) => s.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, max)
        .map((s) => s.slice(0, len))
    : [];

/** Claude's JSON made safe; null when it found no recipe. */
export function cleanClaudeRecipe(raw: Record<string, unknown>): ExtractedRecipe | null {
  const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 200) : '';
  const ingredients = strings(raw.ingredients, 150, 300);
  if (raw.found === false || !title || ingredients.length === 0) return null;
  const servings = typeof raw.servings === 'number' ? Math.round(raw.servings) : 0;
  const minutes = typeof raw.totalMinutes === 'number' ? Math.round(raw.totalMinutes) : 0;
  return {
    title,
    ingredients,
    steps: strings(raw.steps, 120, 2000).map((s) => s.replace(/^\d+[.)]\s*/, '')),
    tags: strings(raw.tags, 4, 30).map((t) => t.toLowerCase()),
    ...(servings >= 1 && servings <= 100 ? { servings } : {}),
    ...(minutes >= 1 && minutes <= 10_000 ? { totalMinutes: minutes } : {}),
  };
}
