/**
 * Birthdays and anniversaries (v4 G): typed in Settings or found on the calendars by name.
 * Today card with "turns 11" and "in 3 days", an Ambient line in the last days before, a dock
 * chip and a morning banner on the day.
 */
import {
  addDays,
  startOfDay,
  type IntegrationConfig,
  type PluginBlocksInput,
  type PluginChipInput,
  type TestResult,
} from '@mantel/shared';
import type { ProviderContext } from '../../providers/types.js';
import {
  AlertOnce,
  bool,
  dayDiff,
  dayWord,
  enabled,
  entries,
  every,
  inDays,
  num,
  plural,
  type PackDeps,
} from '../pack/util.js';
import type { Plugin, PluginStatusFields } from '../types.js';
import { manifest } from './manifest.js';

export interface Birthday {
  name: string;
  month: number; // 1-12
  day: number;
  year: number | null;
  kind: 'birthday' | 'anniversary';
}

export interface Upcoming extends Birthday {
  date: Date;
  days: number;
  /** Age they turn, or years married. */
  years: number | null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "Mia 2015-03-14", "Grandma 03-02", "Rose 3/2/1950", "Mom and Dad anniversary 2010-06-12", "Leo Mar 9". */
export function parseBirthday(text: string): Birthday | null {
  let rest = text.trim();
  let year: number | null = null;
  let month = 0;
  let day = 0;
  const iso = /(\d{4})-(\d{1,2})-(\d{1,2})\s*$/.exec(rest);
  const md = /(?:^|\s)(\d{1,2})[-/](\d{1,2})(?:[-/](\d{4}))?\s*$/.exec(rest);
  const word = /(?:^|\s)([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?\s*$/i.exec(rest);
  if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    rest = rest.slice(0, iso.index);
  } else if (md) {
    [month, day] = [Number(md[1]), Number(md[2])];
    year = md[3] ? Number(md[3]) : null;
    rest = rest.slice(0, md.index);
  } else if (word && MONTHS.includes(word[1]!.toLowerCase())) {
    month = MONTHS.indexOf(word[1]!.toLowerCase()) + 1;
    day = Number(word[2]);
    year = word[3] ? Number(word[3]) : null;
    rest = rest.slice(0, word.index);
  } else return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  rest = rest.replace(/[:,-]\s*$/, '').trim();
  const anniversary = /\banniversary\b/i.test(rest);
  const name = rest
    .replace(/[’']s\s+(birthday|anniversary)\b/i, '')
    .replace(/\b(birthday|anniversary)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name) return null;
  return { name, month, day, year, kind: anniversary ? 'anniversary' : 'birthday' };
}

/** The next time this date comes round on or after today (Feb 29 is Feb 28 in other years). */
function nextDate(b: Birthday, now: Date): Date {
  const today = startOfDay(now);
  for (const y of [today.getFullYear(), today.getFullYear() + 1]) {
    const leap = new Date(y, 1, 29).getMonth() === 1;
    const d = new Date(y, b.month - 1, b.month === 2 && b.day === 29 && !leap ? 28 : b.day);
    if (d >= today) return d;
  }
  return today;
}

export function upcoming(list: Birthday[], now: Date, days: number): Upcoming[] {
  return list
    .map((b) => {
      const date = nextDate(b, now);
      return {
        ...b,
        date,
        days: dayDiff(now, date),
        years: b.year ? date.getFullYear() - b.year : null,
      };
    })
    .filter((u) => u.days <= days)
    .sort((a, b) => a.days - b.days || a.name.localeCompare(b.name));
}

/** "Mia turns 11", "Mom and Dad: 16 years", "Grandma's birthday". */
export function headline(u: Upcoming): string {
  if (u.kind === 'anniversary')
    return u.years && u.years > 0
      ? `${u.name}: ${plural(u.years, 'year')}`
      : `${u.name}’s anniversary`;
  if (u.years !== null && u.years > 0 && u.years < 130)
    return `${u.name} ${u.days === 0 ? 'is' : 'turns'} ${u.years}`;
  return `${u.name}’s birthday`;
}

const sub = (u: Upcoming, now: Date) => {
  if (u.days === 0)
    return u.kind === 'anniversary' ? 'Today · happy anniversary!' : 'Today · happy birthday!';
  const extra = inDays(u.date, now);
  return `${dayWord(u.date, now)}${extra ? ` · ${extra}` : ''}`;
};

export function birthdaysCard(list: Upcoming[], now: Date, configured: boolean): PluginBlocksInput {
  const today = list.filter((u) => u.days === 0);
  return {
    title:
      today.length === 1
        ? today[0]!.kind === 'anniversary'
          ? `Happy anniversary, ${today[0]!.name}!`
          : `Happy birthday, ${today[0]!.name}!`
        : today.length > 1
          ? `${today.length} celebrations today`
          : 'Birthdays',
    icon: 'cake',
    lines: list.slice(0, 5).map((u) => ({
      id: `${u.name}-${u.month}-${u.day}`,
      icon: u.kind === 'anniversary' ? 'heart' : 'cake',
      text: headline(u),
      sub: sub(u, now),
      tone: u.days === 0 ? ('good' as const) : 'normal',
    })),
    empty: configured
      ? 'No birthdays in the next weeks.'
      : 'Add birthdays in Settings, Plugins, Birthdays.',
  };
}

/** Sample people for mock mode, placed around today so the card always has something. */
export function mockBirthdays(now: Date): Birthday[] {
  const on = (n: number) => addDays(now, n);
  const b = (name: string, n: number, year: number | null, kind: Birthday['kind'] = 'birthday') => {
    const d = on(n);
    return {
      name,
      month: d.getMonth() + 1,
      day: d.getDate(),
      year: year && d.getFullYear() - year,
      kind,
    };
  };
  return [
    b('Mia', 3, 11),
    b('Mom and Dad', 21, 16, 'anniversary'),
    b('Grandma Rose', 42, null),
    b('Uncle Ben', 75, 45),
  ];
}

export function birthdaysPlugin(deps: PackDeps = {}): Plugin {
  let ctx: ProviderContext | null = null;
  let config: IntegrationConfig = {};
  let found: Birthday[] = [];
  let stopTick: (() => void) | null = null;
  let lastScan = -1;
  let scanned = false;
  const alerts = new AlertOnce(() => ctx, 'birthdays');
  const now = () => ctx?.now() ?? new Date();

  const typed = () => entries(config.list).flatMap((t) => parseBirthday(t) ?? []);
  const all = (): Birthday[] => {
    const own = typed();
    const list = !own.length && deps.mock && !config.list ? mockBirthdays(now()) : own;
    const names = new Set(list.map((b) => `${b.name.toLowerCase()}|${b.month}|${b.day}`));
    return [
      ...list,
      ...found.filter((b) => !names.has(`${b.name.toLowerCase()}|${b.month}|${b.day}`)),
    ];
  };
  const lookahead = () => num(config.lookahead, 60);
  const soon = () => upcoming(all(), now(), lookahead());

  /** Events named "...birthday" or "...anniversary" on the calendars, once an hour. */
  const scan = async () => {
    const cal = deps.calendar?.();
    if (!cal || !bool(config.fromCalendars, true)) {
      found = [];
      return;
    }
    const from = startOfDay(now());
    const { events } = await cal.events(from, addDays(from, Math.min(lookahead(), 120)));
    const before = JSON.stringify(found);
    found = events
      .filter((e) => /\b(birthday|anniversary|bday)\b/i.test(e.title))
      .flatMap((e) => {
        const d = new Date(e.start);
        // "Leo's birthday party" → Leo; "Birthday: Grandma" → Grandma.
        const owner =
          /^\s*(?:[🎂🎉🎈]\s*)?(.+?)[’']s\s+(?:\d+\w*\s+)?(?:birthday|bday|anniversary)\b/iu.exec(
            e.title,
          )?.[1];
        const name = (owner ?? e.title)
          .replace(/[🎂🎉🎈]/gu, '')
          .replace(/[’']s\b/, '')
          .replace(/\b(happy|birthday|bday|anniversary)\b/gi, '')
          .replace(/\s+/g, ' ')
          .trim();
        return name
          ? [
              {
                name,
                month: d.getMonth() + 1,
                day: d.getDate(),
                year: null,
                kind: /anniversary/i.test(e.title)
                  ? ('anniversary' as const)
                  : ('birthday' as const),
              },
            ]
          : [];
      });
    // The first scan is at start-up, before any display asked; later ones tell the displays.
    if (scanned && JSON.stringify(found) !== before)
      ctx?.emit({ type: 'plugin.changed', payload: { id: 'birthdays' } });
  };

  /** The morning banner, once per person per day, from 7 AM. */
  const check = () => {
    if (!ctx || !bool(config.banner, true) || !enabled(ctx, 'birthdays')) return;
    const t = now();
    if (t.getHours() < 7) return;
    for (const u of soon().filter((x) => x.days === 0)) {
      const anniversary = u.kind === 'anniversary';
      alerts.send({
        key: `${t.toDateString()}|${u.name}`,
        title: anniversary ? `Happy anniversary, ${u.name}!` : `Happy birthday, ${u.name}!`,
        ...(u.years
          ? { text: anniversary ? `${plural(u.years, 'year')} today` : `${u.years} today` }
          : {}),
        icon: anniversary ? 'heart' : 'cake',
        chime: true,
      });
    }
  };

  return {
    manifest,
    start(c) {
      ctx = c;
      stopTick = every(10 * 60_000, async () => {
        const hour = Math.floor(now().getTime() / 3_600_000);
        if (hour !== lastScan) {
          lastScan = hour;
          await scan().catch(() => {});
          scanned = true;
        }
        check();
      });
    },
    stop() {
      stopTick?.();
    },
    apply(next) {
      config = next;
      lastScan = -1;
      ctx?.emit({ type: 'plugin.changed', payload: { id: 'birthdays' } });
    },
    async test(next): Promise<TestResult> {
      const bad = entries(next.list).filter((t) => !parseBirthday(t));
      if (bad.length)
        return {
          ok: false,
          message: `I could not read “${bad[0]}”. Write a name and a date, like Mia 2015-03-14.`,
        };
      const list = upcoming(
        entries(next.list).flatMap((t) => parseBirthday(t) ?? []),
        now(),
        366,
      );
      if (!list.length)
        return {
          ok: true,
          message: 'Nothing typed yet; birthdays on the calendars will still show.',
        };
      const first = list[0]!;
      return {
        ok: true,
        message: `Next: ${headline(first)} ${first.days ? `in ${plural(first.days, 'day')}` : 'today'}.`,
      };
    },
    status(): PluginStatusFields {
      const list = soon();
      const count = all().length;
      if (!count)
        return {
          state: 'not_set_up',
          summary: 'No birthdays yet',
          lastOkAt: null,
          lastError: null,
        };
      const first = list[0];
      return {
        state: 'connected',
        summary: `${plural(count, 'date')}${first ? `, next: ${first.name} ${first.days ? `in ${plural(first.days, 'day')}` : 'today'}` : ''}`,
        lastOkAt: null,
        lastError: null,
      };
    },
    blocks(name) {
      if (name === 'card') return birthdaysCard(soon(), now(), all().length > 0);
      if (name === 'ambient') {
        const near = soon().filter((u) => u.days <= 2);
        if (!near.length) return null;
        const u = near[0]!;
        return {
          title:
            u.days === 0
              ? u.kind === 'anniversary'
                ? `Happy anniversary, ${u.name}`
                : `Happy birthday, ${u.name}${u.years ? `, ${u.years} today` : ''}`
              : `${headline(u)} ${dayWord(u.date, now()).toLowerCase()}`,
          icon: u.kind === 'anniversary' ? 'heart' : 'cake',
          lines: [],
        };
      }
      return undefined;
    },
    chip(name): PluginChipInput | null | undefined {
      if (name !== 'chip') return undefined;
      const today = soon().filter((u) => u.days === 0);
      if (!today.length) return null;
      return {
        text: today.map((u) => u.name).join(', '),
        icon: 'cake',
        tone: 'good',
        label: `Today: ${today.map(headline).join(', ')}`,
      };
    },
  };
}
