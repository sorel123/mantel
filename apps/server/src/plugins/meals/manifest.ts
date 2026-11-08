import type { PluginManifest } from '@mantel/shared';

export const manifest: PluginManifest = {
  id: 'meals',
  name: 'Meal planner',
  description:
    'Plan the week on the wall from your favourite meals and send the ingredients to the grocery list. Built in.',
  category: 'tasks',
  step: null,
  connect: 'none',
  optional: true,
  docs: 'meals.md',
  directions: [
    'Nothing to connect: the plan and favourites live on this server.',
    'Tap Tonight or the meals card on Today to open the planner.',
    'A calendar named Meals is still read: its entries fill any slot the planner leaves empty.',
  ],
  fields: [],
  contributes: { events: ['calendar.changed', 'list.changed'] },
};
