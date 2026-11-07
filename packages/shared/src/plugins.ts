/**
 * The plugin framework. Every integration is a plugin: a folder `apps/server/src/plugins/<id>/`
 * exporting a `Plugin` whose manifest declares what it needs from the user. Settings renders
 * the Integrations card and the setup form from the manifest, the wizard offers the plugin in
 * the step it names, Health reads its status, and the display mounts what it contributes.
 * Adding an integration never touches Settings or wizard code. See `docs/plugins.md`.
 */
import { z } from 'zod';
import { IsoDateTime } from './models.js';
import {
  ConfigValue,
  IntegrationId,
  SetupStep,
  type IntegrationConfig,
  type IntegrationStatus,
  type TestResult,
} from './integrations.js';

export const PluginCategory = z.enum([
  'calendar',
  'home',
  'media',
  'photos',
  'tasks',
  'weather',
  'info',
]);
export type PluginCategory = z.infer<typeof PluginCategory>;

export const SetupFieldType = z.enum([
  'text',
  'secret',
  'url',
  /** A box that also accepts a downloaded JSON file dropped on it (Google's client JSON). */
  'file-json',
  'select',
  'toggle',
  'number',
]);
export type SetupFieldType = z.infer<typeof SetupFieldType>;

/** A link to the exact page where the user gets the value. */
export const GetItHere = z.object({ label: z.string(), url: z.string() });

/**
 * One field of a plugin's setup form. The display renders every field the same way from this:
 * label, help, Get-it-here link, one box that accepts what the site hands you, Copy on
 * read-only values, and the validation message written for a person.
 */
export const SetupField = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
  label: z.string(),
  type: SetupFieldType,
  /** One sentence under the field. */
  help: z.string().optional(),
  placeholder: z.string().optional(),
  required: z.boolean().default(false),
  getItHere: GetItHere.optional(),
  /** `select` options. */
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  /** Regex source the value must match, with the message shown when it does not. */
  pattern: z.object({ regex: z.string(), message: z.string() }).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  default: ConfigValue.optional(),
  /** Shown only when another field has this value (or any value when `equals` is omitted). */
  dependsOn: z.object({ key: z.string(), equals: ConfigValue.optional() }).optional(),
  /** Collapsed under "Advanced". */
  advanced: z.boolean().default(false),
  /** Shown with a Copy button; the server fills it (a redirect URI, a webhook address). */
  readOnly: z.boolean().default(false),
  /** Name of the environment variable that is read when nothing is saved. */
  env: z.string().optional(),
});
export type SetupField = z.infer<typeof SetupField>;

/* ---------- what a plugin shows: one small block format the display renders for any plugin ---------- */

/** `normal`, `warn` (needs attention: bins out now, a timer rang) or `good` (done). */
export const PluginTone = z.enum(['normal', 'warn', 'good']);
export type PluginTone = z.infer<typeof PluginTone>;

/**
 * An icon from the display's bundled set: `trash`, `recycle`, `leaf`, `timer`, `bell`, `check`,
 * `alert`, `calendar`, `star`, `info`, `clock`, `box`. Unknown names draw `info`.
 */
export const PluginIcon = z.string().regex(/^[a-z][a-z0-9-]*$/);

/** A button. Pressing it posts `args` to the plugin's action route `name`. */
export const PluginAction = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/),
  label: z.string(),
  args: z.record(z.string(), ConfigValue).default({}),
  tone: z.enum(['normal', 'primary', 'warn']).default('normal'),
});
export type PluginAction = z.infer<typeof PluginAction>;
export type PluginActionInput = z.input<typeof PluginAction>;

/** One row: an icon, a line of text, a smaller line under it, and buttons at the end. */
export const PluginLine = z.object({
  /** Stable key for the row (a timer id); defaults to its position. */
  id: z.string().optional(),
  icon: PluginIcon.optional(),
  text: z.string(),
  sub: z.string().optional(),
  tone: PluginTone.default('normal'),
  /** The display counts down to this time itself (mm:ss, or h:mm:ss) in place of `sub`. */
  countdownTo: IsoDateTime.optional(),
  actions: z.array(PluginAction).default([]),
});
export type PluginLine = z.infer<typeof PluginLine>;

/** A number picker (the timers' custom dial). Pressing Start posts `{ value }` (in `unit`) to `action`. */
export const PluginDial = z.object({
  action: z.string().regex(/^[a-z][a-z0-9-]*$/),
  label: z.string(),
  submit: z.string().default('Start'),
  unit: z.enum(['s', 'min', 'h']),
  min: z.number(),
  max: z.number(),
  step: z.number().positive(),
  value: z.number(),
});
export type PluginDial = z.infer<typeof PluginDial>;

/**
 * What a card, an Ambient line or a sheet shows. The display draws every plugin's blocks with one
 * component, so a plugin never ships screen code.
 */
export const PluginBlocks = z.object({
  title: z.string(),
  icon: PluginIcon.optional(),
  lines: z.array(PluginLine).default([]),
  /** Shown when there are no lines. */
  empty: z.string().optional(),
  footer: z.string().optional(),
  /** 0 to 1, drawn as a bar under the title. */
  progress: z.number().min(0).max(1).optional(),
  /** Buttons under the lines (the timers' presets). */
  actions: z.array(PluginAction).default([]),
  dial: PluginDial.optional(),
});
export type PluginBlocks = z.infer<typeof PluginBlocks>;
export type PluginBlocksInput = z.input<typeof PluginBlocks>;

/** A chip in the dock beside the clock. */
export const PluginChip = z.object({
  text: z.string(),
  icon: PluginIcon.optional(),
  tone: PluginTone.default('normal'),
  /** Counts down to this time in place of `text`. */
  countdownTo: IsoDateTime.optional(),
  /** Read out by screen readers; defaults to the text. */
  label: z.string().optional(),
});
export type PluginChip = z.infer<typeof PluginChip>;
export type PluginChipInput = z.input<typeof PluginChip>;

export const PluginBlocksResponse = z.object({ blocks: PluginBlocks.nullable() });
export const PluginChipResponse = z.object({ chip: PluginChip.nullable() });
export const PluginActionRequest = z.object({
  args: z.record(z.string(), ConfigValue).default({}),
});
export const PluginActionResponse = z.object({
  ok: z.boolean(),
  /** One sentence for a toast. */
  message: z.string().optional(),
});
export type PluginActionResponse = z.infer<typeof PluginActionResponse>;

/** Something a person should notice now (a timer rang): a banner on every display, and a chime if asked. */
export const PluginAlertPayload = z.object({
  /** The plugin's id. */
  id: z.string(),
  /** Stable per alert so a display shows it once; a later alert with the same key replaces it. */
  key: z.string(),
  title: z.string(),
  text: z.string().optional(),
  icon: PluginIcon.optional(),
  chime: z.boolean().default(false),
  /** Buttons on the banner, posted to the plugin's action routes; with none, the banner has Dismiss. */
  actions: z.array(PluginAction).default([]),
});
export type PluginAlertPayload = z.infer<typeof PluginAlertPayload>;

/* ---------- what the plugin adds to the display ---------- */

/**
 * A card for the custom Today layout. Its kind is `plugin:<plugin id>`; the editor lists it under
 * "From plugins". `data` names what the display fetches: `GET /api/plugins/:id/blocks/<data>`.
 */
export const PluginTodayCard = z.object({
  name: z.string(),
  description: z.string(),
  /** Smallest readable size, [w, h] in cells (the grid is 12 by 8, in half steps). */
  min: z.tuple([z.number().min(1), z.number().min(1)]),
  /** The size the card is drawn for; smaller cards shrink their content a little. */
  comfort: z.tuple([z.number(), z.number()]).optional(),
  data: z.string().default('card'),
});
export type PluginTodayCard = z.infer<typeof PluginTodayCard>;

/** A line on Ambient beside the clock, from `GET /api/plugins/:id/blocks/<data>` (null hides it). */
export const PluginAmbientSlot = z.object({
  id: z.string(),
  /** Weather is 0 and the next event 1; lower is higher up. */
  order: z.number().default(5),
  data: z.string().default('ambient'),
});
export type PluginAmbientSlot = z.infer<typeof PluginAmbientSlot>;

/**
 * A chip in the dock, from `GET /api/plugins/:id/chip/<data>` (null hides it). With `sheet`,
 * tapping it opens a sheet drawn from `GET /api/plugins/:id/blocks/<sheet>`.
 */
export const PluginDockChip = z.object({
  id: z.string(),
  data: z.string().default('chip'),
  sheet: z.string().optional(),
  /** Shown when the chip has nothing to say (null) but should still open the sheet. */
  idle: PluginChip.optional(),
});
export type PluginDockChip = z.infer<typeof PluginDockChip>;

/** What the plugin adds to the display. The display mounts whatever is listed. */
export const PluginContributes = z.object({
  /** A screen id the dock can show (`home`). */
  screen: z.string().optional(),
  /**
   * A plain name (`weather`, `leave-by`) is a built-in card the display already draws; an object
   * is a plugin card the display draws from the plugin's blocks. The same for the two below.
   */
  todayCard: z.union([z.string(), PluginTodayCard]).optional(),
  ambientSlot: z.union([z.string(), PluginAmbientSlot]).optional(),
  dockChip: z.union([z.string(), PluginDockChip]).optional(),
  /** WebSocket event types it emits. Any plugin may emit `plugin.changed` and `plugin.alert`. */
  events: z.array(z.string()).default([]),
});
export type PluginContributes = z.infer<typeof PluginContributes>;

export const PluginManifest = z.object({
  id: IntegrationId,
  name: z.string(),
  /** One line for the card. */
  description: z.string(),
  category: PluginCategory,
  /** The wizard step that offers this plugin; null for ones with nothing to set up. */
  step: SetupStep.nullable(),
  /** `fields`: save values and Test. `oauth`: fields for the client, then Connect through the authorize-url and callback routes. `none`: nothing to configure. */
  connect: z.enum(['fields', 'oauth', 'none']).default('fields'),
  fields: z.array(SetupField),
  /** Numbered directions shown in the side panel, in order. Markdown links allowed. */
  directions: z.array(z.string()).default([]),
  /** In-repo guide, as a path under `docs/`. */
  docs: z.string().optional(),
  /** False for plugins the household needs regardless (weather). */
  optional: z.boolean().default(true),
  contributes: PluginContributes.default({ events: [] }),
});
export type PluginManifest = z.infer<typeof PluginManifest>;

export const PluginsResponse = z.object({ plugins: z.array(PluginManifest) });

/**
 * The runtime side of a plugin, implemented on the server. `Ctx` is the server's provider
 * context. `apply` is called with the merged values (store over env) whenever they change,
 * so a plugin hot-reloads without a restart; `status` must be cheap and synchronous.
 */
export interface PluginRuntime<Ctx = unknown> {
  manifest: PluginManifest;
  start(ctx: Ctx): void | Promise<void>;
  stop(): void | Promise<void>;
  apply(config: IntegrationConfig, secrets: Record<string, string>): void | Promise<void>;
  test(config: IntegrationConfig, secrets: Record<string, string>): Promise<TestResult>;
  status(): Omit<IntegrationStatus, 'id' | 'enabled' | 'config' | 'hasSecrets' | 'sources'>;
}
