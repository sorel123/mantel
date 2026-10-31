/**
 * Integrations: every credential and setting an outside service needs lives on the server
 * (SQLite, secrets encrypted at rest) and is edited over these routes. Environment variables
 * are optional fallbacks; the status says where each value came from.
 *
 * The route table (see `api.ts`):
 *   GET  /api/plugins                        manifests of every plugin (render cards and forms from them)
 *   GET  /api/integrations                   status of every integration
 *   PUT  /api/integrations/:id               enable/disable, save config and secrets; hot-reloads
 *   POST /api/integrations/:id/test          try the saved (or posted) values; one sentence back
 *   GET  /api/integrations/:id/authorize-url OAuth plugins: where to send the browser
 *   POST /api/integrations/:id/callback      OAuth plugins: paste-back of the redirect address
 *   GET  /api/health/details                 version, uptime, per-integration health, log tail
 *   POST /api/admin/pin                      set or change the admin PIN
 *   GET  /api/setup/state                    first run? which wizard steps are done?
 *   PUT  /api/setup/state                    record wizard progress
 *   POST /api/settings/export                everything as one JSON bundle (secrets need a passphrase)
 *   POST /api/settings/import                restore a bundle
 *   POST /api/geocode                        "47.6, -122.3", an address or a city → candidates
 */
import { z } from 'zod';
import { IsoDateTime, Settings } from './models.js';

/** One id per integration. Adding a plugin adds a value here and a folder under `apps/server/src/plugins/`. */
export const IntegrationId = z.enum([
  'google',
  'icloud',
  'homeassistant',
  'photos',
  'routes',
  'pollen',
  'weather',
  'quips',
]);
export type IntegrationId = z.infer<typeof IntegrationId>;

export const IntegrationState = z.enum(['not_set_up', 'connected', 'error', 'disabled']);
export type IntegrationState = z.infer<typeof IntegrationState>;

/** Non-secret config values. Secrets never travel in a status; only their key names do. */
export const ConfigValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type ConfigValue = z.infer<typeof ConfigValue>;
export const IntegrationConfig = z.record(z.string(), ConfigValue);
export type IntegrationConfig = z.infer<typeof IntegrationConfig>;

/** Where a value came from: saved in Settings, or read from an environment variable. */
export const ValueSource = z.enum(['store', 'env']);
export type ValueSource = z.infer<typeof ValueSource>;

export const IntegrationStatus = z.object({
  id: IntegrationId,
  enabled: z.boolean(),
  state: IntegrationState,
  /** One line for the card: "Connected as jay@gmail.com", "Needs a token", "Open-Meteo, no key needed". */
  summary: z.string(),
  lastOkAt: IsoDateTime.nullable(),
  /** Written for a person, not a stack trace. */
  lastError: z.string().nullable(),
  /** Current non-secret values, by field key. */
  config: IntegrationConfig,
  /** Keys of the secret fields that have a value (the values stay on the server). */
  hasSecrets: z.array(z.string()),
  /** Source of each field that has a value. */
  sources: z.record(z.string(), ValueSource).default({}),
});
export type IntegrationStatus = z.infer<typeof IntegrationStatus>;

/** Partial update. A `null` secret clears it; omitted keys are left alone. */
export const IntegrationPatch = z.object({
  enabled: z.boolean().optional(),
  config: IntegrationConfig.optional(),
  secrets: z.record(z.string(), z.string().nullable()).optional(),
});
export type IntegrationPatch = z.infer<typeof IntegrationPatch>;

export const IntegrationsResponse = z.object({ integrations: z.array(IntegrationStatus) });
export const IntegrationResponse = z.object({ integration: IntegrationStatus });

/** `POST /integrations/:id/test`: with a body, test those values before saving; without, test what is saved. */
export const TestRequest = IntegrationPatch.optional();
export const TestResult = z.object({ ok: z.boolean(), message: z.string() });
export type TestResult = z.infer<typeof TestResult>;

/** OAuth plugins (Google now, Microsoft later): where to send the browser, and how it comes back. */
export const AuthorizeUrlResponse = z.object({
  url: z.string(),
  redirectUri: z.string(),
  /** True when the redirect lands on localhost and the user pastes the address back. */
  pasteBack: z.boolean(),
});
/** The whole address from the browser bar after the provider redirected (or just its `code`). */
export const OAuthCallbackRequest = z.object({ url: z.string().min(1) });

/* ---------- health ---------- */

export const LogLine = z.object({
  at: IsoDateTime,
  level: z.enum(['debug', 'info', 'warn', 'error']),
  message: z.string(),
});
export type LogLine = z.infer<typeof LogLine>;

export const HealthDetails = z.object({
  version: z.string(),
  mock: z.boolean(),
  uptimeSeconds: z.number().nonnegative(),
  firstRun: z.boolean(),
  pinSet: z.boolean(),
  /** How the server reaches the outside world, for "Get it here" redirect URIs and the wall QR code. */
  publicUrl: z.string(),
  integrations: z.array(IntegrationStatus),
  /** The last 50 log lines, oldest first. */
  logTail: z.array(LogLine),
  lastSync: z.record(z.string(), IsoDateTime.nullable()),
});
export type HealthDetails = z.infer<typeof HealthDetails>;

/* ---------- admin PIN and first run ---------- */

export const AdminPin = z.string().regex(/^\d{4,8}$/, '4 to 8 digits');

/** Set the PIN on first run (no current PIN), or change it by giving the current one. */
export const AdminPinRequest = z.object({
  pin: AdminPin,
  currentPin: AdminPin.optional(),
});
export const AdminPinResponse = z.object({ ok: z.literal(true), pinSet: z.literal(true) });

export const SetupStepState = z.enum(['todo', 'done', 'skipped']);
export type SetupStepState = z.infer<typeof SetupStepState>;

/** Wizard steps, in order. Plugins name the step that offers them in their manifest. */
export const SetupStep = z.enum([
  'welcome',
  'home',
  'people',
  'calendars',
  'homeassistant',
  'extras',
  'wall',
]);
export type SetupStep = z.infer<typeof SetupStep>;
export const SETUP_STEPS = SetupStep.options;

export const SetupState = z.object({
  /** No admin PIN and no paired device yet: the first browser may set the PIN. */
  firstRun: z.boolean(),
  pinSet: z.boolean(),
  /** True once the wizard has been finished or dismissed; the display stops offering it. */
  completed: z.boolean(),
  steps: z.record(z.string(), SetupStepState),
});
export type SetupState = z.infer<typeof SetupState>;

export const PutSetupStateRequest = z.object({
  steps: z.record(z.string(), SetupStepState).optional(),
  completed: z.boolean().optional(),
});

/* ---------- export and import ---------- */

/** Secrets travel only encrypted with a passphrase the user typed (scrypt key, AES-256-GCM). */
export const EncryptedBlob = z.object({
  cipher: z.literal('aes-256-gcm'),
  kdf: z.literal('scrypt'),
  salt: z.string(),
  iv: z.string(),
  tag: z.string(),
  data: z.string(),
});

export const SettingsBundle = z.object({
  format: z.literal('mantel-settings'),
  version: z.literal(1),
  exportedAt: IsoDateTime,
  appVersion: z.string(),
  settings: Settings,
  /** Non-secret integration config by id. */
  integrations: z.record(z.string(), z.object({ enabled: z.boolean(), config: IntegrationConfig })),
  /** Present when a passphrase was given. Decrypts to `Record<integrationId, Record<key, value>>`. */
  secrets: EncryptedBlob.optional(),
});
export type SettingsBundle = z.infer<typeof SettingsBundle>;

/** Without a passphrase the bundle carries no secrets. */
export const ExportRequest = z.object({ passphrase: z.string().min(1).optional() }).optional();
export const ImportRequest = z.object({
  bundle: SettingsBundle,
  passphrase: z.string().min(1).optional(),
});
export const ImportResponse = z.object({
  ok: z.literal(true),
  /** Integrations whose secrets were restored. */
  secretsRestored: z.array(z.string()),
});

/* ---------- geocoding ---------- */

export const GeocodeRequest = z.object({ query: z.string().trim().min(1).max(200) });
export const GeocodeCandidate = z.object({
  /** "Seattle, Washington, United States" or the coordinates when the query was a pair. */
  name: z.string(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  timezone: z.string(),
  country: z.string().optional(),
  admin: z.string().optional(),
});
export type GeocodeCandidate = z.infer<typeof GeocodeCandidate>;
export const GeocodeResponse = z.object({ candidates: z.array(GeocodeCandidate) });
