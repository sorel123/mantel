/**
 * Core domain models. Every workstream imports these instead of inventing shapes.
 *
 * Conventions:
 * - Timestamps are ISO 8601 strings with an offset (`2026-10-31T09:00:00-07:00` or `...Z`).
 * - Calendar dates without a time are `YYYY-MM-DD`.
 * - Clock times in settings are `HH:MM` (24 h, local to the household timezone).
 * - Colours are CSS colour strings (`#E2694F`).
 * - Ids are opaque strings.
 */
import { z } from 'zod';
import { Appearance, DEFAULT_APPEARANCE } from './skins.js';

export const IsoDateTime = z.iso.datetime({ offset: true });
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
export const ClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM');
export const Color = z.string().min(1);
export const Id = z.string().min(1);

/* ---------- people & calendars ---------- */

export const Person = z.object({
  id: Id,
  name: z.string(),
  initial: z.string().max(2),
  color: Color,
  calendarIds: z.array(Id),
});
export type Person = z.infer<typeof Person>;

export const CalendarSource = z.enum(['google', 'icloud', 'ical']);
export type CalendarSource = z.infer<typeof CalendarSource>;

export const Calendar = z.object({
  id: Id,
  name: z.string(),
  source: CalendarSource,
  color: Color,
  /** People this calendar belongs to; events inherit them unless the event names its own. */
  personIds: z.array(Id),
  readOnly: z.boolean(),
  /** The calendar the meal plan is read from (named "Meals" by default). */
  isMeals: z.boolean().default(false),
});
export type Calendar = z.infer<typeof Calendar>;

/**
 * A normalised event from Google or iCloud.
 * All-day events: `start` is local midnight of the first day and `end` is local midnight
 * of the day after the last day (exclusive), both as full ISO timestamps.
 */
export const CalendarEvent = z.object({
  id: Id,
  calendarId: Id,
  title: z.string(),
  start: IsoDateTime,
  end: IsoDateTime,
  allDay: z.boolean(),
  location: z.string().optional(),
  personIds: z.array(Id),
  /** Resolved display colour: the first person's colour, else the calendar's. */
  color: Color,
  /** True when tagged with a star or `#countdown`. */
  countdown: z.boolean().default(false),
});
export type CalendarEvent = z.infer<typeof CalendarEvent>;

export const Countdown = z.object({
  eventId: Id,
  title: z.string(),
  date: IsoDate,
  daysRemaining: z.number().int().nonnegative(),
  personIds: z.array(Id),
  color: Color,
});
export type Countdown = z.infer<typeof Countdown>;

export const MealSlot = z.enum(['breakfast', 'lunch', 'dinner', 'other']);
export type MealSlot = z.infer<typeof MealSlot>;

export const Meal = z.object({
  date: IsoDate,
  slot: MealSlot,
  title: z.string(),
  eventId: Id.optional(),
});
export type Meal = z.infer<typeof Meal>;

/* ---------- weather & commute ---------- */

/** Icon key; the display maps it (plus `isDay`) to an icon. */
export const WeatherCondition = z.enum([
  'clear',
  'partly',
  'cloudy',
  'fog',
  'drizzle',
  'rain',
  'snow',
  'sleet',
  'storm',
  'wind',
]);
export type WeatherCondition = z.infer<typeof WeatherCondition>;

export const Units = z.enum(['imperial', 'metric']);
export type Units = z.infer<typeof Units>;

export const WeatherCurrent = z.object({
  temp: z.number(),
  feelsLike: z.number(),
  condition: WeatherCondition,
  summary: z.string(),
  isDay: z.boolean(),
  humidity: z.number().min(0).max(100),
  windSpeed: z.number().nonnegative(),
  precipChance: z.number().min(0).max(100),
});

export const WeatherHour = z.object({
  time: IsoDateTime,
  temp: z.number(),
  condition: WeatherCondition,
  isDay: z.boolean(),
  precipChance: z.number().min(0).max(100),
});

export const WeatherDay = z.object({
  date: IsoDate,
  high: z.number(),
  low: z.number(),
  condition: WeatherCondition,
  precipChance: z.number().min(0).max(100),
  sunrise: IsoDateTime,
  sunset: IsoDateTime,
  uvMax: z.number().nonnegative(),
});

export const PollenLevel = z.enum(['none', 'low', 'moderate', 'high', 'very_high']);

export const WeatherAlert = z.object({
  id: Id,
  event: z.string(),
  severity: z.enum(['minor', 'moderate', 'severe', 'extreme', 'unknown']),
  headline: z.string(),
  description: z.string(),
  starts: IsoDateTime,
  ends: IsoDateTime.nullable(),
});

export const WeatherSnapshot = z.object({
  updatedAt: IsoDateTime,
  locationName: z.string(),
  units: Units,
  current: WeatherCurrent,
  /** Next 24 hours, starting with the next whole hour. */
  hourly: z.array(WeatherHour),
  /** Today plus six days. */
  daily: z.array(WeatherDay),
  sunrise: IsoDateTime,
  sunset: IsoDateTime,
  uv: z.object({ index: z.number().nonnegative(), category: z.string() }),
  airQuality: z.object({ aqi: z.number().nonnegative(), category: z.string() }).nullable(),
  pollen: z.object({ tree: PollenLevel, grass: PollenLevel, weed: PollenLevel }).nullable(),
  alerts: z.array(WeatherAlert),
});
export type WeatherSnapshot = z.infer<typeof WeatherSnapshot>;

export const LeaveBy = z.object({
  destinationId: Id,
  name: z.string(),
  leaveBy: IsoDateTime,
  arriveBy: IsoDateTime,
  durationMinutes: z.number().nonnegative(),
  /** Extra minutes over the free-flow time. */
  delayMinutes: z.number(),
  /** False when the time came from a router without live traffic (OSRM, OpenRouteService). */
  traffic: z.boolean().optional(),
  personIds: z.array(Id),
  /** The calendar event this trip is for, if it was matched to one. */
  eventId: Id.optional(),
});
export type LeaveBy = z.infer<typeof LeaveBy>;

/* ---------- photos ---------- */

export const Photo = z.object({
  id: Id,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Dominant colour, used for the backdrop while the image loads and for the clock tint. */
  dominant: Color,
});
export type Photo = z.infer<typeof Photo>;

/* ---------- Home Assistant ---------- */

export const HomeArea = z.object({
  id: Id,
  name: z.string(),
  entityIds: z.array(Id),
});
export type HomeArea = z.infer<typeof HomeArea>;

export const HomeEntityKind = z.enum([
  'light',
  'switch',
  'climate',
  'lock',
  'cover',
  'sensor',
  'camera',
  'scene',
]);
export type HomeEntityKind = z.infer<typeof HomeEntityKind>;

/**
 * An allowed Home Assistant entity. `id` is the HA entity id (`light.kitchen_counter`).
 * `state` is the raw HA state string (`on`, `off`, `locked`, `heat`, `21.5`...).
 * `attrs` carries the HA attributes the display uses (brightness 0-255, current_temperature,
 * temperature, unit_of_measurement, device_class...).
 */
export const HomeEntity = z.object({
  id: Id,
  kind: HomeEntityKind,
  name: z.string(),
  state: z.string(),
  attrs: z.record(z.string(), z.unknown()),
  lastChanged: IsoDateTime.optional(),
});
export type HomeEntity = z.infer<typeof HomeEntity>;

export const Presence = z.object({
  personId: Id,
  home: z.boolean(),
  since: IsoDateTime.optional(),
});
export type Presence = z.infer<typeof Presence>;

export const MediaPlayer = z.object({
  id: Id,
  name: z.string(),
  state: z.enum(['playing', 'paused', 'idle', 'standby', 'off', 'unavailable']),
  app: z.string().optional(),
  title: z.string().optional(),
  artist: z.string().optional(),
  artworkUrl: z.string().optional(),
  positionSeconds: z.number().nonnegative().optional(),
  durationSeconds: z.number().nonnegative().optional(),
  updatedAt: IsoDateTime.optional(),
});
export type MediaPlayer = z.infer<typeof MediaPlayer>;

export const MediaAction = z.enum([
  'play',
  'pause',
  'play_pause',
  'next',
  'previous',
  'volume_up',
  'volume_down',
  'turn_on',
  'turn_off',
]);
export type MediaAction = z.infer<typeof MediaAction>;

/* ---------- lists & chores ---------- */

export const ListItem = z.object({
  id: Id,
  text: z.string(),
  done: z.boolean(),
  personId: Id.optional(),
});
export type ListItem = z.infer<typeof ListItem>;

export const List = z.object({
  id: Id,
  name: z.string(),
  source: z.enum(['reminders', 'local']),
  items: z.array(ListItem),
  /** The list the Today screen shows. When none is chosen, Today picks the grocery list. */
  home: z.boolean().optional(),
});
export type List = z.infer<typeof List>;

export const ChoreCadence = z.enum(['daily', 'weekly']);
export type ChoreCadence = z.infer<typeof ChoreCadence>;

export const Chore = z.object({
  id: Id,
  title: z.string(),
  personId: Id,
  cadence: ChoreCadence,
  stars: z.number().int().nonnegative(),
  /** Completions in the current period (today for daily, this week for weekly). */
  doneCount: z.number().int().nonnegative(),
  /** Completions needed per period. */
  target: z.number().int().positive(),
  /** Completions on each day of the current week, Monday first (7 entries). Drives the chart. */
  week: z.array(z.number().int().nonnegative()).length(7).optional(),
});
export type Chore = z.infer<typeof Chore>;

/** Stars earned this week (the tally resets every Monday). */
export const StarTally = z.object({
  personId: Id,
  stars: z.number().int().nonnegative(),
});
export type StarTally = z.infer<typeof StarTally>;

/* ---------- settings ---------- */

export const ThemeMode = z.enum(['daylight', 'dusk', 'auto']);
export type ThemeMode = z.infer<typeof ThemeMode>;

export const BrightnessStep = z.object({
  at: ClockTime,
  level: z.number().min(0).max(100),
});

export const ScreenSchedule = z.object({
  /** Seconds without a touch before Ambient mode starts. */
  idleSeconds: z.number().int().positive(),
  /** From this time, the display goes straight to Ambient when idle (and stays there). */
  ambientFrom: ClockTime,
  /** Screen off (black) from this time... */
  offFrom: ClockTime,
  /** ...until this time. */
  onAt: ClockTime,
  /** Brightness steps through the day; the most recent step at or before now applies. */
  brightness: z.array(BrightnessStep),
  /** Every display reloads itself at this time each night to pick up new builds. Default 04:00. */
  reloadAt: ClockTime.optional(),
});
export type ScreenSchedule = z.infer<typeof ScreenSchedule>;

export const Destination = z.object({
  id: Id,
  name: z.string(),
  address: z.string(),
  personIds: z.array(Id),
  /** Time to arrive on the given weekdays (0 = Sunday). */
  arriveBy: ClockTime,
  days: z.array(z.number().int().min(0).max(6)),
});
export type Destination = z.infer<typeof Destination>;

export const FeatureFlags = z.object({
  commute: z.boolean(),
  chores: z.boolean(),
  meals: z.boolean(),
  countdowns: z.boolean(),
  media: z.boolean(),
  doorbellPopover: z.boolean(),
  alexaAnnouncements: z.boolean(),
  remindersSync: z.boolean(),
});
export type FeatureFlags = z.infer<typeof FeatureFlags>;

export const Location = z.object({
  name: z.string(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  /** What the user typed: "47.6062, -122.3321", an address or a city. The server geocodes it into the fields above. */
  query: z.string().default(''),
});
export type Location = z.infer<typeof Location>;

/* ---- v2: appearance, layout, screens, weather, integrations (workstream A owns the schema) ---- */

// `Appearance` and `TextSize` live in skins.ts (workstream E) and are re-exported from the index.

/** Layout presets (workstream F renders them; import these rather than redefining). */
export const TodayPreset = z.enum(['agenda', 'weather', 'family', 'photo', 'poster']);
export type TodayPreset = z.infer<typeof TodayPreset>;
export const MonthPreset = z.enum(['grid', 'week']);
export type MonthPreset = z.infer<typeof MonthPreset>;
/** `fit`: letterbox the panel. `fill`: stretch the grid to the viewport. `scale`: fixed factor. */
export const Fit = z.enum(['fit', 'fill', 'scale']);
export type Fit = z.infer<typeof Fit>;
/** Rows under today's agenda on the Agenda and Photo layouts, top to bottom. */
export const TodayRow = z.enum(['tonight', 'week', 'countdowns', 'list', 'photo']);
export type TodayRow = z.infer<typeof TodayRow>;
export const DEFAULT_TODAY_ROWS: TodayRow[] = ['tonight', 'week'];
/** How tightly the Month grid packs a day: `roomy` (bigger type), `compact`, or `dense` (most events). */
export const MonthDensity = z.enum(['roomy', 'compact', 'dense']);
export type MonthDensity = z.infer<typeof MonthDensity>;

export const Layout = z.object({
  todayPreset: TodayPreset.default('agenda'),
  monthPreset: MonthPreset.default('grid'),
  monthDensity: MonthDensity.default('roomy'),
  todayRows: z.array(TodayRow).max(5).default(['tonight', 'week']),
  fit: Fit.default('fit'),
  /** Used when `fit` is `scale`: 0.9 to 1.3. */
  scale: z.number().min(0.5).max(2).default(1),
});
export type Layout = z.infer<typeof Layout>;

/** A screen in the dock: on or off, renamed, reordered. Ids match the display's screen registry (`today`, `month`, `lists`, `home`...). */
export const ScreenConfig = z.object({
  id: Id,
  enabled: z.boolean().default(true),
  label: z.string().max(24).optional(),
  order: z.number().int().nonnegative(),
});
export type ScreenConfig = z.infer<typeof ScreenConfig>;

export const DEFAULT_SCREENS: ScreenConfig[] = [
  { id: 'today', enabled: true, order: 0 },
  { id: 'month', enabled: true, order: 1 },
  { id: 'lists', enabled: true, order: 2 },
  { id: 'home', enabled: true, order: 3 },
];

export const SavedPlace = z.object({
  name: z.string().min(1).max(60),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type SavedPlace = z.infer<typeof SavedPlace>;

export const WeatherPersonality = z.enum(['off', 'friendly', 'snarky']);
export type WeatherPersonality = z.infer<typeof WeatherPersonality>;

export const WeatherSettings = z.object({
  /** Other places to look up from the weather sheet. */
  savedPlaces: z.array(SavedPlace).default([]),
  /** Quips: off, or the tone of voice. Friendly unless chosen otherwise. */
  personality: WeatherPersonality.default('friendly'),
  /** With a Claude key, the afternoon quip is a joke riffing on one of the day's headlines. */
  newsJokes: z.boolean().default(false),
});
export type WeatherSettings = z.infer<typeof WeatherSettings>;

/**
 * On/off per integration id (see `IntegrationId` in integrations.ts). A missing id means
 * enabled. Credentials never live here: they are in the server's encrypted store, edited
 * through `PUT /api/integrations/:id`.
 */
export const IntegrationToggles = z.record(z.string(), z.object({ enabled: z.boolean() }));
export type IntegrationToggles = z.infer<typeof IntegrationToggles>;

export const Settings = z.object({
  timezone: z.string(),
  location: Location,
  units: Units,
  theme: ThemeMode,
  schedule: ScreenSchedule,
  people: z.array(Person),
  destinations: z.array(Destination),
  flags: FeatureFlags,
  // v2 additions, each with a default so settings saved before them still parse.
  appearance: Appearance.default(DEFAULT_APPEARANCE),
  layout: Layout.default({
    todayPreset: 'agenda',
    monthPreset: 'grid',
    monthDensity: 'roomy',
    todayRows: ['tonight', 'week'],
    fit: 'fit',
    scale: 1,
  }),
  screens: z.array(ScreenConfig).default(() => structuredClone(DEFAULT_SCREENS)),
  /** The screen shown after a wake and after the display reloads. */
  defaultScreen: Id.default('today'),
  weather: WeatherSettings.default({ savedPlaces: [], personality: 'friendly', newsJokes: false }),
  integrations: IntegrationToggles.default({}),
});
export type Settings = z.infer<typeof Settings>;

/* ---------- displays (WS6) ---------- */

/** A paired display. Revoking one signs it out at once; it must pair again with a new code. */
export const Device = z.object({
  id: Id,
  name: z.string(),
  createdAt: IsoDateTime,
  lastSeenAt: IsoDateTime.nullable(),
  revokedAt: IsoDateTime.nullable(),
  /** True for the device making the request. */
  current: z.boolean(),
  /** Per-display overrides of the household settings; absent means "use the settings". */
  look: ThemeMode.optional(),
  defaultScreen: Id.optional(),
  fit: Fit.optional(),
  scale: z.number().min(0.5).max(2).optional(),
});
export type Device = z.infer<typeof Device>;

/** Rename a display or change its overrides; `null` clears an override. */
export const DeviceOverrides = z.object({
  look: ThemeMode.nullable(),
  defaultScreen: Id.nullable(),
  fit: Fit.nullable(),
  scale: z.number().min(0.5).max(2).nullable(),
});
export type DeviceOverrides = z.infer<typeof DeviceOverrides>;

/**
 * What the screen should be doing right now according to the schedule. Kiosk helpers
 * (the Surface brightness task, Home Assistant automations) poll this instead of
 * re-implementing the schedule.
 */
export const DisplayState = z.object({
  at: IsoDateTime,
  /** `off` between `offFrom` and `onAt`. */
  screen: z.enum(['on', 'off']),
  /** True between `ambientFrom` and `offFrom`: go to Ambient when idle and stay there. */
  ambient: z.boolean(),
  /** 0 to 100 from the brightness steps; 0 while the screen is off. */
  brightness: z.number().min(0).max(100),
});
export type DisplayState = z.infer<typeof DisplayState>;

export const PanelSize = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type PanelSize = z.infer<typeof PanelSize>;
