/**
 * Small helpers the v4 plugin pack shares (birthdays, pets, poll, sports, school, house status,
 * habits, question of the day, sky): parsing the one-line lists people type into setup fields,
 * friendly day words, an alert that fires once, a fetch for ICS links, and a repeating check.
 */
import { addDays, startOfDay, type IntegrationId, type PluginAlertPayload } from '@mantel/shared';
import { kvGet, kvSet } from '../../db/index.js';
import type { CalendarProvider, HomeProvider, ProviderContext } from '../../providers/types.js';
import { expandIcs } from '../../providers/real/calendar/ics.js';
import type { RawEvent } from '../../providers/real/calendar/types.js';

/** "a; b\nc" → ["a", "b", "c"]: setup fields take one entry per line or separated by semicolons. */
export function entries(text: unknown): string[] {
  if (typeof text !== 'string') return [];
  return text
    .split(/[;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
export const num = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};
export const bool = (v: unknown, fallback: boolean): boolean =>
  typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : fallback;

/** Whole days from `from`'s day to `to`'s day (local calendar days, DST safe). */
export function dayDiff(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000);
}

const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const weekdayName = (d: Date) => DAY[d.getDay()]!;

/** "Today", "Tomorrow", "Friday", "Sat, Dec 6" for a date in the future. */
export function dayWord(date: Date, now: Date): string {
  const n = dayDiff(now, date);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n > 1 && n < 7) return weekdayName(date);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "in 3 days", "" for today and tomorrow. */
export const inDays = (date: Date, now: Date): string => {
  const n = dayDiff(now, date);
  return n > 1 ? `in ${n} days` : '';
};

/** "5:30 PM" (minutes dropped on the hour: "6 PM"). */
export function clock(d: Date): string {
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes();
  return `${h}${m ? `:${String(m).padStart(2, '0')}` : ''} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
}

/** "7:30", "17:30", "7pm", "7:30 am" → minutes after midnight, or null. */
export function parseClock(text: string): number | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/i.exec(text.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = m[3]?.toLowerCase();
  if (ap?.startsWith('p') && h < 12) h += 12;
  if (ap?.startsWith('a') && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** The moment `minutes` after midnight on `day`. */
export function at(day: Date, minutes: number): Date {
  const d = startOfDay(day);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d;
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** "Jay, Mia and Leo". */
export function joinAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)!}`;
}

/**
 * An alert that goes out once per key, remembered in kv so a restart does not chime again.
 * Keys older than two days are forgotten.
 */
export class AlertOnce {
  constructor(
    private readonly ctx: () => ProviderContext | null,
    private readonly plugin: string,
  ) {}

  private get kvKey() {
    return `plugin.${this.plugin}.alerted`;
  }

  sent(key: string): boolean {
    const ctx = this.ctx();
    if (!ctx) return true;
    return Boolean(kvGet<Record<string, string>>(ctx.db, this.kvKey)?.[key]);
  }

  /** Sends the alert (and wakes the screen) unless this key already went out. True when sent. */
  send(
    payload: Omit<PluginAlertPayload, 'id' | 'chime' | 'actions'> & Partial<PluginAlertPayload>,
  ) {
    const ctx = this.ctx();
    if (!ctx || this.sent(payload.key)) return false;
    const now = ctx.now();
    const seen = kvGet<Record<string, string>>(ctx.db, this.kvKey) ?? {};
    const keep = Object.fromEntries(
      Object.entries(seen).filter(([, iso]) => now.getTime() - Date.parse(iso) < 2 * 86_400_000),
    );
    keep[payload.key] = now.toISOString();
    kvSet(ctx.db, this.kvKey, keep);
    ctx.emit({ type: 'display.wake', payload: { reason: 'manual' } });
    ctx.emit({
      type: 'plugin.alert',
      payload: { chime: false, actions: [], ...payload, id: this.plugin },
    });
    return true;
  }
}

/** Run `fn` now-ish and then every `ms`; returns the stop function. Errors are swallowed. */
export function every(ms: number, fn: () => void | Promise<void>): () => void {
  const run = () => {
    try {
      void Promise.resolve(fn()).catch(() => {});
    } catch {
      /* a check that throws waits for the next round */
    }
  };
  const first = setTimeout(run, 50);
  const timer = setInterval(run, ms);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

/** `webcal://` → `https://`. */
export const httpUrl = (url: string) => url.replace(/^webcal:\/\//i, 'https://');

/** Fetch an .ics link and expand its events between two dates. Throws a sentence on failure. */
export async function fetchIcsEvents(
  fetcher: typeof fetch,
  url: string,
  from: Date,
  to: Date,
): Promise<RawEvent[]> {
  const res = await fetcher(httpUrl(url), { headers: { accept: 'text/calendar' } });
  if (!res.ok) throw new Error(`The calendar link answered ${res.status}. Check it still works.`);
  const text = await res.text();
  if (!/BEGIN:VCALENDAR/i.test(text))
    throw new Error('That link did not return a calendar. Copy the link that ends in .ics.');
  return expandIcs(text, 'link', from, to);
}

/** Today and the next `days` days, from local midnight. */
export const span = (now: Date, days: number) => ({
  from: startOfDay(now),
  to: addDays(startOfDay(now), days),
});

/** What the pack plugins may use besides their own values. All optional so tests stay small. */
export interface PackDeps {
  fetch?: typeof fetch;
  /** The live calendar provider (birthdays read named events from it). */
  calendar?: () => CalendarProvider | undefined;
  /** The live Home Assistant provider (house status). */
  home?: () => HomeProvider | undefined;
  /** Mock mode: sample values when nothing is saved, and no network. */
  mock?: boolean;
}

/** Whether the plugin is turned on in Settings (on when no registry is attached, as in tests). */
export const enabled = (ctx: ProviderContext, id: IntegrationId) =>
  ctx.integration?.(id).enabled ?? true;
