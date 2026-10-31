/**
 * Home Assistant settings: the environment fallbacks, and the allow-list of areas and entities
 * the display may see and control. The schema lives in `@mantel/shared` (`home-setup.ts`) so
 * the settings page edits the same shape; this file adds the YAML form (`config/home.yaml`,
 * see config/home.example.yaml) used for import and export.
 */
import {
  DEFAULT_AREA_DOMAINS,
  HOME_DOMAIN_KIND,
  HomeConfig,
  type HomeConfigInput,
  type HomeEntityRef,
} from '@mantel/shared';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

/** Environment variables for this integration (also listed in .env.example). */
const HaEnv = z.object({
  /** Base URL of Home Assistant as the server sees it. Used until one is saved in Settings. */
  HA_URL: z.string().url().optional(),
  /** Long-lived access token (HA profile page, Security tab). Used until one is saved in Settings. */
  HA_TOKEN: z.string().min(1).optional(),
  /** A `home.yaml` to import once when the database has no allow-list yet. */
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

export { HomeConfig };
export type { HomeConfig as HomeConfigType } from '@mantel/shared';
export type EntityRef = HomeEntityRef;
export type { DoorbellConfig, HomeAreaConfig } from '@mantel/shared';

export const DOMAIN_KIND = HOME_DOMAIN_KIND;

export const EMPTY_CONFIG: HomeConfig = HomeConfig.parse({});

/** Parse a config object (from the API or a YAML file) with readable error text. */
export function normalizeHomeConfig(raw: unknown): HomeConfig {
  const parsed = HomeConfig.safeParse(raw ?? {});
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

export function parseHomeConfig(text: string): HomeConfig {
  let raw: unknown;
  try {
    raw = parseYaml(text) ?? {};
  } catch (err) {
    throw new Error(
      `invalid Home Assistant allow-list: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('invalid Home Assistant allow-list: expected a YAML mapping at the top');
  return normalizeHomeConfig(raw);
}

const sameDomains = (a: string[], b: string[]) =>
  a.length === b.length && a.every((d, i) => d === b[i]);

/** An entity ref as the YAML writes it: a bare id when there are no overrides. */
const refOut = (ref: HomeEntityRef) =>
  ref.name === undefined && ref.read_only === undefined ? ref.id : ref;

/**
 * The config as `home.yaml` text, leaving out defaults so the file reads like the example.
 * Parsing the result gives back an equal config.
 */
export function homeConfigToYaml(config: HomeConfig): string {
  const out: HomeConfigInput = {
    areas: config.areas.map((a) => ({
      id: a.id,
      name: a.name,
      ...(a.ha_area ? { ha_area: a.ha_area } : {}),
      ...(sameDomains(a.domains, DEFAULT_AREA_DOMAINS) ? {} : { domains: a.domains }),
      ...(a.exclude.length ? { exclude: a.exclude } : {}),
      ...(a.entities.length ? { entities: a.entities.map(refOut) } : {}),
    })),
  };
  if (config.scenes.length) out.scenes = config.scenes.map(refOut);
  if (config.doorbells.length)
    out.doorbells = config.doorbells.map((d) => ({
      camera: d.camera,
      trigger: d.trigger,
      ...(d.event_types ? { event_types: d.event_types } : {}),
      ...(d.seconds === 30 ? {} : { seconds: d.seconds }),
    }));
  if (config.presence) out.presence = config.presence;
  if (!config.presence_display.wake_on_arrival || !config.presence_display.sleep_when_away)
    out.presence_display = config.presence_display;
  if (config.media_players) out.media_players = config.media_players.map(refOut);
  if (config.alexa) out.alexa = config.alexa;
  return `# Mantel Home Assistant allow-list. Import it on the Settings page or edit by hand.\n${stringifyYaml(out)}`;
}
