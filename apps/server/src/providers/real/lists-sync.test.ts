import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../db/index.js';
import { ListStore } from './lists-store.js';
import { ListSyncService } from './lists-sync.js';
import { FakeListProvider } from './lists-sync-fake.js';

let t = new Date(2026, 10, 4, 9).getTime();
const now = () => new Date(t);
const later = (mins = 1) => {
  t += mins * 60_000;
};

function setup(includesDone = true) {
  const db = openDb(':memory:');
  const store = new ListStore(db, now);
  const list = store.createList('Grocery');
  const fake = new FakeListProvider(includesDone ? 'reminders' : 'todoist', includesDone);
  fake.pollSeconds = 60;
  fake.at(now()).addList('R1', 'Groceries', ['Bread']);
  const sync = new ListSyncService(db, store, { now, debounceMs: 0 });
  sync.register(fake);
  const texts = () =>
    store
      .itemsForSync(list.id)
      .map((i) => `${i.text}${i.done ? ' ✓' : ''}`)
      .sort();
  const remote = () =>
    fake
      .items('R1')
      .map((i) => `${i.text}${i.done ? ' ✓' : ''}`)
      .sort();
  const item = (text: string) => store.itemsForSync(list.id).find((i) => i.text === text)!;
  return { db, store, list, fake, sync, texts, remote, item };
}

beforeEach(() => {
  t = new Date(2026, 10, 4, 9).getTime();
});

describe('linking', () => {
  it('copies both ways on the first round and pairs items with the same text', async () => {
    const s = setup();
    s.store.addItem(s.list.id, { text: 'Milk' });
    s.store.addItem(s.list.id, { text: 'bread ' });
    const link = await s.sync.linkList(s.list.id, s.fake.id, 'R1');
    expect(link).toMatchObject({
      state: 'ok',
      remoteName: 'Groceries',
      summary: 'Synced just now',
    });
    expect(s.texts()).toEqual(['Milk', 'bread']);
    expect(s.remote()).toEqual(['Bread', 'Milk']);
  });

  it('does not copy items that were already ticked', async () => {
    const s = setup();
    s.fake.put('R1', 'Old eggs', true);
    s.store.addItem(s.list.id, { text: 'Old jam' }, { done: true });
    await s.sync.linkList(s.list.id, s.fake.id, 'R1');
    expect(s.texts()).toEqual(['Bread', 'Old jam ✓']);
    expect(s.remote()).toEqual(['Bread', 'Old eggs ✓']);
  });

  it('refuses to share one remote list with two Mantel lists', async () => {
    const s = setup();
    const other = s.store.createList('Costco');
    await s.sync.linkList(s.list.id, s.fake.id, 'R1');
    await expect(s.sync.linkList(other.id, s.fake.id, 'R1')).rejects.toThrow(/already shared/);
  });

  it('unlinking leaves both lists as they are', async () => {
    const s = setup();
    await s.sync.linkList(s.list.id, s.fake.id, 'R1');
    s.sync.unlink(s.list.id);
    s.store.addItem(s.list.id, { text: 'Tea' });
    expect(s.sync.links()).toEqual([]);
    expect(s.remote()).toEqual(['Bread']);
  });
});

describe('two-way sync', () => {
  it('carries adds, ticks, renames and deletes from Mantel to the service', async () => {
    const s = setup();
    await s.sync.linkList(s.list.id, s.fake.id, 'R1');
    s.store.addItem(s.list.id, { text: 'Apples' });
    s.store.patchItem(s.item('Bread').id, { done: true });
    await s.sync.sync(s.list.id);
    expect(s.remote()).toEqual(['Apples', 'Bread ✓']);
    s.store.patchItem(s.item('Apples').id, { text: 'Green apples' });
    await s.sync.sync(s.list.id);
    expect(s.remote()).toEqual(['Bread ✓', 'Green apples']);
    s.store.deleteItem(s.item('Green apples').id);
    await s.sync.sync(s.list.id);
    expect(s.remote()).toEqual(['Bread ✓']);
  });

  it('carries adds, ticks, renames and deletes from the service to Mantel', async () => {
    const s = setup();
    await s.sync.linkList(s.list.id, s.fake.id, 'R1');
    s.fake.put('R1', 'Butter');
    s.fake.edit('R1', 'Bread', { done: true });
    await s.sync.sync(s.list.id);
    expect(s.texts()).toEqual(['Bread ✓', 'Butter']);
    s.fake.edit('R1', 'Butter', { text: 'Salted butter' });
    await s.sync.sync(s.list.id);
    expect(s.texts()).toEqual(['Bread ✓', 'Salted butter']);
    s.fake.drop('R1', 'Salted butter');
    await s.sync.sync(s.list.id);
    expect(s.texts()).toEqual(['Bread ✓']);
  });

  it('a round with nothing new changes nothing on either side', async () => {
    const s = setup();
    await s.sync.linkList(s.list.id, s.fake.id, 'R1');
    s.fake.calls.length = 0;
    await s.sync.sync(s.list.id);
    await s.sync.sync(s.list.id);
    expect(s.fake.calls).toEqual(['pull', 'pull']);
  });

  it('a service that hides ticked items: gone there means ticked here, and unticking reopens it', async () => {
    const s = setup(false);
    await s.sync.linkList(s.list.id, s.fake.id, 'R1');
    s.fake.edit('R1', 'Bread', { done: true });
    await s.sync.sync(s.list.id);
    expect(s.texts()).toEqual(['Bread ✓']);
    s.store.patchItem(s.item('Bread').id, { done: false });
    await s.sync.sync(s.list.id);
    expect(s.remote()).toEqual(['Bread']);
    // and a tick made here closes it there
    s.store.patchItem(s.item('Bread').id, { done: true });
    await s.sync.sync(s.list.id);
    expect(s.remote()).toEqual(['Bread ✓']);
    await s.sync.sync(s.list.id);
    expect(s.texts()).toEqual(['Bread ✓']);
  });
});

describe('conflicts', () => {
  it('both renamed: the later change wins', async () => {
    const s = setup();
    await s.sync.linkList(s.list.id, s.fake.id, 'R1');
    later();
    s.store.patchItem(s.item('Bread').id, { text: 'Rye bread' });
    s.fake.at(new Date(t + 60_000)).edit('R1', 'Bread', { text: 'Sourdough' });
    await s.sync.sync(s.list.id);
    expect(s.texts()).toEqual(['Sourdough']);
    expect(s.remote()).toEqual(['Sourdough']);

    later(5);
    s.fake.at(new Date(t - 60_000)).edit('R1', 'Sourdough', { text: 'Bagels' });
    s.store.patchItem(s.item('Sourdough').id, { text: 'Brioche' });
    await s.sync.sync(s.list.id);
    expect(s.texts()).toEqual(['Brioche']);
    expect(s.remote()).toEqual(['Brioche']);
  });

  it('a tick is never lost to a rename on the other side', async () => {
    const s = setup();
    await s.sync.linkList(s.list.id, s.fake.id, 'R1');
    s.store.patchItem(s.item('Bread').id, { done: true });
    s.fake.at(new Date(t + 60_000)).edit('R1', 'Bread', { text: 'Bread rolls' });
    await s.sync.sync(s.list.id);
    expect(s.texts()).toEqual(['Bread rolls ✓']);
    expect(s.remote()).toEqual(['Bread rolls ✓']);
  });

  it('ticked here and deleted there ends up gone', async () => {
    const s = setup();
    await s.sync.linkList(s.list.id, s.fake.id, 'R1');
    s.store.patchItem(s.item('Bread').id, { done: true });
    s.fake.drop('R1', 'Bread');
    await s.sync.sync(s.list.id);
    expect(s.texts()).toEqual([]);
  });

  it('deleted here but renamed there: the rename comes back', async () => {
    const s = setup();
    await s.sync.linkList(s.list.id, s.fake.id, 'R1');
    s.store.deleteItem(s.item('Bread').id);
    s.fake.edit('R1', 'Bread', { text: 'Bread (gluten free)' });
    await s.sync.sync(s.list.id);
    expect(s.texts()).toEqual(['Bread (gluten free)']);
    expect(s.remote()).toEqual(['Bread (gluten free)']);
  });

  it('deleted there but renamed here: the rename goes back', async () => {
    const s = setup();
    await s.sync.linkList(s.list.id, s.fake.id, 'R1');
    s.store.patchItem(s.item('Bread').id, { text: 'Pitta' });
    s.fake.drop('R1', 'Bread');
    await s.sync.sync(s.list.id);
    expect(s.texts()).toEqual(['Pitta']);
    expect(s.remote()).toEqual(['Pitta']);
  });
});

describe('echo suppression', () => {
  it("the round's own changes here do not start another round", async () => {
    const s = setup();
    await s.sync.linkList(s.list.id, s.fake.id, 'R1');
    s.sync.start();
    s.fake.put('R1', 'Honey');
    s.fake.calls.length = 0;
    await s.sync.sync(s.list.id);
    await new Promise((r) => setTimeout(r, 20));
    expect(s.fake.calls).toEqual(['pull']);
    s.sync.stop();
  });

  it('a change here starts a round by itself', async () => {
    const s = setup();
    await s.sync.linkList(s.list.id, s.fake.id, 'R1');
    s.sync.start();
    s.store.addItem(s.list.id, { text: 'Oats' });
    await new Promise((r) => setTimeout(r, 30));
    expect(s.remote()).toEqual(['Bread', 'Oats']);
    s.sync.stop();
  });

  it('the service reporting our own write back moves nothing', async () => {
    const s = setup();
    await s.sync.linkList(s.list.id, s.fake.id, 'R1');
    s.store.addItem(s.list.id, { text: 'Oats' });
    await s.sync.sync(s.list.id);
    s.fake.calls.length = 0;
    const before = s.store.itemsForSync(s.list.id);
    await s.sync.sync(s.list.id);
    expect(s.fake.calls).toEqual(['pull']);
    expect(s.store.itemsForSync(s.list.id)).toEqual(before);
  });
});

describe('offline catch-up', () => {
  it('a failed round changes nothing and the next one carries everything made meanwhile', async () => {
    const s = setup();
    await s.sync.linkList(s.list.id, s.fake.id, 'R1');
    s.fake.offline = true;
    s.store.addItem(s.list.id, { text: 'Rice' });
    s.store.patchItem(s.item('Bread').id, { done: true });
    await expect(s.sync.sync(s.list.id)).rejects.toThrow(/offline/);
    expect(s.sync.link(s.list.id)).toMatchObject({ state: 'error' });
    s.store.addItem(s.list.id, { text: 'Beans' });
    s.fake.offline = false;
    s.fake.put('R1', 'Pasta');
    const link = await s.sync.sync(s.list.id);
    expect(link).toMatchObject({ state: 'ok', lastError: null });
    expect(s.remote()).toEqual(['Beans', 'Bread ✓', 'Pasta', 'Rice']);
    expect(s.texts()).toEqual(['Beans', 'Bread ✓', 'Pasta', 'Rice']);
  });

  it('polls linked lists on the timer when due', async () => {
    const s = setup();
    await s.sync.linkList(s.list.id, s.fake.id, 'R1');
    s.fake.put('R1', 'Lemons');
    later(2);
    await s.sync.tick();
    expect(s.texts()).toContain('Lemons');
  });
});
