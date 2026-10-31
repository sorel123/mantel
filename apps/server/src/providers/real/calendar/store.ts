/**
 * Local cache of calendar data in SQLite, so the wall keeps showing the week when Google or
 * iCloud is slow or down. The table is created here (not in `db/`) to keep WS2 in its folder.
 *
 * Small JSON values (preferences, OAuth tokens, the calendar list, push channels) go in the
 * shared `kv` table under `calendar.*` keys.
 */
import type Database from 'better-sqlite3';
import { kvGet, kvSet, type Db } from '../../../db/index.js';
import type { CalendarPrefs, RawEvent, SourceCalendar } from './types.js';

const TABLE = `CREATE TABLE IF NOT EXISTS calendar_events (
  calendar_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (calendar_id, uid)
)`;
const INDEX = `CREATE INDEX IF NOT EXISTS calendar_events_range ON calendar_events (start_ms, end_ms)`;

interface Row {
  calendar_id: string;
  uid: string;
  start_ms: number;
  end_ms: number;
  data: string;
}

/** What changed in one calendar's window after a sync. */
export interface Change {
  from: number;
  to: number;
  count: number;
}

export class CalendarStore {
  private readonly sql: Database.Database;

  constructor(private readonly db: Db) {
    // `openDb` builds Db with drizzle(sqlite), which carries the raw handle as $client.
    this.sql = (db as Db & { $client: Database.Database }).$client;
    this.sql.exec(TABLE);
    this.sql.exec(INDEX);
  }

  /** Cached occurrences overlapping [from, to), for the given calendars. */
  events(calendarIds: string[], from: Date, to: Date): RawEvent[] {
    if (!calendarIds.length) return [];
    const marks = calendarIds.map(() => '?').join(',');
    const rows = this.sql
      .prepare(
        `SELECT data FROM calendar_events
         WHERE calendar_id IN (${marks}) AND end_ms > ? AND start_ms < ?
         ORDER BY start_ms, uid`,
      )
      .all(...calendarIds, from.getTime(), to.getTime()) as Pick<Row, 'data'>[];
    return rows.map((r) => JSON.parse(r.data) as RawEvent);
  }

  /**
   * Replace a calendar's events inside [from, to) with `events` and report what changed:
   * the earliest and latest time touched by an added, removed or edited event.
   */
  replaceWindow(calendarId: string, from: Date, to: Date, events: RawEvent[]): Change | null {
    const lo = from.getTime();
    const hi = to.getTime();
    const before = new Map(
      (
        this.sql
          .prepare(
            `SELECT uid, start_ms, end_ms, data FROM calendar_events
             WHERE calendar_id = ? AND end_ms > ? AND start_ms < ?`,
          )
          .all(calendarId, lo, hi) as Row[]
      ).map((r) => [r.uid, r]),
    );
    let min = Infinity;
    let max = -Infinity;
    let count = 0;
    const touch = (s: number, e: number) => {
      min = Math.min(min, s);
      max = Math.max(max, e);
      count++;
    };
    const after = new Map<string, Row>();
    for (const ev of events) {
      const row: Row = {
        calendar_id: calendarId,
        uid: ev.uid,
        start_ms: new Date(ev.start).getTime(),
        end_ms: new Date(ev.end).getTime(),
        data: JSON.stringify(ev),
      };
      after.set(ev.uid, row);
      const old = before.get(ev.uid);
      if (!old) touch(row.start_ms, row.end_ms);
      else if (old.data !== row.data) {
        touch(Math.min(old.start_ms, row.start_ms), Math.max(old.end_ms, row.end_ms));
      }
    }
    for (const [uid, old] of before) if (!after.has(uid)) touch(old.start_ms, old.end_ms);

    const del = this.sql.prepare(
      `DELETE FROM calendar_events WHERE calendar_id = ? AND end_ms > ? AND start_ms < ?`,
    );
    const ins = this.sql.prepare(
      `INSERT OR REPLACE INTO calendar_events (calendar_id, uid, start_ms, end_ms, data)
       VALUES (@calendar_id, @uid, @start_ms, @end_ms, @data)`,
    );
    this.sql.transaction(() => {
      del.run(calendarId, lo, hi);
      for (const row of after.values()) ins.run(row);
    })();
    return count ? { from: min, to: max, count } : null;
  }

  /** Add or update one event (after a quick add), without waiting for the next sync. */
  put(event: RawEvent): void {
    this.sql
      .prepare(
        `INSERT OR REPLACE INTO calendar_events (calendar_id, uid, start_ms, end_ms, data)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        event.calendarId,
        event.uid,
        new Date(event.start).getTime(),
        new Date(event.end).getTime(),
        JSON.stringify(event),
      );
  }

  /** Forget calendars that no longer exist upstream. */
  dropCalendarsExcept(keep: string[]): void {
    if (!keep.length) {
      this.sql.prepare(`DELETE FROM calendar_events`).run();
      return;
    }
    const marks = keep.map(() => '?').join(',');
    this.sql
      .prepare(`DELETE FROM calendar_events WHERE calendar_id NOT IN (${marks})`)
      .run(...keep);
  }

  /** Drop events that ended before `before`; the window moves forward every day. */
  prune(before: Date): void {
    this.sql.prepare(`DELETE FROM calendar_events WHERE end_ms < ?`).run(before.getTime());
  }

  /* ---- small values ---- */

  prefs(): CalendarPrefs {
    return kvGet<CalendarPrefs>(this.db, 'calendar.prefs') ?? { calendars: {} };
  }

  setPrefs(prefs: CalendarPrefs): void {
    kvSet(this.db, 'calendar.prefs', prefs);
  }

  /** The last calendar list seen per source, so bootstrap works while a source is offline. */
  sourceCalendars(): SourceCalendar[] {
    return kvGet<SourceCalendar[]>(this.db, 'calendar.sources') ?? [];
  }

  setSourceCalendars(cals: SourceCalendar[]): void {
    kvSet(this.db, 'calendar.sources', cals);
  }

  get<T>(key: string): T | undefined {
    return kvGet<T>(this.db, `calendar.${key}`);
  }

  set(key: string, value: unknown): void {
    kvSet(this.db, `calendar.${key}`, value);
  }
}
