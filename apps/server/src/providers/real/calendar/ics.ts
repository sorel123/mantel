/**
 * iCalendar parsing and writing for CalDAV. ical.js expands recurrences (with EXDATEs and
 * moved or edited occurrences) and converts zoned times using the VTIMEZONEs iCloud sends.
 */
import ICAL from 'ical.js';
import { fromIsoDate, toLocalIso } from '@mantel/shared';
import type { NewEvent, RawEvent } from './types.js';

/** Caps per series: occurrences stepped through (a daily series from years ago) and kept. */
const MAX_STEPS = 50_000;
const MAX_OCCURRENCES = 1500;
const PEOPLE_PROP = 'x-mantel-people';

const pad = (n: number) => String(n).padStart(2, '0');

function localIso(t: ICAL.Time): string {
  if (t.isDate) return toLocalIso(fromIsoDate(`${t.year}-${pad(t.month)}-${pad(t.day)}`));
  return toLocalIso(t.toJSDate());
}

function registerTimezones(root: ICAL.Component) {
  for (const tz of root.getAllSubcomponents('vtimezone')) {
    const id = tz.getFirstPropertyValue('tzid');
    if (typeof id === 'string' && !ICAL.TimezoneService.has(id)) ICAL.TimezoneService.register(tz);
  }
}

function text(c: ICAL.Component, name: string): string | undefined {
  const v = c.getFirstPropertyValue(name);
  return typeof v === 'string' && v.trim() ? v : undefined;
}

/**
 * Every occurrence in one iCalendar object (a CalDAV resource) that overlaps [from, to).
 * `uid` is the event UID plus the occurrence start, so each instance is unique.
 */
export function expandIcs(ics: string, calendarId: string, from: Date, to: Date): RawEvent[] {
  const root = new ICAL.Component(ICAL.parse(ics));
  registerTimezones(root);
  const vevents = root.getAllSubcomponents('vevent');
  const masters = vevents.filter((v) => !v.hasProperty('recurrence-id'));
  const exceptions = vevents.filter((v) => v.hasProperty('recurrence-id'));
  const lo = from.getTime();
  const hi = to.getTime();
  const out: RawEvent[] = [];

  const push = (item: ICAL.Event, start: ICAL.Time, end: ICAL.Time, key: string) => {
    if (end.compare(start) <= 0) {
      end = start.clone();
      if (start.isDate) end.adjust(1, 0, 0, 0);
    }
    const s = start.toJSDate().getTime();
    const e = end.toJSDate().getTime();
    // Zero-length events still count if they start inside the range.
    if (!(e > lo && s < hi) && !(s === e && s >= lo && s < hi)) return;
    const comp = item.component;
    if (text(comp, 'status')?.toUpperCase() === 'CANCELLED') return;
    const people = text(comp, PEOPLE_PROP);
    out.push({
      uid: key,
      calendarId,
      title: item.summary?.trim() || '(No title)',
      start: localIso(start),
      end: localIso(end),
      allDay: start.isDate,
      ...(item.location ? { location: item.location } : {}),
      ...(item.description ? { description: item.description } : {}),
      ...(people ? { personIds: people.split(/[\s,]+/).filter(Boolean) } : {}),
    });
  };

  for (const master of masters) {
    const event = new ICAL.Event(master);
    for (const ex of exceptions) if (text(ex, 'uid') === event.uid) event.relateException(ex);
    if (!event.isRecurring()) {
      push(event, event.startDate, event.endDate, `${event.uid}@${event.startDate.toString()}`);
      continue;
    }
    const it = event.iterator();
    const span = event.endDate.toJSDate().getTime() - event.startDate.toJSDate().getTime();
    // Moved occurrences can land up to a week from their slot; look that far either side.
    const skipBefore = lo - Math.max(span, 0) - 7 * 864e5;
    let kept = 0;
    for (let i = 0, next = it.next(); next && i < MAX_STEPS; i++, next = it.next()) {
      const t = next.toJSDate().getTime();
      if (t >= hi + 7 * 864e5) break;
      if (t < skipBefore) continue;
      const d = event.getOccurrenceDetails(next);
      const before = out.length;
      push(d.item, d.startDate, d.endDate, `${event.uid}@${next.toString()}`);
      if (out.length > before && ++kept >= MAX_OCCURRENCES) break;
    }
  }

  // Edited occurrences whose master is not in this resource (rare, but CalDAV allows it).
  const masterUids = new Set(masters.map((m) => text(m, 'uid')));
  for (const ex of exceptions) {
    if (masterUids.has(text(ex, 'uid'))) continue;
    const e = new ICAL.Event(ex);
    push(
      e,
      e.startDate,
      e.endDate,
      `${e.uid}@${e.recurrenceId?.toString() ?? e.startDate.toString()}`,
    );
  }
  return out;
}

/* ---- writing ---- */

function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Fold to 75 octets per RFC 5545. */
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let cur = '';
  let len = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, 'utf8');
    if (len + n > (parts.length ? 74 : 75)) {
      parts.push(cur);
      cur = '';
      len = 0;
    }
    cur += ch;
    len += n;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

const utcStamp = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
const dateStamp = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

export function buildIcs(uid: string, ev: NewEvent, now = new Date()): string {
  const when = (name: string, d: Date) =>
    ev.allDay ? `${name};VALUE=DATE:${dateStamp(d)}` : `${name}:${utcStamp(d)}`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Mantel//Wall display//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${utcStamp(now)}`,
    when('DTSTART', ev.start),
    when('DTEND', ev.end),
    `SUMMARY:${escapeText(ev.title)}`,
    ...(ev.personIds.length ? [`X-MANTEL-PEOPLE:${ev.personIds.join(' ')}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
