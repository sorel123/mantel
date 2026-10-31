/**
 * Home Assistant settings: connection from the environment, and the allow-list of areas and
 * entities the display may see and control from a YAML file (see config/home.example.yaml).
 * Nothing in Home Assistant is visible to the display unless this file names it.
 */
import { existsSync, readFileSync, watch, type FSWatcher } from 'node:fs';
import { resolve } from 'node:path';
import type { HomeEntityKind } from '@mantel/shared';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { log } from '../../log.js';

/** Environment variables for this integration (also listed in .env.example). */
const HaEnv = z.object({
  /** Base URL of Home Assistant as the server sees it. */
  HA_URL: z.string().url().optional(),
  /** Long-lived access token (HA profile page, Security tab). */
  HA_TOKEN: z.string().min(1).optional(),
  /** Path to the allow-list YAML. */
  HA_ALLOWLIST: z.string().default('./config/home.yaml'),
  /** Hard cap on one live camera stream, in seconds. */
  HA_STREAM_MAX_SECONDS: z.coerce.number().int().positive().default(120),
});
export type HaEnv = z.infer<typeof HaEnv>;

export function loadHaEnv(env: NodeJS.ProcessEnv = process.env): HaEnv {
  return HaEnv.parse({
    HA_URL: env.HA_URL || undefined,
    HA_TOKEN: env.HA_TOKEN || undefined,
    HA_ALLOWLIST: env.HA_ALLOWLIST || undefined,
    HA_STREAM_MAX_SECONDS: env.HA_STREAM_MAX_SECONDS || undefined,
  });
}

const EntityId = z
  .string()
  .regex(/^[a-z_]+\.[a-z0-9_]+$/, 'expected an entity id like light.kitchen');

/** An entity in the allow-list: just the id, or the id with overrides. */
const EntityRef = z.union([
  EntityId.transform((id) => ({ id })),
  z.object({
    id: EntityId,
    /** Name on the display; defaults to the HA friendly name minus the area name. */
    name: z.string().min(1).optional(),
    /** Shown but never controlled from the wall. */
    read_only: z.boolean().optional(),
  }),
]);
export type EntityRef = { id: string; name?: string; read_only?: boolean };

const Area = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Also include every entity Home Assistant has in this area (by area id or name). */
  ha_area: z.string().min(1).optional(),
  /** Domains pulled in through `ha_area`. Sensors are left out unless listed, there are too many. */
  domains: z
    .array(z.string())
    .default(['light', 'switch', 'fan', 'input_boolean', 'climate', 'lock', 'cover', 'camera']),
  entities: z.array(EntityRef).default([]),
  /** Entities to drop from the `ha_area` expansion. */
  exclude: z.array(EntityId).default([]),
});

const Doorbell = z.object({
  /** The camera whose live view pops over the display. */
  camera: EntityId,
  /**
   * What fires the pop-over: a Ring `event.*_ding` entity, a `binary_sensor` that turns on, or
   * any entity whose state changes.
   */
  trigger: EntityId,
  /** For `event.*` triggers, only these event types count (default: any). */
  event_types: z.array(z.string()).optional(),
  seconds: z.number().int().positive().max(300).default(30),
});

export const HomeConfig = z.object({
  areas: z.array(Area).default([]),
  /** Scene chips across the top of the Home screen, in order. `script.*` works too. */
  scenes: z.array(EntityRef).default([]),
  doorbells: z.array(Doorbell).default([]),
  /**
   * Mantel person id to HA `person.*` entity. When omitted, each person in settings is matched
   * to `person.<id>` or to the person entity with the same name.
   */
  presence: z.array(z.object({ person: z.string().min(1), entity: EntityId })).optional(),
  /** Wake the screen when someone gets home; sleep it when the last person leaves. */
  presence_display: z
    .object({
      wake_on_arrival: z.boolean().default(true),
      sleep_when_away: z.boolean().default(true),
    })
    .default({ wake_on_arrival: true, sleep_when_away: true }),
  /** Now-playing players. When omitted, every entity from the Apple TV integration. */
  media_players: z.array(EntityRef).optional(),
  /** Alexa announcements through the Alexa Media Player custom integration. */
  alexa: z
    .object({
      service: z
        .string()
        .regex(/^notify\.[a-z0-9_]+$/)
        .default('notify.alexa_media'),
      targets: z.array(z.object({ id: EntityId, name: z.string().min(1) })).min(1),
    })
    .optional(),
});
export type HomeConfig = z.infer<typeof HomeConfig>;
export type HomeAreaConfig = z.infer<typeof Area>;
export type DoorbellConfig = z.infer<typeof Doorbell>;

export const EMPTY_CONFIG: HomeConfig = HomeConfig.parse({});

/** HA domain to the display's entity kind. Domains not listed here are never exposed. */
export const DOMAIN_KIND: Record<string, HomeEntityKind> = {
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

export function parseHomeConfig(text: string): HomeConfig {
  const raw: unknown = parseYaml(text) ?? {};
  const parsed = HomeConfig.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`invalid Home Assistant allow-list: ${issues}`);
  }
  const seen = new Set<string>();
  for (const { id } of parsed.data.areas) {
    if (seen.has(id))
      throw new Error(`invalid Home Assistant allow-list: area id "${id}" is used twice`);
    seen.add(id);
  }
  return parsed.data;
}

/**
 * Loads the allow-list and reloads it when the file changes, keeping the last good version if
 * an edit does not parse. A missing file means nothing is allowed (presence and Apple TV still
 * work, they are discovered).
 */
export class HomeConfigFile {
  private current: HomeConfig = EMPTY_CONFIG;
  private watcher: FSWatcher | undefined;
  private timer: NodeJS.Timeout | undefined;
  readonly path: string;

  constructor(
    path: string,
    private readonly onChange: () => void = () => {},
  ) {
    this.path = resolve(path);
    this.load();
    if (existsSync(this.path)) {
      try {
        this.watcher = watch(this.path, () => {
          clearTimeout(this.timer);
          this.timer = setTimeout(() => this.load() && this.onChange(), 250);
          this.timer.unref();
        });
        this.watcher.unref();
      } catch (err) {
        log.warn('home: cannot watch allow-list for changes', { err: String(err) });
      }
    }
  }

  get(): HomeConfig {
    return this.current;
  }

  private load(): boolean {
    if (!existsSync(this.path)) {
      log.warn(
        `home: no allow-list at ${this.path}; nothing from Home Assistant is shown. Copy config/home.example.yaml to start.`,
      );
      return false;
    }
    try {
      this.current = parseHomeConfig(readFileSync(this.path, 'utf8'));
      log.info(
        `home: allow-list loaded (${this.current.areas.length} areas, ${this.current.scenes.length} scenes)`,
      );
      return true;
    } catch (err) {
      log.error(
        `home: ${err instanceof Error ? err.message : String(err)}; keeping the last good one`,
      );
      return false;
    }
  }

  close() {
    clearTimeout(this.timer);
    this.watcher?.close();
  }
}
