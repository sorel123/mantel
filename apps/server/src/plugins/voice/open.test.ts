import { DEVICE_KEY_HEADER } from '@mantel/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { loadConfig } from '../../config.js';

const real = createApp(loadConfig({ DATA_DIR: ':memory:' }));
const mock = createApp(loadConfig({ MOCK: '1', DATA_DIR: ':memory:' }));
afterAll(() => {
  real.close();
  mock.close();
});

type App = typeof real;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const call = async (
  app: App,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Json; text: string }> => {
  const res = await app.app.request(path.startsWith('/mcp') ? path : `/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: Json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* text */
  }
  return { status: res.status, json, text };
};
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

describe('API tokens (real mode)', () => {
  let deviceKey = '';
  beforeAll(async () => {
    // First run: set the PIN, then pair a display with it.
    expect((await call(real, 'POST', '/admin/pin', { pin: '2468' })).status).toBe(200);
    const paired = await call(real, 'POST', '/pair', { pin: '2468', name: 'Wall' });
    deviceKey = paired.json.deviceKey;
  });
  const device = () => ({ [DEVICE_KEY_HEADER]: deviceKey });

  it('needs the admin PIN to make a token', async () => {
    const wrong = await call(
      real,
      'POST',
      '/open/tokens',
      { name: 'X', scopes: ['read'], pin: '0000' },
      device(),
    );
    expect(wrong.status).toBe(403);
    const none = await call(
      real,
      'POST',
      '/open/tokens',
      { name: 'X', scopes: ['read'] },
      device(),
    );
    expect(none.status).toBe(403);
  });

  it('shows the secret once, stores only a hash and lists the token', async () => {
    const made = await call(
      real,
      'POST',
      '/open/tokens',
      { name: 'Siri', scopes: ['read', 'capture'], pin: '2468' },
      device(),
    );
    expect(made.status).toBe(200);
    expect(made.json.secret).toMatch(/^mtl_[A-Za-z0-9_-]{40,}$/);
    expect(made.json.token.prefix).toBe(made.json.secret.slice(0, 8));
    const list = await call(real, 'GET', '/open/tokens', undefined, device());
    expect(list.text).not.toContain(made.json.secret);
    expect(list.json.tokens.map((t: Json) => t.name)).toContain('Siri');
  });

  it('enforces scopes on every route', async () => {
    const make = async (scopes: string[]) =>
      (
        await call(
          real,
          'POST',
          '/open/tokens',
          { name: scopes.join('+'), scopes, pin: '2468' },
          device(),
        )
      ).json.secret as string;
    const read = await make(['read']);
    const lists = await make(['lists']);
    const admin = await make(['admin']);

    const { json } = await call(real, 'GET', '/lists', undefined, bearer(read));
    expect(Array.isArray(json.lists)).toBe(true);
    const listId = (await call(real, 'POST', '/lists', { name: 'Grocery' }, device())).json.list.id;

    // read cannot write; lists can; neither reaches settings or devices; admin reaches everything.
    expect(
      (await call(real, 'POST', `/lists/${listId}/items`, { text: 'Milk' }, bearer(read))).status,
    ).toBe(403);
    expect(
      (await call(real, 'POST', `/lists/${listId}/items`, { text: 'Milk' }, bearer(lists))).status,
    ).toBe(200);
    expect((await call(real, 'GET', '/settings', undefined, bearer(read))).status).toBe(403);
    expect((await call(real, 'GET', '/devices', undefined, bearer(lists))).status).toBe(403);
    expect((await call(real, 'GET', '/open/tokens', undefined, bearer(read))).status).toBe(403);
    expect((await call(real, 'GET', '/settings', undefined, bearer(admin))).status).toBe(200);
    // A made-up token is refused outright.
    expect((await call(real, 'GET', '/lists', undefined, bearer('mtl_nope'))).status).toBe(401);
  });

  it('a revoked token stops at once', async () => {
    const made = await call(
      real,
      'POST',
      '/open/tokens',
      { name: 'Old', scopes: ['read'], pin: '2468' },
      device(),
    );
    expect((await call(real, 'GET', '/lists', undefined, bearer(made.json.secret))).status).toBe(
      200,
    );
    expect(
      (
        await call(
          real,
          'POST',
          `/open/tokens/${made.json.token.id}/revoke`,
          { pin: '2468' },
          device(),
        )
      ).status,
    ).toBe(200);
    expect((await call(real, 'GET', '/lists', undefined, bearer(made.json.secret))).status).toBe(
      401,
    );
    const listed = (await call(real, 'GET', '/open/tokens', undefined, device())).json.tokens.find(
      (t: Json) => t.id === made.json.token.id,
    );
    expect(listed.revokedAt).not.toBeNull();
    expect(listed.lastUsedAt).not.toBeNull();
  });

  it('device keys keep working unchanged', async () => {
    expect((await call(real, 'GET', '/settings', undefined, device())).status).toBe(200);
    expect((await call(real, 'GET', '/settings')).status).toBe(401);
  });

  it('say adds to the grocery list and speaks back; a read token cannot say', async () => {
    const capture = (
      await call(
        real,
        'POST',
        '/open/tokens',
        { name: 'Voice', scopes: ['capture'], pin: '2468' },
        device(),
      )
    ).json.secret;
    const read = (
      await call(
        real,
        'POST',
        '/open/tokens',
        { name: 'R', scopes: ['read'], pin: '2468' },
        device(),
      )
    ).json.secret;
    const said = await call(real, 'POST', '/say', { text: 'eggs and butter' }, bearer(capture));
    expect(said.status).toBe(200);
    expect(said.json).toMatchObject({
      ok: true,
      speech: 'Added eggs and butter to Grocery.',
      parser: 'rules',
    });
    const lists = (await call(real, 'GET', '/lists', undefined, device())).json.lists;
    expect(lists[0].items.map((i: Json) => i.text)).toEqual(
      expect.arrayContaining(['Eggs', 'Butter']),
    );
    expect((await call(real, 'POST', '/say', { text: 'milk' }, bearer(read))).status).toBe(403);
    const note = await call(real, 'POST', '/say', { text: 'note: back at 5' }, bearer(capture));
    expect(note.json.speech).toBe('Posted your note on the wall.');
    const notes = (await call(real, 'GET', '/notes', undefined, device())).json.notes;
    expect(notes[0].text).toBe('Back at 5');
  });

  it('a lists-only token may add items by voice but not events', async () => {
    const lists = (
      await call(
        real,
        'POST',
        '/open/tokens',
        { name: 'L', scopes: ['lists'], pin: '2468' },
        device(),
      )
    ).json.secret;
    expect(
      (await call(real, 'POST', '/say', { text: 'add bread to grocery' }, bearer(lists))).status,
    ).toBe(200);
    expect(
      (await call(real, 'POST', '/say', { text: 'dentist Tuesday at 3' }, bearer(lists))).status,
    ).toBe(403);
  });
});

describe('natural add, Siri summary, Home Assistant state and MCP (mock mode)', () => {
  let token = '';
  beforeAll(async () => {
    token = (
      await call(mock, 'POST', '/open/tokens', { name: 'Claude', scopes: ['read', 'capture'] })
    ).json.secret;
  });

  it('adds an event and a meal', async () => {
    const ev = await call(mock, 'POST', '/say', { text: 'dentist tomorrow at 3' }, bearer(token));
    expect(ev.json).toMatchObject({
      ok: true,
      action: { kind: 'event', title: 'Dentist', start: '15:00' },
    });
    expect(ev.json.speech).toBe('Added Dentist tomorrow at 3 PM.');
    const meal = await call(
      mock,
      'POST',
      '/say',
      { text: 'tacos for dinner tomorrow' },
      bearer(token),
    );
    expect(meal.json).toMatchObject({
      ok: true,
      action: { kind: 'meal', slot: 'dinner', title: 'Tacos' },
    });
  });

  it('a dry run changes nothing', async () => {
    const before = (await call(mock, 'GET', '/lists')).json.lists[0].items.length;
    const r = await call(mock, 'POST', '/say', { text: 'pickles', dryRun: true }, bearer(token));
    expect(r.json).toMatchObject({ ok: true, dryRun: true });
    expect(r.json.speech).toMatch(/^Would add pickles to /);
    expect((await call(mock, 'GET', '/lists')).json.lists[0].items.length).toBe(before);
  });

  it('reads the day out loud as plain text', async () => {
    const r = await call(mock, 'GET', '/today.txt', undefined, bearer(token));
    expect(r.status).toBe(200);
    expect(r.text).toMatch(/^Today is \w+day, \w+ \d+\./);
    const tomorrow = await call(
      mock,
      'GET',
      '/today.txt?day=tomorrow&format=json',
      undefined,
      bearer(token),
    );
    expect(tomorrow.json.text).toMatch(/^Tomorrow is/);
  });

  it('answers the Home Assistant state, with chores done in the activity feed', async () => {
    await call(mock, 'POST', '/chores/chore-bed-leo/done');
    await new Promise((r) => setTimeout(r, 1000));
    const r = await call(mock, 'GET', '/open/state', undefined, bearer(token));
    expect(r.status).toBe(200);
    expect(r.json.people.length).toBeGreaterThan(0);
    expect(r.json.lists.length).toBeGreaterThan(0);
    expect(r.json.calendars.length).toBeGreaterThan(0);
    expect(
      r.json.activity.some((a: Json) => a.type === 'chore_done' && a.personName === 'Leo'),
    ).toBe(true);
  });

  it('speaks MCP: initialize, tools by scope, and a call', async () => {
    const rpc = (method: string, params?: unknown, t = token) =>
      call(mock, 'POST', '/mcp', { jsonrpc: '2.0', id: 1, method, params }, bearer(t));
    const init = await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 't', version: '1' },
    });
    expect(init.json.result).toMatchObject({
      protocolVersion: '2025-06-18',
      serverInfo: { name: 'mantel' },
    });
    const note = await call(
      mock,
      'POST',
      '/mcp',
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      bearer(token),
    );
    expect(note.status).toBe(202);

    const names = (await rpc('tools/list')).json.result.tools.map((t: Json) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(['get_agenda', 'get_lists', 'add_items', 'say', 'post_note']),
    );
    // read + capture: no chore ticking.
    expect(names).not.toContain('complete_chore');

    const added = await rpc('tools/call', { name: 'add_items', arguments: { items: ['Limes'] } });
    expect(added.json.result).toMatchObject({ isError: false });
    expect(added.json.result.content[0].text).toMatch(/^Added Limes to /);
    const lists = await rpc('tools/call', { name: 'get_lists', arguments: {} });
    expect(lists.json.result.content[0].text).toContain('Limes');
    const bad = await rpc('tools/call', {
      name: 'add_event',
      arguments: { title: 'X', date: 'soon' },
    });
    expect(bad.json.result.isError).toBe(true);
    const refused = await rpc('tools/call', { name: 'complete_chore', arguments: { chore: 'x' } });
    expect(refused.json.error.code).toBe(-32602);
  });
});

describe('MCP auth (real mode)', () => {
  it('asks for a token', async () => {
    const r = await call(real, 'POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(r.status).toBe(401);
    expect((await call(real, 'GET', '/mcp')).status).toBe(405);
  });
});
