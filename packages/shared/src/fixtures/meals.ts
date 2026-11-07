import type { Favourite, MealsWeekResponse, PlannedMeal, PlanSlot } from '../meals.js';
import { addDays, startOfWeek, toIsoDate } from '../time.js';

/** The household's favourite meals in mock mode. */
export function mealFavourites(now: Date): Favourite[] {
  const daysAgo = (n: number) => toIsoDate(addDays(now, -n));
  return [
    {
      id: 'fav-tacos',
      title: 'Tacos',
      slot: 'dinner',
      ingredients: ['Tortillas', 'Ground beef', 'Cheddar', 'Salsa', 'Lettuce', 'Limes'],
      tags: ['quick', 'kids love'],
      lastUsed: daysAgo(7),
    },
    {
      id: 'fav-salmon',
      title: 'Salmon and rice',
      slot: 'dinner',
      ingredients: ['Salmon fillets', 'Jasmine rice', 'Broccoli', 'Soy sauce'],
      tags: ['healthy'],
      lastUsed: daysAgo(9),
    },
    {
      id: 'fav-bolognese',
      title: 'Spaghetti bolognese',
      slot: 'dinner',
      ingredients: ['Spaghetti', 'Ground beef', 'Crushed tomatoes', 'Onion', 'Parmesan'],
      tags: ['kids love'],
      lastUsed: daysAgo(14),
    },
    {
      id: 'fav-chicken',
      title: 'Sheet-pan chicken',
      slot: 'dinner',
      ingredients: ['Chicken thighs', 'Potatoes', 'Carrots', 'Lemon'],
      tags: ['easy'],
      lastUsed: daysAgo(20),
    },
    {
      id: 'fav-stirfry',
      title: 'Veggie stir-fry',
      slot: 'dinner',
      ingredients: ['Tofu', 'Bell peppers', 'Snap peas', 'Noodles', 'Soy sauce'],
      tags: ['vegetarian', 'quick'],
      lastUsed: null,
    },
    {
      id: 'fav-pancakes',
      title: 'Pancakes',
      slot: 'breakfast',
      ingredients: ['Flour', 'Eggs', 'Milk', 'Maple syrup', 'Blueberries'],
      tags: ['weekend'],
      lastUsed: daysAgo(6),
    },
    {
      id: 'fav-oats',
      title: 'Overnight oats',
      slot: 'breakfast',
      ingredients: ['Rolled oats', 'Yogurt', 'Bananas'],
      tags: ['quick'],
      lastUsed: null,
    },
    {
      id: 'fav-sandwiches',
      title: 'Turkey sandwiches',
      slot: 'lunch',
      ingredients: ['Sliced turkey', 'Bread', 'Cheddar', 'Apples'],
      tags: ['school'],
      lastUsed: daysAgo(3),
    },
  ];
}

/** What the planner holds for the current week in mock mode (day 0 is Monday). */
export const mealPlanSeed: ReadonlyArray<{
  day: number;
  slot: PlanSlot;
  favouriteId?: string;
  title?: string;
  ingredients?: string[];
}> = [
  { day: 0, slot: 'dinner', favouriteId: 'fav-tacos' },
  { day: 1, slot: 'dinner', favouriteId: 'fav-salmon' },
  { day: 2, slot: 'dinner', favouriteId: 'fav-bolognese' },
  { day: 1, slot: 'lunch', favouriteId: 'fav-sandwiches' },
  { day: 3, slot: 'lunch', favouriteId: 'fav-sandwiches' },
  { day: 5, slot: 'breakfast', favouriteId: 'fav-pancakes' },
  { day: 4, slot: 'breakfast', title: 'Bagels', ingredients: ['Bagels', 'Cream cheese'] },
];

/** A sample `GET /api/meals/week` answer: the seed merged over the Meals calendar fixture. */
export function mealsWeek(now: Date): MealsWeekResponse {
  const start = startOfWeek(now);
  const days = Array.from({ length: 7 }, (_, i) => toIsoDate(addDays(start, i)));
  const favs = new Map(mealFavourites(now).map((f) => [f.id, f]));
  const calendarDinners = ['Tacos', 'Salmon and rice', 'Pasta night', 'Leftovers', 'Pizza Friday'];
  const meals: PlannedMeal[] = mealPlanSeed.map((p) => {
    const fav = p.favouriteId ? favs.get(p.favouriteId) : undefined;
    const ingredients = p.ingredients ?? fav?.ingredients ?? [];
    return {
      date: days[p.day]!,
      slot: p.slot,
      title: p.title ?? fav?.title ?? '',
      ...(p.favouriteId ? { favouriteId: p.favouriteId } : {}),
      source: 'mantel',
      ingredients,
      unbought: ingredients.length,
    };
  });
  for (let i = 3; i < 7; i++)
    meals.push({
      date: days[i]!,
      slot: 'dinner',
      title: calendarDinners[i] ?? 'Grill out',
      source: 'calendar',
      ingredients: [],
      unbought: 0,
    });
  return {
    weekStart: days[0]!,
    days,
    slots: ['breakfast', 'lunch', 'dinner'],
    meals,
    groceryList: { id: 'list-grocery', name: 'Grocery' },
    mirroring: false,
  };
}
