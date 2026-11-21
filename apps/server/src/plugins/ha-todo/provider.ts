/**
 * Home Assistant to-do lists as a list-sync service: any `todo.*` entity, through the Home
 * Assistant connection Mantel already has. That reaches whatever Home Assistant reaches (Local
 * to-do, Shopping list, Google Tasks, Todoist, AnyList, Bring!, Alexa lists through Alexa
 * Devices, CalDAV), each as one entity. See `docs/list-sharing.md` for what was verified.
 *
 * Actions used (home-assistant.io/integrations/todo): `todo.get_items` with a response,
 * `todo.add_item`, `todo.update_item` (by uid, with `rename` and `status`) and `todo.remove_item`.
 * An entity's state is its count of open items, so a state change prompts a round.
 */
import type { RemoteItem, RemoteList } from '@mantel/shared';
import type { HaState } from '../../providers/real/home-client.js';
import type { ListSyncProvider, PullResult } from '../../providers/real/lists-sync.js';

/** The part of `HaClient` this needs, so tests can pass a fake. */
export interface TodoClient {
  readonly connected: boolean;
  readonly states: Map<string, HaState>;
  request<T = unknown>(payload: Record<string, unknown>): Promise<T>;
  on(
    event: 'state',
    fn: (entityId: string, next: HaState | null, prev: HaState | null) => void,
  ): () => void;
}

interface HaTodoItem {
  uid: string;
  summary: string;
  status: 'needs_action' | 'completed';
}

const isTodo = (id: string) => id.startsWith('todo.');

export function haTodoProvider(client: () => TodoClient | null): ListSyncProvider {
  const call = (
    service: string,
    entityId: string,
    data: Record<string, unknown>,
    response = false,
  ) => {
    const c = client();
    if (!c?.connected) throw new Error('Home Assistant is not connected right now.');
    return c.request<{ response?: Record<string, { items?: HaTodoItem[] }> }>({
      type: 'call_service',
      domain: 'todo',
      service,
      service_data: data,
      target: { entity_id: entityId },
      ...(response ? { return_response: true } : {}),
    });
  };
  const items = async (entityId: string): Promise<HaTodoItem[]> => {
    const res = await call('get_items', entityId, { status: ['needs_action', 'completed'] }, true);
    return res?.response?.[entityId]?.items ?? [];
  };

  return {
    id: 'ha-todo',
    setup: '/settings#homeassistant',
    pollSeconds: 120,
    readiness() {
      const c = client();
      if (!c) return { ready: false, summary: 'Connect Home Assistant first.' };
      if (!c.connected)
        return { ready: false, summary: 'Home Assistant is not connected right now.' };
      const n = [...c.states.keys()].filter(isTodo).length;
      return n
        ? { ready: true, summary: `${n} to-do list${n === 1 ? '' : 's'} in Home Assistant` }
        : {
            ready: false,
            summary:
              'Home Assistant has no to-do lists yet. Add the Local to-do or Shopping list integration there.',
          };
    },
    async lists(): Promise<RemoteList[]> {
      const c = client();
      return [...(c?.states.values() ?? [])]
        .filter((s) => isTodo(s.entity_id))
        .map((s) => ({
          id: s.entity_id,
          name: String(s.attributes.friendly_name ?? s.entity_id),
          detail: `${s.entity_id} · ${s.state} open`,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    async pull(entityId): Promise<PullResult> {
      const list: RemoteItem[] = (await items(entityId)).map((i) => ({
        id: i.uid,
        text: i.summary,
        done: i.status === 'completed',
      }));
      return { items: list, includesDone: true };
    },
    async add(entityId, { text, done }) {
      // add_item answers nothing, so the new uid is found by looking again.
      const before = new Set((await items(entityId)).map((i) => i.uid));
      await call('add_item', entityId, { item: text });
      const added = (await items(entityId)).find((i) => !before.has(i.uid) && i.summary === text);
      if (!added) throw new Error(`Home Assistant did not show "${text}" after adding it.`);
      if (done) await call('update_item', entityId, { item: added.uid, status: 'completed' });
      return added.uid;
    },
    async update(entityId, uid, { text, done }) {
      await call('update_item', entityId, {
        item: uid,
        ...(text !== undefined ? { rename: text } : {}),
        ...(done !== undefined ? { status: done ? 'completed' : 'needs_action' } : {}),
      });
    },
    async remove(entityId, uid) {
      await call('remove_item', entityId, { item: uid });
    },
    watch(onChange) {
      // The connection is rebuilt when its settings change, so follow whichever is current.
      let attached: TodoClient | null = null;
      let off: (() => void) | null = null;
      const attach = () => {
        const c = client();
        if (c === attached) return;
        off?.();
        attached = c;
        off =
          c?.on('state', (id, next, prev) => {
            if (isTodo(id) && next?.state !== prev?.state) onChange(id);
          }) ?? null;
      };
      attach();
      const timer = setInterval(attach, 5_000);
      timer.unref?.();
      return () => {
        clearInterval(timer);
        off?.();
      };
    },
  };
}
