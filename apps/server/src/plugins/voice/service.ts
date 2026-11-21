/**
 * The Open Mantel service (v4 O): runs what `POST /api/say` parsed, writes the spoken summary
 * for Siri, builds the state Home Assistant's sensors read, and keeps a short activity feed
 * (chores done, rewards redeemed, things said) that the Home Assistant integration turns into
 * events on its bus. MCP tools call the same methods.
 */
import {
  SayRequest as SaySchema,
  type CalendarEvent,
  type Chore,
  type OpenActivity,
  type OpenState,
  type SayAction,
  type SayRequest,
  type SayResponse,
  type Settings,
  type WallNote,
  type WsEvent,
} from '@mantel/shared';
import { log } from '../../log.js';
import { dateInZone, isoInZone } from '../../providers/real/weather-time.js';
import type { Providers } from '../../providers/types.js';
import { commitImport } from '../import/commit.js';
import { shiftDate, wallIso } from '../import/zone.js';
import type { MealsService } from '../meals/index.js';
import { sayWithClaude } from './claude.js';
import { describe, joinAnd, parseSay, spokenTime, type SayContext } from './parse.js';

export interface OpenDeps {
  providers: Pick<Providers, 'calendar' | 'lists' | 'weather'>;
  meals?: Pick<MealsService, 'enabled' | 'plan' | 'todayMeals' | 'favourites'>;
  settings: () => Settings;
  /** The Claude key saved for quips, or '' when there is none. */
  claudeKey: () => string;
  /** Post a wall note (the notes store plus its WebSocket event and push). */
  postNote: (text: string, personId?: string) => Promise<WallNote>;
  now?: () => Date;
  version: string;
  mock: boolean;
  /** Tests pass a fake Claude. */
  claude?: typeof sayWithClaude;
}

const ACTIVITY_MAX = 50;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export class OpenService {
  private activityLog: OpenActivity[] = [];
  private seq = 0;
  private choreCounts: Map<string, number> | null = null;
  private choreTimer: NodeJS.Timeout | undefined;

  constructor(private readonly d: OpenDeps) {}

  private now() {
    return this.d.now?.() ?? new Date();
  }

  private zone() {
    return this.d.settings().timezone;
  }

  private today() {
    return dateInZone(this.now(), this.zone());
  }

  /* ---------- natural add ---------- */

  async context(personId?: string): Promise<SayContext> {
    const s = this.d.settings();
    const lists = await this.d.providers.lists
      .lists()
      .then((r) => r.lists)
      .catch(() => []);
    let mealNames: string[] = [];
    try {
      if (this.d.meals?.enabled())
        mealNames = this.d.meals.favourites().favourites.map((f) => f.title);
    } catch {
      /* the planner is off */
    }
    return {
      today: this.today(),
      lists: lists.map((l) => ({ id: l.id, name: l.name })),
      people: s.people.map((p) => ({ id: p.id, name: p.name })),
      defaultListId: s.open?.defaultListId ?? null,
      ...(personId ? { personId } : {}),
      mealNames,
    };
  }

  /** Parse a phrase (rules, then Claude when unsure and a key is saved) without running it. */
  async understand(
    text: string,
    personId?: string,
  ): Promise<{ action: SayAction; parser: 'rules' | 'claude' }> {
    const ctx = await this.context(personId);
    const rules = parseSay(text, ctx);
    const key = this.d.claudeKey();
    const long = text.trim().split(/\s+/).length > 12;
    const allowClaude = this.d.settings().open?.claudeParsing !== false;
    if (key && allowClaude && !this.d.mock && (!rules.confident || long)) {
      const better = await (this.d.claude ?? sayWithClaude)({ apiKey: key, text, ctx });
      if (better && better.kind !== 'none') return { action: better, parser: 'claude' };
    }
    return { action: rules.action, parser: 'rules' };
  }

  /** `check` may throw to refuse an action (a token without the scope for it). */
  async say(input: SayRequest, check?: (action: SayAction) => void): Promise<SayResponse> {
    const req = SaySchema.parse(input);
    const dryRun = !!req.dryRun;
    const { action, parser } = await this.understand(req.text, req.personId);
    check?.(action);
    const today = this.today();
    if (action.kind === 'none' || dryRun)
      return {
        ok: action.kind !== 'none',
        speech: describe(action, today, dryRun),
        action,
        parser,
        dryRun,
      };
    const problem = await this.run(action, req.personId);
    if (problem) return { ok: false, speech: problem, action, parser, dryRun };
    this.record({
      type: 'said',
      personId: req.personId ?? null,
      title: req.text.slice(0, 120),
      stars: null,
    });
    return { ok: true, speech: describe(action, today), action, parser, dryRun };
  }

  /** Run an action; returns a sentence when it failed. */
  async run(action: SayAction, personId?: string): Promise<string | null> {
    const tz = this.zone();
    try {
      switch (action.kind) {
        case 'note':
          await this.d.postNote(action.text, action.personId ?? personId);
          return null;
        case 'items': {
          let listId = action.listId;
          if (!listId) {
            const existing = (await this.d.providers.lists.lists()).lists.find(
              (l) => l.name.toLowerCase() === action.listName.toLowerCase(),
            );
            listId =
              existing?.id ??
              (await this.d.providers.lists.createList({ name: action.listName })).list.id;
          }
          for (const text of action.items)
            await this.d.providers.lists.addItem(listId, {
              text,
              ...(personId ? { personId } : {}),
            });
          return null;
        }
        case 'event':
        case 'meal': {
          const body =
            action.kind === 'event'
              ? {
                  events: [
                    {
                      title: action.title,
                      date: action.date,
                      allDay: action.allDay,
                      ...(action.start ? { start: action.start } : {}),
                      ...(action.end ? { end: action.end } : {}),
                      ...(action.location ? { location: action.location } : {}),
                      personIds: action.personIds,
                    },
                  ],
                  items: [],
                  meals: [],
                }
              : {
                  events: [],
                  items: [],
                  meals: [{ date: action.date, slot: action.slot, title: action.title }],
                };
          const result = await commitImport(body, this.d.providers, tz, this.d.meals);
          return result.problems[0] ?? null;
        }
        case 'none':
          return null;
      }
    } catch (err) {
      log.warn('say: could not add', { err: String(err) });
      const why = err instanceof Error ? err.message : String(err);
      return `Sorry, that could not be added: ${why}`;
    }
  }

  /* ---------- the day, spoken ---------- */

  private async eventsOn(date: string): Promise<CalendarEvent[]> {
    const tz = this.zone();
    const from = new Date(wallIso(date, '00:00', tz));
    const to = new Date(wallIso(shiftDate(date, 1), '00:00', tz));
    return this.d.providers.calendar
      .events(from, to)
      .then((r) => r.events)
      .catch(() => []);
  }

  private async dinnerOn(date: string): Promise<string | null> {
    try {
      const week = new Date(wallIso(date, '12:00', this.zone()));
      const meals = this.d.meals
        ? await this.d.meals.todayMeals(week)
        : await this.d.providers.calendar.meals(week);
      return meals.meals.find((m) => m.date === date && m.slot === 'dinner')?.title ?? null;
    } catch {
      return null;
    }
  }

  /** A few sentences for Siri to read out: weather, events, dinner, lists and chores. */
  async todayText(day: 'today' | 'tomorrow' = 'today'): Promise<{ text: string; date: string }> {
    const s = this.d.settings();
    const today = this.today();
    const date = day === 'today' ? today : shiftDate(today, 1);
    const d = new Date(`${date}T12:00:00Z`);
    const label = `${day === 'today' ? 'Today' : 'Tomorrow'} is ${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}.`;
    const parts: string[] = [label];

    try {
      const w = await this.d.providers.weather.weather();
      const daily = w.daily.find((x) => x.date === date);
      if (daily)
        parts.push(
          `${day === 'today' ? `It's ${Math.round(w.current.temp)} degrees and ${w.current.summary.toLowerCase()}, with a high of` : 'The high will be'} ${Math.round(daily.high)}${daily.precipChance >= 40 ? ` and a ${daily.precipChance} percent chance of rain` : ''}.`,
        );
    } catch {
      /* no weather */
    }

    const people = new Map(s.people.map((p) => [p.id, p.name]));
    const nowIso = isoInZone(this.now(), this.zone());
    const events = (await this.eventsOn(date)).filter(
      (e) => day === 'tomorrow' || e.allDay || e.end > nowIso,
    );
    if (!events.length)
      parts.push(`Nothing on the calendar${day === 'today' ? ' for the rest of the day' : ''}.`);
    else {
      const spoken = events.slice(0, 6).map((e) => {
        const who = e.personIds.map((p) => people.get(p)).filter(Boolean) as string[];
        const at = e.allDay ? '' : ` at ${spokenTime(e.start.slice(11, 16))}`;
        return `${e.title}${at}${who.length && who.length < s.people.length ? ` for ${joinAnd(who)}` : ''}`;
      });
      const more = events.length > 6 ? `, and ${events.length - 6} more` : '';
      parts.push(`${plural(events.length, 'thing')} on the calendar: ${joinAnd(spoken)}${more}.`);
    }

    const dinner = await this.dinnerOn(date);
    if (dinner) parts.push(`Dinner is ${dinner}.`);

    if (day === 'today') {
      try {
        const lists = (await this.d.providers.lists.lists()).lists;
        const grocery =
          lists.find((l) => l.id === s.open?.defaultListId) ??
          lists.find((l) => /grocer|shopping/i.test(l.name));
        const open = grocery?.items.filter((i) => !i.done).length ?? 0;
        if (grocery && open) parts.push(`${plural(open, 'thing')} on the ${grocery.name} list.`);
        const chores = (await this.d.providers.lists.chores()).chores;
        const left = s.people
          .map((p) => ({
            name: p.name,
            n: chores.filter((c) => c.personId === p.id && c.doneCount < c.target).length,
          }))
          .filter((x) => x.n > 0);
        if (left.length)
          parts.push(`Chores left: ${joinAnd(left.map((x) => `${x.name} ${x.n}`))}.`);
      } catch {
        /* no lists */
      }
    }
    return { text: parts.join(' '), date };
  }

  /* ---------- Home Assistant ---------- */

  async state(): Promise<OpenState> {
    const s = this.d.settings();
    const today = this.today();
    const nowIso = isoInZone(this.now(), this.zone());
    const [todays, tomorrows] = await Promise.all([
      this.eventsOn(today),
      this.eventsOn(shiftDate(today, 1)),
    ]);
    const upcoming = [...todays, ...tomorrows]
      .filter((e) => !e.allDay && e.start >= nowIso)
      .sort((a, b) => a.start.localeCompare(b.start));
    const next = upcoming[0] ?? todays.find((e) => e.allDay) ?? null;
    const lists = await this.d.providers.lists
      .lists()
      .then((r) => r.lists)
      .catch(() => []);
    const grocery =
      lists.find((l) => l.id === s.open?.defaultListId) ??
      lists.find((l) => /grocer/i.test(l.name)) ??
      lists.find((l) => /shopping/i.test(l.name)) ??
      null;
    const chores = await this.d.providers.lists
      .chores()
      .then((r) => r)
      .catch(() => null);
    const stars = new Map((chores?.stars ?? []).map((t) => [t.personId, t.stars]));
    const calendars = await this.d.providers.calendar.calendars().catch(() => []);
    const open = (l: (typeof lists)[number]) => l.items.filter((i) => !i.done).length;
    return {
      version: this.d.version,
      timezone: s.timezone,
      at: nowIso,
      tonight: { dinner: await this.dinnerOn(today) },
      nextEvent: next
        ? { title: next.title, start: next.start, allDay: next.allDay, personIds: next.personIds }
        : null,
      inboxCount: 0,
      groceryList: grocery ? { id: grocery.id, name: grocery.name, open: open(grocery) } : null,
      lists: lists.map((l) => ({ id: l.id, name: l.name, open: open(l) })),
      people: s.people.map((p) => {
        const mine = (chores?.chores ?? []).filter((c) => c.personId === p.id);
        return {
          id: p.id,
          name: p.name,
          choresOpen: mine.filter((c) => c.doneCount < c.target).length,
          choresDone: mine.filter((c) => c.doneCount >= c.target).length,
          stars: stars.get(p.id) ?? 0,
        };
      }),
      calendars: calendars.map((c) => ({ id: c.id, name: c.name, color: c.color })),
      activity: [...this.activityLog],
    };
  }

  /* ---------- activity feed ---------- */

  activity(): OpenActivity[] {
    return [...this.activityLog];
  }

  record(entry: Omit<OpenActivity, 'id' | 'at' | 'personName'>) {
    const name = entry.personId
      ? (this.d.settings().people.find((p) => p.id === entry.personId)?.name ?? null)
      : null;
    this.seq += 1;
    this.activityLog.push({
      ...entry,
      id: `${Date.now().toString(36)}-${this.seq}`,
      at: isoInZone(this.now(), this.zone()),
      personName: name,
    });
    if (this.activityLog.length > ACTIVITY_MAX)
      this.activityLog.splice(0, this.activityLog.length - ACTIVITY_MAX);
  }

  /** Remember chore counts so the next `chores.changed` can tell what was just done. */
  async primeChores() {
    try {
      const { chores } = await this.d.providers.lists.chores();
      this.choreCounts = new Map(chores.map((c) => [c.id, c.doneCount]));
    } catch {
      this.choreCounts = new Map();
    }
  }

  /** Wired to `hub.onEvent`. */
  handleEvent(e: WsEvent) {
    if (e.type === 'chores.changed') {
      clearTimeout(this.choreTimer);
      this.choreTimer = setTimeout(() => void this.choresChanged(), 800);
      this.choreTimer.unref?.();
      return;
    }
    if ((e as { type: string }).type === 'rewards.redeemed') {
      const p = (e as { payload?: Record<string, unknown> }).payload ?? {};
      this.record({
        type: 'reward_redeemed',
        personId: typeof p.personId === 'string' ? p.personId : null,
        title: typeof p.title === 'string' ? p.title : 'A reward',
        stars: typeof p.cost === 'number' ? p.cost : null,
      });
    }
  }

  async choresChanged() {
    const before = this.choreCounts;
    let chores: Chore[];
    try {
      chores = (await this.d.providers.lists.chores()).chores;
    } catch {
      return;
    }
    this.choreCounts = new Map(chores.map((c) => [c.id, c.doneCount]));
    if (!before) return;
    for (const c of chores) {
      const was = before.get(c.id) ?? 0;
      for (let i = was; i < c.doneCount; i++)
        this.record({ type: 'chore_done', personId: c.personId, title: c.title, stars: c.stars });
    }
  }

  stop() {
    clearTimeout(this.choreTimer);
  }
}
