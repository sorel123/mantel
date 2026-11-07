import type { PluginManifest, SetupField } from '@mantel/shared';

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

export const manifest: PluginManifest = {
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
