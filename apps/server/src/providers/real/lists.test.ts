import { chores as choreFixture } from '@mantel/shared/fixtures';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../config.js';
import { openDb } from '../../db/index.js';
import { SettingsStore } from '../../settings.js';
import { mockLists } from '../mock/lists.js';
import type { ProviderContext } from '../types.js';
import { ChoreStore } from './lists-chores.js';
import { ListStore } from './lists-store.js';
import { realLists } from './lists.js';

/** A movable clock: Wednesday 4 November 2026, 9 am local. */
function clock(start = new Date(2026, 10, 4, 9)) {
  let t = start.getTime();
  return {
    now: () => new Date(t),
    advanceDays: (n: number) => {
      t += n * 864e5;
    },
  };
}

function context(now: () => Date) {
  const db = openDb(':memory:');
  const events: unknown[] = [];
  const settings = new SettingsStore(db);
  const ctx: ProviderContext = {
    config: loadConfig({ DATA_DIR: ':memory:' }),
    db,
    emit: (e) => events.push(e),
    now,
    markSynced: () => {},
    settings: () => settings.get(),
  };
  return { ctx, db, events };
}

describe('ListStore', () => {
  it('seeds the default lists once', () => {
    const { db } = context(clock().now);
    const store = new ListStore(db);
    store.seedDefaults();
    expect(store.all().map((l) => l.name)).toEqual(['Grocery', 'Chores', 'To-do']);
    store.deleteList(store.all()[1]!.id);
    store.seedDefaults();
    expect(store.all().map((l) => l.name)).toEqual(['Grocery', 'To-do']);
  });

  it('adds, checks, edits and deletes items, telling listeners each time', () => {
    const c = clock();
    const { db } = context(c.now);
    const store = new ListStore(db, c.now);
    const changes: string[] = [];
    store.onChange((id) => changes.push(id));
    const list = store.createList('Grocery');
    const milk = store.addItem(list.id, { text: '  Oat milk ', personId: 'sam' });
    store.addItem(list.id, { text: 'Bananas' });
    expect(milk).toMatchObject({ text: 'Oat milk', done: false, personId: 'sam' });

    expect(store.patchItem(milk.id, { done: true, personId: null })).toEqual({
      id: milk.id,
      text: 'Oat milk',
      done: true,
    });
    store.deleteItem(store.all()[0]!.items[1]!.id);
    expect(store.all()[0]!.items.map((i) => i.text)).toEqual(['Oat milk']);
    expect(changes).toEqual(Array(5).fill(list.id));
    expect(() => store.patchItem('nope', { done: true })).toThrow(/not found/);
    expect(() => store.addItem('nope', { text: 'x' })).toThrow(/not found/);
  });

  it('hides items completed before today and prunes old ones', () => {
    const c = clock();
    const { db } = context(c.now);
    const store = new ListStore(db, c.now);
    const list = store.createList('To-do');
    const a = store.addItem(list.id, { text: 'Done yesterday' });
    store.patchItem(a.id, { done: true });
    c.advanceDays(1);
    const b = store.addItem(list.id, { text: 'Done today' });
    store.patchItem(b.id, { done: true });
    store.addItem(list.id, { text: 'Open' });
    expect(store.all()[0]!.items.map((i) => i.text)).toEqual(['Done today', 'Open']);

    // Unchecking a hidden item is still possible by id and brings it back.
    store.patchItem(a.id, { done: false });
    expect(store.all()[0]!.items).toHaveLength(3);

    store.patchItem(a.id, { done: true });
    c.advanceDays(31);
    store.prune();
    store.patchItem(store.all()[0]!.items[0]!.id, { done: false });
    expect(() => store.patchItem(a.id, { done: false })).toThrow(/not found/);
  });
});

describe('list order and the Today list', () => {
  it('reorders lists, keeping ones left out at the end', () => {
    const { db } = context(clock().now);
    const store = new ListStore(db);
    const [a, b, c] = ['A', 'B', 'C'].map((n) => store.createList(n));
    store.reorder([c!.id, 'nope', a!.id]);
    expect(store.all().map((l) => l.name)).toEqual(['C', 'A', 'B']);
    expect(b).toBeTruthy();
  });

  it('marks one list for Today at a time, and renames', () => {
    const { db } = context(clock().now);
    const store = new ListStore(db);
    const seen: string[] = [];
    store.onChange((id) => seen.push(id));
    const a = store.createList('Grocery');
    const b = store.createList('Hardware');
    expect(store.patchList(b.id, { home: true }).home).toBe(true);
    expect(store.patchList(a.id, { home: true }).home).toBe(true);
    expect(
      store
        .all()
        .filter((l) => l.home)
        .map((l) => l.name),
    ).toEqual(['Grocery']);
    store.patchList(a.id, { home: false });
    expect(store.all().some((l) => l.home)).toBe(false);
    expect(store.patchList(b.id, { name: ' Hardware store ' }).name).toBe('Hardware store');
    expect(seen).toContain(b.id);
    expect(() => store.patchList('nope', { home: true })).toThrow();
  });

  it('forgets the Today list when it is deleted', () => {
    const { db } = context(clock().now);
    const store = new ListStore(db);
    const a = store.createList('Grocery');
    store.patchList(a.id, { home: true });
    store.deleteList(a.id);
    const b = store.createList('Grocery');
    expect(store.all().find((l) => l.id === b.id)?.home).toBeUndefined();
  });
});

describe('ChoreStore', () => {
  it('counts completions, caps them at the target and tallies stars per child', () => {
    const c = clock();
    const { db } = context(c.now);
    const store = new ChoreStore(db, c.now);
    const feed = store.create({
      title: 'Feed Mochi',
      personId: 'leo',
      cadence: 'daily',
      target: 2,
    });
    store.create({ title: 'Bins', personId: 'leo', cadence: 'weekly', stars: 2 });
    store.create({ title: 'Make bed', personId: 'ava', cadence: 'daily' });

    store.done(feed.id);
    const second = store.done(feed.id);
    expect(second.chore).toMatchObject({ doneCount: 2, week: [0, 0, 2, 0, 0, 0, 0] });
    const third = store.done(feed.id);
    expect(third.chore.doneCount).toBe(2);
    expect(third.stars).toEqual([
      { personId: 'leo', stars: 2 },
      { personId: 'ava', stars: 0 },
    ]);

    // A sibling who helps gets the stars.
    const bins = store.all().chores[1]!;
    expect(store.done(bins.id, 'ava').stars).toContainEqual({ personId: 'ava', stars: 2 });
  });

  it('resets daily counts each day and the whole chart on Monday', () => {
    const c = clock();
    const { db } = context(c.now);
    const store = new ChoreStore(db, c.now);
    const bed = store.create({ title: 'Make bed', personId: 'ava', cadence: 'daily' });
    const plants = store.create({ title: 'Plants', personId: 'ava', cadence: 'weekly' });
    store.done(bed.id);
    store.done(plants.id);

    c.advanceDays(1); // Thursday
    let chart = store.all();
    expect(chart.chores[0]).toMatchObject({ doneCount: 0, week: [0, 0, 1, 0, 0, 0, 0] });
    expect(chart.chores[1]).toMatchObject({ doneCount: 1 });
    expect(store.done(plants.id).chore.doneCount).toBe(1);
    expect(chart.stars).toEqual([{ personId: 'ava', stars: 2 }]);

    c.advanceDays(4); // next Monday
    chart = store.all();
    expect(chart.weekStart).toBe('2026-11-09');
    expect(chart.chores.map((x) => x.doneCount)).toEqual([0, 0]);
    expect(chart.stars).toEqual([{ personId: 'ava', stars: 0 }]);
  });

  it('undoes the latest completion in the current period only', () => {
    const c = clock();
    const { db } = context(c.now);
    const store = new ChoreStore(db, c.now);
    const bed = store.create({ title: 'Make bed', personId: 'ava', cadence: 'daily' });
    store.done(bed.id);
    c.advanceDays(1);
    expect(store.undo(bed.id).chore.week).toEqual([0, 0, 1, 0, 0, 0, 0]);
    store.done(bed.id);
    expect(store.undo(bed.id).chore).toMatchObject({ doneCount: 0, week: [0, 0, 1, 0, 0, 0, 0] });
  });

  it('keeps stars from a retired chore', () => {
    const { db } = context(clock().now);
    const store = new ChoreStore(db);
    const bed = store.create({ title: 'Make bed', personId: 'ava', cadence: 'daily', stars: 3 });
    store.done(bed.id);
    store.archive(bed.id);
    expect(store.all().chores).toEqual([]);
    expect(store.all().stars).toEqual([{ personId: 'ava', stars: 3 }]);
    expect(() => store.done(bed.id)).toThrow(/not found/);
  });
});

describe('lists provider', () => {
  it('pushes list.changed and chores.changed and rejects unknown people', async () => {
    const { ctx, events } = context(clock().now);
    const lists = realLists(ctx);
    events.length = 0; // seeding the default lists announces them too
    const grocery = (await lists.lists()).lists[0]!;
    await lists.addItem(grocery.id, { text: 'Eggs' });
    const { chore } = await lists.createChore({ title: 'Bed', personId: 'ava', cadence: 'daily' });
    await lists.choreDone(chore.id);
    expect(events).toEqual([
      { type: 'list.changed', payload: { listId: grocery.id } },
      { type: 'chores.changed', payload: {} },
      { type: 'chores.changed', payload: {} },
    ]);
    await expect(lists.addItem(grocery.id, { text: 'x', personId: 'zed' })).rejects.toThrow(
      /unknown person/,
    );
  });

  it('mock mode seeds the mockup lists and a chart matching the fixture', async () => {
    const c = clock();
    const { ctx } = context(c.now);
    const lists = mockLists(ctx);
    expect((await lists.lists()).lists.map((l) => l.name)).toEqual(['Grocery', 'Chores', 'To-do']);
    const fixture = choreFixture(c.now());
    const chart = await lists.chores();
    expect(chart.chores).toEqual(fixture.chores);
    expect(chart.stars).toEqual(fixture.stars);
  });
});
