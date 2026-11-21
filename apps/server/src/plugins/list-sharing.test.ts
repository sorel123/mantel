import type { HaState } from '../providers/real/home-client.js';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDb } from '../db/index.js';
import { ListStore } from '../providers/real/lists-store.js';
import { ListSyncService } from '../providers/real/lists-sync.js';
import { haTodoProvider, type TodoClient } from './ha-todo/provider.js';
import { RemindersBridge } from './reminders/bridge.js';
import { TODOIST_SYNC_URL, todoistProvider } from './todoist/provider.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (res: Response): Promise<any> => res.json();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Todoist', () => {
  /** A Todoist Sync API that keeps tasks in memory and checks the token. */
  function fakeTodoist() {
    let n = 100;
    const items: Array<{ id: string; content: string; project_id: string; checked: boolean }> = [
      { id: '1', content: 'Fix the fence', project_id: 'P1', checked: false },
      { id: '2', content: 'Elsewhere', project_id: 'P2', checked: false },
    ];
    const seen: string[] = [];
    const doFetch = (async (url: string, init: RequestInit) => {
      expect(url).toBe(TODOIST_SYNC_URL);
      if ((init.headers as Record<string, string>).authorization !== 'Bearer tok')
        return new Response('', { status: 401 });
      const form = new URLSearchParams(String(init.body));
      if (form.get('sync_token') === '*') {
        const types = JSON.parse(form.get('resource_types')!) as string[];
        return Response.json({
          ...(types.includes('projects')
            ? {
                projects: [
                  { id: 'P1', name: 'Home' },
                  { id: 'P0', name: 'Inbox', inbox_project: true },
                ],
              }
            : {}),
          ...(types.includes('items') ? { items: items.filter((i) => !i.checked) } : {}),
        });
      }
      const [cmd] = JSON.parse(form.get('commands')!) as Array<{
        type: string;
        uuid: string;
        temp_id?: string;
        args: Record<string, string>;
      }>;
      seen.push(cmd!.type);
      const mapping: Record<string, string> = {};
      const item = items.find((i) => i.id === cmd!.args.id);
      if (cmd!.type === 'item_add') {
        const id = String(++n);
        items.push({
          id,
          content: cmd!.args.content!,
          project_id: cmd!.args.project_id!,
          checked: false,
        });
        mapping[cmd!.temp_id!] = id;
      } else if (cmd!.type === 'item_update') item!.content = cmd!.args.content!;
      else if (cmd!.type === 'item_close') item!.checked = true;
      else if (cmd!.type === 'item_uncomplete') item!.checked = false;
      else if (cmd!.type === 'item_delete') items.splice(items.indexOf(item!), 1);
      return Response.json({ sync_status: { [cmd!.uuid]: 'ok' }, temp_id_mapping: mapping });
    }) as unknown as typeof fetch;
    return { items, seen, doFetch };
  }

  it('lists projects and syncs a list both ways', async () => {
    const t = fakeTodoist();
    const db = openDb(':memory:');
    const store = new ListStore(db);
    const list = store.createList('To-do');
    store.addItem(list.id, { text: 'Call about gutter' });
    const sync = new ListSyncService(db, store);
    sync.register(todoistProvider(() => 'tok', t.doFetch));
    expect((await sync.remoteLists('todoist')).map((l) => l.name)).toEqual(['Home', 'Inbox']);
    const link = await sync.linkList(list.id, 'todoist', 'P1');
    expect(link).toMatchObject({ state: 'ok', remoteName: 'Home' });
    expect(t.items.filter((i) => i.project_id === 'P1').map((i) => i.content)).toEqual([
      'Fix the fence',
      'Call about gutter',
    ]);
    // Ticked in Todoist: it disappears there and is ticked here.
    t.items.find((i) => i.content === 'Fix the fence')!.checked = true;
    await sync.sync(list.id);
    expect(store.itemsForSync(list.id).find((i) => i.text === 'Fix the fence')?.done).toBe(true);
    // Unticked here: reopened there.
    const fence = store.itemsForSync(list.id).find((i) => i.text === 'Fix the fence')!;
    store.patchItem(fence.id, { done: false });
    await sync.sync(list.id);
    expect(t.seen).toContain('item_uncomplete');
    expect(t.items.find((i) => i.content === 'Fix the fence')?.checked).toBe(false);
  });

  it('says plainly when the token is wrong', async () => {
    const t = fakeTodoist();
    const db = openDb(':memory:');
    const store = new ListStore(db);
    const sync = new ListSyncService(db, store);
    sync.register(todoistProvider(() => 'nope', t.doFetch));
    await expect(sync.remoteLists('todoist')).rejects.toThrow(/turned the token down/);
  });
});

describe('Home Assistant to-do lists', () => {
  function fakeHa() {
    let n = 0;
    const lists: Record<string, Array<{ uid: string; summary: string; status: string }>> = {
      'todo.shopping_list': [{ uid: 'a', summary: 'Batteries', status: 'needs_action' }],
    };
    const states = new Map<string, HaState>([
      [
        'todo.shopping_list',
        {
          entity_id: 'todo.shopping_list',
          state: '1',
          attributes: { friendly_name: 'Shopping list' },
        } as unknown as HaState,
      ],
      ['light.kitchen', { entity_id: 'light.kitchen', state: 'on', attributes: {} } as unknown as HaState],
    ]);
    const calls: string[] = [];
    const listeners: Array<(id: string, next: HaState | null, prev: HaState | null) => void> = [];
    const client: TodoClient = {
      connected: true,
      states,
      on: (_e, fn) => {
        listeners.push(fn);
        return () => {};
      },
      async request<T>(p: Record<string, unknown>): Promise<T> {
        const entity = (p.target as { entity_id: string }).entity_id;
        const data = p.service_data as Record<string, string>;
        const items = lists[entity]!;
        calls.push(String(p.service));
        if (p.service === 'get_items') {
          expect(p.return_response).toBe(true);
          return { response: { [entity]: { items: items.map((i) => ({ ...i })) } } } as T;
        }
        if (p.service === 'add_item')
          items.push({ uid: `u${++n}`, summary: data.item!, status: 'needs_action' });
        const item = items.find((i) => i.uid === data.item);
        if (p.service === 'update_item') {
          if (data.rename) item!.summary = data.rename;
          if (data.status) item!.status = data.status;
        }
        if (p.service === 'remove_item') items.splice(items.indexOf(item!), 1);
        return {} as T;
      },
    };
    return { lists, client, calls, listeners };
  }

  it('offers only todo entities and syncs both ways by uid', async () => {
    const ha = fakeHa();
    const db = openDb(':memory:');
    const store = new ListStore(db);
    const list = store.createList('Grocery');
    store.addItem(list.id, { text: 'Milk' });
    const sync = new ListSyncService(db, store);
    sync.register(haTodoProvider(() => ha.client));
    expect(await sync.remoteLists('ha-todo')).toEqual([
      { id: 'todo.shopping_list', name: 'Shopping list', detail: 'todo.shopping_list · 1 open' },
    ]);
    await sync.linkList(list.id, 'ha-todo', 'todo.shopping_list');
    expect(ha.lists['todo.shopping_list']!.map((i) => i.summary)).toEqual(['Batteries', 'Milk']);
    expect(store.itemsForSync(list.id).map((i) => i.text)).toEqual(['Milk', 'Batteries']);
    ha.lists['todo.shopping_list']![0]!.status = 'completed';
    const milk = store.itemsForSync(list.id).find((i) => i.text === 'Milk')!;
    store.patchItem(milk.id, { text: 'Oat milk' });
    await sync.sync(list.id);
    expect(store.itemsForSync(list.id).find((i) => i.text === 'Batteries')?.done).toBe(true);
    expect(ha.lists['todo.shopping_list']!.map((i) => i.summary)).toContain('Oat milk');
  });

  it('a state change in Home Assistant starts a round', async () => {
    const ha = fakeHa();
    const db = openDb(':memory:');
    const store = new ListStore(db);
    const list = store.createList('Grocery');
    const sync = new ListSyncService(db, store);
    sync.register(haTodoProvider(() => ha.client));
    await sync.linkList(list.id, 'ha-todo', 'todo.shopping_list');
    ha.lists['todo.shopping_list']!.push({ uid: 'z', summary: 'Eggs', status: 'needs_action' });
    ha.listeners.forEach((fn) =>
      fn('todo.shopping_list', { state: '2' } as HaState, { state: '1' } as HaState),
    );
    await wait(10);
    expect(store.itemsForSync(list.id).map((i) => i.text)).toContain('Eggs');
    sync.stop();
  });
});

describe('Apple Reminders through the Mac helper', () => {
  function setup() {
    const db = openDb(':memory:');
    const store = new ListStore(db);
    const list = store.createList('Grocery');
    store.addItem(list.id, { text: 'Milk' });
    const sync = new ListSyncService(db, store);
    const bridge = new RemindersBridge(db, store, sync);
    sync.register(bridge.provider());
    const helper = { name: "Jay's MacBook", version: '1.0.0' };
    const lists = [{ id: 'X1', name: 'Groceries', detail: 'Shared' }];
    return { db, store, list, sync, bridge, helper, lists };
  }

  it('is waiting until the helper checks in, then offers its lists', async () => {
    const s = setup();
    expect(s.sync.providerInfo()[0]).toMatchObject({ id: 'reminders', ready: false });
    const first = await s.bridge.checkIn({ helper: s.helper, lists: s.lists });
    expect(first).toEqual({ linked: [], ops: [], nextSeconds: 10 });
    expect(s.sync.providerInfo()[0]).toMatchObject({
      ready: true,
      summary: "Jay's MacBook checked in just now",
    });
    expect(await s.sync.remoteLists('reminders')).toEqual(s.lists);
  });

  it('links, hands the helper ops, and takes the new ids back', async () => {
    const s = setup();
    await s.bridge.checkIn({ helper: s.helper, lists: s.lists });
    const link = await s.sync.linkList(s.list.id, 'reminders', 'X1');
    expect(link).toMatchObject({ remoteName: 'Groceries', state: 'waiting' });

    const r1 = await s.bridge.checkIn({ helper: s.helper, lists: s.lists, snapshots: {} });
    expect(r1.linked).toEqual(['X1']);
    const r2 = await s.bridge.checkIn({
      helper: s.helper,
      lists: s.lists,
      snapshots: { X1: [{ id: 'rem-1', text: 'Eggs', done: false }] },
    });
    expect(r2.ops).toEqual([
      {
        op: 'add',
        remoteListId: 'X1',
        tempId: expect.stringMatching(/^new:/),
        text: 'Milk',
        done: false,
      },
    ]);
    expect(r2.nextSeconds).toBe(2);
    expect(s.store.itemsForSync(s.list.id).map((i) => i.text)).toEqual(['Milk', 'Eggs']);
    expect(s.sync.link(s.list.id)).toMatchObject({ state: 'ok' });

    const tempId = (r2.ops[0] as { tempId: string }).tempId;
    const r3 = await s.bridge.checkIn({
      helper: s.helper,
      lists: s.lists,
      created: [{ tempId, remoteId: 'rem-2', remoteListId: 'X1' }],
      snapshots: {
        X1: [
          { id: 'rem-1', text: 'Eggs', done: true },
          { id: 'rem-2', text: 'Milk', done: false },
        ],
      },
    });
    expect(r3.ops).toEqual([]);
    expect(s.store.itemsForSync(s.list.id).find((i) => i.text === 'Eggs')?.done).toBe(true);

    // A tick on the wall becomes an update op on the next check-in.
    const milk = s.store.itemsForSync(s.list.id).find((i) => i.text === 'Milk')!;
    s.store.patchItem(milk.id, { done: true });
    const r4 = await s.bridge.checkIn({
      helper: s.helper,
      lists: s.lists,
      snapshots: {
        X1: [
          { id: 'rem-1', text: 'Eggs', done: true },
          { id: 'rem-2', text: 'Milk', done: false },
        ],
      },
    });
    expect(r4.ops).toEqual([{ op: 'update', remoteListId: 'X1', remoteId: 'rem-2', done: true }]);
  });

  it('asks again for an add the helper never confirmed', async () => {
    const s = setup();
    await s.bridge.checkIn({ helper: s.helper, lists: s.lists });
    await s.sync.linkList(s.list.id, 'reminders', 'X1');
    const r1 = await s.bridge.checkIn({ helper: s.helper, lists: s.lists, snapshots: { X1: [] } });
    const r2 = await s.bridge.checkIn({ helper: s.helper, lists: s.lists, snapshots: { X1: [] } });
    expect(r1.ops).toHaveLength(1);
    expect(r2.ops).toHaveLength(1);
    expect(r2.ops[0]).toMatchObject({ op: 'add', text: 'Milk' });
    expect(s.store.itemsForSync(s.list.id).map((i) => i.text)).toEqual(['Milk']);
  });

  it('the Shortcuts route adds new items and ticks ones that have left Reminders since the last push', () => {
    const s = setup();
    expect(s.bridge.shortcut('grocery', '• Milk\n- Eggs\nBread\n')).toMatchObject({
      added: 2,
      ticked: 0,
    });
    expect(s.bridge.shortcut('Grocery', ['Bread'])).toMatchObject({ added: 0, ticked: 2 });
    const items = s.store.itemsForSync(s.list.id);
    expect(items.map((i) => `${i.text}${i.done ? ' ✓' : ''}`)).toEqual([
      'Milk ✓',
      'Eggs ✓',
      'Bread',
    ]);
    expect(() => s.bridge.shortcut('Nope', [])).toThrow(/not found/);
  });
});

describe('routes (mock mode)', () => {
  const mock = createApp(loadConfig({ MOCK: '1', DATA_DIR: ':memory:' }));
  afterAll(() => mock.close());
  const req = (method: string, path: string, body?: unknown) =>
    mock.app.request(`/api${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it('shows two linked lists with a status and three services', async () => {
    await wait(20);
    const res = await json(await req('GET', '/lists/sync'));
    expect(res.providers.map((p: { id: string }) => p.id)).toEqual([
      'reminders',
      'todoist',
      'ha-todo',
    ]);
    expect(res.links).toEqual([
      expect.objectContaining({
        listId: 'list-grocery',
        provider: 'reminders',
        remoteName: 'Groceries',
        state: 'ok',
      }),
      expect.objectContaining({
        listId: 'list-todo',
        provider: 'todoist',
        remoteName: 'Home',
        state: 'ok',
      }),
    ]);
    const lists = await json(await req('GET', '/lists'));
    const grocery = lists.lists.find((l: { id: string }) => l.id === 'list-grocery');
    expect(grocery.items.map((i: { text: string }) => i.text)).toContain('Paper towels');
  });

  it('links, syncs and unlinks over the API', async () => {
    const remote = await json(await req('GET', '/lists/sync/ha-todo/lists'));
    expect(remote.lists[0]).toMatchObject({ id: 'todo.shopping_list' });
    const linked = await json(
      await req('PUT', '/lists/list-chores/link', {
        provider: 'ha-todo',
        remoteListId: 'todo.shopping_list',
      }),
    );
    expect(linked.link).toMatchObject({ remoteName: 'Shopping list', state: 'ok' });
    const now = await json(await req('POST', '/lists/list-chores/link/sync'));
    expect(now.link.state).toBe('ok');
    expect((await req('DELETE', '/lists/list-chores/link')).status).toBe(200);
    expect((await req('GET', '/lists/sync/nope/lists')).status).toBe(400);
  });

  it('takes a Shortcuts push', async () => {
    const res = await json(
      await req('POST', '/lists/sync/shortcut', { list: 'chores', items: ['Walk Mochi'] }),
    );
    expect(res).toMatchObject({ ok: true, listId: 'list-chores', added: 1 });
  });
});
