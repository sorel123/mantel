import type { PluginManifest } from '@mantel/shared';

export const manifest: PluginManifest = {
  id: 'timers',
  name: 'Kitchen timers',
  description:
    'Timers from the dock: tap a preset, run several at once, every display rings at zero.',
  category: 'info',
  step: null,
  connect: 'fields',
  optional: true,
  docs: 'plugins.md',
  directions: [
    'Tap the timer chip in the dock, beside the clock, and pick a preset or dial your own.',
    'Timers live on the server, so every display shows them and rings when one is done.',
  ],
  fields: [
    {
      key: 'chime',
      label: 'Chime when a timer is done',
      type: 'toggle',
      default: true,
      help: 'A soft chime with the banner, until someone taps Stop. Off shows the banner only.',
      required: false,
      advanced: false,
      readOnly: false,
    },
  ],
  contributes: {
    todayCard: {
      name: 'Kitchen timers',
      description: 'Running timers, with the presets to start one.',
      min: [3, 2],
      comfort: [4, 4],
      data: 'sheet',
    },
    ambientSlot: { id: 'timers', order: 2, data: 'ambient' },
    dockChip: {
      id: 'timers',
      data: 'chip',
      sheet: 'sheet',
      idle: { text: 'Timer', icon: 'timer', tone: 'normal', label: 'Kitchen timers' },
    },
    events: ['plugin.changed', 'plugin.alert'],
  },
};
