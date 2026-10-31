import type { HomeEntity, MediaPlayer } from '@mantel/shared';
import { homeState, mediaPlayers } from '@mantel/shared/fixtures';
import { HttpError, notFound } from '../../errors.js';
import type { HomeProvider, ProviderContext } from '../types.js';
import { artworkSvg, cameraSvg } from './cameras.js';

/** The mockup's scene presets: [on, brightness %] for each light, in fixture order. */
const scenePresets: Record<string, Record<string, [boolean, number]>> = {
  'scene.morning': {
    living_room_ceiling: [true, 70],
    living_room_lamp: [true, 40],
    kitchen_counter: [true, 100],
    kitchen_island: [false, 60],
    bedroom_bedside: [false, 30],
    bedroom_closet: [false, 80],
    ava_lamp: [true, 55],
    leo_lamp: [false, 50],
  },
  'scene.focus': {
    living_room_ceiling: [true, 90],
    living_room_lamp: [false, 40],
    kitchen_counter: [true, 80],
    kitchen_island: [false, 60],
    bedroom_bedside: [false, 30],
    bedroom_closet: [false, 80],
    ava_lamp: [false, 55],
    leo_lamp: [false, 50],
  },
  'scene.movie': {
    living_room_ceiling: [false, 70],
    living_room_lamp: [true, 15],
    kitchen_counter: [false, 100],
    kitchen_island: [false, 60],
    bedroom_bedside: [false, 30],
    bedroom_closet: [false, 80],
    ava_lamp: [false, 55],
    leo_lamp: [false, 50],
  },
  'scene.goodnight': {
    living_room_ceiling: [false, 70],
    living_room_lamp: [false, 40],
    kitchen_counter: [false, 100],
    kitchen_island: [false, 60],
    bedroom_bedside: [true, 10],
    bedroom_closet: [false, 80],
    ava_lamp: [false, 55],
    leo_lamp: [false, 50],
  },
};

const queue = [
  { title: 'Bluey', artist: 'Season 3 · Episode 12', durationSeconds: 470 },
  { title: 'Bluey', artist: 'Season 3 · Episode 13', durationSeconds: 455 },
  { title: 'Bluey', artist: 'Season 3 · Episode 14', durationSeconds: 482 },
];

/** Applies service calls to in-memory fixture state and echoes `home.state` like HA would. */
export function mockHome(ctx: ProviderContext): HomeProvider {
  const state = homeState(ctx.now());
  const players = mediaPlayers(ctx.now());
  const changed: HomeEntity[] = [];
  let episode = 0;

  const touch = (e: HomeEntity) => {
    e.lastChanged = ctx.now().toISOString();
    changed.push(e);
  };

  const apply = (e: HomeEntity, service: string, data: Record<string, unknown>) => {
    const on = (v: boolean) => (e.state = v ? 'on' : 'off');
    switch (`${e.kind}.${service}`) {
      case 'light.turn_on': {
        on(true);
        const pct = typeof data.brightness_pct === 'number' ? data.brightness_pct : undefined;
        const raw = typeof data.brightness === 'number' ? data.brightness : undefined;
        e.attrs = {
          ...e.attrs,
          brightness:
            raw ?? (pct !== undefined ? Math.round(pct * 2.55) : (e.attrs.brightness ?? 255)),
        };
        return;
      }
      case 'light.turn_off':
      case 'switch.turn_off':
        on(false);
        if (e.kind === 'light') e.attrs = { ...e.attrs, brightness: null };
        return;
      case 'switch.turn_on':
        on(true);
        return;
      case 'light.toggle':
      case 'switch.toggle':
        return apply(e, e.state === 'on' ? 'turn_off' : 'turn_on', data);
      case 'climate.set_temperature': {
        const { temperature, target_temp_low: low, target_temp_high: high } = data;
        if (typeof temperature === 'number') e.attrs = { ...e.attrs, temperature };
        else if (typeof low === 'number' && typeof high === 'number')
          e.attrs = { ...e.attrs, target_temp_low: low, target_temp_high: high };
        else throw new HttpError('bad_request', 'temperature (or a low and high) is required');
        return;
      }
      case 'climate.set_hvac_mode': {
        const mode = String(data.hvac_mode ?? e.state);
        e.state = mode;
        const t = (e.attrs.temperature as number | null) ?? 68;
        if (mode === 'heat_cool')
          e.attrs = {
            ...e.attrs,
            temperature: null,
            target_temp_low: (e.attrs.target_temp_low as number | undefined) ?? t - 2,
            target_temp_high: (e.attrs.target_temp_high as number | undefined) ?? t + 4,
          };
        else if (mode !== 'off' && e.attrs.temperature == null)
          e.attrs = { ...e.attrs, temperature: (e.attrs.target_temp_low as number) ?? 68 };
        e.attrs.hvac_action = mode === 'off' ? 'off' : 'idle';
        return;
      }
      case 'lock.lock':
        e.state = 'locked';
        return;
      case 'lock.unlock':
        e.state = 'unlocked';
        return;
      case 'cover.open_cover':
        e.state = 'open';
        return;
      case 'cover.close_cover':
        e.state = 'closed';
        return;
      case 'scene.turn_on': {
        const preset = scenePresets[e.id] ?? {};
        for (const [id, [isOn, pct]] of Object.entries(preset)) {
          const light = state.entities.find((x) => x.id === `light.${id}`);
          if (!light) continue;
          apply(light, isOn ? 'turn_on' : 'turn_off', { brightness_pct: pct });
          if (!isOn) light.attrs = { ...light.attrs, brightness: null };
          touch(light);
        }
        return;
      }
      default:
        throw new HttpError('bad_request', `service ${service} is not supported for ${e.kind}`);
    }
  };

  const findPlayer = (id: string) => {
    const p = players.find((x) => x.id === id);
    if (!p) throw notFound(`media player ${id}`);
    return p;
  };
  /** Where playback is now, counting time since the last update while playing. */
  const position = (p: MediaPlayer) => {
    if (p.positionSeconds === undefined) return undefined;
    const elapsed =
      p.state === 'playing' && p.updatedAt
        ? (ctx.now().getTime() - new Date(p.updatedAt).getTime()) / 1000
        : 0;
    return Math.min(p.durationSeconds ?? Infinity, p.positionSeconds + Math.max(0, elapsed));
  };

  return {
    async state() {
      return structuredClone(state);
    },
    async call({ entityId, service, data }) {
      const entity = state.entities.find((e) => e.id === entityId);
      if (!entity) throw new HttpError('forbidden', `${entityId} is not an allowed entity`);
      changed.length = 0;
      apply(entity, service, data ?? {});
      touch(entity);
      for (const e of changed) ctx.emit({ type: 'home.state', payload: { entity: e } });
      return { ok: true, entity };
    },
    async announce({ targets }) {
      const all = state.announceTargets.map((t) => t.id);
      const chosen = targets ?? all;
      const unknown = chosen.filter((t) => !all.includes(t));
      if (unknown.length)
        throw new HttpError('forbidden', `${unknown.join(', ')} is not an announce target`);
      return { ok: true, targets: chosen };
    },
    async cameraSnapshot(entityId) {
      const cam = state.entities.find((e) => e.id === entityId && e.kind === 'camera');
      if (!cam) return null;
      return {
        contentType: 'image/svg+xml',
        body: cameraSvg(cam.id, cam.name, ctx.now(), false),
      };
    },
    async cameraStream(entityId) {
      const cam = state.entities.find((e) => e.id === entityId && e.kind === 'camera');
      if (!cam) return null;
      return { contentType: 'image/svg+xml', body: cameraSvg(cam.id, cam.name, ctx.now(), true) };
    },
    async media() {
      return { players: structuredClone(players) };
    },
    async mediaCall({ playerId, action }) {
      const p = findPlayer(playerId);
      const pos = position(p);
      if (pos !== undefined) p.positionSeconds = Math.round(pos);
      const next: Partial<Record<typeof action, MediaPlayer['state']>> = {
        play: 'playing',
        pause: 'paused',
        play_pause: p.state === 'playing' ? 'paused' : 'playing',
        turn_on: 'idle',
        turn_off: 'off',
      };
      p.state = next[action] ?? p.state;
      if ((action === 'next' || action === 'previous') && p.title) {
        episode = (episode + (action === 'next' ? 1 : queue.length - 1)) % queue.length;
        Object.assign(p, queue[episode], { positionSeconds: 0 });
      }
      p.updatedAt = ctx.now().toISOString();
      ctx.emit({ type: 'media.state', payload: { player: p } });
      return { ok: true, player: p };
    },
    async mediaArtwork(playerId) {
      const p = players.find((x) => x.id === playerId);
      if (!p?.artworkUrl || !p.title) return null;
      return { contentType: 'image/svg+xml', body: artworkSvg(p.title) };
    },
  };
}
