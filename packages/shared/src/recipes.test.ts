import { describe, expect, it } from 'vitest';
import {
  durationMinutes,
  formatQuantity,
  groceryKey,
  groceryLine,
  parseIngredient,
  readNumber,
  RecipeImportRequest,
  scaleIngredientText,
  stepTimers,
  toRecipeIngredient,
} from './recipes.js';

describe('reading numbers', () => {
  it.each([
    ['1', 1],
    ['1 1/2', 1.5],
    ['1/3', 1 / 3],
    ['½', 0.5],
    ['2½', 2.5],
    ['2 ¼', 2.25],
    ['1,5', 1.5],
    ['0.75', 0.75],
  ])('%s', (raw, n) => expect(readNumber(raw)).toBeCloseTo(n));
});

describe('reading an ingredient line', () => {
  it.each([
    ['2 cups all-purpose flour', { quantity: 2, unit: 'cup', item: 'all-purpose flour' }],
    ['1 1/2 tsp. salt', { quantity: 1.5, unit: 'tsp', item: 'salt' }],
    ['½ cup milk', { quantity: 0.5, unit: 'cup', item: 'milk' }],
    ['3 large eggs, beaten', { quantity: 3, unit: undefined, item: 'eggs' }],
    ['1 (14 oz) can coconut milk', { quantity: 1, unit: 'can', item: 'coconut milk' }],
    ['2 T butter', { quantity: 2, unit: 'tbsp', item: 'butter' }],
    ['1 t vanilla', { quantity: 1, unit: 'tsp', item: 'vanilla' }],
    ['200g caster sugar', { quantity: 200, unit: 'g', item: 'caster sugar' }],
    ['2-3 carrots, peeled', { quantity: 2, unit: undefined, item: 'carrots' }],
    ['Salt and pepper to taste', { quantity: undefined, unit: undefined, item: 'salt and pepper' }],
    ['Parmesan, for serving', { quantity: undefined, unit: undefined, item: 'parmesan' }],
    ['4 cloves garlic, minced', { quantity: 4, unit: 'clove', item: 'garlic' }],
    ['1 lb ground beef', { quantity: 1, unit: 'lb', item: 'ground beef' }],
    ['▢ 1 cup rice', { quantity: 1, unit: 'cup', item: 'rice' }],
  ])('%s', (text, want) => {
    const p = parseIngredient(text);
    expect({ quantity: p.quantity, unit: p.unit, item: p.item }).toEqual(want);
  });

  it('keeps the range top', () => {
    expect(parseIngredient('2-3 carrots').quantityMax).toBe(3);
    expect(parseIngredient('1 to 2 tbsp honey').quantityMax).toBe(2);
  });

  it('does not take a word for a unit without an amount', () => {
    expect(parseIngredient('Can of beans').unit).toBeUndefined();
  });

  it('saves the parts it read', () => {
    expect(toRecipeIngredient(' 2  cups  flour ')).toEqual({
      text: '2 cups flour',
      quantity: 2,
      unit: 'cup',
      item: 'flour',
    });
  });
});

describe('scaling', () => {
  it('formats amounts as kitchen fractions', () => {
    expect(formatQuantity(1.5)).toBe('1½');
    expect(formatQuantity(1 / 3)).toBe('⅓');
    expect(formatQuantity(0.25)).toBe('¼');
    expect(formatQuantity(2)).toBe('2');
    expect(formatQuantity(0.99)).toBe('1');
    expect(formatQuantity(2.4)).toBe('2.4');
    expect(formatQuantity(13.4)).toBe('13');
  });

  it.each([
    ['1 cup flour', 2, '2 cups flour'],
    ['2 cups flour', 0.5, '1 cup flour'],
    ['1 1/2 tsp salt', 2, '3 tsp salt'],
    ['½ cup milk', 3, '1½ cups milk'],
    ['3 eggs', 1 / 3, '1 eggs'],
    ['2-3 carrots, peeled', 2, '4–6 carrots, peeled'],
    ['1 (14 oz) can coconut milk', 2, '2 cans (14 oz) coconut milk'],
    ['Salt to taste', 2, 'Salt to taste'],
    ['4 cloves garlic', 0.5, '2 cloves garlic'],
    ['1 clove garlic', 1, '1 clove garlic'],
  ])('%s × %s', (text, factor, want) => expect(scaleIngredientText(text, factor)).toBe(want));

  it('writes grocery lines and matches them with list items', () => {
    expect(groceryLine({ quantity: 3, unit: 'cup', item: 'flour' }, '')).toBe('3 cups flour');
    expect(groceryLine({ item: 'salt' }, 'Salt')).toBe('Salt');
    expect(groceryKey('2 large eggs')).toBe(groceryKey('Eggs'));
    expect(groceryKey('1 lb ground beef')).toBe(groceryKey('Ground beef'));
    expect(groceryKey('Tortillas')).toBe('tortilla');
  });
});

describe('durations and timers', () => {
  it.each([
    ['PT1H30M', 90],
    ['PT45M', 45],
    ['P0DT0H20M0.000S', 20],
    ['PT90M', 90],
    ['P1D', 1440],
    ['1 hour 10 minutes', 70],
    ['45 mins', 45],
    ['PT0S', undefined],
    ['', undefined],
  ])('%s', (v, n) => expect(durationMinutes(v)).toBe(n));

  it('finds the times a step mentions', () => {
    expect(stepTimers('Bake for 25 to 30 minutes until golden.')).toEqual([
      { seconds: 1800, label: '30 min' },
    ]);
    expect(stepTimers('Roast for 1 hour, then rest for 15 minutes.')).toEqual([
      { seconds: 3600, label: '1 h' },
      { seconds: 900, label: '15 min' },
    ]);
    expect(stepTimers('Warm the tortillas, 30 seconds a side.')).toEqual([
      { seconds: 30, label: '30 s' },
    ]);
    expect(stepTimers('Heat the oven to 425°F.')).toEqual([]);
  });
});

describe('the import request', () => {
  it('takes exactly one source', () => {
    expect(RecipeImportRequest.safeParse({ url: 'https://example.com/r' }).success).toBe(true);
    expect(RecipeImportRequest.safeParse({}).success).toBe(false);
    expect(
      RecipeImportRequest.safeParse({ url: 'https://example.com/r', text: 'x'.repeat(30) }).success,
    ).toBe(false);
    expect(RecipeImportRequest.safeParse({ image: 'data:text/html;base64,AAAA' }).success).toBe(
      false,
    );
  });
});
