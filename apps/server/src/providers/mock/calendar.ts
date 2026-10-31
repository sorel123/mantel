import type { CalendarEvent } from '@mantel/shared';
import { addDays, toLocalIso } from '@mantel/shared';
import { calendars, countdowns, eventsInRange, meals, personColor } from '@mantel/shared/fixtures';
import type { CalendarProvider, ProviderContext } from '../types.js';
import { mountMockCalendarSetup } from './calendar-setup.js';

export function mockCalendar(ctx: ProviderContext): CalendarProvider {
  const added: CalendarEvent[] = [];
  return {
    async events(from, to) {
      const extra = added.filter(
        (e) =>
          new Date(e.end).getTime() > from.getTime() && new Date(e.start).getTime() < to.getTime(),
      );
      return { events: [...eventsInRange(ctx.now(), from, to), ...extra] };
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
