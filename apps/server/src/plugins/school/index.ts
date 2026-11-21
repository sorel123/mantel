/**
 * School day (v4 G): today's lunch and tomorrow's, the A/B day rotation, and no-school days, from
 * a menu calendar link or a typed weekly menu, a rotation start date, typed no-school days and
 * an optional school calendar link. After 3 PM the card leads with tomorrow.
 */
import {
  addDays,
  startOfDay,
  toIsoDate,
  type IntegrationConfig,
  type PluginBlocksInput,
  type TestResult,
} from '@mantel/shared';
import type { ProviderContext } from '../../providers/types.js';
import type { RawEvent } from '../../providers/real/calendar/types.js';
import { humanError } from '../registry.js';
import {
  dayDiff,
  dayWord,
  entries,
  every,
  fetchIcsEvents,
  plural,
  str,
  type PackDeps,
} from '../pack/util.js';
import type { Plugin, PluginStatusFields } from '../types.js';
import { manifest } from './manifest.js';

const WEEKDAYS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/** "Mon: Pizza; Tue: Tacos" → weekday → menu. */
export function parseMenu(text: unknown): Map<number, string> {
  const out = new Map<number, string>();
  for (const e of entries(text)) {
    const m = /^([a-z]{3})[a-z]*\.?\s*[:-]\s*(.+)$/i.exec(e);
    const day = m ? WEEKDAYS[m[1]!.toLowerCase()] : undefined;
    if (m && day !== undefined) out.set(day, m[2]!.trim());
  }
  return out;
}

export interface Closure {
  from: string;
  to: string;
  name: string;
}

/** "2026-11-26 Thanksgiving; 2026-12-21..2027-01-01 Winter break; 2027-01-18". */
export function parseClosures(text: unknown): Closure[] {
  return entries(text).flatMap((e) => {
    const m = /^(\d{4}-\d{2}-\d{2})(?:\s*(?:\.\.|to|–|-)\s*(\d{4}-\d{2}-\d{2}))?\s*(.*)$/.exec(e);
    return m
      ? [
          {
            from: m[1]!,
            to: m[2] ?? m[1]!,
            name: m[3]!.replace(/^[:,-]\s*/, '').trim() || 'No school',
          },
        ]
      : [];
  });
}

export interface SchoolDay {
  date: Date;
  school: boolean;
  /** Why there is no school: "Weekend", "Thanksgiving". */
  reason?: string;
  /** "A", "B". */
  type?: string;
  lunch?: string;
}

export interface SchoolData {
  menu: Map<number, string>;
  closures: Closure[];
  rotation: string[];
  rotationStart: string | null;
  /** From the links: lunch by date, closures and day types by date. */
  menuByDate: Map<string, string>;
  calendarClosures: Map<string, string>;
  calendarTypes: Map<string, string>;
}

const NO_SCHOOL =
  /\b(no school|no classes|school closed|closed|break|holiday|vacation|teacher (work|in-?service|pd)|in-?service|recess)\b/i;
const DAY_TYPE = /^\s*(?:day\s+)?([A-Z0-9])\s*(?:-|\s)?day\b|^\s*day\s+([A-Z0-9])\b/i;

export function dayFor(data: SchoolData, date: Date): SchoolDay {
  const iso = toIsoDate(date);
  const weekend = date.getDay() === 0 || date.getDay() === 6;
  const typed = data.closures.find((c) => iso >= c.from && iso <= c.to);
  const fromCal = data.calendarClosures.get(iso);
  if (weekend || typed || fromCal)
    return { date, school: false, reason: typed?.name ?? fromCal ?? 'Weekend' };
  const lunch = data.menuByDate.get(iso) ?? data.menu.get(date.getDay());
  let type = data.calendarTypes.get(iso);
  if (!type && data.rotation.length && data.rotationStart) {
    // Count school days from the start; closures and weekends do not advance the rotation.
    const start = startOfDay(new Date(`${data.rotationStart}T00:00:00`));
    const forward = date >= start;
    let n = 0;
    for (
      let d = forward ? start : date;
      startOfDay(d) < startOfDay(forward ? date : start);
      d = addDays(d, 1)
    )
      if (dayFor({ ...data, rotation: [] }, d).school) n++;
    const idx = forward ? n : -n;
    type =
      data.rotation[((idx % data.rotation.length) + data.rotation.length) % data.rotation.length];
  }
  return { date, school: true, ...(type ? { type } : {}), ...(lunch ? { lunch } : {}) };
}

/** Read lunch from a menu calendar, and closures and day types from a school calendar. */
export function fromEvents(menu: RawEvent[], calendar: RawEvent[]) {
  const menuByDate = new Map<string, string>();
  for (const e of menu) {
    const iso = toIsoDate(new Date(e.start));
    const text = [e.title, e.description].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    if (text && !menuByDate.has(iso)) menuByDate.set(iso, e.title.trim() || text);
  }
  const calendarClosures = new Map<string, string>();
  const calendarTypes = new Map<string, string>();
  for (const e of calendar) {
    const first = startOfDay(new Date(e.start));
    const last = e.allDay ? addDays(startOfDay(new Date(e.end)), -1) : first;
    for (let d = first; d <= last; d = addDays(d, 1)) {
      const iso = toIsoDate(d);
      const t = DAY_TYPE.exec(e.title);
      if (t) calendarTypes.set(iso, (t[1] ?? t[2])!.toUpperCase());
      else if (NO_SCHOOL.test(e.title)) calendarClosures.set(iso, e.title.trim());
    }
  }
  return { menuByDate, calendarClosures, calendarTypes };
}

const MOCK: IntegrationConfig = {
  menu: 'Mon: Pizza; Tue: Chicken tacos; Wed: Mac and cheese; Thu: Pasta bar; Fri: Fish sticks',
  rotation: 'A, B',
};

const lunchLine = (d: SchoolDay) => (d.lunch ? `Lunch: ${d.lunch}` : 'No menu');

export function schoolCard(days: SchoolDay[], now: Date, configured: boolean): PluginBlocksInput {
  if (!configured)
    return {
      title: 'School day',
      icon: 'school',
      lines: [],
      empty: 'Add the lunch menu or schedule in Settings, Plugins, School day.',
    };
  const evening = now.getHours() >= 15;
  const [today, tomorrow] = days;
  const lead = evening ? tomorrow! : today!;
  const title = !lead.school
    ? `No school ${evening ? 'tomorrow' : 'today'}`
    : `School${evening ? ' tomorrow' : ''}${lead.type ? ` · ${lead.type} day` : ''}`;
  // Weekends are skipped after the first row: the card says what the next school days hold.
  const ahead = evening ? days.slice(1) : days;
  const rows = ahead.filter((d, i) => i === 0 || d.school || d.reason !== 'Weekend').slice(0, 3);
  const lastShown = rows.at(-1)?.date.getTime() ?? 0;
  // The next no-school day in the coming two weeks, if it is not already shown.
  const off = days.find((d) => d.date.getTime() > lastShown && !d.school && d.reason !== 'Weekend');
  return {
    title,
    icon: 'school',
    lines: [
      ...rows.map((d) => ({
        id: toIsoDate(d.date),
        icon: d.school ? (d.lunch ? 'lunch' : 'school') : 'star',
        text: d.school
          ? `${d.type ? `${d.type} day · ` : ''}${d.lunch ?? 'School'}`
          : `No school · ${d.reason}`,
        sub: dayWord(d.date, now),
        tone: d.school ? ('normal' as const) : ('good' as const),
      })),
      ...(off
        ? [
            {
              id: 'off',
              icon: 'star',
              text: `No school · ${off.reason}`,
              sub: `${dayWord(off.date, now)} · in ${plural(dayDiff(now, off.date), 'day')}`,
              tone: 'good' as const,
            },
          ]
        : []),
    ],
  };
}

export function schoolPlugin(deps: PackDeps = {}): Plugin {
  let ctx: ProviderContext | null = null;
  let config: IntegrationConfig = {};
  let links: ReturnType<typeof fromEvents> = fromEvents([], []);
  let lastOkAt: string | null = null;
  let lastError: string | null = null;
  let stopTick: (() => void) | null = null;
  const now = () => ctx?.now() ?? new Date();
  const fetcher = deps.fetch ?? fetch;
  const configured = (c = config) =>
    ['menuUrl', 'menu', 'rotation', 'noSchool', 'calendarUrl'].some((k) => str(c[k]));
  const values = () => (!configured() && deps.mock ? MOCK : config);

  const data = (): SchoolData => {
    const c = values();
    const start =
      str(c.rotationStart) ||
      (deps.mock && !configured() ? toIsoDate(addDays(now(), -now().getDay() + 1)) : '');
    return {
      menu: parseMenu(c.menu),
      closures: parseClosures(c.noSchool),
      rotation: str(c.rotation)
        .split(/[,\s/]+/)
        .map((x) => x.trim())
        .filter(Boolean),
      rotationStart: /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : null,
      ...links,
    };
  };
  const days = (n: number) => {
    const d = data();
    return Array.from({ length: n }, (_, i) => dayFor(d, addDays(startOfDay(now()), i)));
  };

  const refresh = async () => {
    const menuUrl = str(config.menuUrl);
    const calUrl = str(config.calendarUrl);
    if (!menuUrl && !calUrl) {
      links = fromEvents([], []);
      return;
    }
    const from = addDays(startOfDay(now()), -1);
    const to = addDays(from, 30);
    try {
      const [menu, cal] = await Promise.all([
        menuUrl ? fetchIcsEvents(fetcher, menuUrl, from, to) : [],
        calUrl ? fetchIcsEvents(fetcher, calUrl, from, addDays(from, 120)) : [],
      ]);
      links = fromEvents(menu, cal);
      lastOkAt = now().toISOString();
      lastError = null;
      ctx?.emit({ type: 'plugin.changed', payload: { id: 'school' } });
    } catch (err) {
      lastError = humanError(err);
    }
  };

  return {
    manifest,
    start(c) {
      ctx = c;
      stopTick = every(6 * 3600_000, refresh);
    },
    stop() {
      stopTick?.();
    },
    apply(next) {
      config = next;
      void refresh();
      ctx?.emit({ type: 'plugin.changed', payload: { id: 'school' } });
    },
    async test(next): Promise<TestResult> {
      if (!configured(next))
        return { ok: false, message: 'Add a lunch menu, a rotation or no-school days.' };
      try {
        const from = startOfDay(now());
        const menu = str(next.menuUrl)
          ? await fetchIcsEvents(fetcher, str(next.menuUrl), from, addDays(from, 14))
          : [];
        const cal = str(next.calendarUrl)
          ? await fetchIcsEvents(fetcher, str(next.calendarUrl), from, addDays(from, 120))
          : [];
        const l = fromEvents(menu, cal);
        const d: SchoolData = {
          menu: parseMenu(next.menu),
          closures: parseClosures(next.noSchool),
          rotation: str(next.rotation)
            .split(/[,\s/]+/)
            .filter(Boolean),
          rotationStart: str(next.rotationStart) || null,
          ...l,
        };
        const next7 = Array.from({ length: 7 }, (_, i) => dayFor(d, addDays(from, i)));
        const first = next7.find((x) => x.school);
        const parts = [
          first
            ? `${dayWord(first.date, now())}: ${first.type ? `${first.type} day, ` : ''}${lunchLine(first).toLowerCase()}`
            : 'No school this week',
          menu.length ? `${plural(l.menuByDate.size, 'menu day')} from the link` : '',
          cal.length ? `${plural(l.calendarClosures.size, 'day')} off found on the calendar` : '',
        ].filter(Boolean);
        return { ok: true, message: `${parts.join('. ')}.` };
      } catch (err) {
        return { ok: false, message: humanError(err) };
      }
    },
    status(): PluginStatusFields {
      if (!configured() && !deps.mock)
        return {
          state: 'not_set_up',
          summary: 'No menu or schedule yet',
          lastOkAt: null,
          lastError: null,
        };
      const d = data();
      const parts = [
        d.menuByDate.size ? 'Menu link' : d.menu.size ? 'Weekly menu' : '',
        d.rotation.length ? `${d.rotation.join('/')} days` : '',
        d.closures.length ? plural(d.closures.length, 'break') : '',
      ].filter(Boolean);
      return {
        state: lastError ? 'error' : 'connected',
        summary: parts.join(', ') || 'Set up',
        lastOkAt,
        lastError,
      };
    },
    blocks(name) {
      if (name === 'card') return schoolCard(days(15), now(), configured() || Boolean(deps.mock));
      if (name === 'ambient') {
        if (!configured() && !deps.mock) return null;
        const [today, tomorrow] = days(2);
        const h = now().getHours();
        if (h >= 15 && tomorrow && !tomorrow.school && tomorrow.reason !== 'Weekend')
          return { title: `No school tomorrow: ${tomorrow.reason}`, icon: 'star', lines: [] };
        if (h >= 15 && tomorrow?.school && tomorrow.type)
          return {
            title: `Tomorrow is ${tomorrow.type} day${tomorrow.lunch ? ` · ${tomorrow.lunch}` : ''}`,
            icon: 'school',
            lines: [],
          };
        if (h < 10 && today?.school)
          return {
            title: `${today.type ? `${today.type} day · ` : ''}${lunchLine(today)}`,
            icon: 'school',
            lines: [],
          };
        return null;
      }
      return undefined;
    },
  };
}
