/**
 * Calendar data for the Today and Month screens: fetch hooks that refetch on
 * `calendar.changed`, plus date and time formatting shared by both screens.
 */
import type { CalendarEvent, Countdown, Meal, ResponseOf } from '@mantel/shared';
import { addDays, startOfDay, toIsoDate, toLocalIso } from '@mantel/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { onServerEvent } from '../../lib/events';

export const monthNames = [
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
export const dayNames = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/** `9 am`, `3:30 pm`; `compact` drops the space (`3:30pm`) for month pills. */
export function formatTime(d: Date, compact = false): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const ap = h >= 12 ? 'pm' : 'am';
  const hh = ((h + 11) % 12) + 1;
  const t = m ? `${hh}:${String(m).padStart(2, '0')}` : `${hh}`;
  return compact ? `${t}${ap}` : `${t} ${ap}`;
}

export const sameDay = (a: Date, b: Date) => toIsoDate(a) === toIsoDate(b);

/** `Today`, `Tomorrow`, `Saturday`, or `Sat, Nov 14` beyond a week. */
export function relativeDay(d: Date, now: Date): string {
  const diff = Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / 864e5);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff > 1 && diff < 7) return dayNames[d.getDay()]!;
  return `${dayNames[d.getDay()]!.slice(0, 3)}, ${monthNames[d.getMonth()]!.slice(0, 3)} ${d.getDate()}`;
}

export function countdownLabel(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 14) return `in ${days} days`;
  if (days < 60) return `in ${Math.round(days / 7)} weeks`;
  return `in ${Math.round(days / 30)} months`;
}

/** Events that touch the local day `day`, all-day first, then by start. */
export function eventsOn(events: CalendarEvent[], day: Date): CalendarEvent[] {
  const s = startOfDay(day).getTime();
  const e = addDays(startOfDay(day), 1).getTime();
  return events
    .filter((ev) => {
      const a = new Date(ev.start).getTime();
      const b = new Date(ev.end).getTime();
      return (b > s && a < e) || (a === b && a >= s && a < e);
    })
    .sort((x, y) => Number(y.allDay) - Number(x.allDay) || x.start.localeCompare(y.start));
}

/** "Day 2 of 3" for an all-day event spanning several days. */
export function spanLabel(ev: CalendarEvent, day: Date): string | null {
  if (!ev.allDay) return null;
  const s = startOfDay(new Date(ev.start)).getTime();
  const days = Math.round((new Date(ev.end).getTime() - s) / 864e5);
  if (days <= 1) return null;
  const n = Math.round((startOfDay(day).getTime() - s) / 864e5) + 1;
  return `day ${n} of ${days}`;
}

/* ---------- fetch hooks ---------- */

type Status = 'loading' | 'ready' | 'error';

/**
 * Fetch with `load`, keep the last good value through errors, and refetch when the server
 * says the calendar changed (any overlap with `range`, or always when `range` is omitted)
 * and every five minutes as a safety net.
 */
function useCalendarData<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
  initial: T,
  range?: { from: number; to: number },
) {
  const [state, setState] = useState<{ key: string; data: T; status: Status }>(() => ({
    key,
    data: (cache.get(key) as T) ?? initial,
    status: cache.has(key) ? 'ready' : 'loading',
  }));
  const loadRef = useRef(load);
  loadRef.current = load;
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    const ctl = new AbortController();
    setState((s) =>
      s.key === key
        ? s
        : {
            key,
            data: (cache.get(key) as T) ?? initial,
            status: cache.has(key) ? 'ready' : 'loading',
          },
    );
    loadRef
      .current(ctl.signal)
      .then((data) => {
        cache.set(key, data);
        if (!ctl.signal.aborted) setState({ key, data, status: 'ready' });
      })
      .catch(() => {
        if (!ctl.signal.aborted)
          setState((s) => ({
            ...s,
            key,
            status: s.key === key && cache.has(key) ? 'ready' : 'error',
          }));
      });
    return () => ctl.abort();
    // `initial` is a constant per call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);

  const from = range?.from;
  const to = range?.to;
  useEffect(() => {
    const off = onServerEvent((e) => {
      if (e.type !== 'calendar.changed') return;
      if (from !== undefined && to !== undefined) {
        const a = new Date(e.payload.from).getTime();
        const b = new Date(e.payload.to).getTime();
        if (!(b >= from && a <= to)) return;
      }
      reload();
    });
    const t = setInterval(reload, 5 * 60_000);
    return () => {
      off();
      clearInterval(t);
    };
  }, [from, to, reload]);

  return {
    data: state.key === key ? state.data : ((cache.get(key) as T) ?? initial),
    status: state.status,
    reload,
  };
}

/** Last responses by key, so switching screens does not flash empty. */
const cache = new Map<string, unknown>();

const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const NONE: never[] = [];

export function useEvents(from: Date, to: Date) {
  const f = toLocalIso(from);
  const t = toLocalIso(to);
  const { data, status, reload } = useCalendarData<CalendarEvent[]>(
    `calendar:${f}:${t}`,
    async (signal) =>
      asArray<CalendarEvent>(
        (await api.call('calendar', { query: { from: f, to: t }, signal }))?.events,
      ),
    NONE,
    { from: from.getTime(), to: to.getTime() },
  );
  return { events: data, status, reload };
}

export function useCountdowns(): Countdown[] {
  return useCalendarData<Countdown[]>(
    'countdowns',
    async (signal) => asArray<Countdown>((await api.call('countdowns', { signal }))?.countdowns),
    NONE,
  ).data;
}

export function useMeals(week: Date): ResponseOf<'meals'> {
  const iso = toIsoDate(week);
  return useCalendarData<ResponseOf<'meals'>>(
    `meals:${iso}`,
    async (signal) => {
      const res = await api.call('meals', { query: { week: iso }, signal });
      return { weekStart: res?.weekStart ?? iso, meals: asArray<Meal>(res?.meals) };
    },
    { weekStart: iso, meals: [] },
  ).data;
}

/** Clear the cache (tests). */
export const resetCalendarCache = () => cache.clear();
