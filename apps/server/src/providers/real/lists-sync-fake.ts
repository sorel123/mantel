/**
 * An in-memory list service for tests and mock mode: it behaves like Todoist (hides ticked
 * items when `includesDone` is false) or like Reminders (shows them), can go offline, and
 * counts the calls made to it.
 */
import type { ListSyncProviderId, RemoteItem, RemoteList } from '@mantel/shared';
import type { ListSyncProvider, PullResult } from './lists-sync.js';

export class FakeListProvider implements ListSyncProvider {
  readonly setup = '/settings#integrations';
  pollSeconds: number | null = 60;
  offline = false;
  readonly calls: string[] = [];
  private readonly data = new Map<string, { name: string; detail?: string; items: RemoteItem[] }>();
  private seq = 0;
  private clock = Date.parse('2026-01-01T00:00:00Z');

  constructor(
    readonly id: ListSyncProviderId,
    readonly includesDone = true,
  ) {}

  readiness() {
    return this.offline
      ? { ready: true, summary: 'Connected (offline right now)' }
      : { ready: true, summary: 'Connected' };
  }

  addList(
    id: string,
    name: string,
    items: Array<string | [string, boolean]> = [],
    detail?: string,
  ) {
    this.data.set(id, {
      name,
      ...(detail ? { detail } : {}),
      items: items.map((it) => {
        const [text, done] = typeof it === 'string' ? [it, false] : it;
        return { id: `r${++this.seq}`, text, done, updatedAt: this.stamp() };
      }),
    });
    return this;
  }

  /** The items as the service has them, ticked ones included. */
  items(listId: string): RemoteItem[] {
    return this.data.get(listId)?.items ?? [];
  }

  /** Change the service directly, as a person on a phone would. */
  edit(listId: string, text: string, patch: { text?: string; done?: boolean }) {
    const item = this.items(listId).find((i) => i.text === text);
    if (!item) throw new Error(`no ${text}`);
    Object.assign(item, patch, { updatedAt: this.stamp() });
  }

  put(listId: string, text: string, done = false): string {
    const id = `r${++this.seq}`;
    this.list(listId).items.push({ id, text, done, updatedAt: this.stamp() });
    return id;
  }

  drop(listId: string, text: string) {
    const l = this.list(listId);
    l.items = l.items.filter((i) => i.text !== text);
  }

  /** Set the service's clock, so its next change counts as earlier or later than ours. */
  at(time: Date) {
    this.clock = time.getTime();
    return this;
  }

  async lists(): Promise<RemoteList[]> {
    this.check('lists');
    return [...this.data].map(([id, l]) => ({
      id,
      name: l.name,
      ...(l.detail ? { detail: l.detail } : {}),
    }));
  }

  async pull(listId: string): Promise<PullResult> {
    this.check('pull');
    const items = this.list(listId).items.filter((i) => this.includesDone || !i.done);
    return { items: items.map((i) => ({ ...i })), includesDone: this.includesDone };
  }

  async add(listId: string, item: { text: string; done: boolean }): Promise<string> {
    this.check(`add ${item.text}`);
    return this.put(listId, item.text, item.done);
  }

  async update(listId: string, remoteId: string, patch: { text?: string; done?: boolean }) {
    this.check(`update ${remoteId} ${JSON.stringify(patch)}`);
    const item = this.list(listId).items.find((i) => i.id === remoteId);
    if (item) Object.assign(item, patch, { updatedAt: this.stamp() });
  }

  async remove(listId: string, remoteId: string) {
    this.check(`remove ${remoteId}`);
    const l = this.list(listId);
    l.items = l.items.filter((i) => i.id !== remoteId);
  }

  private list(id: string) {
    const l = this.data.get(id);
    if (!l) throw new Error(`no list ${id}`);
    return l;
  }

  private check(call: string) {
    if (this.offline) throw new Error('The service did not answer (offline).');
    this.calls.push(call);
  }

  private stamp() {
    return new Date(this.clock).toISOString();
  }
}
