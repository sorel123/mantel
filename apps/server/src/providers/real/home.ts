/**
 * The real Home provider: Home Assistant through `HaClient`, filtered by the YAML allow-list.
 * Lights (Hue, Caséta), plugs (Meross), ecobee thermostats, locks, covers, sensors, Ring
 * cameras and doorbell, Apple TV now playing, and Alexa announcements all arrive as HA
 * entities, so this file only maps HA's shapes to the contract and guards what may be called.
 */
import type {
  AnnounceTarget,
  HomeArea,
  HomeEntity,
  MediaAction,
  MediaPlayer,
  Person,
  Presence,
} from '@mantel/shared';
import { HttpError, notImplemented } from '../../errors.js';
import { log } from '../../log.js';
import type { HomeBytes, HomeProvider, ProviderContext } from '../types.js';
import { HaClient, HaError, type HaRegistry, type HaState } from './home-client.js';
import {
  DOMAIN_KIND,
  HomeConfigFile,
  loadHaEnv,
  type EntityRef,
  type HaEnv,
  type HomeConfig,
} from './home-config.js';

/** HA attributes the display uses; everything else stays on the server. */
const ATTRS = [
  'brightness',
  'supported_color_modes',
  'color_mode',
  'current_temperature',
  'temperature',
  'target_temp_low',
  'target_temp_high',
  'min_temp',
  'max_temp',
  'target_temp_step',
  'hvac_action',
  'hvac_modes',
  'unit_of_measurement',
  'device_class',
  'current_position',
  'icon',
];

/** Services the display may call, per HA domain, with the data keys each accepts. */
const SERVICES: Record<string, Record<string, string[]>> = {
  light: {
    turn_on: ['brightness', 'brightness_pct', 'transition', 'color_temp_kelvin', 'rgb_color'],
    turn_off: ['transition'],
    toggle: [],
  },
  switch: { turn_on: [], turn_off: [], toggle: [] },
  input_boolean: { turn_on: [], turn_off: [], toggle: [] },
  fan: { turn_on: [], turn_off: [], toggle: [] },
  climate: {
    set_temperature: ['temperature', 'target_temp_low', 'target_temp_high', 'hvac_mode'],
    set_hvac_mode: ['hvac_mode'],
    turn_on: [],
    turn_off: [],
  },
  lock: { lock: [], unlock: [] },
  cover: {
    open_cover: [],
    close_cover: [],
    stop_cover: [],
    toggle: [],
    set_cover_position: ['position'],
  },
  scene: { turn_on: ['transition'] },
  script: { turn_on: [] },
};

const MEDIA_SERVICES: Record<MediaAction, string> = {
  play: 'media_play',
  pause: 'media_pause',
  play_pause: 'media_play_pause',
  next: 'media_next_track',
  previous: 'media_previous_track',
  volume_up: 'volume_up',
  volume_down: 'volume_down',
  turn_on: 'turn_on',
  turn_off: 'turn_off',
};

const domainOf = (entityId: string) => entityId.split('.')[0] ?? '';
const isIso = (s: string) => /^\d{4}-\d{2}-\d{2}T/.test(s) && !Number.isNaN(Date.parse(s));
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** "Living Room Ceiling" in area "Living room" reads as "Ceiling". */
export function displayName(friendly: string, areaName?: string): string {
  if (!areaName) return friendly;
  const lower = friendly.toLowerCase();
  const prefix = areaName.toLowerCase();
  if (lower.startsWith(`${prefix} `) && friendly.length > prefix.length + 1) {
    const rest = friendly.slice(prefix.length + 1).trim();
    return rest.charAt(0).toUpperCase() + rest.slice(1);
  }
  return friendly;
}

interface AllowedEntity {
  ref: EntityRef;
  areaName?: string;
  extra: Record<string, unknown>;
}

export interface HomeView {
  areas: HomeArea[];
  /** Allowed entities by id, in display order. */
  allowed: Map<string, AllowedEntity>;
  mediaPlayers: EntityRef[];
  presence: { person: string; entity: string }[];
}

/** Resolve the allow-list against HA's registries: expand `ha_area`, scenes, doorbells. */
export function resolveView(config: HomeConfig, registry: HaRegistry, people: Person[]): HomeView {
  const allowed = new Map<string, AllowedEntity>();
  const add = (ref: EntityRef, areaName?: string, extra: Record<string, unknown> = {}) => {
    if (!DOMAIN_KIND[domainOf(ref.id)]) {
      log.warn(`home: ${ref.id} is not a supported kind of entity; skipping`);
      return false;
    }
    const existing = allowed.get(ref.id);
    if (existing) {
      existing.ref = { ...existing.ref, ...ref };
      existing.extra = { ...existing.extra, ...extra };
    } else allowed.set(ref.id, { ref, areaName, extra });
    return true;
  };

  const deviceArea = new Map(registry.devices.map((d) => [d.id, d.area_id]));
  const areaIdFor = (key: string) =>
    registry.areas.find((a) => a.area_id === key || a.name.toLowerCase() === key.toLowerCase())
      ?.area_id;

  const areas: HomeArea[] = config.areas.map((area) => {
    const ids: string[] = [];
    const push = (ref: EntityRef) => {
      if (add(ref, area.name) && !ids.includes(ref.id)) ids.push(ref.id);
    };
    for (const ref of area.entities) push(ref);
    if (area.ha_area) {
      const haArea = areaIdFor(area.ha_area);
      if (!haArea) log.warn(`home: Home Assistant has no area "${area.ha_area}"`);
      else
        for (const e of registry.entities) {
          const where = e.area_id ?? (e.device_id ? deviceArea.get(e.device_id) : null);
          if (where !== haArea) continue;
          if (e.hidden_by || e.disabled_by || e.entity_category) continue;
          if (!area.domains.includes(domainOf(e.entity_id))) continue;
          if (area.exclude.includes(e.entity_id)) continue;
          push({ id: e.entity_id });
        }
    }
    return { id: area.id, name: area.name, entityIds: ids };
  });

  for (const ref of config.scenes) add(ref);
  for (const bell of config.doorbells) add({ id: bell.camera }, undefined, { doorbell: true });

  const mediaPlayers =
    config.media_players ??
    registry.entities
      .filter((e) => e.platform === 'apple_tv' && domainOf(e.entity_id) === 'media_player')
      .filter((e) => !e.disabled_by)
      .map((e) => ({ id: e.entity_id }));

  const presence =
    config.presence ??
    people.flatMap((p) => {
      const byId = `person.${p.id}`;
      if (registry.entities.some((e) => e.entity_id === byId))
        return [{ person: p.id, entity: byId }];
      return [];
    });

  return { areas, allowed, mediaPlayers, presence };
}

export function toEntity(
  id: string,
  allowed: AllowedEntity,
  s: HaState | undefined,
  temperatureUnit: string,
): HomeEntity {
  const domain = domainOf(id);
  const kind = DOMAIN_KIND[domain]!;
  const friendly = str(s?.attributes.friendly_name) ?? id;
  const attrs: Record<string, unknown> = {};
  for (const k of ATTRS) if (s && k in s.attributes) attrs[k] = s.attributes[k];
  if (kind === 'climate' && attrs.unit_of_measurement === undefined)
    attrs.unit_of_measurement = temperatureUnit;
  if (kind === 'camera' && str(s?.attributes.brand)) attrs.brand = s?.attributes.brand;
  if (allowed.ref.read_only) attrs.read_only = true;
  Object.assign(attrs, allowed.extra);
  // A scene's state is when it last ran, which is what "last changed" means on the display.
  const lastChanged = s && kind === 'scene' && isIso(s.state) ? s.state : s?.last_changed;
  return {
    id,
    kind,
    name: allowed.ref.name ?? displayName(friendly, allowed.areaName),
    state: s?.state ?? 'unavailable',
    attrs,
    ...(lastChanged && isIso(lastChanged) ? { lastChanged } : {}),
  };
}

const PLAYER_STATES: Record<string, MediaPlayer['state']> = {
  playing: 'playing',
  buffering: 'playing',
  paused: 'paused',
  idle: 'idle',
  on: 'idle',
  standby: 'standby',
  off: 'off',
};

export function toPlayer(ref: EntityRef, s: HaState | undefined): MediaPlayer {
  const a = s?.attributes ?? {};
  const state = PLAYER_STATES[s?.state ?? ''] ?? 'unavailable';
  const series = str(a.media_series_title);
  const season = a.media_season ?? undefined;
  const episode = a.media_episode ?? undefined;
  const episodeLine = [
    season !== undefined ? `Season ${String(season)}` : '',
    episode !== undefined ? `Episode ${String(episode)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const title = series ?? str(a.media_title);
  const artist = series
    ? episodeLine || str(a.media_title)
    : (str(a.media_artist) ?? str(a.media_album_name));
  const picture = str(a.entity_picture);
  const updated = str(a.media_position_updated_at) ?? s?.last_updated;
  const active = state === 'playing' || state === 'paused';
  return {
    id: ref.id,
    name: ref.name ?? str(a.friendly_name) ?? ref.id,
    state,
    ...(str(a.app_name) ? { app: str(a.app_name) } : {}),
    ...(active && title ? { title } : {}),
    ...(active && artist ? { artist } : {}),
    ...(active && picture
      ? { artworkUrl: `/api/media/${ref.id}/artwork?v=${encodeURIComponent(hash(picture))}` }
      : {}),
    ...(active && num(a.media_position) !== undefined
      ? { positionSeconds: Math.max(0, num(a.media_position)!) }
      : {}),
    ...(active && num(a.media_duration) !== undefined
      ? { durationSeconds: Math.max(0, num(a.media_duration)!) }
      : {}),
    ...(updated && isIso(updated) ? { updatedAt: updated } : {}),
  };
}

/** Short stable hash for cache-busting artwork URLs. */
function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Does this state change ring the doorbell? */
export function isRing(
  trigger: string,
  eventTypes: string[] | undefined,
  next: HaState | null,
  prev: HaState | null,
): boolean {
  if (!next || ['unavailable', 'unknown'].includes(next.state)) return false;
  if (prev && prev.state === next.state) return false;
  const domain = domainOf(trigger);
  if (domain === 'binary_sensor') return next.state === 'on';
  if (domain === 'event') {
    // The first state after a restart is a restore, not a press.
    if (!prev || ['unavailable', 'unknown'].includes(prev.state)) return false;
    const type = str(next.attributes.event_type);
    return !eventTypes || (type !== undefined && eventTypes.includes(type));
  }
  return prev !== null;
}

const DOORBELL_DEBOUNCE_MS = 15_000;
const CALL_SETTLE_MS = 1500;

export interface RealHome extends HomeProvider {
  /** Close the Home Assistant socket and the allow-list watcher (the plugin registry calls this before a rebuild). */
  stop(): void;
  /** The connection, for status reporting; absent when HA_URL and HA_TOKEN are not set. */
  client?: HaClient;
}

export function realHome(ctx: ProviderContext, env: HaEnv = loadHaEnv()): RealHome {
  if (!env.HA_URL || !env.HA_TOKEN) {
    log.info('home: HA_URL and HA_TOKEN are not set; Home Assistant routes answer 501');
    const off = () =>
      Promise.reject(notImplemented('Home Assistant (set HA_URL and HA_TOKEN to connect)'));
    return {
      state: off,
      call: off,
      announce: off,
      cameraSnapshot: off,
      cameraStream: off,
      media: off,
      mediaCall: off,
      mediaArtwork: off,
      stop: () => {},
    };
  }
  const client = new HaClient({ url: env.HA_URL, token: env.HA_TOKEN });
  // A changed allow-list can add or drop whole cards, so displays reload to pick it up.
  const file = new HomeConfigFile(env.HA_ALLOWLIST, () =>
    ctx.emit({ type: 'display.reload', payload: {} }),
  );
  const provider = createHomeProvider(ctx, client, () => file.get(), env.HA_STREAM_MAX_SECONDS);
  client.start();
  return {
    ...provider,
    client,
    stop: () => {
      client.stop();
      file.close();
    },
  };
}

/** Everything but the wiring, so tests can hand in a client pointed at a fake HA. */
export function createHomeProvider(
  ctx: ProviderContext,
  client: HaClient,
  config: () => HomeConfig,
  streamMaxSeconds = 120,
): HomeProvider {
  let view: HomeView | null = null;
  let viewFor: HomeConfig | null = null;
  const lastRing = new Map<string, number>();

  const getView = () => {
    const cfg = config();
    if (!view || viewFor !== cfg) {
      view = resolveView(cfg, client.registry, ctx.settings().people);
      viewFor = cfg;
    }
    return view;
  };

  const entity = (id: string) => {
    const allowed = getView().allowed.get(id);
    return allowed ? toEntity(id, allowed, client.states.get(id), client.temperatureUnit) : null;
  };

  const presence = (): Presence[] =>
    getView().presence.map(({ person, entity: id }) => {
      const s = client.states.get(id);
      return {
        personId: person,
        home: s?.state === 'home',
        ...(s?.last_changed ? { since: s.last_changed } : {}),
      };
    });

  const announceTargets = (): AnnounceTarget[] => config().alexa?.targets ?? [];

  const ensureReady = () => {
    if (!client.hasStates)
      throw new HttpError('upstream_error', 'Home Assistant is not reachable yet');
  };

  const upstream = (err: unknown): never => {
    if (err instanceof HttpError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new HttpError('upstream_error', `Home Assistant: ${msg}`);
  };

  const player = (id: string) => {
    const ref = getView().mediaPlayers.find((p) => p.id === id);
    return ref ? toPlayer(ref, client.states.get(id)) : null;
  };

  const anyoneHome = (list: Presence[]) => list.some((p) => p.home);

  /* ---- relay HA changes to displays ---- */
  client.on('ready', (previous) => {
    view = null;
    ctx.markSynced('home');
    // After a reconnect, push whatever changed while we were away.
    for (const id of getView().allowed.keys()) {
      const before = previous.get(id);
      const after = client.states.get(id);
      if (previous.size && before?.last_updated !== after?.last_updated) {
        const e = entity(id);
        if (e) ctx.emit({ type: 'home.state', payload: { entity: e } });
      }
    }
    if (previous.size) ctx.emit({ type: 'home.presence', payload: { presence: presence() } });
  });

  client.on('state', (id, next, prev) => {
    const v = getView();
    ctx.markSynced('home');
    if (v.allowed.has(id)) {
      const e = entity(id);
      if (e) ctx.emit({ type: 'home.state', payload: { entity: e } });
    }
    const p = player(id);
    if (p) ctx.emit({ type: 'media.state', payload: { player: p } });

    if (v.presence.some((x) => x.entity === id) && prev?.state !== next?.state) {
      const now = presence();
      ctx.emit({ type: 'home.presence', payload: { presence: now } });
      const before = now.map((x) =>
        v.presence.find((m) => m.person === x.personId)?.entity === id
          ? { ...x, home: prev?.state === 'home' }
          : x,
      );
      const opts = config().presence_display;
      const arrived = next?.state === 'home' && prev?.state !== 'home';
      if (arrived && opts.wake_on_arrival)
        ctx.emit({ type: 'display.wake', payload: { reason: 'presence' } });
      if (anyoneHome(before) && !anyoneHome(now) && opts.sleep_when_away)
        ctx.emit({ type: 'display.sleep', payload: { reason: 'presence' } });
    }

    for (const bell of config().doorbells) {
      if (bell.trigger !== id || !isRing(bell.trigger, bell.event_types, next, prev)) continue;
      if (!ctx.settings().flags.doorbellPopover) continue;
      const t = ctx.now().getTime();
      if (t - (lastRing.get(bell.camera) ?? -Infinity) < DOORBELL_DEBOUNCE_MS) continue;
      lastRing.set(bell.camera, t);
      log.info(`home: doorbell ${bell.trigger} rang`);
      ctx.emit({
        type: 'home.doorbell',
        payload: {
          cameraEntityId: bell.camera,
          at: ctx.now().toISOString(),
          durationSeconds: bell.seconds,
        },
      });
    }
  });

  const cameraAllowed = (id: string) =>
    domainOf(id) === 'camera' && getView().allowed.has(id) ? id : null;

  return {
    async state() {
      ensureReady();
      const v = getView();
      const entities: HomeEntity[] = [];
      for (const id of v.allowed.keys()) {
        const e = entity(id);
        if (e) entities.push(e);
      }
      const targets = announceTargets();
      return {
        areas: v.areas,
        entities,
        presence: presence(),
        ...(targets.length ? { announceTargets: targets } : {}),
      };
    },

    async call({ entityId, service, data = {} }) {
      const allowed = getView().allowed.get(entityId);
      if (!allowed) throw new HttpError('forbidden', `${entityId} is not an allowed entity`);
      if (allowed.ref.read_only)
        throw new HttpError('forbidden', `${entityId} is read-only on the display`);
      const domain = domainOf(entityId);
      const keys = SERVICES[domain]?.[service];
      if (!keys) throw new HttpError('bad_request', `${domain}.${service} is not allowed`);
      const extra = Object.keys(data).filter((k) => !keys.includes(k));
      if (extra.length)
        throw new HttpError(
          'bad_request',
          `${domain}.${service} does not take ${extra.join(', ')}`,
        );
      ensureReady();
      const settled = client.waitForChange(entityId, CALL_SETTLE_MS);
      await client.callService(domain, service, entityId, data).catch(upstream);
      await settled;
      return { ok: true, ...(entity(entityId) ? { entity: entity(entityId)! } : {}) };
    },

    async announce({ message, targets }) {
      const alexa = config().alexa;
      if (!alexa) throw new HttpError('forbidden', 'Alexa announcements are not set up');
      const all = alexa.targets.map((t) => t.id);
      const chosen = targets ?? all;
      const unknown = chosen.filter((t) => !all.includes(t));
      if (unknown.length)
        throw new HttpError('forbidden', `${unknown.join(', ')} is not an announce target`);
      const [domain, service] = alexa.service.split('.') as [string, string];
      await client
        .callService(domain, service, null, {
          message,
          target: chosen,
          data: { type: 'announce', method: 'all' },
        })
        .catch(upstream);
      return { ok: true, targets: chosen };
    },

    async cameraSnapshot(id) {
      if (!cameraAllowed(id)) return null;
      const res = await client.fetch(`/api/camera_proxy/${id}`).catch(upstream);
      return {
        contentType: res.headers.get('content-type') ?? 'image/jpeg',
        body: new Uint8Array(await res.arrayBuffer()),
      };
    },

    async cameraStream(id, signal) {
      if (!cameraAllowed(id)) return null;
      // Stop upstream when the display closes the view, or after the cap so a forgotten
      // tab cannot hold a camera open.
      const limit = AbortSignal.any([signal, AbortSignal.timeout(streamMaxSeconds * 1000)]);
      const res = await client.fetch(`/api/camera_proxy_stream/${id}`, limit).catch(upstream);
      if (!res.body) throw new HttpError('upstream_error', 'camera stream had no body');
      return {
        contentType: res.headers.get('content-type') ?? 'multipart/x-mixed-replace',
        body: res.body as ReadableStream<Uint8Array>,
      };
    },

    async media() {
      ensureReady();
      return {
        players: getView().mediaPlayers.map((ref) => toPlayer(ref, client.states.get(ref.id))),
      };
    },

    async mediaCall({ playerId, action }) {
      if (!getView().mediaPlayers.some((p) => p.id === playerId))
        throw new HttpError('not_found', `media player ${playerId} not found`);
      ensureReady();
      const settled = client.waitForChange(playerId, CALL_SETTLE_MS);
      await client
        .callService('media_player', MEDIA_SERVICES[action], playerId, {})
        .catch(upstream);
      await settled;
      return { ok: true, player: player(playerId)! };
    },

    async mediaArtwork(id): Promise<HomeBytes | null> {
      if (!getView().mediaPlayers.some((p) => p.id === id)) return null;
      const picture = str(client.states.get(id)?.attributes.entity_picture);
      if (!picture) return null;
      const res = await client.fetch(picture).catch((err: unknown) => {
        if (err instanceof HaError && err.code === 'http_404') return null;
        return upstream(err);
      });
      if (!res) return null;
      return {
        contentType: res.headers.get('content-type') ?? 'image/jpeg',
        body: new Uint8Array(await res.arrayBuffer()),
      };
    },
  };
}
