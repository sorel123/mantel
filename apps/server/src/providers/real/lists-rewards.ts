import { randomUUID } from 'node:crypto';
import {
  startOfWeek,
  toIsoDate,
  toLocalIso,
  type BodyOf,
  type Reward,
  type Routine,
  type StarBalance,
  type StarLedgerEntry,
} from '@mantel/shared';
import { and, asc, desc, eq, gte, max, sql } from 'drizzle-orm';
import { schema, type Db } from '../../db/index.js';
import { HttpError, notFound } from '../../errors.js';

const { starLedger, rewards, routines, choreCompletions } = schema;
type LedgerRow = typeof starLedger.$inferSelect;
type RewardRow = typeof rewards.$inferSelect;
type RoutineRow = typeof routines.$inferSelect;

const newId = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;
const ids = (json: string): string[] => {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

const toEntry = (r: LedgerRow): StarLedgerEntry => ({
  id: r.id,
  personId: r.personId,
  delta: r.delta,
  reason: r.reason,
  at: r.at,
  ...(r.refId ? { refId: r.refId } : {}),
  ...(r.note ? { note: r.note } : {}),
});

const toReward = (r: RewardRow): Reward => ({
  id: r.id,
  title: r.title,
  cost: r.cost,
  icon: r.icon,
  personIds: ids(r.personIds),
  active: r.active,
});

const toRoutine = (r: RoutineRow): Routine => ({
  id: r.id,
  name: r.name,
  personIds: ids(r.personIds),
  timeOfDay: r.timeOfDay,
  icon: r.icon,
});

/**
 * The star bank, the rewards to spend it on, and routines. Chore taps are written to the
 * ledger by `ChoreStore`; this store reads balances, records bonuses, corrections and
 * redemptions, and keeps the reward and routine lists. PIN checks happen in the routes.
 */
export class RewardStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /* ---- stars ---- */

  private sum(personId: string): number {
    return (
      this.db
        .select({ n: sql<number>`coalesce(sum(${starLedger.delta}), 0)` })
        .from(starLedger)
        .where(eq(starLedger.personId, personId))
        .get()?.n ?? 0
    );
  }

  private weekStars(personId: string): number {
    const since = toIsoDate(startOfWeek(this.now()));
    return (
      this.db
        .select({ n: sql<number>`coalesce(sum(${choreCompletions.stars}), 0)` })
        .from(choreCompletions)
        .where(and(eq(choreCompletions.personId, personId), gte(choreCompletions.day, since)))
        .get()?.n ?? 0
    );
  }

  balance(personId: string): StarBalance {
    return { personId, stars: this.sum(personId), week: this.weekStars(personId) };
  }

  /** Balances for these people (everyone in Settings), plus anyone else with ledger entries. */
  balances(personIds: string[]): StarBalance[] {
    const inLedger = this.db
      .selectDistinct({ p: starLedger.personId })
      .from(starLedger)
      .all()
      .map((r) => r.p);
    const all = [...new Set([...personIds, ...inLedger])];
    return all.map((p) => this.balance(p));
  }

  ledger(personId?: string, limit = 100): StarLedgerEntry[] {
    return this.db
      .select()
      .from(starLedger)
      .where(personId ? eq(starLedger.personId, personId) : undefined)
      .orderBy(desc(starLedger.at), sql`rowid desc`)
      .limit(limit)
      .all()
      .map(toEntry);
  }

  private add(entry: Omit<StarLedgerEntry, 'id' | 'at'> & { id?: string; at?: string }) {
    const row: LedgerRow = {
      id: entry.id ?? `star-${randomUUID().slice(0, 12)}`,
      personId: entry.personId,
      delta: entry.delta,
      reason: entry.reason,
      refId: entry.refId ?? null,
      note: entry.note ?? null,
      at: entry.at ?? toLocalIso(this.now()),
    };
    this.db.insert(starLedger).values(row).run();
    return { entry: toEntry(row), balance: this.balance(row.personId) };
  }

  /** A bonus or a correction typed by a parent. */
  adjust(req: Omit<BodyOf<'starsAdjust'>, 'pin'>) {
    return this.add({
      personId: req.personId,
      delta: req.delta,
      reason: req.reason ?? 'adjust',
      ...(req.note ? { note: req.note } : {}),
    });
  }

  /** Seed an entry as it is (mock mode and tests). */
  seed(entry: StarLedgerEntry) {
    return this.add(entry);
  }

  /** Spend stars on a reward. Fails with a plain sentence when the reward can't be had. */
  redeem(rewardId: string, personId: string, personName = personId) {
    const reward = this.reward(rewardId);
    if (!reward.active) throw new HttpError('bad_request', `${reward.title} is switched off`);
    if (reward.personIds.length > 0 && !reward.personIds.includes(personId))
      throw new HttpError('bad_request', `${reward.title} isn't one of ${personName}'s rewards`);
    const have = this.sum(personId);
    if (have < reward.cost)
      throw new HttpError(
        'bad_request',
        `${personName} has ${have} ${have === 1 ? 'star' : 'stars'}; ${reward.title} needs ${reward.cost}`,
      );
    return {
      reward,
      ...this.add({
        personId,
        delta: -reward.cost,
        reason: 'redeem',
        refId: reward.id,
        note: reward.title,
      }),
    };
  }

  /* ---- rewards ---- */

  private reward(id: string): Reward {
    const row = this.db.select().from(rewards).where(eq(rewards.id, id)).get();
    if (!row) throw notFound(`reward ${id}`);
    return toReward(row);
  }

  rewards(): Reward[] {
    return this.db
      .select()
      .from(rewards)
      .orderBy(asc(rewards.cost), asc(rewards.sort))
      .all()
      .map(toReward);
  }

  createReward(req: BodyOf<'rewardCreate'>, id = newId('reward')): Reward {
    const sort =
      (this.db
        .select({ m: max(rewards.sort) })
        .from(rewards)
        .get()?.m ?? -1) + 1;
    const row: RewardRow = {
      id,
      title: req.title.trim(),
      cost: req.cost,
      icon: req.icon ?? 'gift',
      personIds: JSON.stringify(req.personIds ?? []),
      active: req.active ?? true,
      sort,
    };
    this.db.insert(rewards).values(row).run();
    return toReward(row);
  }

  patchReward(id: string, patch: BodyOf<'rewardPatch'>): Reward {
    this.reward(id);
    const set: Partial<RewardRow> = {};
    if (patch.title !== undefined) set.title = patch.title.trim();
    if (patch.cost !== undefined) set.cost = patch.cost;
    if (patch.icon !== undefined) set.icon = patch.icon;
    if (patch.personIds !== undefined) set.personIds = JSON.stringify(patch.personIds);
    if (patch.active !== undefined) set.active = patch.active;
    this.db.update(rewards).set(set).where(eq(rewards.id, id)).run();
    return this.reward(id);
  }

  /** Delete a reward. Past redemptions keep their entries (with the title as the note). */
  deleteReward(id: string) {
    this.reward(id);
    this.db.delete(rewards).where(eq(rewards.id, id)).run();
  }

  /* ---- routines ---- */

  private routine(id: string): Routine {
    const row = this.db.select().from(routines).where(eq(routines.id, id)).get();
    if (!row) throw notFound(`routine ${id}`);
    return toRoutine(row);
  }

  routines(): Routine[] {
    return this.db.select().from(routines).orderBy(asc(routines.sort)).all().map(toRoutine);
  }

  createRoutine(req: BodyOf<'routineCreate'>, id = newId('routine')): Routine {
    const sort =
      (this.db
        .select({ m: max(routines.sort) })
        .from(routines)
        .get()?.m ?? -1) + 1;
    const row: RoutineRow = {
      id,
      name: req.name.trim(),
      personIds: JSON.stringify(req.personIds),
      timeOfDay: req.timeOfDay,
      icon: req.icon ?? 'sun',
      sort,
    };
    this.db.insert(routines).values(row).run();
    return toRoutine(row);
  }

  patchRoutine(id: string, patch: BodyOf<'routinePatch'>): Routine {
    this.routine(id);
    const set: Partial<RoutineRow> = {};
    if (patch.name !== undefined) set.name = patch.name.trim();
    if (patch.personIds !== undefined) set.personIds = JSON.stringify(patch.personIds);
    if (patch.timeOfDay !== undefined) set.timeOfDay = patch.timeOfDay;
    if (patch.icon !== undefined) set.icon = patch.icon;
    this.db.update(routines).set(set).where(eq(routines.id, id)).run();
    return this.routine(id);
  }

  deleteRoutine(id: string) {
    this.routine(id);
    this.db.delete(routines).where(eq(routines.id, id)).run();
  }
}
