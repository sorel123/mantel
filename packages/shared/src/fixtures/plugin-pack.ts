/**
 * v4 G, the plugin pack: the manifests of nine small plugins (birthdays, pet care, family poll,
 * sports, school day, house status, habits and plants, question of the day, sky). The server's
 * `apps/server/src/plugins/<id>/manifest.ts` re-exports these, so the copy the display renders in
 * mock mode can never drift from the server's. Sample blocks for each card are below, for the
 * Settings gallery's preview of a plugin that is turned off and for display tests.
 */
import type { PluginBlocksInput, PluginManifest, SetupField } from '../plugins.js';
import { addDays } from '../time.js';

type FieldInput = Omit<SetupField, 'required' | 'advanced' | 'readOnly'> &
  Partial<Pick<SetupField, 'required' | 'advanced' | 'readOnly'>>;
const field = (f: FieldInput): SetupField => ({
  required: false,
  advanced: false,
  readOnly: false,
  ...f,
});

export const birthdaysManifest: PluginManifest = {
  id: 'birthdays',
  name: 'Birthdays and anniversaries',
  description: 'Who has a birthday coming up, how old they turn, and a banner on the day.',
  category: 'info',
  step: null,
  connect: 'fields',
  optional: true,
  docs: 'plugin-pack.md',
  directions: [
    'Type each birthday as a name and a date, one per line: Mia 2015-03-14, or Grandma 03-02 when you do not know the year.',
    'Add the word anniversary for an anniversary: Mom and Dad anniversary 2010-06-12.',
    'Birthdays already on your calendars (Google’s Birthdays calendar, for one) are found by themselves.',
  ],
  fields: [
    field({
      key: 'list',
      label: 'Birthdays',
      type: 'text',
      placeholder: 'Mia 2015-03-14; Grandma 03-02; Mom and Dad anniversary 2010-06-12',
      help: 'A name and a date per entry, separated by semicolons. With the year, the card says how old they turn.',
      pattern: {
        regex: '^([^;]*\\d{1,2}[-/]\\d{1,2}[^;]*)(;[^;]*\\d{1,2}[-/]\\d{1,2}[^;]*)*;?\\s*$',
        message: 'Write each one as a name and a date, like Mia 2015-03-14; Grandma 03-02',
      },
    }),
    field({
      key: 'fromCalendars',
      label: 'Also find birthdays on the calendars',
      type: 'toggle',
      default: true,
      help: 'Events named “birthday” or “anniversary” on any connected calendar.',
    }),
    field({
      key: 'lookahead',
      label: 'Look ahead (days)',
      type: 'number',
      min: 7,
      max: 366,
      default: 60,
      advanced: true,
    }),
    field({
      key: 'banner',
      label: 'Banner on the morning of a birthday',
      type: 'toggle',
      default: true,
    }),
  ],
  contributes: {
    todayCard: {
      name: 'Birthdays',
      description: 'The next birthdays and anniversaries, with ages.',
      min: [2.5, 1.5],
      comfort: [4, 2.5],
      data: 'card',
    },
    ambientSlot: { id: 'birthdays', order: 4, data: 'ambient' },
    dockChip: { id: 'birthdays', data: 'chip' },
    events: ['plugin.changed', 'plugin.alert'],
  },
};

export const petsManifest: PluginManifest = {
  id: 'pets',
  name: 'Pet care',
  description: '“Has the dog been fed?” One tap marks it with who and when; a nudge if it is late.',
  category: 'info',
  step: null,
  connect: 'fields',
  optional: true,
  docs: 'plugin-pack.md',
  directions: [
    'Write each pet, a colon, then its jobs with a time: Biscuit: breakfast 7:30, dinner 17:30, walk 18:00.',
    'Separate pets with a semicolon. A job without a time is just “today”.',
    'Add the Pet care card to Today. Tap a name on a job to mark it done; everything resets at midnight.',
  ],
  fields: [
    field({
      key: 'pets',
      label: 'Pets and their jobs',
      type: 'text',
      required: true,
      placeholder:
        'Biscuit: breakfast 7:30, dinner 17:30, walk 18:00; Luna: breakfast 7, meds 20:00',
      help: 'Pet name, a colon, then jobs and times. Separate pets with a semicolon.',
      pattern: {
        regex: '^[^:;]+:[^;]+(;\\s*[^:;]+:[^;]+)*;?\\s*$',
        message: 'Write it as Name: job time, job time; Name: job time',
      },
    }),
    field({
      key: 'grace',
      label: 'Late after (minutes)',
      type: 'number',
      min: 10,
      max: 240,
      default: 60,
      help: 'A job turns orange at its time and nudges the wall this long after.',
    }),
    field({
      key: 'nudge',
      label: 'Banner when a job is late',
      type: 'toggle',
      default: true,
    }),
  ],
  contributes: {
    todayCard: {
      name: 'Pet care',
      description: 'Each pet’s jobs today, with who did them.',
      min: [3, 2],
      comfort: [4, 3],
      data: 'card',
    },
    ambientSlot: { id: 'pets', order: 3, data: 'ambient' },
    dockChip: { id: 'pets', data: 'chip', sheet: 'card' },
    events: ['plugin.changed', 'plugin.alert'],
  },
};

export const pollManifest: PluginManifest = {
  id: 'poll',
  name: 'Family poll',
  description:
    '“Pizza or tacos?” Ask on the wall, everyone taps a choice, the winner shows at the end.',
  category: 'info',
  step: null,
  connect: 'fields',
  optional: true,
  docs: 'plugin-pack.md',
  directions: [
    'Add the Family poll card to Today, or tap Poll in the dock.',
    'Type a question with “or” between the choices (Pizza or tacos?) and tap Ask.',
    'Each person taps their pick. The poll closes on its own and shows the winner.',
  ],
  fields: [
    field({
      key: 'closeAfter',
      label: 'Close after (minutes)',
      type: 'number',
      min: 5,
      max: 1440,
      default: 120,
    }),
    field({
      key: 'announce',
      label: 'Banner with the winner',
      type: 'toggle',
      default: true,
    }),
  ],
  contributes: {
    todayCard: {
      name: 'Family poll',
      description: 'The open question with a tap per person, or the last winner.',
      min: [3, 2],
      comfort: [4, 3.5],
      data: 'card',
    },
    ambientSlot: { id: 'poll', order: 4, data: 'ambient' },
    dockChip: {
      id: 'poll',
      data: 'chip',
      sheet: 'card',
      idle: { text: 'Poll', icon: 'vote', tone: 'normal', label: 'Family poll' },
    },
    events: ['plugin.changed', 'plugin.alert'],
  },
};

export const sportsManifest: PluginManifest = {
  id: 'sports',
  name: 'Sports',
  description: 'Your teams: the next game, the live score, the final.',
  category: 'info',
  step: null,
  connect: 'fields',
  optional: true,
  docs: 'plugin-pack.md',
  directions: [
    'Find your team on [espn.com](https://www.espn.com). The address ends with the league and the team’s short name, like /nfl/team/_/name/det.',
    'Write each as league/team, separated by semicolons: nfl/det; nba/det; eng.1/ars.',
    'For a kids’ team, paste its schedule link (.ics) from TeamSnap, GameChanger or the league site.',
  ],
  fields: [
    field({
      key: 'teams',
      label: 'Teams',
      type: 'text',
      placeholder: 'nfl/det; nba/det; mlb/det; nhl/det',
      help: 'League and team as ESPN writes them. Leagues: nfl, nba, wnba, mlb, nhl, mls, college-football, mens-college-basketball, eng.1 and more.',
      getItHere: { label: 'ESPN teams', url: 'https://www.espn.com/nfl/teams' },
      pattern: {
        regex: '^\\s*[a-z0-9.-]+/[a-z0-9-]+\\s*(;\\s*[a-z0-9.-]+/[a-z0-9-]+\\s*)*;?\\s*$',
        message: 'Write each as league/team, like nfl/det; nba/lal',
      },
    }),
    field({
      key: 'icsUrl',
      label: 'A team schedule link',
      type: 'url',
      placeholder: 'webcal://…/team-schedule.ics',
      help: 'For teams ESPN does not cover: the subscribe link from TeamSnap, GameChanger or the league.',
      pattern: {
        regex: '^(https?|webcal)://',
        message: 'Paste a link starting with https:// or webcal://',
      },
    }),
    field({
      key: 'icsName',
      label: 'Call that team',
      type: 'text',
      placeholder: 'Mia’s soccer',
      dependsOn: { key: 'icsUrl' },
    }),
    field({
      key: 'finals',
      label: 'Banner when a game ends',
      type: 'toggle',
      default: true,
    }),
  ],
  contributes: {
    todayCard: {
      name: 'Sports',
      description: 'Next game, live score or final for each team.',
      min: [3, 1.5],
      comfort: [4, 2.5],
      data: 'card',
    },
    ambientSlot: { id: 'sports', order: 4, data: 'ambient' },
    dockChip: { id: 'sports', data: 'chip', sheet: 'card' },
    events: ['plugin.changed', 'plugin.alert'],
  },
};

export const schoolManifest: PluginManifest = {
  id: 'school',
  name: 'School day',
  description: 'Today’s lunch, A day or B day, and no-school days, the evening before.',
  category: 'info',
  step: null,
  connect: 'fields',
  optional: true,
  docs: 'plugin-pack.md',
  directions: [
    'Paste the lunch menu link if your district has one (Nutrislice and most menu sites offer a calendar subscription), or type a weekly menu.',
    'For a rotating schedule, list the day names (A, B) and the date of a recent first day.',
    'List the no-school days, or paste the school calendar link and Mantel finds “No school” days on it.',
  ],
  fields: [
    field({
      key: 'menuUrl',
      label: 'Lunch menu link',
      type: 'url',
      placeholder: 'webcal://…/menu.ics',
      help: 'A calendar link with one entry a day (most district menu sites have Subscribe).',
      pattern: {
        regex: '^(https?|webcal)://',
        message: 'Paste a link starting with https:// or webcal://',
      },
    }),
    field({
      key: 'menu',
      label: 'Or a weekly menu',
      type: 'text',
      placeholder: 'Mon: Pizza; Tue: Tacos; Wed: Chicken nuggets; Thu: Pasta; Fri: Fish sticks',
      help: 'Repeats every week. Used when the link has nothing for a day.',
    }),
    field({
      key: 'rotation',
      label: 'Day rotation',
      type: 'text',
      placeholder: 'A, B',
      help: 'The names of the rotating days, in order. Leave empty for none.',
    }),
    field({
      key: 'rotationStart',
      label: 'A recent first day of the rotation',
      type: 'text',
      placeholder: '2026-11-17',
      dependsOn: { key: 'rotation' },
      pattern: { regex: '^\\d{4}-\\d{2}-\\d{2}$', message: 'Write the date as 2026-11-17' },
    }),
    field({
      key: 'noSchool',
      label: 'No-school days',
      type: 'text',
      placeholder: '2026-11-26 Thanksgiving; 2026-12-21..2027-01-01 Winter break',
      help: 'A date or a range (with ..) and a name, separated by semicolons. They do not count in the rotation.',
    }),
    field({
      key: 'calendarUrl',
      label: 'School calendar link',
      type: 'url',
      placeholder: 'https://…/district.ics',
      help: 'Days named “No school”, “Break” or “A day”/“B day” on it are picked up.',
      advanced: true,
      pattern: {
        regex: '^(https?|webcal)://',
        message: 'Paste a link starting with https:// or webcal://',
      },
    }),
  ],
  contributes: {
    todayCard: {
      name: 'School day',
      description: 'Lunch and day type today and tomorrow.',
      min: [2.5, 1.5],
      comfort: [4, 2],
      data: 'card',
    },
    ambientSlot: { id: 'school', order: 3, data: 'ambient' },
    events: ['plugin.changed'],
  },
};

export const houseStatusManifest: PluginManifest = {
  id: 'housestatus',
  name: 'House status',
  description:
    'Washer done, garage open, doors unlocked at night with a one-tap lock, energy today.',
  category: 'home',
  step: null,
  connect: 'fields',
  optional: true,
  docs: 'plugin-pack.md',
  directions: [
    'Connect Home Assistant first (Settings, Home Assistant) and allow the locks, garage door and appliance sensors you want here.',
    'Leave the list empty and Mantel picks them itself: locks, garage doors, doors, the washer, dryer and dishwasher, and energy today.',
    'Or list entity ids to show exactly those.',
  ],
  fields: [
    field({
      key: 'entities',
      label: 'Show these',
      type: 'text',
      placeholder: 'lock.front_door; cover.garage_door; sensor.washer_status',
      help: 'Home Assistant entity ids, separated by semicolons. Empty: picked for you.',
    }),
    field({
      key: 'nightFrom',
      label: 'Night starts (hour)',
      type: 'number',
      min: 17,
      max: 23,
      default: 21,
      help: 'From this hour an unlocked door or open garage turns orange.',
    }),
    field({
      key: 'nightBanner',
      label: 'Banner at night when something is open',
      type: 'toggle',
      default: false,
      help: 'Once a night, with a Lock button.',
    }),
    field({
      key: 'doneBanner',
      label: 'Banner when the washer or dryer finishes',
      type: 'toggle',
      default: true,
    }),
  ],
  contributes: {
    todayCard: {
      name: 'House status',
      description: 'Locks, garage, appliances and energy at a glance.',
      min: [3, 2],
      comfort: [4, 3],
      data: 'card',
    },
    ambientSlot: { id: 'housestatus', order: 2, data: 'ambient' },
    events: ['plugin.changed', 'plugin.alert'],
  },
};

export const habitsManifest: PluginManifest = {
  id: 'habits',
  name: 'Habits and plants',
  description:
    'Water the plants every 5 days, vitamins daily: what is due, and when it was last done.',
  category: 'info',
  step: null,
  connect: 'fields',
  optional: true,
  docs: 'plugin-pack.md',
  directions: [
    'Write each one with how often: Water the plants every 5 days; Vitamins daily for Jay; Furnace filter every 90 days.',
    'Add the Habits card to Today and tap Done when it is done. The card counts from there.',
  ],
  fields: [
    field({
      key: 'habits',
      label: 'Habits',
      type: 'text',
      required: true,
      placeholder:
        'Water the plants every 5 days; Vitamins daily for Jay; Furnace filter every 90 days',
      help: 'A name, then daily, weekly, every N days or every N weeks, and “for” a person if it is theirs.',
    }),
  ],
  contributes: {
    todayCard: {
      name: 'Habits and plants',
      description: 'What is due, overdue, and coming up.',
      min: [2.5, 1.5],
      comfort: [4, 2.5],
      data: 'card',
    },
    ambientSlot: { id: 'habits', order: 4, data: 'ambient' },
    events: ['plugin.changed'],
  },
};

export const qotdManifest: PluginManifest = {
  id: 'qotd',
  name: 'Question of the day',
  description: 'A dinner-table conversation starter, a new one each day from 365.',
  category: 'info',
  step: null,
  connect: 'fields',
  optional: true,
  docs: 'plugin-pack.md',
  directions: ['Add the card to Today. Tap Another one if the question does not land.'],
  fields: [
    field({
      key: 'kids',
      label: 'Kid-friendly questions only',
      type: 'toggle',
      default: true,
    }),
    field({
      key: 'ambient',
      label: 'Show it on Ambient at dinner',
      type: 'toggle',
      default: false,
    }),
    field({
      key: 'dinner',
      label: 'Dinner time',
      type: 'text',
      default: '17:30',
      placeholder: '17:30',
      dependsOn: { key: 'ambient', equals: true },
      pattern: { regex: '^\\d{1,2}:\\d{2}$', message: 'Write the time as 17:30' },
    }),
  ],
  contributes: {
    todayCard: {
      name: 'Question of the day',
      description: 'A conversation starter for dinner.',
      min: [3, 1.5],
      comfort: [4, 2],
      data: 'card',
    },
    ambientSlot: { id: 'qotd', order: 5, data: 'ambient' },
    events: ['plugin.changed'],
  },
};

export const skyManifest: PluginManifest = {
  id: 'sky',
  name: 'Sky',
  description: 'Sunrise, sunset, the moon, and the next thing worth looking up for.',
  category: 'weather',
  step: null,
  connect: 'none',
  optional: true,
  docs: 'plugin-pack.md',
  directions: [
    'Nothing to set up: it uses the home location from Settings, Your home.',
    'Ambient mentions full moons and meteor showers on the night.',
  ],
  fields: [],
  contributes: {
    todayCard: {
      name: 'Sky',
      description: 'Sunrise, sunset, moon phase and the next sky event.',
      min: [2.5, 1.5],
      comfort: [4, 2.5],
      data: 'card',
    },
    ambientSlot: { id: 'sky', order: 6, data: 'ambient' },
    events: ['plugin.changed'],
  },
};

export const pluginPackManifests: PluginManifest[] = [
  birthdaysManifest,
  petsManifest,
  pollManifest,
  sportsManifest,
  schoolManifest,
  houseStatusManifest,
  habitsManifest,
  qotdManifest,
  skyManifest,
];

/** A sample card per pack plugin, for previews of a plugin that is off (and for tests). */
export function pluginPackSamples(now = new Date()): Record<string, PluginBlocksInput> {
  const day = (n: number) => addDays(now, n).toLocaleDateString('en-US', { weekday: 'long' });
  return {
    birthdays: {
      title: 'Birthdays',
      icon: 'cake',
      lines: [
        { icon: 'cake', text: 'Mia turns 11', sub: `${day(3)} · in 3 days`, tone: 'normal' },
        { icon: 'heart', text: 'Mom and Dad: 16 years', sub: 'Dec 12 · in 21 days' },
        { icon: 'cake', text: 'Grandma Rose', sub: 'Jan 2 · in 42 days' },
      ],
    },
    pets: {
      title: 'Pet care',
      icon: 'paw',
      lines: [
        { icon: 'check', text: 'Biscuit · Breakfast', sub: 'Done 7:41 AM by Mia', tone: 'good' },
        {
          icon: 'paw',
          text: 'Biscuit · Dinner',
          sub: 'Due 5:30 PM',
          actions: [
            { name: 'done', label: 'Jay', args: { task: 'biscuit/dinner', by: 'Jay' } },
            { name: 'done', label: 'Mia', args: { task: 'biscuit/dinner', by: 'Mia' } },
          ],
        },
        { icon: 'pill', text: 'Luna · Meds', sub: 'Due 8 PM' },
      ],
    },
    poll: {
      title: 'Pizza or tacos?',
      icon: 'vote',
      lines: [
        { icon: 'trophy', text: 'Tacos', sub: '2 votes · Jay, Mia', tone: 'good' },
        { icon: 'vote', text: 'Pizza', sub: '1 vote · Leo' },
      ],
      footer: 'Closes at 6 PM · Ava has not voted',
    },
    sports: {
      title: 'Sports',
      icon: 'trophy',
      lines: [
        { icon: 'trophy', text: 'Lions 24, Packers 17', sub: 'Live · 4th 2:11', tone: 'warn' },
        { icon: 'calendar', text: 'Pistons at Bulls', sub: `${day(2)} 8 PM · in 2 days` },
        { icon: 'check', text: 'Red Wings 3, Bruins 2', sub: 'Final (OT) · Won', tone: 'good' },
      ],
    },
    school: {
      title: 'School · B day',
      icon: 'school',
      lines: [
        { icon: 'lunch', text: 'Lunch: Chicken tacos', sub: 'Today' },
        { icon: 'school', text: 'A day · Pizza', sub: 'Tomorrow' },
        { icon: 'star', text: 'No school', sub: 'Thursday · Thanksgiving', tone: 'good' },
      ],
    },
    housestatus: {
      title: 'House status',
      icon: 'house',
      lines: [
        {
          icon: 'unlock',
          text: 'Front door',
          sub: 'Unlocked',
          tone: 'warn',
          actions: [
            {
              name: 'call',
              label: 'Lock',
              args: { entity: 'lock.front_door', service: 'lock' },
              tone: 'primary',
            },
          ],
        },
        { icon: 'door', text: 'Garage door', sub: 'Closed' },
        { icon: 'washer', text: 'Washer', sub: 'Done 12 min ago', tone: 'good' },
        { icon: 'bolt', text: 'Energy today', sub: '14.2 kWh' },
      ],
    },
    habits: {
      title: 'Habits and plants',
      icon: 'sprout',
      lines: [
        {
          icon: 'sprout',
          text: 'Water the plants',
          sub: 'Due today · last done Sunday',
          tone: 'warn',
          actions: [{ name: 'done', label: 'Done', args: { key: 'water-the-plants' } }],
        },
        { icon: 'check', text: 'Vitamins · Jay', sub: 'Done today', tone: 'good' },
        { icon: 'sprout', text: 'Furnace filter', sub: 'In 34 days' },
      ],
    },
    qotd: {
      title: 'Question of the day',
      icon: 'chat',
      lead: 'If you could have any animal as a pet, what would it be?',
      lines: [],
      actions: [{ name: 'next', label: 'Another one' }],
    },
    sky: {
      title: 'Sky',
      icon: 'sun',
      lines: [
        { icon: 'sunrise', text: 'Sunrise 7:32 AM', sub: 'Sunset 5:08 PM · 9 h 36 min of light' },
        { icon: 'moon', text: 'Waxing gibbous', sub: '78% lit · full moon in 3 days' },
        { icon: 'sparkle', text: 'Geminids peak', sub: 'Dec 14 · in 23 days' },
      ],
    },
  };
}
