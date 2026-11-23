/**
 * Saved recipe pages, trimmed to what matters, each in a shape real recipe sites publish:
 *
 * - `yoast-graph`: a WordPress recipe plugin under Yoast's `@graph`, HowToSteps, entities.
 * - `type-array`: a top-level array, `@type: ["Recipe", "NewsArticle"]`, an ImageObject.
 * - `sections`: HowToSections of HowToSteps, "Makes 24 cookies", keywords as a list.
 * - `main-entity`: a WebPage whose `mainEntity` is the recipe, instructions as one HTML string.
 * - `messy`: a broken block, the full `http://schema.org/Recipe` IRI, a small "you might also
 *   like" recipe beside the main one, a relative image and a numeric yield.
 * - `no-recipe-data`: a blog post with no JSON-LD at all (the Claude fallback).
 *
 * The unit tests read them, and mock mode serves them for any link on `recipes.example`, so the
 * smoke test imports through the real reader with no network.
 */
export const RECIPE_PAGE_HOST = 'recipes.example';

const page = (title: string, ld: string[], body = '') => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<meta property="og:title" content="${title}">
<meta property="og:image" content="https://${RECIPE_PAGE_HOST}/img/og.jpg">
${ld.map((j) => `<script type="application/ld+json">${j}</script>`).join('\n')}
</head><body><nav>Home · Recipes · About</nav><main><h1>${title}</h1>${body}</main>
<footer>© Somebody's kitchen</footer></body></html>`;

export const RECIPE_PAGES: Record<string, string> = {
  'yoast-graph': page('Lemon Garlic Salmon &#8211; Sheet Pan Dinners', [
    JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          '@id': 'https://recipes.example/#org',
          name: 'Sheet Pan Dinners',
        },
        {
          '@type': 'WebPage',
          '@id': 'https://recipes.example/yoast-graph',
          url: 'https://recipes.example/yoast-graph',
          name: 'Lemon Garlic Salmon',
        },
        {
          '@type': 'Article',
          headline: 'Lemon Garlic Salmon',
          author: { name: 'Sam' },
          mainEntityOfPage: { '@id': 'https://recipes.example/yoast-graph' },
        },
        {
          '@type': 'Recipe',
          name: 'Lemon Garlic Salmon',
          author: { '@type': 'Person', name: 'Sam' },
          description: 'Weeknight salmon with lemon &amp; garlic.',
          image: [
            'https://recipes.example/img/salmon-1200x1200.jpg',
            'https://recipes.example/img/salmon-1200x900.jpg',
          ],
          recipeYield: ['4', '4 servings'],
          prepTime: 'PT10M',
          cookTime: 'PT15M',
          totalTime: 'PT25M',
          recipeIngredient: [
            '4 salmon fillets (about 6 oz each)',
            '3 tablespoons butter, melted',
            '4 cloves garlic, minced',
            '1 lemon, thinly sliced',
            '1 &frac12; tsp. kosher salt',
            '&#189; teaspoon black pepper',
            '1 lb asparagus, trimmed',
            'Fresh parsley, for serving',
          ],
          recipeInstructions: [
            {
              '@type': 'HowToStep',
              text: 'Heat the oven to 400&deg;F and line a sheet pan.',
              name: 'Heat the oven to 400&deg;F and line a sheet pan.',
              url: 'https://recipes.example/yoast-graph#step-1',
            },
            {
              '@type': 'HowToStep',
              text: 'Toss the asparagus with half the butter and set the salmon on top.',
            },
            {
              '@type': 'HowToStep',
              text: 'Mix the rest of the butter with the garlic, salt and pepper; brush it over the fish and lay on the lemon.',
            },
            {
              '@type': 'HowToStep',
              text: 'Bake for 12 to 15 minutes, until the salmon flakes. Scatter with parsley.',
            },
          ],
          recipeCategory: ['Dinner'],
          recipeCuisine: ['American'],
          keywords: 'salmon, sheet pan, quick dinner',
        },
      ],
    }),
  ]),

  'type-array': page('Classic Meatloaf', [
    JSON.stringify([
      {
        '@context': 'http://schema.org',
        '@type': ['Recipe', 'NewsArticle'],
        headline: 'Classic Meatloaf',
        name: 'Classic Meatloaf',
        image: {
          '@type': 'ImageObject',
          url: 'https://recipes.example/img/meatloaf.jpg',
          height: 1125,
          width: 1500,
        },
        recipeYield: '8',
        totalTime: 'PT1H15M',
        recipeIngredient: [
          '1 ½ pounds ground beef',
          '1 egg',
          '1 onion, chopped',
          '1 cup milk',
          '1 cup dried bread crumbs',
          'salt and pepper to taste',
          '2 tablespoons brown sugar',
          '2 tablespoons prepared mustard',
          '⅓ cup ketchup',
        ],
        recipeInstructions: [
          { '@type': 'HowToStep', text: 'Preheat the oven to 350 degrees F (175 degrees C).\n' },
          {
            '@type': 'HowToStep',
            text: 'Combine beef, egg, onion, milk, and bread crumbs in a large bowl; season with salt and pepper. Press into a loaf pan.',
          },
          {
            '@type': 'HowToStep',
            text: 'Mix brown sugar, mustard, and ketchup in a small bowl; pour over the meatloaf.',
          },
          { '@type': 'HowToStep', text: 'Bake in the preheated oven for 1 hour.' },
        ],
        recipeCategory: ['Dinner', 'Meat and Poultry'],
        recipeCuisine: ['American'],
        nutrition: { '@type': 'NutritionInformation', calories: '372 kcal' },
        aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.6', ratingCount: '7000' },
      },
    ]),
  ]),

  sections: page('Brown Butter Chocolate Chip Cookies', [
    JSON.stringify({
      '@context': 'https://schema.org/',
      '@type': 'Recipe',
      name: 'Brown Butter Chocolate Chip Cookies',
      image: { '@type': 'ImageObject', url: 'https://recipes.example/img/cookies.jpg' },
      recipeYield: 'Makes 24 cookies',
      prepTime: 'PT20M',
      cookTime: 'PT12M',
      keywords: ['cookies', 'baking', 'chocolate'],
      recipeIngredient: [
        '1 cup (226g) unsalted butter',
        '1 cup packed brown sugar',
        '½ cup granulated sugar',
        '2 large eggs',
        '2 tsp vanilla extract',
        '2 ¼ cups all-purpose flour',
        '1 tsp baking soda',
        '1 tsp salt',
        '12 oz dark chocolate, chopped',
      ],
      recipeInstructions: [
        {
          '@type': 'HowToSection',
          name: 'Brown the butter',
          itemListElement: [
            {
              '@type': 'HowToStep',
              text: 'Melt the butter in a pan over medium heat, swirling, for 5 to 7 minutes until nutty and brown.',
            },
            { '@type': 'HowToStep', text: 'Pour into a bowl and cool for 15 minutes.' },
          ],
        },
        {
          '@type': 'HowToSection',
          name: 'Make the dough',
          itemListElement: [
            {
              '@type': 'HowToStep',
              text: 'Whisk the sugars into the butter, then the eggs and vanilla.',
            },
            {
              '@type': 'HowToStep',
              text: 'Stir in the flour, soda and salt, then the chocolate. Chill for 30 minutes.',
            },
          ],
        },
        {
          '@type': 'HowToSection',
          name: 'Bake',
          itemListElement: [
            {
              '@type': 'HowToStep',
              text: 'Bake 2-tablespoon balls at 350°F for 10 to 12 minutes.',
            },
          ],
        },
      ],
    }),
  ]),

  'main-entity': page('Slow Cooker Chili', [
    JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: 'Slow Cooker Chili',
      mainEntity: {
        '@type': 'Recipe',
        name: 'Slow Cooker Chili',
        image: 'https://recipes.example/img/chili.jpg',
        recipeYield: '6 to 8 servings',
        totalTime: 'P0DT8H15M',
        recipeIngredient: [
          '2 lb ground beef',
          '1 large onion, diced',
          '2 (15 oz) cans kidney beans, drained',
          '1 (28 oz) can crushed tomatoes',
          '2 tbsp chili powder',
          '1 tbsp cumin',
          '1 cup beef broth',
          'Shredded cheddar and sour cream, to serve',
        ],
        recipeInstructions:
          '<ol><li>Brown the beef and onion in a skillet, about 10 minutes. Drain.</li><li>Put everything except the toppings in the slow cooker.</li><li>Cook on low for 8 hours.</li><li>Serve with cheddar &amp; sour cream.</li></ol>',
        recipeCategory: 'Main Course',
        keywords: 'chili, slow cooker, game day',
      },
    }),
  ]),

  messy: page(
    'Weeknight Fried Rice',
    [
      '{"@context":"https://schema.org","@type":"BreadcrumbList", "itemListElement": [ broken ',
      JSON.stringify({
        '@context': 'http://schema.org',
        '@type': 'http://schema.org/Recipe',
        name: 'Quick Cucumber Salad',
        recipeIngredient: ['1 cucumber', '1 tbsp rice vinegar'],
        recipeInstructions: 'Slice and dress.',
      }),
      JSON.stringify({
        '@context': 'http://schema.org',
        '@type': 'http://schema.org/Recipe',
        name: 'Weeknight Fried Rice',
        url: '/messy',
        image: [{ '@type': 'ImageObject', url: '/img/fried-rice.jpg' }],
        recipeYield: 4,
        cookTime: 'PT20M',
        recipeIngredient: [
          '3 cups cooked rice, cold',
          '2 tbsp vegetable oil',
          '2 eggs, beaten',
          '1 cup frozen peas and carrots',
          '3 green onions, sliced',
          '3 tbsp soy sauce',
          '1 tsp sesame oil',
        ],
        recipeInstructions: [
          'Heat the oil in a wok over high heat.',
          'Scramble the eggs, about 1 minute, and set aside.',
          'Fry the vegetables for 2 minutes, add the rice and fry for 5 minutes.',
          'Stir in the soy sauce, sesame oil, eggs and green onions.',
        ],
        recipeCuisine: 'Chinese',
      }),
    ],
    '<p>You might also like: Quick Cucumber Salad</p>',
  ),

  'no-recipe-data': page(
    "Nana's Shortbread",
    [],
    `<article><p>My nana made these every Christmas.</p>
<h2>Ingredients</h2><ul><li>1 cup butter, softened</li><li>½ cup sugar</li><li>2 cups flour</li></ul>
<h2>Method</h2><ol><li>Cream the butter and sugar.</li><li>Work in the flour.</li>
<li>Press into a tin and bake at 325°F for 30 minutes.</li></ol></article>
<script>window.ads = true;</script>`,
  ),
};

/** The page for a `https://recipes.example/<name>` link; any other name gets the salmon. */
export function recipePageFor(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.hostname !== RECIPE_PAGE_HOST) return null;
  const name = u.pathname.replace(/^\/+|\/+$/g, '');
  return RECIPE_PAGES[name] ?? RECIPE_PAGES['yoast-graph']!;
}
