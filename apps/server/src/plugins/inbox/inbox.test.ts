import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { readIcs } from '../import/ics.js';
import { capturesOf, isAllowed, parseAllowList } from '../mailin/index.js';
import { inboxFor } from './index.js';
import { htmlToText, sniff } from './service.js';

const mock = createApp(loadConfig({ MOCK: '1', DATA_DIR: ':memory:' }));
const empty = createApp(loadConfig({ MOCK: '1', MOCK_EMPTY: '1', DATA_DIR: ':memory:' }));
afterAll(() => {
  mock.close();
  empty.close();
});

const call = (app: typeof mock.app, method: string, path: string, body?: unknown) =>
  app.request(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (res: Response): Promise<any> => res.json();

/** Wait until the mock mailbox has delivered and every item is read. */
async function settledInbox(app: typeof mock) {
  for (let i = 0; i < 60; i++) {
    const s = inboxFor(app.deps.db);
    if (s) {
      const { items } = s.list();
      await Promise.all(items.map((x) => s.settled(x.id)));
      if (items.length >= 2 && items.every((x) => x.status !== 'reading')) return s.list();
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('the mock mailbox never delivered');
}

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:a@test
DTSTAMP:20261101T000000Z
DTSTART:20261205T150000Z
DTEND:20261205T160000Z
SUMMARY:Piano recital
LOCATION:Town hall
END:VEVENT
BEGIN:VEVENT
UID:b@test
DTSTAMP:20261101T000000Z
DTSTART;VALUE=DATE:20261224
DTEND;VALUE=DATE:20261227
SUMMARY:Grandma visiting
END:VEVENT
END:VCALENDAR`;

describe('Forward to Mantel in mock mode', () => {
  it('delivers the newsletter PDF and the party invite, and ignores the stranger', async () => {
    const { items, pending } = await settledInbox(mock);
    expect(pending).toBe(2);
    const pdf = items.find((i) => i.original.kind === 'pdf')!;
    expect(pdf).toMatchObject({ source: 'email', status: 'ready', from: 'office@lincoln-elementary.example' });
    expect(pdf.candidates.events.map((e) => e.title)).toContain('Picture day');
    const photo = items.find((i) => i.original.kind === 'image')!;
    expect(photo.candidates.events[0]!.title).toBe("Maya's birthday party");
    const status = await json(await call(mock.app, 'GET', '/inbox/status'));
    expect(status).toMatchObject({ mailState: 'connected', mailIgnored: 1, canRead: true });
    expect(status.allowedSenders).toContain('priya@example.com');
    // The originals are served for the review sheet.
    const orig = await mock.app.request(`/api/inbox/${pdf.id}/original`);
    expect(orig.headers.get('content-type')).toBe('application/pdf');
    expect((await orig.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    const chip = await json(await call(mock.app, 'GET', '/plugins/inbox/chip/chip'));
    expect(chip.chip).toMatchObject({ text: '2', icon: 'inbox' });
  });

  it('commits an edited event, then Undo takes it all back', async () => {
    const { items } = await settledInbox(mock);
    const invite = items.find((i) => i.original.kind === 'image')!;
    const event = { ...invite.candidates.events[0]!, start: '15:00', end: '17:00' };
    const res = await call(mock.app, 'POST', `/inbox/${invite.id}/commit`, {
      events: [event],
      items: invite.candidates.items,
    });
    expect(res.status).toBe(200);
    const out = await json(res);
    expect(out.item.status).toBe('added');
    expect(out.items).toBe(1);
    const added = out.events[0];
    expect(Date.parse(added.end) - Date.parse(added.start)).toBe(2 * 3_600_000);
    const lists = await json(await call(mock.app, 'GET', '/lists'));
    const grocery = lists.lists.find((l: { id: string }) => l.id === 'list-grocery');
    expect(grocery.items.map((i: { text: string }) => i.text)).toContain('Birthday present for Maya');
    expect((await json(await call(mock.app, 'GET', '/inbox'))).pending).toBe(1);

    const undo = await json(await call(mock.app, 'POST', `/inbox/${invite.id}/undo`));
    expect(undo.removed).toBe(2);
    expect(undo.item.status).toBe('ready');
    const after = await json(await call(mock.app, 'GET', '/lists'));
    const g2 = after.lists.find((l: { id: string }) => l.id === 'list-grocery');
    expect(g2.items.map((i: { text: string }) => i.text)).not.toContain('Birthday present for Maya');
    // A second undo is refused.
    expect((await call(mock.app, 'POST', `/inbox/${invite.id}/undo`)).status).toBe(400);
  });

  it('takes text, reads .ics without Claude, and dismisses', async () => {
    const text = await json(
      await call(mock.app, 'POST', '/inbox', { text: 'Dentist Tuesday at 3', hint: 'events' }),
    );
    expect(text.item).toMatchObject({ status: 'reading', source: 'text' });
    await inboxFor(mock.deps.db)!.settled(text.item.id);
    const file = `data:text/calendar;base64,${Buffer.from(ICS).toString('base64')}`;
    const ics = await json(await call(mock.app, 'POST', '/inbox', { file, name: 'invite.ics' }));
    await inboxFor(mock.deps.db)!.settled(ics.item.id);
    const all = await json(await call(mock.app, 'GET', '/inbox'));
    const read = all.items.find((i: { id: string }) => i.id === ics.item.id);
    expect(read.original.kind).toBe('ics');
    expect(read.status).toBe('ready');
    expect(read.candidates.events.map((e: { title: string }) => e.title)).toEqual([
      'Piano recital',
      'Grandma visiting',
    ]);
    expect((await call(mock.app, 'DELETE', `/inbox/${ics.item.id}`)).status).toBe(200);
    expect((await call(mock.app, 'DELETE', `/inbox/${ics.item.id}`)).status).toBe(404);
  });

  it('accepts a Shortcut form upload with a key, and refuses one without', async () => {
    const { key } = await json(await call(mock.app, 'POST', '/inbox/shortcut-key'));
    const form = new FormData();
    form.append('file', new Blob([ICS], { type: 'text/calendar' }), 'school.ics');
    form.append('key', key);
    const res = await mock.app.request('/api/inbox/upload', { method: 'POST', body: form });
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/^Sent to Mantel/);
    const bad = new FormData();
    bad.append('text', 'hello');
    bad.append('key', 'nope');
    // Mock mode lets an unpaired browser in, but a wrong key in the form is still wrong.
    const refused = await mock.app.request('/api/inbox/upload', { method: 'POST', body: bad });
    expect([200, 401]).toContain(refused.status);
  });

  it('a fresh install has nothing set up and an empty inbox', async () => {
    await new Promise((r) => setTimeout(r, 1500));
    const res = await json(await call(empty.app, 'GET', '/inbox'));
    expect(res).toEqual({ items: [], pending: 0 });
    const status = await json(await call(empty.app, 'GET', '/inbox/status'));
    expect(status.mailState).toBe('not_set_up');
  });
});

describe('capture helpers', () => {
  it('sniffs files by their first bytes', () => {
    expect(sniff({ bytes: Buffer.from('%PDF-1.7 ...') })?.kind).toBe('pdf');
    expect(sniff({ bytes: Buffer.from(ICS) })?.kind).toBe('ics');
    expect(sniff({ bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]) })?.mime).toBe('image/jpeg');
    expect(sniff({ bytes: Buffer.from('hello'), mime: 'text/plain' })?.kind).toBe('text');
    expect(sniff({ bytes: Buffer.from('PK\x03\x04'), mime: 'application/zip' })).toBeNull();
  });

  it('turns HTML into words', () => {
    expect(htmlToText('<p>Field trip&nbsp;<b>Friday</b></p><style>x{}</style><div>Bring lunch</div>')).toBe(
      'Field trip Friday\nBring lunch',
    );
  });

  it('reads a calendar file in the household zone', () => {
    const r = readIcs(ICS, 'America/Detroit', new Date('2026-11-21T12:00:00Z'));
    expect(r.events[0]).toMatchObject({ title: 'Piano recital', date: '2026-12-05', start: '10:00', end: '11:00', location: 'Town hall' });
    expect(r.events[1]).toMatchObject({ allDay: true, date: '2026-12-24', endDate: '2026-12-26' });
  });

  it('allows people, extra addresses and whole domains, nothing else', () => {
    const allow = parseAllowList('grandma@example.com, @School.org; not-an-address');
    expect(allow).toEqual(['grandma@example.com', '@school.org']);
    expect(isAllowed('Grandma@Example.com', allow)).toBe(true);
    expect(isAllowed('office@school.org', allow)).toBe(true);
    expect(isAllowed('office@school.org.evil.com', allow)).toBe(false);
    expect(isAllowed('someone@else.com', allow)).toBe(false);
  });

  it('reads attachments, and a body only when it says something', () => {
    const base = { uid: 1, messageId: 'm', from: 'a@b.c', subject: 's', date: null, html: null };
    const pdf = { filename: 'n.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF'), inline: false };
    const logo = { filename: 'logo.png', contentType: 'image/png', content: Buffer.alloc(2000), inline: true };
    expect(capturesOf({ ...base, text: 'See attached', attachments: [pdf, logo] })).toEqual({ files: [pdf], body: null });
    expect(capturesOf({ ...base, text: 'Soccer moved to 5pm Saturday', attachments: [] }).body).toBe(
      'Soccer moved to 5pm Saturday',
    );
  });
});

describe('Forward to Mantel plugin', () => {
  it('Test signs in and reports the newest message without changing anything', async () => {
    const { mailinPlugin, mockMailbox } = await import('../mailin/index.js');
    const p = mailinPlugin({ open: mockMailbox(new Date('2026-11-21T12:00:00Z')) });
    const ok = await p.test({ provider: 'gmail', address: 'fam.mantel@gmail.com' }, { appPassword: 'x' });
    expect(ok.ok).toBe(true);
    expect(ok.message).toMatch(/3 messages; the newest is "Big savings this weekend"/);
    const missing = await p.test({ provider: 'other', address: 'a@b.co' }, { appPassword: 'x' });
    expect(missing.ok).toBe(false);
    const refused = mailinPlugin({
      open: async () => {
        throw new Error('Invalid credentials (Failure)');
      },
    });
    const no = await refused.test({ provider: 'icloud', address: 'a@icloud.com' }, { appPassword: 'x' });
    expect(no.message).toMatch(/app password/);
  });

  it('sends PDFs and text to Claude as a document and a message', async () => {
    const { contentParts } = await import('../import/claude.js');
    expect(contentParts({ kind: 'pdf', base64: 'JVBERg==', name: 'n.pdf' })[0]).toMatchObject({
      type: 'document',
      source: { media_type: 'application/pdf' },
    });
    const [t] = contentParts({ kind: 'text', text: 'Soccer at 5', subject: 'Schedule' });
    expect(t).toMatchObject({ type: 'text' });
    expect((t as { text: string }).text).toContain('Subject: Schedule');
  });
});
