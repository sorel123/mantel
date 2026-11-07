import type { CalendarEvent, Repeat } from '@mantel/shared';
import { addDays, daysBetween, startOfDay, toIsoDate, toLocalIso } from '@mantel/shared';
import { calendars, countdowns, eventsInRange, meals, personColor } from '@mantel/shared/fixtures';
import { HttpError } from '../../errors.js';
import type { CalendarProvider, ProviderContext } from '../types.js';
import { mountMockCalendarSetup } from './calendar-setup.js';
import { occurrences, shiftSeries } from '../real/calendar/repeat.js';

/** A repeating event made with quick add: its first occurrence, the pattern and per-day edits. */
interface Series {
  id: string;
  first: CalendarEvent;
  repeat: Repeat;
  /** Edited (or deleted, null) occurrences by their date. */
  overrides: Map<string, CalendarEvent | null>;
}

const COUNTDOWN = /\s*#countdown\b|⭐/gi;

export function mockCalendar(ctx: ProviderContext): CalendarProvider {
  const added: CalendarEvent[] = [];
  /** Edits to fixture events: the new event, or null once deleted. */
  const edited = new Map<string, CalendarEvent | null>();
  const overlaps = (e: CalendarEvent, from: Date, to: Date) =>
    new Date(e.end).getTime() > from.getTime() && new Date(e.start).getTime() < to.getTime();
  const find = (id: string, now = ctx.now()): CalendarEvent | undefined => {
    if (edited.has(id)) return edited.get(id) ?? undefined;
    return (
      added.find((e) => e.id === id) ??
      eventsInRange(now, addDays(now, -62), addDays(now, 62)).find((e) => e.id === id)
    );
  };
  const readOnly = (e: CalendarEvent) => calendars.find((c) => c.id === e.calendarId)?.readOnly;
  const series: Series[] = [];
  /** Occurrences of every series overlapping [from, to), edits applied. */
  const expand = (from: Date, to: Date): CalendarEvent[] =>
    series.flatMap((s) => {
      const start = new Date(s.first.start);
      const length = new Date(s.first.end).getTime() - start.getTime();
      return occurrences(start, s.repeat, addDays(from, -1), to, length).flatMap((at) => {
        const key = toIsoDate(at);
        const over = s.overrides.get(key);
        if (over === null) return [];
        if (over) return [over];
        return [
          {
            ...s.first,
            id: `${s.id}@${key}`,
            start: toLocalIso(at),
            end: toLocalIso(new Date(at.getTime() + length)),
          },
        ];
      });
    });
  /** The series and occurrence date behind an occurrence id. */
  const inSeries = (id: string) => {
    const at = id.lastIndexOf('@');
    const s = at > 0 ? series.find((x) => x.id === id.slice(0, at)) : undefined;
    return s ? { s, key: id.slice(at + 1) } : null;
  };
  const findAny = (id: string): CalendarEvent | undefined => {
    const hit = inSeries(id);
    if (!hit) return find(id);
    const day = new Date(`${hit.key}T00:00:00`);
    return expand(day, addDays(day, 1)).find((e) => e.id === id);
  };
  return {
    async events(from, to) {
      const base = eventsInRange(ctx.now(), from, to)
        .filter((e) => !edited.has(e.id))
        .concat([...edited.values()].filter((e): e is CalendarEvent => !!e));
      const extra = added.filter((e) => overlaps(e, from, to));
      const repeating = expand(from, to).filter((e) => overlaps(e, from, to));
      return { events: [...base.filter((e) => overlaps(e, from, to)), ...extra, ...repeating] };
    },
    async updateEvent(id, req) {
      const old = findAny(id);
      if (!old) throw new HttpError('not_found', `event ${id}`);
      if (readOnly(old)) throw new HttpError('forbidden', 'that calendar is read-only');
      const allDay = req.allDay ?? old.allDay;
      const start = req.start ? new Date(req.start) : new Date(old.start);
      const end = req.end
        ? new Date(req.end)
        : new Date(start.getTime() + (new Date(old.end).getTime() - new Date(old.start).getTime()));
      if (end <= start) throw new HttpError('bad_request', 'end must be after start');
      const personIds = req.personIds ?? old.personIds;
      const location = req.location === undefined ? old.location : req.location.trim();
      const { location: _drop, ...rest } = old;
      const event: CalendarEvent = {
        ...rest,
        title: (req.title?.trim() ?? old.title).replace(COUNTDOWN, '').trim(),
        start: toLocalIso(start),
        end: toLocalIso(end),
        allDay,
        personIds,
        color: personColor(personIds[0]),
        countdown: req.countdown ?? old.countdown,
        ...(location ? { location } : {}),
      };
      const hit = inSeries(id);
      if (hit && req.scope === 'all') {
        const first = shiftSeries(new Date(hit.s.first.start), new Date(old.start), start, allDay);
        hit.s.first = {
          ...event,
          id: hit.s.id,
          start: toLocalIso(first),
          end: toLocalIso(new Date(first.getTime() + (end.getTime() - start.getTime()))),
        };
        hit.s.overrides.clear();
        ctx.emit({
          type: 'calendar.changed',
          payload: { from: old.start, to: toLocalIso(addDays(end, 400)) },
        });
        return { event };
      }
      if (hit) {
        hit.s.overrides.set(hit.key, event);
        ctx.emit({ type: 'calendar.changed', payload: { from: old.start, to: event.end } });
        return { event };
      }
      const i = added.findIndex((e) => e.id === id);
      if (i >= 0) added[i] = event;
      else edited.set(id, event);
      ctx.emit({ type: 'calendar.changed', payload: { from: old.start, to: event.end } });
      return { event };
    },
    async deleteEvent(id, scope) {
      const old = findAny(id);
      if (!old) throw new HttpError('not_found', `event ${id}`);
      if (readOnly(old)) throw new HttpError('forbidden', 'that calendar is read-only');
      const hit = inSeries(id);
      if (hit) {
        if (scope === 'all') series.splice(series.indexOf(hit.s), 1);
        else hit.s.overrides.set(hit.key, null);
        ctx.emit({ type: 'calendar.changed', payload: { from: old.start, to: old.end } });
        return { ok: true };
      }
      const i = added.findIndex((e) => e.id === id);
      if (i >= 0) added.splice(i, 1);
      else edited.set(id, null);
      ctx.emit({ type: 'calendar.changed', payload: { from: old.start, to: old.end } });
      return { ok: true };
    },
    async quickAdd(req) {
      const start = new Date(req.start);
      const end = req.end
        ? new Date(req.end)
        : req.allDay
          ? addDays(start, 1)
          : new Date(start.getTime() + 3600e3);
      const personIds = req.personIds ?? [];
      const allDay = req.allDay ?? false;
      const event: CalendarEvent = {
        id: `evt-quick-${added.length + series.length}`,
        calendarId: req.calendarId ?? 'cal-family',
        title: req.title.replace(COUNTDOWN, '').trim() || req.title,
        start: toLocalIso(allDay ? startOfDay(start) : start),
        end: toLocalIso(end),
        allDay,
        personIds,
        color: personColor(personIds[0]),
        countdown: req.countdown ?? /#countdown|⭐/.test(req.title),
        ...(req.location?.trim() ? { location: req.location.trim() } : {}),
      };
      if (req.repeat) {
        const s: Series = {
          id: event.id,
          first: { ...event, recurring: true },
          repeat: req.repeat,
          overrides: new Map(),
        };
        series.push(s);
        ctx.emit({
          type: 'calendar.changed',
          payload: { from: event.start, to: toLocalIso(addDays(end, 400)) },
        });
        return { event: { ...s.first, id: `${s.id}@${toIsoDate(start)}` } };
      }
      added.push(event);
      ctx.emit({ type: 'calendar.changed', payload: { from: event.start, to: event.end } });
      return { event };
    },
    async countdowns() {
      // Fixture countdowns plus any starred with quick add (a series counts down to its next one).
      const today = startOfDay(ctx.now());
      const mine = [...added, ...expand(today, addDays(today, 400))]
        .filter((e) => e.countdown && new Date(e.start) >= today)
        .sort((a, b) => a.start.localeCompare(b.start))
        .filter(
          (e, i, all) => all.findIndex((x) => x.id.split('@')[0] === e.id.split('@')[0]) === i,
        )
        .map((e) => ({
          eventId: e.id,
          title: e.title,
          date: toIsoDate(new Date(e.start)),
          daysRemaining: daysBetween(today, startOfDay(new Date(e.start))),
          personIds: e.personIds,
          color: e.color,
        }));
      const all = [...countdowns(ctx.now()), ...mine].sort(
        (a, b) => a.daysRemaining - b.daysRemaining,
      );
      return { countdowns: all };
    },
    async meals(week) {
      return meals(ctx.now(), week);
    },
    async calendars() {
      return calendars;
    },
    mount(api, auth) {
      mountMockCalendarSetup(api, auth, ctx);
    },
  };
}
