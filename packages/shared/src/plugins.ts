/**
 * The plugin framework. Every integration is a plugin: a folder `apps/server/src/plugins/<id>/`
 * exporting a `Plugin` whose manifest declares what it needs from the user. Settings renders
 * the Integrations card and the setup form from the manifest, the wizard offers the plugin in
 * the step it names, Health reads its status, and the display mounts what it contributes.
 * Adding an integration never touches Settings or wizard code. See `docs/plugins.md`.
 */
import { z } from 'zod';
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

/** What the plugin adds to the display, by registered name. The display mounts whatever is listed. */
export const PluginContributes = z.object({
  /** A screen id the dock can show (`home`). */
  screen: z.string().optional(),
  /** A card on Today (`weather`, `leave-by`). */
  todayCard: z.string().optional(),
  /** An Ambient slot name. */
  ambientSlot: z.string().optional(),
  /** A chip in the dock. */
  dockChip: z.string().optional(),
  /** WebSocket event types it emits. */
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
