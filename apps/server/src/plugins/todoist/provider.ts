/**
 * Todoist as a list-sync service: a Todoist project is a list, its open tasks are the items.
 * Uses the Todoist API v1 Sync endpoint (developer.todoist.com/api/v1), with the personal API
 * token as a Bearer token: a full read of projects or items, and batched commands
 * (`item_add` with a temp id, `item_update`, `item_close`, `item_uncomplete`, `item_delete`).
 * A full items read returns open tasks only, so a task ticked in Todoist just disappears;
 * the sync framework treats that as ticked.
 */
import { randomUUID } from 'node:crypto';
import type { RemoteList } from '@mantel/shared';
import type { ListSyncProvider, PullResult } from '../../providers/real/lists-sync.js';

export const TODOIST_SYNC_URL = 'https://api.todoist.com/api/v1/sync';

interface TodoistProject {
  id: string;
  name: string;
  is_deleted?: boolean;
  is_archived?: boolean;
  inbox_project?: boolean;
  shared?: boolean;
}
interface TodoistItem {
  id: string;
  content: string;
  project_id: string;
  checked?: boolean;
  is_deleted?: boolean;
  updated_at?: string | null;
}
interface SyncResponse {
  projects?: TodoistProject[];
  items?: TodoistItem[];
  sync_status?: Record<string, unknown>;
  temp_id_mapping?: Record<string, string>;
}

export class TodoistError extends Error {}

export function todoistClient(token: string, doFetch: typeof fetch = fetch) {
  const post = async (form: Record<string, string>): Promise<SyncResponse> => {
    let res: Response;
    try {
      res = await doFetch(TODOIST_SYNC_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(form).toString(),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new TodoistError(
        `Could not reach Todoist: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (res.status === 401 || res.status === 403)
      throw new TodoistError(
        'Todoist turned the token down. Copy it again from Todoist’s Integrations settings.',
      );
    if (res.status === 429)
      throw new TodoistError('Todoist asked us to slow down; trying again shortly.');
    if (!res.ok) throw new TodoistError(`Todoist answered ${res.status}.`);
    return (await res.json()) as SyncResponse;
  };
  const read = (type: 'projects' | 'items') =>
    post({ sync_token: '*', resource_types: JSON.stringify([type]) });
  const command = async (type: string, args: Record<string, unknown>, tempId?: string) => {
    const uuid = randomUUID();
    const res = await post({
      commands: JSON.stringify([{ type, uuid, args, ...(tempId ? { temp_id: tempId } : {}) }]),
    });
    const status = res.sync_status?.[uuid];
    if (status !== 'ok') {
      const why = (status as { error?: string } | undefined)?.error ?? 'no answer';
      throw new TodoistError(`Todoist did not accept the change: ${why}`);
    }
    return res;
  };
  return { read, command };
}

export function todoistProvider(
  token: () => string | null,
  doFetch: typeof fetch = fetch,
): ListSyncProvider {
  const client = () => {
    const t = token();
    if (!t) throw new TodoistError('Add your Todoist API token under Integrations.');
    return todoistClient(t, doFetch);
  };
  return {
    id: 'todoist',
    setup: '/settings#integrations',
    pollSeconds: 60,
    readiness() {
      return token()
        ? { ready: true, summary: 'Connected to Todoist' }
        : { ready: false, summary: 'Add your Todoist API token under Integrations.' };
    },
    async lists(): Promise<RemoteList[]> {
      const { projects = [] } = await client().read('projects');
      return projects
        .filter((p) => !p.is_deleted && !p.is_archived)
        .map((p) => ({
          id: String(p.id),
          name: p.name,
          ...(p.inbox_project
            ? { detail: 'Your Inbox' }
            : p.shared
              ? { detail: 'Shared project' }
              : {}),
        }));
    },
    async pull(projectId): Promise<PullResult> {
      const { items = [] } = await client().read('items');
      return {
        items: items
          .filter((i) => String(i.project_id) === projectId && !i.is_deleted)
          .map((i) => ({
            id: String(i.id),
            text: i.content,
            done: Boolean(i.checked),
            updatedAt: i.updated_at ?? null,
          })),
        includesDone: false,
      };
    },
    async add(projectId, { text, done }) {
      const c = client();
      const tempId = randomUUID();
      const res = await c.command('item_add', { content: text, project_id: projectId }, tempId);
      const id = res.temp_id_mapping?.[tempId];
      if (!id) throw new TodoistError('Todoist did not return the new task’s id.');
      if (done) await c.command('item_close', { id });
      return String(id);
    },
    async update(_projectId, id, { text, done }) {
      const c = client();
      if (text !== undefined) await c.command('item_update', { id, content: text });
      if (done === true) await c.command('item_close', { id });
      if (done === false) await c.command('item_uncomplete', { id });
    },
    async remove(_projectId, id) {
      await client().command('item_delete', { id });
    },
  };
}
