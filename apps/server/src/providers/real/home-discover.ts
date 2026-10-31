/**
 * Discovery for the settings page: what Home Assistant has (areas, entities with their area,
 * state and kind), and a connection test that answers in one sentence a person can act on.
 */
import { HOME_DOMAIN_KIND, type DiscoveredEntity, type HomeDiscovery } from '@mantel/shared';
import type { HaRegistry, HaState } from './home-client.js';

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

/** Domains that never mean anything on the wall; leaving them out keeps the picker short. */
const SKIP_DOMAINS = new Set([
  'automation',
  'update',
  'tts',
  'stt',
  'conversation',
  'zone',
  'sun',
  'persistent_notification',
  'device_tracker',
  'number',
  'select',
  'button',
  'text',
  'time',
  'date',
  'datetime',
  'wake_word',
  'assist_satellite',
  'tag',
  'todo',
  'calendar',
  'weather',
  'input_number',
  'input_select',
  'input_text',
  'input_datetime',
  'input_button',
  'counter',
  'timer',
  'schedule',
  'remote',
  'siren',
  'notify',
  'image',
  'stt',
]);

/** "light.living_room_lamp" reads as "Living room lamp" when HA has no friendly name. */
function nameFromId(id: string): string {
  const base = id.split('.')[1] ?? id;
  const words = base.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Map HA's registries and states to the picker's shape. Entities the registry hides or disables
 * and config/diagnostic entities are left out; entities with a state but no registry entry
 * (YAML-defined ones) are kept, without an area.
 */
export function mapDiscovery(
  registry: HaRegistry,
  states: Map<string, HaState>,
  extra: { haVersion?: string; temperatureUnit?: string } = {},
): HomeDiscovery {
  const deviceArea = new Map(registry.devices.map((d) => [d.id, d.area_id]));
  const areaNames = new Map(registry.areas.map((a) => [a.area_id, a.name]));
  const entries = new Map(registry.entities.map((e) => [e.entity_id, e]));
  const ids = new Set<string>([...registry.entities.map((e) => e.entity_id), ...states.keys()]);

  const entities: DiscoveredEntity[] = [];
  for (const id of ids) {
    const domain = id.split('.')[0] ?? '';
    if (SKIP_DOMAINS.has(domain)) continue;
    const entry = entries.get(id);
    if (entry && (entry.hidden_by || entry.disabled_by || entry.entity_category)) continue;
    const s = states.get(id);
    if (!s && !entry) continue;
    const areaId =
      entry?.area_id ?? (entry?.device_id ? (deviceArea.get(entry.device_id) ?? null) : null);
    const kind = HOME_DOMAIN_KIND[domain];
    const deviceClass = str(s?.attributes.device_class);
    entities.push({
      id,
      domain,
      ...(kind ? { kind } : {}),
      name: str(s?.attributes.friendly_name) ?? nameFromId(id),
      areaId: areaId && areaNames.has(areaId) ? areaId : null,
      state: s?.state ?? 'unavailable',
      ...(deviceClass ? { deviceClass } : {}),
      ...(entry?.platform ? { platform: entry.platform } : {}),
    });
  }
  entities.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  return {
    areas: registry.areas
      .map((a) => ({ id: a.area_id, name: a.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    entities,
    ...(extra.haVersion ? { haVersion: extra.haVersion } : {}),
    ...(extra.temperatureUnit ? { temperatureUnit: extra.temperatureUnit } : {}),
  };
}

export interface TestOutcome {
  ok: boolean;
  message: string;
  version?: string;
  locationName?: string;
}

/**
 * Try a URL and token over REST (`GET /api/config`), answering in one sentence a person can
 * act on. Uses a short timeout: the settings page is waiting.
 */
export async function testHaConnection(
  url: string,
  token: string,
  doFetch: typeof fetch = fetch,
  timeoutMs = 6000,
): Promise<TestOutcome> {
  const base = url.trim().replace(/\/+$/, '');
  if (!base) return { ok: false, message: 'Enter the address of Home Assistant first.' };
  if (!/^https?:\/\/[^/\s]+/.test(base))
    return {
      ok: false,
      message:
        'That does not look like an address. It usually looks like http://homeassistant.local:8123 or http://192.168.1.20:8123.',
    };
  if (!token)
    return {
      ok: false,
      message: 'Paste a long-lived access token first (Home Assistant profile, Security tab).',
    };
  let res: Response;
  try {
    res = await doFetch(`${base}/api/config`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError')
      return {
        ok: false,
        message: `Nothing answered at ${base} within a few seconds. Check the address and that this computer can reach Home Assistant.`,
      };
    return {
      ok: false,
      message: `Could not reach ${base}. Check the address (including http:// and the port, usually 8123) and that Home Assistant is running.`,
    };
  }
  if (res.status === 401 || res.status === 403) {
    await res.body?.cancel();
    return {
      ok: false,
      message:
        'Home Assistant refused the token. Make a new long-lived access token (your profile, Security tab) and paste the whole thing.',
    };
  }
  if (!res.ok) {
    await res.body?.cancel();
    return {
      ok: false,
      message: `Home Assistant answered ${res.status} at ${base}/api/config. Is that the right address?`,
    };
  }
  const body = (await res.json().catch(() => null)) as {
    version?: string;
    location_name?: string;
  } | null;
  if (!body || typeof body !== 'object' || !('version' in body))
    return {
      ok: false,
      message: `Something answered at ${base}, but it is not Home Assistant. Check the address.`,
    };
  const where = body.location_name ? ` ("${body.location_name}")` : '';
  return {
    ok: true,
    message: `Connected to Home Assistant ${body.version ?? ''}${where}.`.replace('  ', ' '),
    ...(body.version ? { version: body.version } : {}),
    ...(body.location_name ? { locationName: body.location_name } : {}),
  };
}
