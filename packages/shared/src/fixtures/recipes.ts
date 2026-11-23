import { toRecipeIngredient, type Recipe } from '../recipes.js';
import { addDays, toIsoDate } from '../time.js';

/** The look of each mock recipe's generated photo (the server draws it as SVG). */
export interface RecipeArt {
  /** Table, plate rim, the food's base and two garnish colours. */
  table: string;
  plate: string;
  base: string;
  garnish: [string, string];
  /** `bowl` (soup, curry), `plate` (mains), `stack` (pancakes), `loaf`, `cookies`, `tacos`. */
  shape: 'bowl' | 'plate' | 'stack' | 'loaf' | 'cookies' | 'tacos';
}

interface Seed {
  id: string;
  title: string;
  servings: number;
  totalMinutes: number;
  tags: string[];
  rating?: number;
  cookedDaysAgo?: number;
  sourceUrl?: string;
  notes?: string;
  ingredients: string[];
  steps: string[];
  art: RecipeArt;
}

const SEEDS: Seed[] = [
  {
    id: 'rec-tacos',
    title: 'Weeknight beef tacos',
    servings: 4,
    totalMinutes: 25,
    tags: ['quick', 'kids love', 'mexican'],
    rating: 5,
    cookedDaysAgo: 7,
    sourceUrl: 'https://www.example.com/recipes/weeknight-beef-tacos',
    notes: 'Leo likes his with no lettuce. Double the cheese.',
    ingredients: [
      '1 lb ground beef',
      '1 tbsp olive oil',
      '1 small onion, finely chopped',
      '2 cloves garlic, minced',
      '2 tsp chili powder',
      '1 tsp ground cumin',
      '½ tsp smoked paprika',
      '½ cup tomato sauce',
      '8 small flour tortillas',
      '1 cup shredded cheddar',
      '2 cups shredded lettuce',
      '1 cup salsa',
      '2 limes, cut into wedges',
    ],
    steps: [
      'Heat the oil in a large skillet over medium-high heat. Cook the onion for 4 minutes, until soft.',
      'Add the beef and cook, breaking it up, for 6 to 8 minutes until browned. Spoon off the fat.',
      'Stir in the garlic, chili powder, cumin and paprika and cook for 1 minute.',
      'Add the tomato sauce and a splash of water. Simmer for 5 minutes until thick.',
      'Warm the tortillas in a dry pan, 30 seconds a side.',
      'Fill the tortillas with beef, cheddar, lettuce and salsa. Serve with lime wedges.',
    ],
    art: {
      table: '#E9C9A6',
      plate: '#FBF6EE',
      base: '#F3D9A4',
      garnish: ['#7A3E22', '#6FAF4F'],
      shape: 'tacos',
    },
  },
  {
    id: 'rec-bolognese',
    title: 'Spaghetti bolognese',
    servings: 6,
    totalMinutes: 75,
    tags: ['kids love', 'italian', 'freezes well'],
    rating: 5,
    cookedDaysAgo: 14,
    sourceUrl: 'https://www.example.com/recipes/spaghetti-bolognese',
    ingredients: [
      '2 tbsp olive oil',
      '1 onion, diced',
      '2 carrots, diced',
      '2 celery stalks, diced',
      '3 cloves garlic, minced',
      '1 lb ground beef',
      '2 tbsp tomato paste',
      '1 (28 oz) can crushed tomatoes',
      '½ cup milk',
      '1 tsp dried oregano',
      '1 lb spaghetti',
      '½ cup grated parmesan',
      'Salt and pepper to taste',
    ],
    steps: [
      'Warm the oil in a heavy pot. Add the onion, carrots and celery and cook gently for 10 minutes.',
      'Add the garlic, then the beef. Cook until browned, about 8 minutes.',
      'Stir in the tomato paste for 1 minute, then the tomatoes, milk and oregano.',
      'Simmer, partly covered, for 45 minutes, stirring now and then. Season with salt and pepper.',
      'Cook the spaghetti in salted water for 10 minutes, or as the packet says. Drain.',
      'Toss the spaghetti with the sauce and serve with parmesan.',
    ],
    art: {
      table: '#B9C7B0',
      plate: '#F8F4EA',
      base: '#E8C77A',
      garnish: ['#B23A26', '#4F8A3A'],
      shape: 'plate',
    },
  },
  {
    id: 'rec-pancakes',
    title: 'Fluffy buttermilk pancakes',
    servings: 4,
    totalMinutes: 30,
    tags: ['weekend', 'breakfast', 'kids love'],
    rating: 4,
    cookedDaysAgo: 6,
    sourceUrl: 'https://www.example.com/recipes/buttermilk-pancakes',
    ingredients: [
      '2 cups all-purpose flour',
      '2 tbsp sugar',
      '2 tsp baking powder',
      '½ tsp baking soda',
      '½ tsp salt',
      '2 cups buttermilk',
      '2 large eggs',
      '3 tbsp butter, melted',
      '1 cup blueberries',
      'Maple syrup, for serving',
    ],
    steps: [
      'Whisk the flour, sugar, baking powder, baking soda and salt in a large bowl.',
      'In another bowl whisk the buttermilk, eggs and melted butter.',
      'Pour the wet into the dry and stir until just combined. Lumps are fine. Rest for 5 minutes.',
      'Heat a lightly buttered pan over medium heat. Pour ¼ cup of batter per pancake and scatter on a few blueberries.',
      'Cook for 2 minutes until bubbles form, flip, and cook 1 minute more.',
      'Serve warm with maple syrup.',
    ],
    art: {
      table: '#A9C6DE',
      plate: '#FFFFFF',
      base: '#E2A85A',
      garnish: ['#3B3F8F', '#F6E7B0'],
      shape: 'stack',
    },
  },
  {
    id: 'rec-chicken',
    title: 'Lemon herb roast chicken',
    servings: 4,
    totalMinutes: 90,
    tags: ['sunday', 'easy'],
    rating: 5,
    cookedDaysAgo: 20,
    sourceUrl: 'https://www.example.com/recipes/lemon-herb-roast-chicken',
    ingredients: [
      '1 whole chicken (about 4 lb)',
      '2 lemons',
      '4 sprigs fresh thyme',
      '2 sprigs rosemary',
      '6 cloves garlic, smashed',
      '3 tbsp butter, softened',
      '1½ lb baby potatoes, halved',
      '4 carrots, cut into chunks',
      '2 tbsp olive oil',
      '1 tsp flaky salt',
    ],
    steps: [
      'Heat the oven to 425°F (220°C). Take the chicken out of the fridge 30 minutes before.',
      'Toss the potatoes and carrots with the oil and salt in a roasting tin.',
      'Rub the butter over the chicken. Halve one lemon and put it inside with the herbs and garlic.',
      'Set the chicken on the vegetables and roast for 1 hour 15 minutes, until the juices run clear.',
      'Rest the chicken for 15 minutes before carving. Squeeze over the second lemon.',
    ],
    art: {
      table: '#D8C3A5',
      plate: '#F6F1E6',
      base: '#C98B3C',
      garnish: ['#F3D34A', '#5E8C3A'],
      shape: 'plate',
    },
  },
  {
    id: 'rec-curry',
    title: 'Thai green curry',
    servings: 4,
    totalMinutes: 35,
    tags: ['spicy', 'thai'],
    rating: 4,
    sourceUrl: 'https://www.example.com/recipes/thai-green-curry',
    ingredients: [
      '1 tbsp vegetable oil',
      '3 tbsp green curry paste',
      '1 (14 oz) can coconut milk',
      '1½ lb boneless chicken thighs, sliced',
      '1 red bell pepper, sliced',
      '1 cup green beans, trimmed',
      '1 tbsp fish sauce',
      '1 tsp brown sugar',
      '1 handful Thai basil',
      '1½ cups jasmine rice',
      '1 lime',
    ],
    steps: [
      'Rinse the rice and cook it with 2¼ cups of water, covered, for 15 minutes. Rest 10 minutes.',
      'Fry the curry paste in the oil for 1 minute until fragrant.',
      'Add half the coconut milk and bubble for 2 minutes, then the chicken. Cook for 5 minutes.',
      'Add the rest of the coconut milk, the pepper and the beans. Simmer for 8 minutes.',
      'Season with the fish sauce, sugar and lime juice. Stir in the basil and serve over rice.',
    ],
    art: {
      table: '#2F4B3F',
      plate: '#F4EFE3',
      base: '#B8C77A',
      garnish: ['#E04B3A', '#3E7A35'],
      shape: 'bowl',
    },
  },
  {
    id: 'rec-banana',
    title: "Grandma's banana bread",
    servings: 10,
    totalMinutes: 75,
    tags: ['baking', 'snack'],
    rating: 5,
    notes: 'From the card in the recipe tin. Walnuts optional.',
    ingredients: [
      '3 ripe bananas, mashed',
      '⅓ cup butter, melted',
      '¾ cup brown sugar',
      '1 large egg, beaten',
      '1 tsp vanilla extract',
      '1 tsp baking soda',
      'Pinch of salt',
      '1½ cups all-purpose flour',
      '½ cup chopped walnuts',
    ],
    steps: [
      'Heat the oven to 350°F (175°C) and butter a 4 by 8 inch loaf pan.',
      'Mix the mashed bananas with the melted butter.',
      'Stir in the sugar, egg and vanilla, then the baking soda and salt.',
      'Fold in the flour and walnuts until just combined.',
      'Pour into the pan and bake for 55 to 60 minutes, until a skewer comes out clean.',
      'Cool in the pan for 10 minutes, then on a rack.',
    ],
    art: {
      table: '#E7D8C4',
      plate: '#FAF6EF',
      base: '#9A5B2E',
      garnish: ['#F1D27A', '#6B3B1E'],
      shape: 'loaf',
    },
  },
  {
    id: 'rec-cookies',
    title: 'Chewy chocolate chip cookies',
    servings: 24,
    totalMinutes: 40,
    tags: ['baking', 'kids love', 'treat'],
    rating: 5,
    sourceUrl: 'https://www.example.com/recipes/chocolate-chip-cookies',
    ingredients: [
      '1 cup butter, softened',
      '¾ cup sugar',
      '¾ cup packed brown sugar',
      '2 large eggs',
      '2 tsp vanilla extract',
      '2¼ cups all-purpose flour',
      '1 tsp baking soda',
      '1 tsp salt',
      '2 cups chocolate chips',
    ],
    steps: [
      'Heat the oven to 375°F (190°C). Line two baking sheets.',
      'Beat the butter and both sugars for 3 minutes until fluffy. Beat in the eggs and vanilla.',
      'Mix in the flour, baking soda and salt, then the chocolate chips.',
      'Scoop tablespoons of dough onto the sheets, 2 inches apart.',
      'Bake for 9 to 11 minutes until golden at the edges. Cool on the sheet for 5 minutes.',
    ],
    art: {
      table: '#C9DCD2',
      plate: '#FFFDF8',
      base: '#D9A25F',
      garnish: ['#4A2A17', '#E9C58F'],
      shape: 'cookies',
    },
  },
  {
    id: 'rec-soup',
    title: 'Creamy tomato soup',
    servings: 4,
    totalMinutes: 40,
    tags: ['vegetarian', 'quick', 'soup'],
    sourceUrl: 'https://www.example.com/recipes/creamy-tomato-soup',
    ingredients: [
      '2 tbsp butter',
      '1 onion, chopped',
      '2 cloves garlic',
      '2 (28 oz) cans whole tomatoes',
      '2 cups vegetable stock',
      '1 tsp sugar',
      '½ cup heavy cream',
      '1 handful fresh basil',
      '4 slices sourdough, for grilled cheese',
    ],
    steps: [
      'Melt the butter in a pot and cook the onion for 8 minutes until soft. Add the garlic for 1 minute.',
      'Add the tomatoes, stock and sugar. Simmer for 20 minutes.',
      'Blend until smooth, stir in the cream and basil, and season.',
      'Serve with grilled cheese on the side.',
    ],
    art: {
      table: '#3B4A63',
      plate: '#F7F2E8',
      base: '#D9532F',
      garnish: ['#FFF4E0', '#4E8A3E'],
      shape: 'bowl',
    },
  },
];

/** The recipe box in mock mode: eight recipes, with generated photos. */
export function mockRecipes(now: Date): Recipe[] {
  return SEEDS.map((s, i) => ({
    id: s.id,
    title: s.title,
    ...(s.sourceUrl ? { sourceUrl: s.sourceUrl } : {}),
    image: `mock:${s.id}`,
    hasPhoto: true,
    servings: s.servings,
    totalMinutes: s.totalMinutes,
    ingredients: s.ingredients.map(toRecipeIngredient),
    steps: s.steps,
    tags: s.tags,
    notes: s.notes ?? '',
    ...(s.rating ? { rating: s.rating } : {}),
    ...(s.cookedDaysAgo ? { lastCooked: toIsoDate(addDays(now, -s.cookedDaysAgo)) } : {}),
    via: s.sourceUrl ? ('link' as const) : ('typed' as const),
    createdAt: addDays(now, -60 + i).toISOString(),
  }));
}

/** The generated photo's look for a mock recipe id. */
export const recipeArt = (id: string): RecipeArt | undefined => SEEDS.find((s) => s.id === id)?.art;

/** Which mock favourites cook a recipe from the box. */
export const FAVOURITE_RECIPES: Record<string, string> = {
  'fav-tacos': 'rec-tacos',
  'fav-bolognese': 'rec-bolognese',
  'fav-pancakes': 'rec-pancakes',
};

/** What mock mode "reads" from a photo or pasted text. */
export function sampleRecipeImport(): Omit<Recipe, 'id'> {
  return {
    title: 'Oatmeal raisin cookies',
    hasPhoto: false,
    servings: 18,
    totalMinutes: 30,
    ingredients: [
      '½ cup butter, softened',
      '¾ cup brown sugar',
      '1 egg',
      '1 tsp vanilla',
      '¾ cup flour',
      '½ tsp baking soda',
      '1 tsp cinnamon',
      '1½ cups rolled oats',
      '¾ cup raisins',
    ].map(toRecipeIngredient),
    steps: [
      'Heat the oven to 350°F. Cream the butter and sugar, then beat in the egg and vanilla.',
      'Stir in the flour, soda and cinnamon, then the oats and raisins.',
      'Drop spoonfuls onto a lined sheet and bake for 10 to 12 minutes.',
    ],
    tags: ['baking'],
    notes: '',
    via: 'claude',
  };
}
