/**
 * v3 X: the manifests of the two plugins that draw cards (trash day, kitchen timers), kept in
 * step with `apps/server/src/plugins/trash/` and `timers/` (the manifest test fails on drift),
 * and sample blocks for each data route, as the server answers them in mock mode.
 */
import { addDays, toLocalIso } from '../time.js';
import type { PluginBlocksInput, PluginChipInput, PluginManifest, SetupField } from '../plugins.js';

const DAYS = [
  { value: 'none', label: 'No pickup' },
  { value: 'monday', label: 'Monday' },
  { value: 'tuesday', label: 'Tuesday' },
  { value: 'wednesday', label: 'Wednesday' },
  { value: 'thursday', label: 'Thursday' },
  { value: 'friday', label: 'Friday' },
  { value: 'saturday', label: 'Saturday' },
  { value: 'sunday', label: 'Sunday' },
];

/** The three fields of one stream: its day, how often, and a recent pickup for every-other-week. */
function stream(key: 'trash' | 'recycling' | 'yard', label: string, day: string): SetupField[] {
  return [
    {
      key: `${key}Day`,
      label: `${label} day`,
      type: 'select',
      options: DAYS,
      default: day,
      required: false,
      advanced: false,
      readOnly: false,
    },
    {
      key: `${key}Every`,
      label: `${label} comes`,
      type: 'select',
      options: [
        { value: 'weekly', label: 'Every week' },
        { value: 'biweekly', label: 'Every other week' },
      ],
      default: 'weekly',
      dependsOn: { key: `${key}Day` },
      required: false,
      advanced: false,
      readOnly: false,
    },
    {
      key: `${key}Since`,
      label: `A recent ${label.toLowerCase()} pickup`,
      type: 'text',
      placeholder: '2026-11-05',
      help: 'Any date it was picked up, so Mantel knows which weeks are on. Your city’s calendar has one.',
      pattern: { regex: '^\\d{4}-\\d{2}-\\d{2}$', message: 'Write the date as 2026-11-05' },
      dependsOn: { key: `${key}Every`, equals: 'biweekly' },
      required: false,
      advanced: false,
      readOnly: false,
    },
  ];
}

export const trashManifest: PluginManifest = {
  id: 'trash',
  name: 'Trash and recycling day',
  description:
    'A reminder the evening before pickup, on Today, Ambient and the dock. Nothing to sign up for.',
  category: 'info',
  step: null,
  connect: 'fields',
  optional: true,
  docs: 'plugins.md',
  directions: [
    'Pick the day each bin goes out. Your city or hauler’s website lists them, often as a printable calendar.',
    'For every-other-week pickups, give any recent pickup date so Mantel knows which weeks are on.',
    'Add the Trash and recycling card to Today in Settings, Layout, Your own. Ambient shows the reminder the evening before by itself.',
  ],
  fields: [
    ...stream('trash', 'Trash', 'none'),
    ...stream('recycling', 'Recycling', 'none'),
    ...stream('yard', 'Yard waste', 'none'),
    {
      key: 'holidayShift',
      label: 'A holiday pushes pickup back a day',
      type: 'toggle',
      default: false,
      help: 'In a week with New Year’s Day, Memorial Day, July 4, Labor Day, Thanksgiving or Christmas on or before pickup day (Monday to Friday), pickup moves one day later.',
      required: false,
      advanced: false,
      readOnly: false,
    },
    {
      key: 'remindFrom',
      label: 'Remind from (hour, the evening before)',
      type: 'number',
      min: 12,
      max: 23,
      default: 16,
      help: 'The reminder shows from this hour the day before, and until noon on pickup day.',
      required: false,
      advanced: true,
      readOnly: false,
    },
  ],
  contributes: {
    todayCard: {
      name: 'Trash and recycling',
      description: 'What goes out next, and a reminder the evening before.',
      min: [2.5, 1.5],
      comfort: [4, 2.5],
      data: 'card',
    },
    ambientSlot: { id: 'trash', order: 3, data: 'ambient' },
    events: ['plugin.changed'],
  },
};

export const timersManifest: PluginManifest = {
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

/** Sample answers for `GET /api/plugins/:id/blocks/:name` and `chip/:name`. */
export function pluginBlocks(now = new Date()): Record<string, PluginBlocksInput | null> {
  const soon = (min: number) => toLocalIso(new Date(now.getTime() + min * 60_000));
  const day = (n: number) => addDays(now, n).toLocaleDateString('en-US', { weekday: 'long' });
  return {
    'trash/card': {
      title: 'Trash and recycling tonight',
      icon: 'trash',
      lines: [
        { icon: 'trash', text: 'Trash', sub: 'Put it out tonight, pickup tomorrow', tone: 'warn' },
        {
          icon: 'recycle',
          text: 'Recycling',
          sub: 'Put it out tonight, pickup tomorrow',
          tone: 'warn',
        },
        { icon: 'leaf', text: 'Yard waste', sub: `${day(3)} · in 3 days` },
      ],
    },
    'trash/ambient': { title: 'Trash and recycling tonight', icon: 'trash', lines: [] },
    'timers/sheet': {
      title: 'Kitchen timers',
      icon: 'timer',
      lines: [
        {
          id: 't1',
          icon: 'timer',
          text: 'Pasta',
          countdownTo: soon(7),
          actions: [
            { name: 'add', label: '+1 min', args: { id: 't1', minutes: 1 } },
            { name: 'stop', label: 'Cancel', args: { id: 't1' } },
          ],
        },
      ],
      empty: 'No timers running. Pick one below.',
      actions: [1, 5, 10, 20, 45].map((m) => ({
        name: 'start',
        label: `${m} min`,
        args: { minutes: m },
      })),
      dial: {
        action: 'start',
        label: 'Or set your own',
        submit: 'Start',
        unit: 'min',
        min: 1,
        max: 180,
        step: 1,
        value: 15,
      },
    },
    'timers/ambient': {
      title: 'Timers',
      icon: 'timer',
      lines: [{ id: 't1', text: 'Pasta', countdownTo: soon(7) }],
    },
  };
}

export function pluginChips(now = new Date()): Record<string, PluginChipInput | null> {
  return {
    'timers/chip': {
      text: '',
      icon: 'timer',
      countdownTo: toLocalIso(new Date(now.getTime() + 7 * 60_000)),
      label: '1 timer running. Open timers',
    },
  };
}
