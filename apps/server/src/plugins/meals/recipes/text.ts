/**
 * Pasted recipe text read without Claude: a title line, then ingredients and steps, found by
 * their headings ("Ingredients", "Method") or, without headings, by whether a line starts with
 * an amount.
 */
import { parseIngredient } from '@mantel/shared';
import type { ExtractedRecipe } from './jsonld.js';

const INGREDIENTS = /^(ingredients?|you(?:'|’)?ll need|what you need|shopping list)\s*:?$/i;
const STEPS = /^(method|directions?|instructions?|steps?|preparation|how to make( it)?)\s*:?$/i;
const NOISE = /^(notes?|nutrition.*|serves?.*|yield.*|prep time.*|cook time.*|total time.*)\s*:?$/i;

const looksLikeIngredient = (line: string) => {
  const p = parseIngredient(line);
  return p.quantity !== undefined && line.length <= 120;
};

export function recipeFromText(raw: string): ExtractedRecipe | null {
  const lines = raw
    .split(/\r?\n/)
    .map((l) =>
      l
        .replace(/^\s*(?:[-•*▢□☐]|\d+[.)])\s*/, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean);
  if (lines.length < 3) return null;
  const title = lines[0]!.slice(0, 200);
  const rest = lines.slice(1);
  const ingredients: string[] = [];
  const steps: string[] = [];
  let mode: 'ingredients' | 'steps' | 'guess' | 'skip' = 'guess';
  let servings: number | undefined;
  for (const line of rest) {
    if (INGREDIENTS.test(line)) {
      mode = 'ingredients';
      continue;
    }
    if (STEPS.test(line)) {
      mode = 'steps';
      continue;
    }
    const serves = /^(?:serves|makes|yield)\s*:?\s*(\d+)/i.exec(line);
    if (serves) {
      servings = Number(serves[1]);
      continue;
    }
    if (NOISE.test(line)) {
      mode = mode === 'guess' ? 'guess' : 'skip';
      continue;
    }
    if (mode === 'skip') continue;
    if (mode === 'ingredients') ingredients.push(line);
    else if (mode === 'steps') steps.push(line);
    else if (looksLikeIngredient(line)) ingredients.push(line);
    else if (line.length > 20) steps.push(line);
  }
  if (ingredients.length < 2) return null;
  return {
    title,
    ingredients: ingredients.slice(0, 150).map((s) => s.slice(0, 300)),
    steps: steps.slice(0, 120).map((s) => s.slice(0, 2000)),
    tags: [],
    ...(servings && servings <= 100 ? { servings } : {}),
  };
}
