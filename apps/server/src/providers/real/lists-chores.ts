import { randomUUID } from 'node:crypto';
import {
  addDays,
  fromIsoDate,
  startOfWeek,
  toIsoDate,
  toLocalIso,
  type BodyOf,
  type Chore,
  type ResponseOf,
  type StarTally,
} from '@mantel/shared';
import { and, asc, desc, eq, gte, inArray, isNull, max } from 'drizzle-orm';
import { kvGet, kvSet, schema, type Db } from '../../db/index.js';
import { HttpError, notFound } from '../../errors.js';

const { chores, choreCompletions, starLedger, routines } = schema;
type ChoreRow = typeof chores.$inferSelect;
type CompletionRow = typeof choreCompletions.$inferSelect;

/** The ledger entry for one chore tap; taking the tap back deletes it. */
export const completionRef = (completionId: number) => `completion:${completionId}`;
const LEDGER_MIGRATED = 'stars.ledger.migrated';

/**
 * The chore chart. Every tap is a completion row dated in local time; counts, the week grid
 * and star tallies are derived from those rows for the week containing "now", so the weekly
 * reset on Monday needs no job: last week's rows simply fall outside the window.
 */
export class ChoreStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.migrateLedger();
  }

  /**
   * One time, on the first start with the star bank: credit this week's chore taps to the
   * ledger, so the stars on the chart before the upgrade are not lost. Earlier weeks had
   * already reset, so there is nothing else to carry over.
   */
  private migrateLedger() {
    if (kvGet<boolean>(this.db, LEDGER_MIGRATED)) return;
    this.db.transaction((tx) => {
      const since = this.week().start;
      const done = tx
        .select({ c: choreCompletions, title: chores.title })
        .from(choreCompletions)
        .innerJoin(chores, eq(chores.id, choreCompletions.choreId))
        .where(gte(choreCompletions.day, since))
        .all();
      for (const { c, title } of done) {
        const refId = completionRef(c.id);
        if (tx.select().from(starLedger).where(eq(starLedger.refId, refId)).get()) continue;
        tx.insert(starLedger)
          .values({
            id: `star-${randomUUID().slice(0, 12)}`,
            personId: c.personId,
            delta: c.stars,
            reason: 'chore',
            refId,
            note: title,
            at: c.at,
          })
          .run();
      }
    });
    kvSet(this.db, LEDGER_MIGRATED, true);
  }

  /** Time of day per routine, which a chore in that routine follows. */
  private routineTimes(): Map<string, ChoreRow['timeOfDay']> {
    return new Map(
      this.db
        .select({ id: routines.id, t: routines.timeOfDay })
        .from(routines)
        .all()
        .map((r) => [r.id, r.t]),
    );
  }

  private week() {
    const start = startOfWeek(this.now());
    return {
      start: toIsoDate(start),
      days: Array.from({ length: 7 }, (_, i) => toIsoDate(addDays(start, i))),
      today: toIsoDate(this.now()),
    };
  }

  private completions(since: string): CompletionRow[] {
    return this.db.select().from(choreCompletions).where(gte(choreCompletions.day, since)).all();
  }

  private toChore(
    row: ChoreRow,
    done: CompletionRow[],
    w = this.week(),
    times = this.routineTimes(),
  ): Chore {
    const mine = done.filter((d) => d.choreId === row.id);
    const routineTime = row.routineId ? times.get(row.routineId) : undefined;
    const week = w.days.map((day) => mine.filter((d) => d.day === day).length);
    const doneCount = row.cadence === 'daily' ? week[w.days.indexOf(w.today)]! : mine.length;
    return {
      id: row.id,
      title: row.title,
      personId: row.personId,
      cadence: row.cadence,
      stars: row.stars,
      target: row.target,
      doneCount,
      week,
      timeOfDay: routineTime ?? row.timeOfDay,
      ...(row.icon ? { icon: row.icon } : {}),
      ...(row.routineId && routineTime ? { routineId: row.routineId } : {}),
    };
  }

  private tallies(active: ChoreRow[], done: CompletionRow[]): StarTally[] {
    const stars = new Map<string, number>();
    for (const c of active) stars.set(c.personId, 0);
    for (const d of done) stars.set(d.personId, (stars.get(d.personId) ?? 0) + d.stars);
    return [...stars].map(([personId, n]) => ({ personId, stars: n }));
  }

  private active(): ChoreRow[] {
    return this.db
      .select()
      .from(chores)
      .where(isNull(chores.archivedAt))
      .orderBy(asc(chores.sort))
      .all();
  }

  private getRow(id: string): ChoreRow {
    const row = this.db.select().from(chores).where(eq(chores.id, id)).get();
    if (!row || row.archivedAt) throw notFound(`chore ${id}`);
    return row;
  }

  all(): ResponseOf<'chores'> {
    const w = this.week();
    const done = this.completions(w.start);
    const active = this.active();
    const times = this.routineTimes();
    return {
      weekStart: w.start,
      chores: active.map((c) => this.toChore(c, done, w, times)),
      stars: this.tallies(active, done),
    };
  }

  create(req: BodyOf<'choreCreate'>, id = `chore-${randomUUID().slice(0, 8)}`): Chore {
    const sort =
      (this.db
        .select({ m: max(chores.sort) })
        .from(chores)
        .get()?.m ?? -1) + 1;
    const row: ChoreRow = {
      id,
      title: req.title.trim(),
      personId: req.personId,
      cadence: req.cadence,
      stars: req.stars ?? 1,
      target: req.target ?? 1,
      sort,
      createdAt: toLocalIso(this.now()),
      archivedAt: null,
      timeOfDay: req.timeOfDay ?? 'any',
      icon: req.icon ?? null,
      routineId: req.routineId ?? null,
    };
    this.checkRoutine(row.routineId);
    this.db.insert(chores).values(row).run();
    return this.toChore(row, []);
  }

  private checkRoutine(id: string | null | undefined) {
    if (id && !this.db.select().from(routines).where(eq(routines.id, id)).get())
      throw new HttpError('bad_request', `unknown routine ${id}`);
  }

  /** Change a chore in place. Stars already earned keep the value they had. */
  update(id: string, patch: BodyOf<'choreUpdate'>): Chore {
    this.getRow(id);
    this.checkRoutine(patch.routineId);
    const set: Partial<ChoreRow> = {};
    if (patch.title !== undefined) set.title = patch.title.trim();
    if (patch.personId !== undefined) set.personId = patch.personId;
    if (patch.cadence !== undefined) set.cadence = patch.cadence;
    if (patch.stars !== undefined) set.stars = patch.stars;
    if (patch.target !== undefined) set.target = patch.target;
    if (patch.timeOfDay !== undefined) set.timeOfDay = patch.timeOfDay;
    if (patch.icon !== undefined) set.icon = patch.icon;
    if (patch.routineId !== undefined) set.routineId = patch.routineId;
    this.db.update(chores).set(set).where(eq(chores.id, id)).run();
    const w = this.week();
    return this.toChore(this.getRow(id), this.completions(w.start), w);
  }

  /** Take every chore out of a routine (the routine is being deleted). */
  leaveRoutine(routineId: string) {
    this.db.update(chores).set({ routineId: null }).where(eq(chores.routineId, routineId)).run();
  }

  /** Active chores in these routines, for the routine card. */
  inRoutines(ids: string[]): ChoreRow[] {
    if (ids.length === 0) return [];
    return this.db.select().from(chores).where(inArray(chores.routineId, ids)).all();
  }

  /** Retire a chore. Its completions stay, so stars earned this week are kept. */
  archive(id: string) {
    this.getRow(id);
    this.db
      .update(chores)
      .set({ archivedAt: toLocalIso(this.now()) })
      .where(eq(chores.id, id))
      .run();
  }

  /**
   * Record one completion today. A chore already at its target for the period is left as is,
   * so tapping a finished chore again never earns extra stars.
   */
  done(id: string, personId?: string, day = this.week().today): ResponseOf<'choreDone'> {
    const row = this.getRow(id);
    const w = this.week();
    if (this.toChore(row, this.completions(w.start), w).doneCount < row.target) {
      // A tap recorded for an earlier day (mock history, a sync) is stamped at noon that day.
      const at =
        day === w.today
          ? toLocalIso(this.now())
          : toLocalIso(new Date(fromIsoDate(day).getTime() + 12 * 3_600_000));
      const who = personId ?? row.personId;
      this.db.transaction((tx) => {
        const done = tx
          .insert(choreCompletions)
          .values({ choreId: id, personId: who, day, at, stars: row.stars })
          .returning({ id: choreCompletions.id })
          .get();
        // Every tap banks its stars; the ledger never resets.
        tx.insert(starLedger)
          .values({
            id: `star-${randomUUID().slice(0, 12)}`,
            personId: who,
            delta: row.stars,
            reason: 'chore',
            refId: completionRef(done.id),
            note: row.title,
            at,
          })
          .run();
      });
    }
    return this.result(row);
  }

  /** Take back the latest completion in the current period (today, or this week for weekly). */
  undo(id: string): ResponseOf<'choreUndo'> {
    const row = this.getRow(id);
    const w = this.week();
    const since = row.cadence === 'daily' ? w.today : w.start;
    const last = this.db
      .select()
      .from(choreCompletions)
      .where(and(eq(choreCompletions.choreId, id), gte(choreCompletions.day, since)))
      .orderBy(desc(choreCompletions.id))
      .get();
    if (last)
      this.db.transaction((tx) => {
        tx.delete(starLedger)
          .where(eq(starLedger.refId, completionRef(last.id)))
          .run();
        tx.delete(choreCompletions).where(eq(choreCompletions.id, last.id)).run();
      });
    return this.result(row);
  }

  private result(row: ChoreRow) {
    const w = this.week();
    const done = this.completions(w.start);
    return { chore: this.toChore(row, done, w), stars: this.tallies(this.active(), done) };
  }
}
