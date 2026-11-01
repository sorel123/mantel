/**
 * WS2: the real calendar provider. Google and iCloud calendars are synced into SQLite on a
 * rolling window (two months back, a year ahead) and the routes read from that cache, so the
 * wall never waits on an upstream service. Google pushes changes when the server has a public
 * https address; otherwise, and for iCloud, the server polls.
 */
import type { CalendarEvent, CalendarSource } from '@mantel/shared';
import { addDays, startOfDay, startOfWeek, toIsoDate, toLocalIso } from '@mantel/shared';
import type { Hono } from 'hono';
import type { DeviceAuth } from '../../../auth.js';
import { HttpError } from '../../../errors.js';
import { log } from '../../../log.js';
import type { CalendarProvider, ProviderContext } from '../../types.js';
import { CalDavSource } from './caldav.js';
import { FeedSource, feedUrls } from './feed.js';
import { loadCalendarEnv, type CalendarEnv } from './env.js';
import { GoogleAuth, GoogleSource, type PushChannel } from './google.js';
import { countdownsFrom, isEnabled, isMeals, mealsFrom, toCalendar, toEvent } from './normalize.js';
import { mountCalendarSetup } from './setup.js';
import { googleRedirect, pushAddress } from './urls.js';
import { CalendarStore } from './store.js';
import type { CalendarPrefs, RawEvent, Source, SourceCalendar } from './types.js';

export interface RealCalendarOptions {
  env?: CalendarEnv;
  fetch?: typeof fetch;
  /** Start the sync loop on creation (default true; tests turn it off). */
  autoStart?: boolean;
}

interface SyncState {
  /** iCloud ctag and window start at the last full fetch, per calendar. */
  [calendarId: string]: { ctag?: string; windowFrom: string };
}

export interface SourceStatus {
  configured: boolean;
  connected: boolean;
  lastSync: string | null;
  error: string | null;
}

export class RealCalendar implements CalendarProvider {
  readonly store: CalendarStore;
  readonly env: CalendarEnv;
  readonly googleAuth: GoogleAuth;
  readonly google: GoogleSource;
  readonly icloud: CalDavSource;
  readonly feeds: FeedSource;
  readonly redirect: { uri: string; pasteBack: boolean };
  private readonly sources: Source[];
  private running: Promise<void> | null = null;
  private again = false;
  private firstSync: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pushTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  readonly status: Record<CalendarSource, { lastSync: string | null; error: string | null }> = {
    google: { lastSync: null, error: null },
    icloud: { lastSync: null, error: null },
    ical: { lastSync: null, error: null },
  };

  constructor(
    private readonly ctx: ProviderContext,
    opts: RealCalendarOptions = {},
  ) {
    this.env = opts.env ?? loadCalendarEnv();
    this.store = new CalendarStore(ctx.db);
    this.redirect = googleRedirect(this.env, ctx.config);
    this.googleAuth = new GoogleAuth(this.store, {
      clientId: this.env.GOOGLE_CLIENT_ID,
      clientSecret: this.env.GOOGLE_CLIENT_SECRET,
      redirectUri: this.redirect.uri,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
    this.google = new GoogleSource(this.googleAuth);
    this.icloud = new CalDavSource({
      url: this.env.ICLOUD_CALDAV_URL,
      username: this.env.ICLOUD_USERNAME,
      password: this.env.ICLOUD_APP_PASSWORD,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
    this.feeds = new FeedSource({
      urls: feedUrls([this.env.ICAL_URLS]),
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
    this.sources = [this.google, this.icloud, this.feeds];
    if (opts.autoStart !== false) this.start();
  }

  /* ---- lifecycle ---- */

  start() {
    this.stopped = false;
    if (!this.sources.some((s) => s.ready())) return;
    this.firstSync = this.sync();
    this.schedule();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearTimeout(this.pushTimer);
  }

  private schedule() {
    clearTimeout(this.timer);
    if (this.stopped) return;
    const pushOnly = this.pushActive() && !this.icloud.ready() && !this.feeds.ready();
    const seconds = pushOnly ? this.env.CALENDAR_PUSH_POLL_SECONDS : this.env.CALENDAR_POLL_SECONDS;
    this.timer = setTimeout(() => {
      void this.sync().finally(() => this.schedule());
    }, seconds * 1000);
    this.timer.unref?.();
  }

  /** Sync soon, coalescing bursts (a push often arrives in twos and threes). */
  syncSoon(delayMs = 1500) {
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => void this.sync(), delayMs);
    this.pushTimer.unref?.();
  }

  window(now = this.ctx.now()) {
    const today = startOfDay(now);
    return {
      from: addDays(today, -this.env.CALENDAR_PAST_DAYS),
      to: addDays(today, this.env.CALENDAR_FUTURE_DAYS),
    };
  }

  /* ---- calendars and preferences ---- */

  prefs(): CalendarPrefs {
    return this.store.prefs();
  }

  setPrefs(prefs: CalendarPrefs) {
    this.store.setPrefs(prefs);
    this.ctx.emit({
      type: 'calendar.changed',
      payload: { from: toLocalIso(this.window().from), to: toLocalIso(this.window().to) },
    });
    if (this.sources.some((s) => s.ready())) void this.sync();
  }

  /** Every calendar the sources know about, with this household's choices applied. */
  sourceCalendars(): SourceCalendar[] {
    return this.store.sourceCalendars();
  }

  /** Calendars whose events are fetched: the ones shown plus the meal plan. */
  private synced(prefs = this.prefs()): SourceCalendar[] {
    return this.sourceCalendars().filter((c) => isEnabled(c, prefs) || isMeals(c, prefs));
  }

  async calendars() {
    const prefs = this.prefs();
    const people = this.ctx.settings().people;
    return this.synced(prefs).map((c) => toCalendar(c, prefs, people));
  }

  sourceStatus(kind: CalendarSource): SourceStatus {
    const source = this.sources.find((s) => s.kind === kind)!;
    const configured = kind === 'google' ? this.googleAuth.configured() : source.ready();
    const connected = kind === 'google' ? this.googleAuth.connected() : source.ready();
    return { configured, connected, ...this.status[kind] };
  }

  /* ---- sync ---- */

  /** One sync at a time; a request during a run queues exactly one more. */
  sync(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.runSync()
      .catch((err: unknown) => log.warn('calendar sync failed', { err: String(err) }))
      .finally(() => {
        this.running = null;
        if (this.again && !this.stopped) {
          this.again = false;
          void this.sync();
        }
      });
    return this.running;
  }

  private async runSync() {
    const { from, to } = this.window();
    const previous = this.store.sourceCalendars();
    const listed: SourceCalendar[] = [];
    const okSources = new Set<string>();

    for (const source of this.sources) {
      if (!source.ready()) continue;
      try {
        listed.push(...(await source.calendars()));
        okSources.add(source.kind);
      } catch (err) {
        this.status[source.kind].error = errText(err);
        // Keep what we knew so the wall keeps its calendars through an outage.
        listed.push(...previous.filter((c) => c.source === source.kind));
      }
    }
    // A source that is no longer configured drops its calendars.
    const all = listed;
    this.store.setSourceCalendars(all);
    this.store.dropCalendarsExcept(all.map((c) => c.id));

    const prefs = this.prefs();
    const state = this.store.get<SyncState>('syncState') ?? {};
    const windowFrom = from.toISOString();
    let lo = Infinity;
    let hi = -Infinity;
    const failed = new Set<string>();

    for (const cal of all.filter((c) => isEnabled(c, prefs) || isMeals(c, prefs))) {
      if (!okSources.has(cal.source)) continue;
      const prev = state[cal.id];
      if (cal.ctag && prev?.ctag === cal.ctag && prev.windowFrom === windowFrom) continue;
      const source = this.sources.find((s) => s.kind === cal.source)!;
      try {
        const events = await source.events(cal, from, to);
        const change = this.store.replaceWindow(cal.id, from, to, events);
        if (change) {
          lo = Math.min(lo, change.from);
          hi = Math.max(hi, change.to);
        }
        state[cal.id] = { ...(cal.ctag ? { ctag: cal.ctag } : {}), windowFrom };
      } catch (err) {
        failed.add(cal.source);
        this.status[cal.source].error = `${cal.name}: ${errText(err)}`;
      }
    }
    this.store.set('syncState', state);
    this.store.prune(from);

    const at = new Date().toISOString();
    for (const kind of okSources) {
      if (failed.has(kind)) continue;
      this.status[kind as CalendarSource] = { lastSync: at, error: null };
    }
    if (okSources.size) this.ctx.markSynced('calendar');
    if (lo <= hi) {
      this.ctx.emit({
        type: 'calendar.changed',
        payload: { from: toLocalIso(new Date(lo)), to: toLocalIso(new Date(hi)) },
      });
    }
    if (okSources.has('google')) await this.ensurePush(all, prefs);
  }

  /* ---- Google push channels ---- */

  private channels(): PushChannel[] {
    return this.store.get<PushChannel[]>('google.channels') ?? [];
  }

  pushActive(): boolean {
    const now = Date.now();
    return this.channels().some((c) => c.expiration > now);
  }

  private async ensurePush(all: SourceCalendar[], prefs: CalendarPrefs) {
    const address = pushAddress(this.ctx.config);
    const wanted = all.filter(
      (c) => c.source === 'google' && (isEnabled(c, prefs) || isMeals(c, prefs)),
    );
    const current = this.channels();
    if (!address) {
      if (current.length) this.store.set('google.channels', []);
      return;
    }
    const soon = Date.now() + 864e5;
    const keep: PushChannel[] = [];
    for (const ch of current) {
      if (wanted.some((c) => c.id === ch.calendarId) && ch.expiration > soon) keep.push(ch);
      else await this.google.stop(ch);
    }
    for (const cal of wanted) {
      if (keep.some((c) => c.calendarId === cal.id)) continue;
      try {
        keep.push(await this.google.watch(cal, address));
      } catch (err) {
        // Not fatal: polling covers it. Usually the domain is not verified for push.
        log.debug('google: watch failed', { calendar: cal.name, err: errText(err) });
      }
    }
    this.store.set('google.channels', keep);
  }

  /** A Google push notification. True when it matched one of our channels. */
  onPush(channelId: string | undefined, token: string | undefined, state: string | undefined) {
    const ch = this.channels().find((c) => c.channelId === channelId && c.token === token);
    if (!ch) return false;
    if (state !== 'sync') this.syncSoon();
    return true;
  }

  /* ---- reads ---- */

  /** Wait (briefly) for the first sync after start, so a fresh server does not answer empty. */
  private async warm() {
    if (!this.firstSync) return;
    await Promise.race([this.firstSync, new Promise((r) => setTimeout(r, 8000).unref?.())]);
  }

  private async raws(cals: SourceCalendar[], from: Date, to: Date): Promise<RawEvent[]> {
    await this.warm();
    const w = this.window();
    const ids = cals.map((c) => c.id);
    if (from >= w.from && to <= w.to) return this.store.events(ids, from, to);
    // Outside the cached window (paging far back or ahead): ask the sources directly.
    const out: RawEvent[] = [];
    for (const cal of cals) {
      const source = this.sources.find((s) => s.kind === cal.source);
      try {
        if (!source?.ready()) throw new Error('not connected');
        out.push(...(await source.events(cal, from, to)));
      } catch {
        out.push(...this.store.events([cal.id], from, to));
      }
    }
    return out;
  }

  private toEvents(raws: RawEvent[], prefs = this.prefs()): CalendarEvent[] {
    const people = this.ctx.settings().people;
    const byId = new Map(this.sourceCalendars().map((c) => [c.id, toCalendar(c, prefs, people)]));
    return raws
      .flatMap((r) => {
        const cal = byId.get(r.calendarId);
        return cal ? [toEvent(r, cal, people)] : [];
      })
      .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  }

  async events(from: Date, to: Date) {
    const prefs = this.prefs();
    const shown = this.sourceCalendars().filter((c) => isEnabled(c, prefs) && !isMeals(c, prefs));
    return { events: this.toEvents(await this.raws(shown, from, to), prefs) };
  }

  async countdowns() {
    const now = this.ctx.now();
    const today = startOfDay(now);
    const { events } = await this.events(today, addDays(today, this.env.CALENDAR_FUTURE_DAYS));
    return { countdowns: countdownsFrom(events, now) };
  }

  async meals(week?: Date) {
    const prefs = this.prefs();
    const weekStart = startOfWeek(week ?? this.ctx.now());
    const cals = this.synced(prefs).filter((c) => isMeals(c, prefs));
    const raws = await this.raws(cals, weekStart, addDays(weekStart, 7));
    const withIds = raws.map((r) => ({ ...r, eventId: `${r.calendarId}|${r.uid}` }));
    return { weekStart: toIsoDate(weekStart), meals: mealsFrom(withIds, weekStart) };
  }

  /** Where quick add writes when the display does not say. */
  defaultCalendar(prefs = this.prefs()): SourceCalendar | undefined {
    const writable = this.sourceCalendars().filter((c) => !c.readOnly && !isMeals(c, prefs));
    return (
      writable.find((c) => c.id === prefs.defaultCalendarId) ??
      writable.find((c) => c.primary && isEnabled(c, prefs)) ??
      writable.find((c) => isEnabled(c, prefs)) ??
      writable[0]
    );
  }

  async quickAdd(req: Parameters<CalendarProvider['quickAdd']>[0]) {
    const prefs = this.prefs();
    const cal = req.calendarId
      ? this.sourceCalendars().find((c) => c.id === req.calendarId)
      : this.defaultCalendar(prefs);
    if (!cal) throw new HttpError('bad_request', 'no writable calendar is connected');
    if (cal.readOnly) throw new HttpError('forbidden', `${cal.name} is read-only`);
    const source = this.sources.find((s) => s.kind === cal.source)!;
    if (!source.ready()) throw new HttpError('upstream_error', `${cal.source} is not connected`);

    const allDay = req.allDay ?? false;
    const start = allDay ? startOfDay(new Date(req.start)) : new Date(req.start);
    let end = req.end
      ? new Date(req.end)
      : allDay
        ? addDays(start, 1)
        : new Date(start.getTime() + 3600e3);
    if (allDay) end = startOfDay(end) > start ? startOfDay(end) : addDays(start, 1);
    if (end <= start) throw new HttpError('bad_request', 'end must be after start');

    const raw = await source.create(cal, {
      title: req.title.trim(),
      start,
      end,
      allDay,
      personIds: req.personIds ?? [],
    });
    this.store.put(raw);
    this.ctx.emit({ type: 'calendar.changed', payload: { from: raw.start, to: raw.end } });
    const [event] = this.toEvents([raw], prefs);
    if (!event) throw new HttpError('internal', 'new event has no calendar');
    return { event };
  }

  /** The calendar, its source and the cached occurrence behind a display event id. */
  private editable(id: string) {
    const bar = id.indexOf('|');
    const calendarId = bar > 0 ? id.slice(0, bar) : '';
    const uid = bar > 0 ? id.slice(bar + 1) : '';
    const cal = this.sourceCalendars().find((c) => c.id === calendarId);
    const raw = cal && this.store.getEvent(cal.id, uid);
    if (!cal || !raw) throw new HttpError('not_found', 'that event is not on the wall any more');
    if (cal.readOnly) throw new HttpError('forbidden', `${cal.name} is read-only`);
    const source = this.sources.find((s) => s.kind === cal.source);
    if (!source?.update || !source.remove)
      throw new HttpError('forbidden', `${cal.name} can't be changed from Mantel`);
    if (!source.ready()) throw new HttpError('upstream_error', `${cal.source} is not connected`);
    return { cal, raw, uid, source: source as Required<typeof source> };
  }

  async updateEvent(id: string, req: Parameters<CalendarProvider['updateEvent']>[1]) {
    const prefs = this.prefs();
    const { cal, raw, uid, source } = this.editable(id);
    const allDay = req.allDay ?? raw.allDay;
    const oldStart = new Date(raw.start);
    const length = new Date(raw.end).getTime() - oldStart.getTime();
    let start = req.start ? new Date(req.start) : oldStart;
    let end = req.end ? new Date(req.end) : new Date(start.getTime() + length);
    if (allDay) {
      start = startOfDay(start);
      end = startOfDay(end) > start ? startOfDay(end) : addDays(start, 1);
    } else if (raw.allDay && !req.end) {
      end = new Date(start.getTime() + 3600e3);
    }
    if (end <= start) throw new HttpError('bad_request', 'end must be after start');

    const next = await source.update(cal, uid, {
      title: req.title?.trim() || raw.title,
      start,
      end,
      allDay,
      ...(req.location !== undefined ? { location: req.location } : {}),
      ...(req.personIds !== undefined ? { personIds: req.personIds } : {}),
    });
    this.store.removeEvent(cal.id, uid);
    this.store.put(next);
    const from = raw.start < next.start ? raw.start : next.start;
    const to = raw.end > next.end ? raw.end : next.end;
    this.ctx.emit({ type: 'calendar.changed', payload: { from, to } });
    const [event] = this.toEvents([next], prefs);
    if (!event) throw new HttpError('internal', 'edited event has no calendar');
    return { event };
  }

  async deleteEvent(id: string) {
    const { cal, raw, uid, source } = this.editable(id);
    await source.remove(cal, uid);
    this.store.removeEvent(cal.id, uid);
    this.ctx.emit({ type: 'calendar.changed', payload: { from: raw.start, to: raw.end } });
    return { ok: true as const };
  }

  mount(api: Hono, auth: DeviceAuth) {
    mountCalendarSetup(api, auth, this, this.ctx);
  }
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function realCalendar(ctx: ProviderContext, opts?: RealCalendarOptions): RealCalendar {
  return new RealCalendar(ctx, opts);
}
