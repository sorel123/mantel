/**
 * v4 K: a calendar file (`.ics`, an email invitation, a school's "add to calendar" link) is read
 * directly: no Claude call, no key needed. Each event in the next year becomes a candidate the
 * family checks like any other; repeating events are listed once per date, at most 20.
 */
import type { ImportAnalyseResponse, ImportEvent } from '@mantel/shared';
import { ImportEvent as EventSchema } from '@mantel/shared';
import { expandIcs } from '../../providers/real/calendar/ics.js';
import { zoned } from '../../providers/real/weather-time.js';
import { shiftDate } from './zone.js';

const MAX = 20;
const pad = (n: number) => String(n).padStart(2, '0');

export function readIcs(ics: string, timeZone: string, now = new Date()): ImportAnalyseResponse {
  let raw;
  try {
    // From yesterday, so an invitation for later today still shows.
    raw = expandIcs(ics, 'capture', new Date(now.getTime() - 864e5), new Date(now.getTime() + 366 * 864e5));
  } catch {
    return { summary: 'That calendar file could not be read.', events: [], items: [], meals: [] };
  }
  raw.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const events: ImportEvent[] = [];
  for (const e of raw.slice(0, MAX)) {
    let candidate: unknown;
    if (e.allDay) {
      const date = e.start.slice(0, 10);
      const last = shiftDate(e.end.slice(0, 10), -1);
      candidate = {
        title: e.title.slice(0, 200),
        date,
        ...(last > date ? { endDate: last } : {}),
        allDay: true,
        personIds: [],
      };
    } else {
      const s = zoned(new Date(e.start), timeZone);
      const end = zoned(new Date(e.end), timeZone);
      const date = `${s.year}-${pad(s.month)}-${pad(s.day)}`;
      const endDate = `${end.year}-${pad(end.month)}-${pad(end.day)}`;
      candidate = {
        title: e.title.slice(0, 200),
        date,
        allDay: false,
        start: `${pad(s.hour)}:${pad(s.minute)}`,
        // An end on a later day is dropped; the event is then an hour long on the wall.
        ...(endDate === date ? { end: `${pad(end.hour)}:${pad(end.minute)}` } : {}),
        personIds: [],
      };
    }
    const c = candidate as Record<string, unknown>;
    if (e.location) c.location = e.location.slice(0, 300);
    if (e.description) c.notes = e.description.replace(/\s+/g, ' ').trim().slice(0, 500);
    const parsed = EventSchema.safeParse(c);
    if (parsed.success) events.push(parsed.data);
  }
  const more = raw.length > MAX ? ` (the first ${MAX} of ${raw.length})` : '';
  return {
    summary: events.length
      ? `A calendar file with ${events.length} event${events.length === 1 ? '' : 's'}${more}.`
      : 'A calendar file with nothing coming up.',
    events,
    items: [],
    meals: [],
  };
}
