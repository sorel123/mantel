import type { HomeEntity, MediaPlayer } from '@mantel/shared';
import { homeState, mediaPlayers } from '@mantel/shared/fixtures';
import { HttpError, notFound } from '../../errors.js';
import type { HomeProvider, ProviderContext } from '../types.js';

/** Applies service calls to in-memory fixture state and echoes `home.state` like HA would. */
export function mockHome(ctx: ProviderContext): HomeProvider {
  const state = homeState(ctx.now());
  const players = mediaPlayers(ctx.now());

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
      case 'climate.set_temperature':
        if (typeof data.temperature !== 'number')
          throw new HttpError('bad_request', 'temperature is required');
        e.attrs = { ...e.attrs, temperature: data.temperature };
        return;
      case 'climate.set_hvac_mode':
        e.state = String(data.hvac_mode ?? e.state);
        return;
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
      case 'scene.turn_on':
        return;
      default:
        throw new HttpError('bad_request', `service ${service} is not supported for ${e.kind}`);
    }
  };

  return {
    async state() {
      return structuredClone(state);
    },
    async call({ entityId, service, data }) {
      const entity = state.entities.find((e) => e.id === entityId);
      if (!entity) throw new HttpError('forbidden', `${entityId} is not an allowed entity`);
      apply(entity, service, data ?? {});
      entity.lastChanged = ctx.now().toISOString();
      ctx.emit({ type: 'home.state', payload: { entity } });
      return { ok: true, entity };
    },
    async media() {
      return { players: structuredClone(players) };
    },
    async mediaCall({ playerId, action }) {
      const p = players.find((x) => x.id === playerId);
      if (!p) throw notFound(`media player ${playerId}`);
      const next: Partial<Record<typeof action, MediaPlayer['state']>> = {
        play: 'playing',
        pause: 'paused',
        play_pause: p.state === 'playing' ? 'paused' : 'playing',
        turn_on: 'idle',
        turn_off: 'off',
      };
      p.state = next[action] ?? p.state;
      p.updatedAt = ctx.now().toISOString();
      ctx.emit({ type: 'media.state', payload: { player: p } });
      return { ok: true, player: p };
    },
  };
}
