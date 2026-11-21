/**
 * The morning digest and the nudges (v4 D). Once a minute the scheduler looks at the household
 * clock (`settings.timezone`, so a server in UTC still sends at 7:00 local, and a DST change
 * moves nothing) and sends what is due: each person's morning digest, the evening "tomorrow"
 * preview, the late-afternoon routine reminder, event reminders and "dinner is not planned".
 * What was sent is kept in the database so a restart never sends twice. Quiet hours hold
 * everything back; a digest due in quiet hours goes when they end (within three hours).
 */
import Anthropic from '@anthropic-ai/sdk';
import {
  DEFAULT_DIGEST_SETTINGS,
  deepLinkUrl,
  digestPerson,
  digestPushBody,
  hhmmMinutes,
  inQuietHours,
  morningTimeFor,
  type CalendarEvent,
  type Digest,
  type DigestKind,
  type DigestSettings,
  type PluginBlocksInput,
  type Settings,
} from '@mantel/shared';
import { kvGet, kvSet, type Db } from '../../db/index.js';
import { log } from '../../log.js';
import type { Providers } from '../../providers/types.js';
import { dateInZone, isoInZone, zoned } from '../../providers/real/weather-time.js';
import type { PushService } from '../push/service.js';
import type { PluginRegistry } from '../registry.js';
import { shiftDate, wallTime } from '../import/zone.js';
import { assembleDigest, dayBounds, digestDate } from './assemble.js';

export const DIGEST_MODEL = 'claude-sonnet-5-5';
const SENT_KEY = 'digest.sent';
/** A send missed (server off, quiet hours) still goes within this many minutes. */
const CATCH_UP_MIN = 180;

export interface DigestServiceOptions {
  db: Db;
  now: () => Date;
  settings: () => Settings;
  providers: Pick<Providers, 'calendar' | 'weather' | 'lists'>;
  meals: {
    todayMeals(
      week?: Date,
    ): Promise<{ meals: Array<{ date: string; slot: string; title: string }> }>;
  };
  push: Pick<PushService, 'notify' | 'phonesOf' | 'recordMock'>;
  registry: Pick<PluginRegistry, 'manifests' | 'blocks' | 'resolve'> | null;
  mock: boolean;
  fetch?: typeof fetch;
  /**
   * The household's zone; defaults to `settings.timezone`. Mock mode passes the machine's own,
   * because the fixtures are generated in it.
   */
  timeZone?: () => string;
  /** Claude, for the optional one-line summary (tests pass a fake). */
  summarise?: (digest: Digest, apiKey: string) => Promise<string | null>;
}

export interface SendResult {
  sent: number;
  url: string;
  digest: Digest;
}

export class DigestService {
  private timer: NodeJS.Timeout | undefined;
  private upcoming: { at: number; events: CalendarEvent[] } | null = null;
  private summaries = new Map<string, string>();

  constructor(private readonly o: DigestServiceOptions) {}

  private cfg(): DigestSettings {
    return this.o.settings().digest ?? DEFAULT_DIGEST_SETTINGS;
  }
  private tz() {
    return this.o.timeZone?.() ?? this.o.settings().timezone;
  }

  /* ---------- building ---------- */

  async build(kind: DigestKind, personId: string | null): Promise<Digest> {
    const s = this.o.settings();
    const now = this.o.now();
    const tz = this.tz();
    const person = personId ? (s.people.find((p) => p.id === personId) ?? null) : null;
    const include = person
      ? digestPerson(s.digest, person.id).include
      : { events: true, chores: true, dinner: true, weather: true, birthdays: true, alerts: true };
    const date = digestDate(now, tz, kind);
    const { from, to } = dayBounds(date, tz);
    const quiet = <T>(p: Promise<T>, fallback: T): Promise<T> =>
      p.catch((err: unknown) => {
        log.warn('digest: a source failed', { err: String(err) });
        return fallback;
      });

    const [events, calendars, chores, meals, weather] = await Promise.all([
      quiet(
        this.o.providers.calendar.events(from, to).then((r) => r.events),
        [],
      ),
      quiet(this.o.providers.calendar.calendars(), []),
      quiet(
        this.o.providers.lists.chores().then((r) => r.chores),
        [],
      ),
      quiet(
        this.o.meals.todayMeals(from).then((r) => r.meals),
        [],
      ),
      quiet(
        this.o.providers.weather.weather().then((r) => r as never),
        null,
      ),
    ]);
    const leaveBy =
      kind === 'morning' && include.events
        ? await quiet(
            this.o.providers.weather.commute(async () => events).then((r) => r.leaveBy),
            [],
          )
        : [];
    const alerts = include.alerts ? await this.pluginAlerts() : [];

    const digest = assembleDigest({
      now,
      timeZone: tz,
      kind,
      person,
      include,
      events,
      calendars,
      leaveBy,
      chores,
      meals: meals as never,
      weather,
      alerts,
    });
    const summary = s.digest?.aiSummary ? await this.summary(digest) : undefined;
    return summary ? { ...digest, summary } : digest;
  }

  /** Lines from plugins with an Ambient slot (trash day...): their title when they have one. */
  private async pluginAlerts(): Promise<Digest['alerts']> {
    const reg = this.o.registry;
    if (!reg) return [];
    const out: Digest['alerts'] = [];
    for (const m of reg.manifests()) {
      const slot = m.contributes?.ambientSlot;
      if (m.id === 'digest' || !slot || typeof slot === 'string') continue;
      try {
        const b = await reg.blocks(m.id, slot.data);
        if (b?.title)
          out.push({ icon: b.icon ?? 'info', text: b.title, tone: b.lines[0]?.tone ?? 'normal' });
      } catch {
        // A plugin without that block is simply not part of the digest.
      }
    }
    return out;
  }

  private async summary(d: Digest): Promise<string | undefined> {
    const key = `${d.personId}|${d.kind}|${d.date}`;
    const cached = this.summaries.get(key);
    if (cached) return cached;
    let text: string | null = null;
    if (this.o.mock) text = mockSummary(d);
    else {
      const apiKey = this.o.registry?.resolve('quips').secrets.claudeApiKey;
      if (!apiKey) return undefined;
      text = await (this.o.summarise ?? ((dd, k) => summariseWithClaude(dd, k, this.o.fetch)))(
        d,
        apiKey,
      );
    }
    if (!text) return undefined;
    if (this.summaries.size > 50) this.summaries.clear();
    this.summaries.set(key, text);
    return text;
  }

  /* ---------- sending ---------- */

  async send(
    kind: DigestKind,
    personId: string,
    opts: { alsoDeviceId?: string | null; test?: boolean } = {},
  ): Promise<SendResult> {
    const digest = await this.build(kind, personId);
    const url = deepLinkUrl({ tab: 'digest', id: `${kind}:${personId}` });
    const message = {
      title: opts.test ? `${digest.greeting} (test)` : digest.greeting,
      body: digestPushBody(digest),
      url,
      tag: `digest-${kind}-${personId}`,
    };
    let sent = await this.o.push.notify('digest', message, {
      exactPeople: [personId],
      ...(opts.alsoDeviceId ? { alsoDeviceId: opts.alsoDeviceId } : {}),
    });
    if (sent === 0 && this.o.mock && opts.test) {
      this.o.push.recordMock('digest', message);
      sent = 1;
    }
    return { sent, url, digest };
  }

  private async nudge(
    title: string,
    body: string,
    url: string,
    tag: string,
    people?: string[],
  ): Promise<number> {
    return this.o.push.notify(
      'nudge',
      { title, body, url, tag },
      people ? { exactPeople: people } : {},
    );
  }

  /* ---------- the schedule ---------- */

  private sent(): Record<string, string> {
    return kvGet<Record<string, string>>(this.o.db, SENT_KEY) ?? {};
  }
  private wasSent(key: string) {
    return key in this.sent();
  }
  private markSent(key: string, date: string) {
    const all = this.sent();
    all[key] = date;
    // Keep three days of marks.
    const keepFrom = shiftDate(date, -3);
    for (const [k, d] of Object.entries(all)) if (d < keepFrom) delete all[k];
    kvSet(this.o.db, SENT_KEY, all);
  }

  /**
   * One pass of the schedule. Exposed for tests, which move the clock and call it; the timer
   * calls it every minute.
   */
  async tick(): Promise<string[]> {
    const s = this.o.settings();
    const d = s.digest ?? DEFAULT_DIGEST_SETTINGS;
    const now = this.o.now();
    const tz = this.tz();
    const today = dateInZone(now, tz);
    const parts = zoned(now, tz);
    const minutes = parts.hour * 60 + parts.minute;
    const done: string[] = [];
    if (inQuietHours(minutes, d.quiet)) return done;

    const due = (hhmm: string) => {
      const at = hhmmMinutes(hhmm);
      return minutes >= at && minutes < at + CATCH_UP_MIN;
    };
    const once = async (key: string, run: () => Promise<unknown>) => {
      if (this.wasSent(key)) return;
      this.markSent(key, today);
      done.push(key);
      try {
        await run();
      } catch (err) {
        log.warn('digest: a send failed', { key, err: String(err) });
      }
    };

    let chores: Awaited<ReturnType<Providers['lists']['chores']>>['chores'] | null = null;
    const loadChores = async () =>
      (chores ??= await this.o.providers.lists.chores().then(
        (r) => r.chores,
        () => [],
      ));

    for (const person of s.people) {
      const p = digestPerson(d, person.id);
      if (p.morning && due(morningTimeFor(p, parts.weekday)))
        await once(`morning|${person.id}|${today}`, () => this.send('morning', person.id));
      if (p.evening && due(p.eveningTime))
        await once(`evening|${person.id}|${today}`, () => this.send('evening', person.id));
      if (p.routineNudge && due(d.nudges.routineTime))
        await once(`routine|${person.id}|${today}`, async () => {
          const open = (await loadChores()).filter(
            (c) => c.personId === person.id && c.routineId && c.doneCount < c.target,
          );
          if (!open.length) return;
          await this.nudge(
            `${person.name}, ${open.length} routine ${open.length === 1 ? 'step' : 'steps'} left`,
            open
              .slice(0, 4)
              .map((c) => c.title)
              .join(', '),
            deepLinkUrl({ tab: 'chores', id: open[0]!.id }),
            `routine-${person.id}`,
            [person.id],
          );
        });
    }

    if (d.nudges.dinner && due(d.nudges.dinnerTime))
      await once(`dinner|${today}`, async () => {
        const meals = await this.o.meals
          .todayMeals(wallTime(today, '12:00', tz))
          .then((r) => r.meals)
          .catch(() => null);
        if (!meals || meals.some((m) => m.date === today && m.slot === 'dinner')) return;
        await this.nudge(
          'Dinner is not planned',
          'Pick something from favourites in the phone app, or on the wall.',
          deepLinkUrl({ tab: 'meals', id: today }),
          `dinner-${today}`,
        );
      });

    await this.eventReminders(d, now, today, once);
    return done;
  }

  private async eventReminders(
    d: DigestSettings,
    now: Date,
    today: string,
    once: (key: string, run: () => Promise<unknown>) => Promise<void>,
  ) {
    const anyOn =
      d.nudges.eventMinutes > 0 || Object.values(d.nudges.calendarMinutes).some(Boolean);
    if (!anyOn) return;
    const events = await this.upcomingEvents(now);
    const tz = this.tz();
    for (const e of events) {
      if (e.allDay) continue;
      const lead = d.nudges.calendarMinutes[e.calendarId] ?? d.nudges.eventMinutes;
      if (!lead) continue;
      const start = Date.parse(e.start);
      const msLeft = start - now.getTime();
      // Inside the lead time and not started; a reminder missed by more than 5 minutes is dropped.
      if (msLeft <= 0 || msLeft > lead * 60_000 || msLeft < lead * 60_000 - 5 * 60_000) continue;
      const mins = Math.max(1, Math.round(msLeft / 60_000));
      const p = zoned(new Date(start), tz);
      const at = `${p.hour % 12 || 12}:${String(p.minute).padStart(2, '0')} ${p.hour < 12 ? 'AM' : 'PM'}`;
      await once(`event|${e.id}|${e.start}`, () =>
        this.nudge(
          `${e.title} in ${mins} min`,
          `At ${at}${e.location ? `, ${e.location}` : ''}.`,
          deepLinkUrl({ tab: 'calendar', id: e.id }),
          `event-${e.id}`,
          e.personIds.length ? e.personIds : undefined,
        ),
      );
    }
    void today;
  }

  /** Events starting in the next four hours, refreshed every five minutes. */
  private async upcomingEvents(now: Date): Promise<CalendarEvent[]> {
    if (this.upcoming && now.getTime() - this.upcoming.at < 5 * 60_000) return this.upcoming.events;
    const events = await this.o.providers.calendar
      .events(now, new Date(now.getTime() + 4 * 3_600_000))
      .then((r) => r.events)
      .catch(() => [] as CalendarEvent[]);
    this.upcoming = { at: now.getTime(), events };
    return events;
  }

  /** The calendar changed: look again at the next tick. */
  calendarChanged() {
    this.upcoming = null;
  }

  start(everyMs = 60_000) {
    this.timer = setInterval(() => void this.tick().catch(() => undefined), everyMs);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
  }

  /* ---------- status and the wall ---------- */

  /** When each person's next morning and evening digests go. */
  status() {
    const s = this.o.settings();
    const tz = this.tz();
    const now = this.o.now();
    const today = dateInZone(now, tz);
    const next = (time: (date: string, weekday: number) => string | null) => {
      for (let i = 0; i < 8; i++) {
        const date = shiftDate(today, i);
        const weekday = zoned(wallTime(date, '12:00', tz), tz).weekday;
        const hhmm = time(date, weekday);
        if (!hhmm) return null;
        const at = wallTime(date, hhmm, tz);
        if (at.getTime() > now.getTime()) return isoInZone(at, tz);
      }
      return null;
    };
    return {
      people: s.people.map((person) => {
        const p = digestPerson(s.digest, person.id);
        return {
          personId: person.id,
          phones: this.o.push.phonesOf(person.id, 'digest'),
          nextMorning: p.morning ? next((_, wd) => morningTimeFor(p, wd)) : null,
          nextEvening: p.evening ? next(() => p.eveningTime) : null,
        };
      }),
      aiReady: this.o.mock || !!this.o.registry?.resolve('quips').secrets.claudeApiKey,
    };
  }

  /**
   * The wall's blocks. `card`: the household's day for the Today layout. `ambient`: a good
   * morning line for the first hour after the earliest morning digest.
   */
  async blocks(name: string): Promise<PluginBlocksInput | null | undefined> {
    if (name !== 'card' && name !== 'ambient') return undefined;
    const s = this.o.settings();
    const now = this.o.now();
    const tz = this.tz();
    if (name === 'ambient') {
      const parts = zoned(now, tz);
      const minutes = parts.hour * 60 + parts.minute;
      const starts = s.people.map((p) =>
        hhmmMinutes(morningTimeFor(digestPerson(s.digest, p.id), parts.weekday)),
      );
      const first = starts.length ? Math.min(...starts) : hhmmMinutes('07:00');
      if (minutes < first || minutes >= first + 60) return null;
    }
    const d = await this.build('morning', null);
    if (name === 'ambient') {
      return {
        title: d.headline,
        icon: 'calendar',
        lines: d.weather?.warning ? [{ text: d.weather.warning, tone: 'warn' }] : [],
      };
    }
    return wallCard(d, tz);
  }
}

/** The Today card: weather, the next events, chores left, dinner and reminders. */
export function wallCard(d: Digest, tz: string): PluginBlocksInput {
  const lines: PluginBlocksInput['lines'] = [];
  if (d.weather)
    lines.push({
      icon: 'info',
      text: d.weather.line,
      ...(d.weather.warning ? { sub: d.weather.warning, tone: 'warn' as const } : {}),
    });
  const timed = d.events.filter((e) => !e.allDay);
  const allDay = d.events.filter((e) => e.allDay);
  for (const e of [...allDay, ...timed].slice(0, 3)) {
    const p = zoned(new Date(e.start), tz);
    const when = e.allDay
      ? 'All day'
      : `${p.hour % 12 || 12}:${String(p.minute).padStart(2, '0')} ${p.hour < 12 ? 'AM' : 'PM'}`;
    let sub = when;
    if (e.leaveBy) {
      const l = zoned(new Date(e.leaveBy), tz);
      sub += ` · leave by ${l.hour % 12 || 12}:${String(l.minute).padStart(2, '0')}`;
    }
    lines.push({ icon: 'calendar', text: e.title, sub });
  }
  if (d.events.length > 3)
    lines.push({ icon: 'calendar', text: `And ${d.events.length - 3} more today` });
  const open = d.chores.filter((c) => !c.done);
  const rolled = open.filter((c) => c.overdueSince).length;
  if (d.chores.length)
    lines.push({
      icon: open.length ? 'star' : 'check',
      text: open.length
        ? `${open.length} chore${open.length === 1 ? '' : 's'} to do`
        : 'Every chore done',
      ...(rolled ? { sub: `${rolled} carried over`, tone: 'warn' as const } : {}),
      ...(open.length ? {} : { tone: 'good' as const }),
    });
  lines.push(
    d.dinner
      ? { icon: 'leaf', text: `Dinner: ${d.dinner}` }
      : { icon: 'leaf', text: 'Dinner is not planned yet', tone: 'warn' },
  );
  for (const b of d.birthdays) lines.push({ icon: 'star', text: `${b}'s birthday`, tone: 'good' });
  for (const a of d.alerts) lines.push({ icon: a.icon, text: a.text, tone: a.tone });
  return {
    title: d.headline,
    icon: 'calendar',
    lines,
    ...(d.summary ? { footer: d.summary } : {}),
  };
}

function mockSummary(d: Digest): string {
  const first = d.events.find((e) => !e.allDay);
  return first
    ? `A full one: ${first.title} first${d.dinner ? `, and ${d.dinner.toLowerCase()} to look forward to tonight` : ''}.`
    : `A quiet day${d.dinner ? `, with ${d.dinner.toLowerCase()} for dinner` : ''}.`;
}

/** One friendly sentence about the day from Claude, or null when the call fails. */
export async function summariseWithClaude(
  d: Digest,
  apiKey: string,
  fetchFn?: typeof fetch,
): Promise<string | null> {
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 20_000, fetch: fetchFn });
  const brief = {
    who: d.greeting,
    kind: d.kind,
    weather: d.weather,
    events: d.events.map((e) => ({ title: e.title, start: e.start, allDay: e.allDay })),
    chores: d.chores.filter((c) => !c.done).map((c) => c.title),
    dinner: d.dinner,
    birthdays: d.birthdays,
    reminders: d.alerts.map((a) => a.text),
  };
  try {
    const response = await client.messages.create({
      model: DIGEST_MODEL,
      max_tokens: 200,
      output_config: { effort: 'low' },
      system: [
        'You write the first line of a family member’s morning message from their kitchen wall display.',
        'One warm, plain sentence of at most 140 characters that sums up the day from the brief. No emoji, no quotation marks.',
        'Never invent anything that is not in the brief. Children may read it.',
        'Answer with the sentence only.',
      ].join('\n'),
      messages: [{ role: 'user', content: JSON.stringify(brief) }],
    });
    if (response.stop_reason === 'refusal') return null;
    const text = response.content
      .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join(' ')
      .trim()
      .replace(/^["“]|["”]$/g, '');
    return text && text.length <= 220 ? text : null;
  } catch (err) {
    log.warn('digest: Claude summary failed', { err: String(err) });
    return null;
  }
}
