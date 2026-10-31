import type {
  AnnounceTarget,
  HomeArea,
  HomeEntity,
  MediaAction,
  MediaPlayer,
  Presence,
} from '@mantel/shared';
import { ApiRequestError } from '@mantel/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { useConnection, useServerEvent } from '../../lib/events';

export interface HomeData {
  areas: HomeArea[];
  entities: Map<string, HomeEntity>;
  presence: Presence[];
  announceTargets: AnnounceTarget[];
}

export type CallFn = (
  entity: HomeEntity,
  service: string,
  data?: Record<string, unknown>,
  /** The state to show straight away, before Home Assistant answers. */
  optimistic?: Partial<HomeEntity>,
) => Promise<boolean>;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Home state and media for the Home screen: loads once, follows `home.state`, `home.presence`
 * and `media.state`, reloads after the socket reconnects, and applies calls optimistically
 * (rolling back if Home Assistant refuses).
 */
export function useHome(withMedia: boolean) {
  const [data, setData] = useState<HomeData | null>(null);
  const [players, setPlayers] = useState<MediaPlayer[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** True when the server says Home Assistant is not set up (501), as opposed to not answering. */
  const [notSetUp, setNotSetUp] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const connection = useConnection();
  const wasOpen = useRef(false);

  const load = useCallback(async () => {
    try {
      const [state, media] = await Promise.all([
        api.call('homeState'),
        withMedia ? api.call('media').catch(() => ({ players: [] })) : { players: [] },
      ]);
      setData({
        areas: state.areas,
        entities: new Map(state.entities.map((e) => [e.id, e])),
        presence: state.presence,
        announceTargets: state.announceTargets ?? [],
      });
      setPlayers(media.players);
      setError(null);
      setNotSetUp(false);
    } catch (err) {
      setError(message(err));
      setNotSetUp(err instanceof ApiRequestError && err.status === 501);
    }
  }, [withMedia]);

  useEffect(() => {
    void load();
  }, [load]);

  // Anything may have changed while the socket was down.
  useEffect(() => {
    if (connection === 'open' && wasOpen.current === false && data) void load();
    wasOpen.current = connection === 'open';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection]);

  const patch = useCallback((entity: HomeEntity) => {
    setData((d) => {
      if (!d || !d.entities.has(entity.id)) return d;
      const entities = new Map(d.entities);
      entities.set(entity.id, entity);
      return { ...d, entities };
    });
  }, []);

  useServerEvent(
    'home.state',
    useCallback((p) => patch(p.entity), [patch]),
  );
  useServerEvent(
    'home.presence',
    useCallback((p) => setData((d) => (d ? { ...d, presence: p.presence } : d)), []),
  );
  useServerEvent(
    'media.state',
    useCallback(
      (p) =>
        setPlayers((list) =>
          list.some((x) => x.id === p.player.id)
            ? list.map((x) => (x.id === p.player.id ? p.player : x))
            : list,
        ),
      [],
    ),
  );

  const call: CallFn = useCallback(
    async (entity, service, data, optimistic) => {
      if (optimistic)
        patch({ ...entity, ...optimistic, attrs: { ...entity.attrs, ...optimistic.attrs } });
      try {
        const res = await api.call('homeCall', { body: { entityId: entity.id, service, data } });
        if (res.entity) patch(res.entity);
        return true;
      } catch (err) {
        patch(entity);
        setNotice(`${entity.name}: ${message(err)}`);
        return false;
      }
    },
    [patch],
  );

  const mediaCall = useCallback(async (player: MediaPlayer, action: MediaAction) => {
    try {
      const res = await api.call('mediaCall', { body: { playerId: player.id, action } });
      setPlayers((list) => list.map((x) => (x.id === res.player.id ? res.player : x)));
    } catch (err) {
      setNotice(`${player.name}: ${message(err)}`);
    }
  }, []);

  const announce = useCallback(async (msg: string, targets?: string[]) => {
    try {
      await api.call('homeAnnounce', { body: { message: msg, targets } });
      return true;
    } catch (err) {
      setNotice(`Announcement: ${message(err)}`);
      return false;
    }
  }, []);

  // Notices fade on their own.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  return { data, players, error, notSetUp, notice, reload: load, call, mediaCall, announce };
}
