import { randomUUID } from 'node:crypto';
import {
  addDays,
  startOfWeek,
  toIsoDate,
  toLocalIso,
  type BodyOf,
  type Chore,
  type ResponseOf,
  type StarTally,
} from '@mantel/shared';
import { and, asc, desc, eq, gte, isNull, max } from 'drizzle-orm';
import { schema, type Db } from '../../db/index.js';
import { notFound } from '../../errors.js';

const { chores, choreCompletions } = schema;
type ChoreRow = typeof chores.$inferSelect;
type CompletionRow = typeof choreCompletions.$inferSelect;

/**
 * The chore chart. Every tap is a completion row dated in local time; counts, the week grid
 * and star tallies are derived from those rows for the week containing "now", so the weekly
 * reset on Monday needs no job: last week's rows simply fall outside the window.
 */
export class ChoreStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

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

  private toChore(row: ChoreRow, done: CompletionRow[], w = this.week()): Chore {
    const mine = done.filter((d) => d.choreId === row.id);
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
    return {
      weekStart: w.start,
      chores: active.map((c) => this.toChore(c, done, w)),
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
    };
    this.db.insert(chores).values(row).run();
    return this.toChore(row, []);
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
      this.db
        .insert(choreCompletions)
        .values({
          choreId: id,
          personId: personId ?? row.personId,
          day,
          at: toLocalIso(this.now()),
          stars: row.stars,
        })
        .run();
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
    if (last) this.db.delete(choreCompletions).where(eq(choreCompletions.id, last.id)).run();
    return this.result(row);
  }

  private result(row: ChoreRow) {
    const w = this.week();
    const done = this.completions(w.start);
    return { chore: this.toChore(row, done, w), stars: this.tallies(this.active(), done) };
  }
}
