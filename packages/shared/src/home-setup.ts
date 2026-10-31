/**
 * Home Assistant setup without YAML (workstream C): the allow-list config the server stores
 * (the same shape `config/home.yaml` has), what the server discovers in Home Assistant so the
 * settings page can offer rooms and devices to tick, and the connection card's state.
 */
import { z } from 'zod';
import { Id, type HomeEntityKind } from './models.js';

export const HaEntityId = z
  .string()
  .regex(/^[a-z_]+\.[a-z0-9_]+$/, 'expected an entity id like light.kitchen');

/** An entity in the allow-list: just the id, or the id with overrides. */
export const HomeEntityRef = z.union([
  HaEntityId.transform((id) => ({ id })),
  z.object({
    id: HaEntityId,
    /** Name on the display; defaults to the HA friendly name minus the area name. */
    name: z.string().min(1).optional(),
    /** Shown but never controlled from the wall. */
    read_only: z.boolean().optional(),
  }),
]);
export type HomeEntityRef = { id: string; name?: string; read_only?: boolean };

/** Domains pulled in through `ha_area`. Sensors are left out unless listed, there are too many. */
export const DEFAULT_AREA_DOMAINS = [
  'light',
  'switch',
  'fan',
  'input_boolean',
  'climate',
  'lock',
  'cover',
  'camera',
];

export const HomeAreaConfig = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Also include every entity Home Assistant has in this area (by area id or name). */
  ha_area: z.string().min(1).optional(),
  domains: z.array(z.string()).default(DEFAULT_AREA_DOMAINS),
  entities: z.array(HomeEntityRef).default([]),
  /** Entities to drop from the `ha_area` expansion. */
  exclude: z.array(HaEntityId).default([]),
});
export type HomeAreaConfig = z.infer<typeof HomeAreaConfig>;

export const DoorbellConfig = z.object({
  /** The camera whose live view pops over the display. */
  camera: HaEntityId,
  /**
   * What fires the pop-over: a Ring `event.*_ding` entity, a `binary_sensor` that turns on, or
   * any entity whose state changes.
   */
  trigger: HaEntityId,
  /** For `event.*` triggers, only these event types count (default: any). */
  event_types: z.array(z.string()).optional(),
  seconds: z.number().int().positive().max(300).default(30),
});
export type DoorbellConfig = z.infer<typeof DoorbellConfig>;

/** What the display may see and control. Stored in SQLite; `home.yaml` is its import/export form. */
export const HomeConfig = z.object({
  areas: z.array(HomeAreaConfig).default([]),
  /** Scene chips across the top of the Home screen, in order. `script.*` works too. */
  scenes: z.array(HomeEntityRef).default([]),
  doorbells: z.array(DoorbellConfig).default([]),
  /**
   * Mantel person id to HA `person.*` entity. When omitted, each person in settings is matched
   * to `person.<id>`.
   */
  presence: z.array(z.object({ person: z.string().min(1), entity: HaEntityId })).optional(),
  /** Wake the screen when someone gets home; sleep it when the last person leaves. */
  presence_display: z
    .object({
      wake_on_arrival: z.boolean().default(true),
      sleep_when_away: z.boolean().default(true),
    })
    .default({ wake_on_arrival: true, sleep_when_away: true }),
  /** Now-playing players. When omitted, every entity from the Apple TV integration. */
  media_players: z.array(HomeEntityRef).optional(),
  /** Alexa announcements through the Alexa Media Player custom integration. */
  alexa: z
    .object({
      service: z
        .string()
        .regex(/^notify\.[a-z0-9_]+$/)
        .default('notify.alexa_media'),
      targets: z.array(z.object({ id: HaEntityId, name: z.string().min(1) })).min(1),
    })
    .optional(),
});
export type HomeConfig = z.infer<typeof HomeConfig>;
export type HomeConfigInput = z.input<typeof HomeConfig>;

/** HA domain to the display's entity kind. Domains not listed here never reach the Home screen. */
export const HOME_DOMAIN_KIND: Record<string, HomeEntityKind> = {
  light: 'light',
  switch: 'switch',
  fan: 'switch',
  input_boolean: 'switch',
  climate: 'climate',
  lock: 'lock',
  cover: 'cover',
  sensor: 'sensor',
  binary_sensor: 'sensor',
  camera: 'camera',
  scene: 'scene',
  script: 'scene',
};

/* ---------- discovery: what Home Assistant has ---------- */

export const DiscoveredArea = z.object({ id: Id, name: z.string() });
export type DiscoveredArea = z.infer<typeof DiscoveredArea>;

export const DiscoveredEntity = z.object({
  id: HaEntityId,
  /** `light`, `sensor`, `event`, `person`, `media_player`... anything HA has. */
  domain: z.string(),
  /** What it would be on the Home screen; missing for domains the display cannot show. */
  kind: z
    .enum(['light', 'switch', 'climate', 'lock', 'cover', 'sensor', 'camera', 'scene'])
    .optional(),
  name: z.string(),
  /** HA area, through the entity or its device; null for unassigned entities. */
  areaId: Id.nullable(),
  state: z.string(),
  deviceClass: z.string().optional(),
  /** The HA integration that provides it (`hue`, `ring`, `apple_tv`...). */
  platform: z.string().optional(),
});
export type DiscoveredEntity = z.infer<typeof DiscoveredEntity>;

export const HomeDiscovery = z.object({
  areas: z.array(DiscoveredArea),
  entities: z.array(DiscoveredEntity),
  /** Home Assistant's version, when known. */
  haVersion: z.string().optional(),
  /** Temperature unit from HA's unit system, e.g. `°F`. */
  temperatureUnit: z.string().optional(),
});
export type HomeDiscovery = z.infer<typeof HomeDiscovery>;

/* ---------- the connection card ---------- */

export const HomeConnectionState = z.enum([
  'disabled',
  'not_set_up',
  'connecting',
  'connected',
  'error',
]);
export type HomeConnectionState = z.infer<typeof HomeConnectionState>;

/** Non-secret view of the connection. The token itself never leaves the server. */
export const HomeConnectionStatus = z.object({
  enabled: z.boolean(),
  url: z.string(),
  hasToken: z.boolean(),
  /** Where the URL and token came from: saved in Settings, the environment, or nowhere yet. */
  source: z.enum(['settings', 'env', 'none']),
  state: HomeConnectionState,
  /** One sentence for a person: what is wrong, or what is connected. */
  summary: z.string(),
  lastError: z.string().optional(),
  lastOkAt: z.string().optional(),
  entityCount: z.number().int().nonnegative().optional(),
});
export type HomeConnectionStatus = z.infer<typeof HomeConnectionStatus>;

export const HomeConnectionPatch = z.object({
  enabled: z.boolean().optional(),
  /** Base URL of Home Assistant as the server sees it, e.g. `http://homeassistant.local:8123`. */
  url: z.string().trim().optional(),
  /** A long-lived access token. An empty string clears the saved token. */
  token: z.string().trim().optional(),
});
export type HomeConnectionPatch = z.infer<typeof HomeConnectionPatch>;

/** Try a URL and token before saving them; omitted fields use what is saved. */
export const HomeConnectionTestRequest = z.object({
  url: z.string().trim().optional(),
  token: z.string().trim().optional(),
});
export const HomeTestResult = z.object({ ok: z.boolean(), message: z.string() });
export type HomeTestResult = z.infer<typeof HomeTestResult>;

export const HomeYaml = z.object({ yaml: z.string() });
