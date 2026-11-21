import { addDays, startOfWeek, toIsoDate } from '@mantel/shared';
import { chores, lists, rewards, routines, starLedgerSeed } from '@mantel/shared/fixtures';
import { openDb } from '../../db/index.js';
import { storeLists } from '../real/lists.js';
import { FakeListProvider } from '../real/lists-sync-fake.js';
import { RemindersBridge } from '../../plugins/reminders/bridge.js';
import type { ListsProvider, ProviderContext } from '../types.js';

/**
 * The real store on a private in-memory database, seeded with the mockup's lists and chore
 * chart, two routines, three rewards and a star bank. Everything works (checks, adds, stars,
 * undo, redeeming with any PIN) and resets on restart.
 */
export function mockLists(ctx: ProviderContext): ListsProvider {
  const provider = storeLists(ctx, openDb(':memory:'));
  const { store, choreStore, rewardStore } = provider;

  for (const list of lists()) {
    store.createList(list.name, list.id);
    for (const item of list.items) store.addItem(list.id, item, { id: item.id, done: item.done });
  }

  seedMockSharing(provider, ctx);

  const now = ctx.now();
  const monday = startOfWeek(now);
  for (const r of routines()) rewardStore.createRoutine(r, r.id);
  for (const r of rewards()) rewardStore.createReward(r, r.id);
  for (const e of starLedgerSeed(now)) rewardStore.seed(e);
  for (const c of chores(now).chores) {
    choreStore.create(c, c.id);
    c.week?.forEach((n, i) => {
      for (let k = 0; k < n; k++) choreStore.done(c.id, c.personId, toIsoDate(addDays(monday, i)));
    });
  }
  return provider;
}

/**
 * v4 L: in-memory stand-ins for Reminders, Todoist and Home Assistant, with Grocery shared with
 * a family Reminders list and To-do with a Todoist project, so Settings shows two links with a
 * status. `MOCK_EMPTY=1` leaves every list unshared (the services can still be picked).
 */
function seedMockSharing(provider: ReturnType<typeof storeLists>, ctx: ProviderContext) {
  const { store, sync } = provider;
  sync.reminders = new RemindersBridge(ctx.db, store, sync, ctx.now);
  const reminders = new FakeListProvider('reminders', true)
    .addList(
      'rem-groceries',
      'Groceries',
      ['Oat milk', 'Bananas', 'Paper towels'],
      'Shared with Sam and Ava',
    )
    .addList('rem-family', 'Family', ['Dentist forms'])
    .addList('rem-reminders', 'Reminders', []);
  reminders.readiness = () => ({ ready: true, summary: "Jay's MacBook checked in just now" });
  const todoist = new FakeListProvider('todoist', false)
    .addList('td-inbox', 'Inbox', [], 'Your Inbox')
    .addList(
      'td-home',
      'Home',
      ['Book sitter for Friday', 'Call about gutter', 'Fix the fence latch'],
      'Shared project',
    );
  todoist.readiness = () => ({ ready: true, summary: 'Connected to Todoist' });
  const ha = new FakeListProvider('ha-todo', true)
    .addList('todo.shopping_list', 'Shopping list', ['Batteries'], 'todo.shopping_list · 1 open')
    .addList(
      'todo.family_google_tasks',
      'Family (Google Tasks)',
      [],
      'todo.family_google_tasks · 0 open',
    )
    .addList(
      'todo.alexa_shopping_list',
      'Alexa shopping list',
      [],
      'todo.alexa_shopping_list · 0 open',
    );
  ha.readiness = () => ({ ready: true, summary: '3 to-do lists in Home Assistant' });
  for (const p of [reminders, todoist, ha]) {
    p.pollSeconds = 30;
    sync.register(p);
  }
  if (ctx.config.MOCK_EMPTY) return;
  void sync.linkList('list-grocery', 'reminders', 'rem-groceries').catch(() => {});
  void sync.linkList('list-todo', 'todoist', 'td-home').catch(() => {});
}
