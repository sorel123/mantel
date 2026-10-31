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

export const CalendarSource = z.enum(['google', 'icloud']);
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
});
export type List = z.infer<typeof List>;

export const Chore = z.object({
  id: Id,
  title: z.string(),
  personId: Id,
  cadence: z.enum(['daily', 'weekly']),
  stars: z.number().int().nonnegative(),
  /** Completions in the current period (today for daily, this week for weekly). */
  doneCount: z.number().int().nonnegative(),
  /** Completions needed per period. */
  target: z.number().int().positive(),
});
export type Chore = z.infer<typeof Chore>;

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
});
export type Location = z.infer<typeof Location>;

export const Settings = z.object({
  timezone: z.string(),
  location: Location,
  units: Units,
  theme: ThemeMode,
  schedule: ScreenSchedule,
  people: z.array(Person),
  destinations: z.array(Destination),
  flags: FeatureFlags,
});
export type Settings = z.infer<typeof Settings>;

export const PanelSize = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type PanelSize = z.infer<typeof PanelSize>;
