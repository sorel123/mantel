/**
 * The activity log (v4 D): one row per meaningful change, for "since you last looked" on the
 * wall and the phone. It is fed by the WebSocket events the other parts already send: on each
 * one it reloads the thing that changed, compares it with what it saw last time, and writes a
 * row for every new list item, finished chore, added or moved event, planned meal, wall note
 * and redeemed reward. No other workstream's code had to change.
 */
import { randomUUID } from 'node:crypto';
import {
  type ActivityEntry,
  type ActivityKind,
  type Calendar,
  type CalendarEvent,
  type Chore,
  type DeepLink,
  type List,
  type Meal,
  type Person,
  type WallNote,
  type WsEvent,
  type WsEventInput,
} from '@mantel/shared';
import { desc, gt, lt } from 'drizzle-orm';
import { schema, type Db } from '../../db/index.js';
import { log } from '../../log.js';
import { dateInZone, isoInZone, zoned } from '../../providers/real/weather-time.js';
import { shiftDate } from '../import/zone.js';

const { activity } = schema;
type Row = typeof activity.$inferSelect;

/** Rows older than this are dropped. */
export const ACTIVITY_KEEP_DAYS = 30;
const MAX_ROWS = 3000;
const DEBOUNCE_MS = 1200;

export interface ActivitySources {
  lists(): Promise<List[]>;
  chores(): Promise<Chore[]>;
  /** Events from yesterday to two months ahead, and the calendars (to skip the Meals one). */
  events(): Promise<{ events: CalendarEvent[]; calendars: Calendar[] }>;
  /** Planned meals this week and next. */
  meals(): Promise<Meal[]>;
  notes(): WallNote[];
}

export interface ActivityLogOptions {
  db: Db;
  now: () => Date;
  timeZone: () => string;
  people: () => Person[];
  emit: (e: WsEventInput) => void;
  /** The device that just wrote something, if any (see `writer.ts`). */
  writer: () => string | null;
  /** Name of a device ("Kitchen wall") and whose it is, from its phone's notification settings. */
  device: (id: string) => { name: string; personId: string | null } | null;
  sources: ActivitySources;
}

export type NewEntry = Omit<ActivityEntry, 'id' | 'at'> & { at?: string };

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "today", "tomorrow", "Thursday" (within a week) or "Nov 30", in the household's zone. */
export function dayWords(iso: string, now: Date, timeZone: string): string {
  const day = iso.length === 10 ? iso : dateInZone(new Date(iso), timeZone);
  const today = dateInZone(now, timeZone);
  if (day === today) return 'today';
  if (day === shiftDate(today, 1)) return 'tomorrow';
  if (day === shiftDate(today, -1)) return 'yesterday';
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const at = new Date(Date.UTC(y, m - 1, d, 12));
  if (day > today && day <= shiftDate(today, 6)) return WEEKDAYS[at.getUTCDay()]!;
  return `${MONTHS[m - 1]} ${d}`;
}

const toEntry = (r: Row): ActivityEntry => ({
  id: r.id,
  at: r.at,
  kind: r.kind as ActivityKind,
  ...(r.personId ? { personId: r.personId } : {}),
  ...(r.who ? { who: r.who } : {}),
  subject: r.subject,
  ...(r.place ? { where: r.place } : {}),
  link: { tab: r.linkTab as DeepLink['tab'], ...(r.linkId ? { id: r.linkId } : {}) },
  ...(r.grp ? { group: r.grp } : {}),
});

interface Snapshots {
  items: Map<string, { listId: string; text: string; done: boolean }> | null;
  chores: Map<string, number> | null;
  events: Map<string, { start: string; title: string }> | null;
  meals: Map<string, string> | null;
  notes: Set<string> | null;
}

export class ActivityLog {
  private snap: Snapshots = { items: null, chores: null, events: null, meals: null, notes: null };
  private timers = new Map<string, NodeJS.Timeout>();
  private running = new Map<string, Promise<void>>();

  constructor(private readonly o: ActivityLogOptions) {}

  /* ---------- the store ---------- */

  add(e: NewEntry): ActivityEntry {
    const nowMs = e.at ? Date.parse(e.at) : this.o.now().getTime();
    const row: Row = {
      id: `act-${randomUUID().slice(0, 12)}`,
      at: e.at ?? isoInZone(new Date(nowMs), this.o.timeZone()),
      atMs: nowMs,
      kind: e.kind,
      personId: e.personId ?? null,
      who: e.who ?? null,
      subject: e.subject.slice(0, 200),
      place: e.where ?? null,
      linkTab: e.link.tab,
      linkId: e.link.id ?? null,
      grp: e.group ?? null,
    };
    this.o.db.insert(activity).values(row).run();
    const entry = toEntry(row);
    this.o.emit({ type: 'activity.added', payload: { entry } });
    return entry;
  }

  /** Newest first; with `since`, only entries after it. */
  list(since?: string, limit = 50): ActivityEntry[] {
    this.prune();
    const q = this.o.db.select().from(activity);
    const rows = (since ? q.where(gt(activity.atMs, Date.parse(since))) : q)
      .orderBy(desc(activity.atMs))
      .limit(limit)
      .all();
    return rows.map(toEntry);
  }

  private prune() {
    const cutoff = this.o.now().getTime() - ACTIVITY_KEEP_DAYS * 864e5;
    this.o.db.delete(activity).where(lt(activity.atMs, cutoff)).run();
    const extra = this.o.db
      .select({ atMs: activity.atMs })
      .from(activity)
      .orderBy(desc(activity.atMs))
      .limit(1)
      .offset(MAX_ROWS)
      .get();
    if (extra)
      this.o.db
        .delete(activity)
        .where(lt(activity.atMs, extra.atMs + 1))
        .run();
  }

  /* ---------- who ---------- */

  private personName(id: string | null | undefined): string | undefined {
    return id ? this.o.people().find((p) => p.id === id)?.name : undefined;
  }

  /** The person (or device) behind the last write, if it was just now. */
  private writer(): { personId?: string; who?: string } {
    const id = this.o.writer();
    if (!id) return {};
    const d = this.o.device(id);
    if (!d) return {};
    const name = this.personName(d.personId);
    return d.personId && name ? { personId: d.personId, who: name } : { who: d.name };
  }

  /* ---------- watching ---------- */

  /** Load everything once so the first change has something to compare with. */
  async prime(): Promise<void> {
    await Promise.all([
      this.diffLists(false),
      this.diffChores(false),
      this.diffEvents(false),
      this.diffMeals(false),
      this.diffNotes(false),
    ]);
  }

  /** Wired to `hub.onEvent`. */
  handleEvent(e: WsEvent): void {
    const type = (e as { type: string }).type;
    if (type === 'list.changed') this.soon('lists', () => this.diffLists(true));
    else if (type === 'chores.changed') this.soon('chores', () => this.diffChores(true));
    else if (type === 'calendar.changed') {
      this.soon('events', () => this.diffEvents(true));
      this.soon('meals', () => this.diffMeals(true));
    } else if (type === 'notes.changed') this.soon('notes', () => this.diffNotes(true));
    else if (type === 'rewards.redeemed') {
      const p = (e as { payload?: Record<string, unknown> }).payload ?? {};
      const personId = typeof p.personId === 'string' ? p.personId : undefined;
      this.add({
        kind: 'reward.redeemed',
        ...(personId ? { personId } : {}),
        ...(this.personName(personId) ? { who: this.personName(personId)! } : {}),
        subject: typeof p.title === 'string' ? p.title : 'a reward',
        link: { tab: 'chores' },
      });
    } else if (type === 'inbox.changed') {
      // Workstream K's event: a capture committed from the inbox says how many it added.
      const p = (e as { payload?: Record<string, unknown> }).payload ?? {};
      const c = p.committed as { id?: string; title?: string; count?: number } | undefined;
      if (c)
        this.add({
          kind: 'capture.committed',
          ...this.writer(),
          subject: c.title ?? `${c.count ?? 1} thing${c.count === 1 ? '' : 's'}`,
          link: { tab: 'inbox', ...(c.id ? { id: c.id } : {}) },
        });
    }
  }

  /** Several events in a row become one comparison; runs never overlap. */
  private soon(key: string, run: () => Promise<void>) {
    clearTimeout(this.timers.get(key));
    const t = setTimeout(() => {
      this.timers.delete(key);
      const before = this.running.get(key) ?? Promise.resolve();
      const next = before.then(run).catch((err: unknown) => {
        log.warn('activity: could not compare', { key, err: String(err) });
      });
      this.running.set(key, next);
    }, DEBOUNCE_MS);
    t.unref?.();
    this.timers.set(key, t);
  }

  /** Wait for pending comparisons (tests). */
  async flush(): Promise<void> {
    const pending = [...this.timers.keys()];
    for (const key of pending) clearTimeout(this.timers.get(key));
    this.timers.clear();
    for (const key of pending) {
      const run = {
        lists: () => this.diffLists(true),
        chores: () => this.diffChores(true),
        events: () => this.diffEvents(true),
        meals: () => this.diffMeals(true),
        notes: () => this.diffNotes(true),
      }[key];
      if (run) await run();
    }
    await Promise.all(this.running.values());
  }

  async diffLists(record: boolean) {
    const lists = await this.o.sources.lists();
    const names = new Map(lists.map((l) => [l.id, l.name]));
    const next = new Map<string, { listId: string; text: string; done: boolean }>();
    for (const l of lists)
      for (const i of l.items) next.set(i.id, { listId: l.id, text: i.text, done: i.done });
    const before = this.snap.items;
    this.snap.items = next;
    if (!record || !before) return;
    const by = this.writer();
    for (const [id, item] of next) {
      const old = before.get(id);
      const where = names.get(item.listId);
      if (!old && !item.done)
        this.add({
          kind: 'list.added',
          ...by,
          subject: item.text,
          ...(where ? { where } : {}),
          link: { tab: 'lists', id: item.listId },
          group: item.listId,
        });
      else if (old && !old.done && item.done)
        this.add({
          kind: 'list.done',
          ...by,
          subject: item.text,
          ...(where ? { where: `on ${where}` } : {}),
          link: { tab: 'lists', id: item.listId },
          group: `done-${item.listId}`,
        });
    }
  }

  async diffChores(record: boolean) {
    const chores = await this.o.sources.chores();
    const next = new Map(chores.map((c) => [c.id, c.doneCount]));
    const before = this.snap.chores;
    this.snap.chores = next;
    if (!record || !before) return;
    for (const c of chores) {
      const was = before.get(c.id) ?? 0;
      if (c.doneCount <= was) continue;
      const who = this.personName(c.personId);
      this.add({
        kind: 'chore.done',
        personId: c.personId,
        ...(who ? { who } : {}),
        subject: c.title,
        link: { tab: 'chores', id: c.id },
        group: c.personId,
      });
    }
  }

  async diffEvents(record: boolean) {
    const { events, calendars } = await this.o.sources.events();
    const meals = new Set(calendars.filter((c) => c.isMeals).map((c) => c.id));
    const shown = events.filter((e) => !meals.has(e.calendarId));
    const next = new Map(shown.map((e) => [e.id, { start: e.start, title: e.title }]));
    const before = this.snap.events;
    this.snap.events = next;
    if (!record || !before) return;
    const now = this.o.now();
    const tz = this.o.timeZone();
    const by = this.writer();
    for (const e of shown) {
      const old = before.get(e.id);
      if (!old)
        this.add({
          kind: 'event.added',
          ...by,
          subject: e.title,
          where: dayWords(e.start, now, tz),
          link: { tab: 'calendar', id: e.id },
        });
      else if (Date.parse(old.start) !== Date.parse(e.start))
        this.add({
          kind: 'event.moved',
          ...by,
          subject: e.title,
          where: e.allDay
            ? dayWords(e.start, now, tz)
            : `${dayWords(e.start, now, tz)} ${clock(e.start, tz)}`,
          link: { tab: 'calendar', id: e.id },
        });
    }
    // Only future events that vanish are news; a past one leaving the window is not.
    for (const [id, old] of before)
      if (!next.has(id) && Date.parse(old.start) > now.getTime())
        this.add({ kind: 'event.removed', ...by, subject: old.title, link: { tab: 'calendar' } });
  }

  async diffMeals(record: boolean) {
    const meals = await this.o.sources.meals();
    const next = new Map(meals.map((m) => [`${m.date}|${m.slot}`, m.title]));
    const before = this.snap.meals;
    this.snap.meals = next;
    if (!record || !before) return;
    const now = this.o.now();
    const tz = this.o.timeZone();
    const by = this.writer();
    for (const m of meals) {
      const key = `${m.date}|${m.slot}`;
      if (before.get(key) === m.title) continue;
      this.add({
        kind: 'meal.planned',
        ...by,
        subject: m.title,
        where: `${dayWords(m.date, now, tz)}${m.slot === 'dinner' ? '' : ` ${m.slot}`}`,
        link: { tab: 'meals', id: m.date },
        group: 'meals',
      });
    }
  }

  async diffNotes(record: boolean) {
    const notes = this.o.sources.notes();
    const before = this.snap.notes;
    this.snap.notes = new Set(notes.map((n) => n.id));
    if (!record || !before) return;
    for (const n of notes) {
      if (before.has(n.id)) continue;
      const who = this.personName(n.personId) ?? n.from;
      this.add({
        kind: 'note.posted',
        ...(n.personId ? { personId: n.personId } : {}),
        ...(who ? { who } : {}),
        subject: n.text || 'a drawing',
        link: { tab: 'note', id: n.id },
      });
    }
  }

  stop() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}

function clock(iso: string, tz: string): string {
  const p = zoned(new Date(iso), tz);
  const h = p.hour % 12 || 12;
  return `${h}:${String(p.minute).padStart(2, '0')} ${p.hour < 12 ? 'AM' : 'PM'}`;
}
