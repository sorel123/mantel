import {
  ImportAnalyseResponse,
  NotesResponse,
  PushSubscriptionResponse,
  sampleImport,
  type LeaveBy,
} from '@mantel/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { cleanCandidates, analyseWithClaude, systemPrompt } from './import/claude.js';
import { eventTimes } from './import/commit.js';
import { shiftDate, wallIso, wallTime } from './import/zone.js';
import { expiryAt } from './notes/store.js';

const mock = createApp(loadConfig({ MOCK: '1', DATA_DIR: ':memory:' }));
const real = createApp(loadConfig({ DATA_DIR: ':memory:' }), { env: {} });
afterAll(() => {
  mock.close();
  real.close();
});

const req = (app: typeof mock.app, method: string, path: string, body?: unknown) =>
  app.request(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (res: Response): Promise<any> => res.json();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('zone helpers', () => {
  it('finds the instant for a wall time, across DST', () => {
    expect(wallIso('2026-07-04', '18:30', 'America/Los_Angeles')).toBe('2026-07-04T18:30:00-07:00');
    expect(wallIso('2026-01-04', '18:30', 'America/Los_Angeles')).toBe('2026-01-04T18:30:00-08:00');
    expect(wallTime('2026-11-01', '12:00', 'Europe/London').toISOString()).toBe(
      '2026-11-01T12:00:00.000Z',
    );
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('turns imported events into calendar times', () => {
    const tz = 'America/New_York';
    expect(
      eventTimes(
        { title: 'Fair', date: '2026-11-10', allDay: false, start: '18:00', personIds: [] },
        tz,
      ),
    ).toEqual({
      start: '2026-11-10T18:00:00-05:00',
      end: '2026-11-10T19:00:00-05:00',
      allDay: false,
    });
    expect(
      eventTimes(
        { title: 'Break', date: '2026-11-25', endDate: '2026-11-27', allDay: true, personIds: [] },
        tz,
      ),
    ).toMatchObject({ start: '2026-11-25T00:00:00-05:00', end: '2026-11-28T00:00:00-05:00' });
  });

  it('expires a "tonight" note at local midnight', () => {
    const now = new Date('2026-11-07T20:00:00Z'); // noon in Los Angeles
    expect(expiryAt('tonight', now, 'America/Los_Angeles')).toBe('2026-11-08T00:00:00-08:00');
    expect(expiryAt('dismiss', now, 'America/Los_Angeles')).toBeNull();
    expect(expiryAt('24h', now, 'UTC')).toBe('2026-11-08T20:00:00+00:00');
  });
});

describe('wall notes', () => {
  it('lists the sample note in mock mode, posts a text and a drawing, serves and deletes', async () => {
    const first = NotesResponse.parse(await json(await req(mock.app, 'GET', '/notes')));
    expect(first.notes.map((n) => n.id)).toContain('note-1');

    const text = await req(mock.app, 'POST', '/notes', {
      text: 'Back at 6',
      color: 'sky',
      expiry: 'tonight',
    });
    expect(text.status).toBe(200);
    const drawn = await json(
      await req(mock.app, 'POST', '/notes', { kind: 'drawing', image: PNG, expiry: 'dismiss' }),
    );
    expect(drawn.note).toMatchObject({ kind: 'drawing', hasImage: true, expiresAt: null });

    const img = await req(mock.app, 'GET', `/notes/${drawn.note.id}/image`);
    expect(img.headers.get('content-type')).toBe('image/png');
    expect((await img.arrayBuffer()).byteLength).toBeGreaterThan(20);

    expect((await req(mock.app, 'DELETE', `/notes/${drawn.note.id}`)).status).toBe(200);
    expect((await req(mock.app, 'DELETE', `/notes/${drawn.note.id}`)).status).toBe(404);
  });

  it('refuses an empty note', async () => {
    expect((await req(mock.app, 'POST', '/notes', { text: '  ' })).status).toBe(400);
    expect((await req(mock.app, 'POST', '/notes', { kind: 'drawing' })).status).toBe(400);
  });

  it('needs a key for a drawing outside mock mode', async () => {
    expect((await req(real.app, 'GET', '/notes/nope/image')).status).toBe(401);
    expect((await req(real.app, 'GET', '/notes')).status).toBe(401);
  });
});

describe('web push (mock mode, fake endpoint)', () => {
  it('hands out a VAPID key and keeps it', async () => {
    const a = await json(await req(mock.app, 'GET', '/push/config'));
    const b = await json(await req(mock.app, 'GET', '/push/config'));
    expect(a.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect(b.publicKey).toBe(a.publicKey);
  });

  it('subscribes, patches, tests and delivers the doorbell', async () => {
    const res = await req(mock.app, 'POST', '/push/subscriptions', {
      endpoint: 'https://push.example.test/abc',
      keys: { p256dh: 'BKey', auth: 'auth' },
      events: ['doorbell', 'note'],
      personId: 'jay',
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const { subscription } = PushSubscriptionResponse.parse(await json(res));
    expect(subscription).toMatchObject({ current: true, events: ['doorbell', 'note'] });

    // Subscribing the same endpoint again updates it rather than adding a row.
    await req(mock.app, 'POST', '/push/subscriptions', {
      endpoint: 'https://push.example.test/abc',
      keys: { p256dh: 'BKey', auth: 'auth' },
      events: ['doorbell'],
    });
    const list = await json(await req(mock.app, 'GET', '/push/subscriptions'));
    expect(list.subscriptions).toHaveLength(1);

    const patched = await json(
      await req(mock.app, 'PATCH', `/push/subscriptions/${subscription.id}`, {
        events: ['doorbell', 'chores'],
      }),
    );
    expect(patched.subscription.events).toEqual(['doorbell', 'chores']);

    const test = await json(
      await req(mock.app, 'POST', `/push/subscriptions/${subscription.id}/test`),
    );
    expect(test.ok).toBe(true);

    await req(mock.app, 'POST', '/dev/doorbell');
    await wait(20);
    const after = await json(await req(mock.app, 'GET', '/push/subscriptions'));
    expect(after.subscriptions[0].lastSentAt).not.toBeNull();

    expect((await req(mock.app, 'DELETE', `/push/subscriptions/${subscription.id}`)).status).toBe(
      200,
    );
  });
});

describe('push service rules', async () => {
  const { PushService } = await import('./push/service.js');
  const app = createApp(loadConfig({ MOCK: '1', DATA_DIR: ':memory:' }));
  afterAll(() => app.close());
  let chores = [
    {
      id: 'c1',
      title: 'Make bed',
      personId: 'ava',
      cadence: 'daily' as const,
      stars: 1,
      doneCount: 0,
      target: 1,
    },
    {
      id: 'c2',
      title: 'Feed Mochi',
      personId: 'ava',
      cadence: 'daily' as const,
      stars: 1,
      doneCount: 0,
      target: 1,
    },
  ];
  const now = new Date('2026-11-07T15:00:00Z');
  const svc = new PushService({
    db: app.deps.db,
    secrets: app.deps.secrets,
    now: () => now,
    people: () => [
      { id: 'ava', name: 'Ava', initial: 'A', color: '#f00', calendarIds: [] },
      { id: 'jay', name: 'Jay', initial: 'J', color: '#00f', calendarIds: [] },
    ],
    deviceName: () => 'Phone',
    mock: true,
  });
  const sub = (endpoint: string, personId: string | null) =>
    svc.subscribe('dev-1', {
      endpoint,
      keys: { p256dh: 'k', auth: 'a' },
      events: ['chores', 'leaveBy'],
      personId,
    });
  const jay = sub('https://push.example.test/jay', 'jay');
  const ava = sub('https://push.example.test/ava', 'ava');

  it("tells other people's phones when a chore is finished", async () => {
    await svc.primeChores(async () => ({ chores }));
    chores = chores.map((c) => (c.id === 'c1' ? { ...c, doneCount: 1 } : c));
    await (svc as unknown as { choresChanged: (l: unknown) => Promise<void> }).choresChanged(
      async () => ({ chores }),
    );
    expect(svc.outbox.map((o) => o.subscriptionId)).toEqual([jay.id]);
    expect(svc.outbox[0]!.message).toMatchObject({ title: 'Ava did a chore', body: 'Make bed' });

    chores = chores.map((c) => ({ ...c, doneCount: 1 }));
    await (svc as unknown as { choresChanged: (l: unknown) => Promise<void> }).choresChanged(
      async () => ({ chores }),
    );
    expect(svc.outbox.at(-1)!.message.title).toBe('Ava finished every chore');
  });

  it('warns ten minutes before a leave-by time, once, to the right phones', async () => {
    svc.outbox.length = 0;
    const trip: LeaveBy = {
      destinationId: 'school',
      name: 'School',
      leaveBy: new Date(now.getTime() + 10 * 60_000).toISOString(),
      arriveBy: new Date(now.getTime() + 30 * 60_000).toISOString(),
      durationMinutes: 18,
      delayMinutes: 4,
      personIds: ['ava'],
    };
    await svc.leaveByTick([trip]);
    await svc.leaveByTick([trip]);
    expect(svc.outbox.map((o) => o.subscriptionId)).toEqual([ava.id]);
    expect(svc.outbox[0]!.message.title).toBe('Leave for School in 10 minutes');
    await svc.leaveByTick([
      {
        ...trip,
        destinationId: 'far',
        leaveBy: new Date(now.getTime() + 40 * 60_000).toISOString(),
      },
    ]);
    expect(svc.outbox).toHaveLength(1);
  });

  it('drops a subscription the push service says is gone', async () => {
    const gone = new PushService({
      db: app.deps.db,
      secrets: app.deps.secrets,
      now: () => now,
      people: () => [],
      deviceName: () => 'Phone',
      mock: false,
      sender: async () => {
        throw Object.assign(new Error('Gone'), { statusCode: 410 });
      },
    });
    const r = await gone.test(jay.id);
    expect(r.ok).toBe(false);
    expect(gone.get(jay.id, null)).toBeNull();
  });
});

describe('magic import', () => {
  it('reads every photo as the sample flyer in mock mode, and commits it', async () => {
    const status = await json(await req(mock.app, 'GET', '/import/status'));
    expect(status).toMatchObject({ ready: true, mock: true });
    const res = await req(mock.app, 'POST', '/import/analyse', { image: PNG, hint: 'events' });
    expect(res.status, await res.clone().text()).toBe(200);
    const found = ImportAnalyseResponse.parse(await json(res));
    expect(found.events.length).toBeGreaterThan(0);

    const commit = await json(await req(mock.app, 'POST', '/import/commit', found));
    expect(commit.events).toHaveLength(found.events.length);
    expect(commit.items).toBe(found.items.length);
    // The mock has a Meals calendar it can write to.
    expect(commit.meals + commit.problems.length).toBeGreaterThan(0);
    const lists = await json(await req(mock.app, 'GET', '/lists'));
    const grocery = lists.lists.find((l: { id: string }) => l.id === 'list-grocery');
    expect(grocery.items.map((i: { text: string }) => i.text)).toContain('Poster board');
  });

  it('refuses a non-image', async () => {
    expect((await req(mock.app, 'POST', '/import/analyse', { image: 'hello' })).status).toBe(400);
  });

  it('says plainly that a key is needed outside mock mode', async () => {
    const fresh = createApp(loadConfig({ DATA_DIR: ':memory:' }), { env: {} });
    const { deviceKey } = fresh.deps.auth.pairLocal('Test');
    const r = (path: string, body?: unknown) =>
      fresh.app.request(`/api${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'content-type': 'application/json', 'x-mantel-device-key': deviceKey },
        body: body ? JSON.stringify(body) : undefined,
      });
    expect(await json(await r('/import/status'))).toMatchObject({ ready: false });
    const res = await r('/import/analyse', { image: PNG });
    expect(res.status).toBe(403);
    expect((await json(res)).error.message).toMatch(/Claude key/);
    fresh.close();
  });

  it('keeps only valid candidates from Claude, matching people and lists', () => {
    const people = [{ id: 'ava', name: 'Ava', initial: 'A', color: '#f00', calendarIds: [] }];
    const lists = [{ id: 'list-grocery', name: 'Grocery', source: 'local' as const, items: [] }];
    const out = cleanCandidates(
      {
        summary: '',
        events: [
          {
            title: 'Fair',
            date: '2026-11-10',
            allDay: false,
            start: '18:00',
            end: '',
            location: '',
            people: ['ava', 'ghost'],
            notes: '',
          },
          { title: 'Bad date', date: 'next week', allDay: true },
          { title: '', date: '2026-11-10', allDay: true },
        ],
        items: [
          { list: 'grocery', text: 'Glue' },
          { list: 'Party', text: 'Balloons' },
          { list: 'x', text: '' },
        ],
        meals: [
          { date: '2026-11-10', slot: 'dinner', title: 'Tacos' },
          { date: '2026-11-10', slot: 'snack', title: 'x' },
        ],
      },
      people,
      lists,
    );
    expect(out.events).toEqual([
      { title: 'Fair', date: '2026-11-10', allDay: false, start: '18:00', personIds: ['ava'] },
    ]);
    expect(out.items).toEqual([
      { listId: 'list-grocery', listName: 'Grocery', text: 'Glue' },
      { listName: 'Party', text: 'Balloons' },
    ]);
    expect(out.meals).toHaveLength(1);
    expect(out.summary).toBe('Found 4 things to add.');
  });

  it('sends the photo to Claude with a schema and today, and parses the answer', async () => {
    let sent: Record<string, unknown> | null = null;
    const client = {
      beta: {
        messages: {
          create: async (body: Record<string, unknown>) => {
            sent = body;
            return {
              stop_reason: 'end_turn',
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    summary: 'A party invitation.',
                    events: [
                      {
                        title: "Mia's party",
                        date: '2026-11-14',
                        allDay: false,
                        start: '14:00',
                        end: '16:00',
                        endDate: '',
                        location: '12 Elm St',
                        people: [],
                        notes: '',
                      },
                    ],
                    items: [],
                    meals: [],
                  }),
                },
              ],
            };
          },
        },
      },
    };
    const out = await analyseWithClaude({
      apiKey: 'k',
      image: PNG,
      hint: 'auto',
      today: '2026-11-07',
      weekday: 'Saturday',
      timeZone: 'America/Los_Angeles',
      people: [],
      lists: [],
      client: client as never,
    });
    expect(out.events[0]).toMatchObject({
      title: "Mia's party",
      location: '12 Elm St',
      end: '16:00',
    });
    expect(sent!.model).toBe('claude-sonnet-5-5');
    expect(JSON.stringify(sent!.output_config)).toContain('json_schema');
    expect(JSON.stringify(sent!.messages)).toContain('"media_type":"image/png"');
    expect(
      systemPrompt({
        hint: 'meals',
        today: '2026-11-07',
        weekday: 'Saturday',
        timeZone: 'UTC',
        people: [],
        lists: [],
      }),
    ).toContain('2026-11-07');
  });

  it('the fixture parses', () => {
    ImportAnalyseResponse.parse(sampleImport());
  });
});
