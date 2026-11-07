import { starBalances } from '@mantel/shared/fixtures';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../config.js';
import { openDb, schema } from '../../db/index.js';
import { SettingsStore } from '../../settings.js';
import { mockLists } from '../mock/lists.js';
import type { ProviderContext } from '../types.js';
import { ChoreStore } from './lists-chores.js';
import { RewardStore } from './lists-rewards.js';
import { realLists } from './lists.js';

/** Wednesday 4 November 2026, 9 am local. */
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
  const events: Array<{ type: string; payload: unknown }> = [];
  const settings = new SettingsStore(db);
  const ctx: ProviderContext = {
    config: loadConfig({ DATA_DIR: ':memory:' }),
    db,
    emit: (e) => events.push(e as { type: string; payload: unknown }),
    now,
    markSynced: () => {},
    settings: () => settings.get(),
  };
  return { ctx, db, events };
}

describe('star bank', () => {
  it('banks every chore tap and takes it back on undo; it survives the Monday reset', () => {
    const c = clock();
    const { db } = context(c.now);
    const chores = new ChoreStore(db, c.now);
    const bank = new RewardStore(db, c.now);
    const bins = chores.create({ title: 'Bins', personId: 'leo', cadence: 'weekly', stars: 3 });
    const feed = chores.create({ title: 'Feed Mochi', personId: 'leo', cadence: 'daily' });

    chores.done(bins.id);
    chores.done(feed.id);
    chores.done(feed.id); // at target: no extra stars
    expect(bank.balance('leo')).toEqual({ personId: 'leo', stars: 4, week: 4 });
    expect(bank.ledger('leo').map((e) => [e.reason, e.delta, e.note])).toEqual([
      ['chore', 1, 'Feed Mochi'],
      ['chore', 3, 'Bins'],
    ]);

    chores.undo(feed.id);
    expect(bank.balance('leo').stars).toBe(3);

    c.advanceDays(7);
    expect(chores.all().stars).toEqual([{ personId: 'leo', stars: 0 }]);
    expect(bank.balance('leo')).toEqual({ personId: 'leo', stars: 3, week: 0 });
  });

  it('credits the stars already on the chart once, when the bank first opens', () => {
    const c = clock();
    const { db } = context(c.now);
    const first = new ChoreStore(db, c.now);
    const bed = first.create({ title: 'Make bed', personId: 'ava', cadence: 'daily', stars: 2 });
    first.done(bed.id);
    // Pretend the database predates the bank: no ledger, not migrated.
    db.delete(schema.starLedger).run();
    db.delete(schema.kv).run();
    const bank = new RewardStore(db, c.now);
    expect(bank.balance('ava').stars).toBe(0);

    new ChoreStore(db, c.now);
    expect(bank.balance('ava').stars).toBe(2);
    new ChoreStore(db, c.now);
    expect(bank.balance('ava').stars).toBe(2);
    // The migrated entry is linked to its tap, so undo still takes it back.
    new ChoreStore(db, c.now).undo(bed.id);
    expect(bank.balance('ava').stars).toBe(0);
  });

  it('redeems only with enough stars, for the right person, and adjusts by hand', () => {
    const c = clock();
    const { db } = context(c.now);
    const bank = new RewardStore(db, c.now);
    const movie = bank.createReward({ title: 'Pick the movie', cost: 10, personIds: [] });
    const game = bank.createReward({ title: 'Games', cost: 2, personIds: ['leo'] });
    bank.adjust({ personId: 'ava', delta: 8, reason: 'bonus', note: 'Helped' });

    expect(() => bank.redeem(movie.id, 'ava', 'Ava')).toThrow(
      'Ava has 8 stars; Pick the movie needs 10',
    );
    expect(() => bank.redeem(game.id, 'ava', 'Ava')).toThrow("Games isn't one of Ava's rewards");
    bank.adjust({ personId: 'ava', delta: 2 });
    const spent = bank.redeem(movie.id, 'ava', 'Ava');
    expect(spent.entry).toMatchObject({ delta: -10, reason: 'redeem', refId: movie.id });
    expect(spent.balance.stars).toBe(0);

    bank.patchReward(movie.id, { active: false });
    expect(() => bank.redeem(movie.id, 'ava')).toThrow(/switched off/);
    expect(bank.rewards().map((r) => r.title)).toEqual(['Games', 'Pick the movie']);
  });
});

describe('routines', () => {
  it('gives a chore its routine time, and frees chores when the routine goes', () => {
    const c = clock();
    const { db } = context(c.now);
    const chores = new ChoreStore(db, c.now);
    const bank = new RewardStore(db, c.now);
    const morning = bank.createRoutine({
      name: 'Morning',
      personIds: ['ava'],
      timeOfDay: 'morning',
      icon: 'sun',
    });
    const teeth = chores.create({
      title: 'Brush teeth',
      personId: 'ava',
      cadence: 'daily',
      icon: 'toothbrush',
      routineId: morning.id,
    });
    expect(teeth).toMatchObject({
      timeOfDay: 'morning',
      icon: 'toothbrush',
      routineId: morning.id,
    });

    bank.patchRoutine(morning.id, { timeOfDay: 'evening', name: 'Bedtime' });
    expect(chores.all().chores[0]).toMatchObject({ timeOfDay: 'evening' });

    bank.deleteRoutine(morning.id);
    chores.leaveRoutine(morning.id);
    expect(chores.all().chores[0]).toMatchObject({ timeOfDay: 'any' });
    expect(chores.all().chores[0]!.routineId).toBeUndefined();

    expect(chores.update(teeth.id, { timeOfDay: 'afternoon', title: 'Floss' })).toMatchObject({
      title: 'Floss',
      timeOfDay: 'afternoon',
    });
    expect(() => chores.update(teeth.id, { routineId: 'nope' })).toThrow(/unknown routine/);
  });
});

describe('lists provider: rewards', () => {
  it('emits rewards.redeemed and chores.changed when stars are spent', async () => {
    const c = clock();
    const { ctx, events } = context(c.now);
    const lists = realLists(ctx);
    const { reward } = await lists.createReward({ title: 'Ice cream', cost: 3, personIds: [] });
    await lists.starsAdjust({ personId: 'leo', delta: 5, reason: 'bonus' });
    events.length = 0;
    const res = await lists.redeemReward(reward.id, 'leo');
    expect(res.balance.stars).toBe(2);
    expect(events.map((e) => e.type)).toEqual(['rewards.redeemed', 'chores.changed']);
    expect(events[0]!.payload).toMatchObject({ personId: 'leo', title: 'Ice cream', cost: 3 });
    await expect(lists.redeemReward(reward.id, 'zed')).rejects.toThrow(/unknown person/);
  });

  it('mock mode has two routines, three rewards and balances matching the fixture', async () => {
    const c = clock();
    const { ctx } = context(c.now);
    const lists = mockLists(ctx);
    expect((await lists.routines()).routines).toHaveLength(2);
    expect((await lists.rewards()).rewards).toHaveLength(3);
    const { balances, celebrations } = await lists.starsBalance();
    for (const b of starBalances(c.now()))
      expect(balances.find((x) => x.personId === b.personId)).toEqual(b);
    expect(celebrations).toEqual({ celebrationsOff: [], chime: false });
  });
});
