import type { CalendarEvent } from '@mantel/shared';
import { addDays, toLocalIso } from '@mantel/shared';
import { calendars, countdowns, eventsInRange, meals, personColor } from '@mantel/shared/fixtures';
import { HttpError } from '../../errors.js';
import type { CalendarProvider, ProviderContext } from '../types.js';
import { mountMockCalendarSetup } from './calendar-setup.js';

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
  return {
    async events(from, to) {
      const base = eventsInRange(ctx.now(), from, to)
        .filter((e) => !edited.has(e.id))
        .concat([...edited.values()].filter((e): e is CalendarEvent => !!e));
      const extra = added.filter((e) => overlaps(e, from, to));
      return { events: [...base.filter((e) => overlaps(e, from, to)), ...extra] };
    },
    async updateEvent(id, req) {
      const old = find(id);
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
        title: req.title?.trim() ?? old.title,
        start: toLocalIso(start),
        end: toLocalIso(end),
        allDay,
        personIds,
        color: personColor(personIds[0]),
        ...(location ? { location } : {}),
      };
      const i = added.findIndex((e) => e.id === id);
      if (i >= 0) added[i] = event;
      else edited.set(id, event);
      ctx.emit({ type: 'calendar.changed', payload: { from: old.start, to: event.end } });
      return { event };
    },
    async deleteEvent(id) {
      const old = find(id);
      if (!old) throw new HttpError('not_found', `event ${id}`);
      if (readOnly(old)) throw new HttpError('forbidden', 'that calendar is read-only');
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
      const event: CalendarEvent = {
        id: `evt-quick-${added.length}`,
        calendarId: req.calendarId ?? 'cal-family',
        title: req.title,
        start: toLocalIso(start),
        end: toLocalIso(end),
        allDay: req.allDay ?? false,
        personIds,
        color: personColor(personIds[0]),
        countdown: /#countdown|⭐/.test(req.title),
      };
      added.push(event);
      ctx.emit({ type: 'calendar.changed', payload: { from: event.start, to: event.end } });
      return { event };
    },
    async countdowns() {
      return { countdowns: countdowns(ctx.now()) };
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
