/**
 * iCalendar parsing and writing for CalDAV. ical.js expands recurrences (with EXDATEs and
 * moved or edited occurrences) and converts zoned times using the VTIMEZONEs iCloud sends.
 */
import ICAL from 'ical.js';
import { fromIsoDate, toLocalIso } from '@mantel/shared';
import { rrule, shiftSeries, icsLocal, vtimezone } from './repeat.js';
import type { EditEvent, NewEvent, RawEvent } from './types.js';

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

  const push = (
    item: ICAL.Event,
    start: ICAL.Time,
    end: ICAL.Time,
    key: string,
    recurring = false,
  ) => {
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
      ...(recurring ? { recurring: true } : {}),
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
      push(d.item, d.startDate, d.endDate, `${event.uid}@${next.toString()}`, true);
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
      true,
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
  // A repeating timed event is written in the household's zone (with its VTIMEZONE) so it keeps
  // its wall-clock time across daylight saving; everything else in UTC.
  const zone = ev.repeat && !ev.allDay && ev.timeZone ? ev.timeZone : null;
  const when = (name: string, d: Date) =>
    ev.allDay
      ? `${name};VALUE=DATE:${dateStamp(d)}`
      : zone
        ? `${name};TZID=${zone}:${icsLocal(d, zone)}`
        : `${name}:${utcStamp(d)}`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Mantel//Wall display//EN',
    ...(zone ? vtimezone(zone, ev.start.getFullYear()) : []),
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${utcStamp(now)}`,
    when('DTSTART', ev.start),
    when('DTEND', ev.end),
    `SUMMARY:${escapeText(ev.title)}`,
    ...(ev.location?.trim() ? [`LOCATION:${escapeText(ev.location.trim())}`] : []),
    ...(ev.repeat ? [`RRULE:${rrule(ev.repeat)}`] : []),
    ...(ev.personIds.length ? [`X-MANTEL-PEOPLE:${ev.personIds.join(' ')}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** The UID of the iCalendar object an occurrence key (`<UID>@<start>`) came from. */
export const icsUid = (key: string) => {
  const at = key.lastIndexOf('@');
  return at > 0 ? key.slice(0, at) : key;
};

/** True when the object is a repeating series (or has edited occurrences). */
export function isRecurringIcs(ics: string): boolean {
  const root = new ICAL.Component(ICAL.parse(ics));
  const vevents = root.getAllSubcomponents('vevent');
  return (
    vevents.length > 1 || vevents.some((v) => v.hasProperty('rrule') || v.hasProperty('rdate'))
  );
}

/**
 * The same iCalendar object with its single event changed: title, times, place and people.
 * Other properties (alarms, notes, attendees) are kept. Throws for a repeating series.
 */
export function editIcs(ics: string, ev: EditEvent, now = new Date()): string {
  if (isRecurringIcs(ics)) throw new Error('repeating event');
  const root = new ICAL.Component(ICAL.parse(ics));
  const vevent = root.getFirstSubcomponent('vevent');
  if (!vevent) throw new Error('no event in the object');
  const when = (d: Date): ICAL.Time =>
    ev.allDay
      ? ICAL.Time.fromDateString(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
      : ICAL.Time.fromJSDate(d, true);
  const set = (name: string, value: string | ICAL.Time) => {
    vevent.removeAllProperties(name);
    vevent.addPropertyWithValue(name, value);
  };
  set('summary', ev.title);
  set('dtstart', when(ev.start));
  vevent.removeAllProperties('duration');
  set('dtend', when(ev.end));
  if (ev.location !== undefined) {
    vevent.removeAllProperties('location');
    if (ev.location.trim()) vevent.addPropertyWithValue('location', ev.location.trim());
  }
  if (ev.personIds !== undefined) {
    vevent.removeAllProperties(PEOPLE_PROP);
    if (ev.personIds.length) vevent.addPropertyWithValue(PEOPLE_PROP, ev.personIds.join(' '));
  }
  set('dtstamp', ICAL.Time.fromJSDate(now, true));
  set('last-modified', ICAL.Time.fromJSDate(now, true));
  const seq = Number(vevent.getFirstPropertyValue('sequence') ?? 0);
  vevent.removeAllProperties('sequence');
  vevent.addPropertyWithValue('sequence', (Number.isFinite(seq) ? seq : 0) + 1);
  return root.toString();
}

/* ---- repeating series: one occurrence or all ---- */

/** The master VEVENT of a series and the recurrence id (as ical.js iterates it) behind `key`. */
function occurrence(root: ICAL.Component, key: string) {
  registerTimezones(root);
  const vevents = root.getAllSubcomponents('vevent');
  const master = vevents.find((v) => !v.hasProperty('recurrence-id'));
  if (!master) throw new Error('no series in the object');
  const at = key.lastIndexOf('@');
  const wanted = at > 0 ? key.slice(at + 1) : '';
  const event = new ICAL.Event(master);
  const it = event.iterator();
  for (let i = 0, next = it.next(); next && i < MAX_STEPS; i++, next = it.next()) {
    if (next.toString() === wanted) return { master, rid: next, vevents };
  }
  // A moved occurrence: its key is its recurrence id, which the iterator also yields above;
  // reaching here means the series no longer has that slot.
  throw new Error('that occurrence is no longer in the series');
}

/** Set a date-time property keeping the TZID of a zoned time. */
function setTime(comp: ICAL.Component, name: string, time: ICAL.Time) {
  comp.removeAllProperties(name);
  const prop = comp.addPropertyWithValue(name, time);
  const tzid = time.zone?.tzid;
  if (!time.isDate && tzid && tzid !== 'UTC' && tzid !== 'floating')
    prop.setParameter('tzid', tzid);
}

const timeOf = (d: Date, allDay: boolean): ICAL.Time =>
  allDay
    ? ICAL.Time.fromDateString(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
    : ICAL.Time.fromJSDate(d, true);

function stamp(comp: ICAL.Component, now: Date) {
  setTime(comp, 'dtstamp', ICAL.Time.fromJSDate(now, true));
  setTime(comp, 'last-modified', ICAL.Time.fromJSDate(now, true));
  const seq = Number(comp.getFirstPropertyValue('sequence') ?? 0);
  comp.removeAllProperties('sequence');
  comp.addPropertyWithValue('sequence', (Number.isFinite(seq) ? seq : 0) + 1);
}

function applyFields(comp: ICAL.Component, ev: EditEvent) {
  comp.removeAllProperties('summary');
  comp.addPropertyWithValue('summary', ev.title);
  if (ev.location !== undefined) {
    comp.removeAllProperties('location');
    if (ev.location.trim()) comp.addPropertyWithValue('location', ev.location.trim());
  }
  if (ev.personIds !== undefined) {
    comp.removeAllProperties(PEOPLE_PROP);
    if (ev.personIds.length) comp.addPropertyWithValue(PEOPLE_PROP, ev.personIds.join(' '));
  }
}

/**
 * Change one occurrence of a repeating series: an exception VEVENT for its slot (replacing an
 * earlier one) with the new title, times, place and people. The rest of the series is untouched.
 */
export function editIcsOccurrence(ics: string, key: string, ev: EditEvent, now = new Date()) {
  const root = new ICAL.Component(ICAL.parse(ics));
  const { master, rid, vevents } = occurrence(root, key);
  const old = vevents.find(
    (v) => v.hasProperty('recurrence-id') && new ICAL.Event(v).recurrenceId?.compare(rid) === 0,
  );
  const ex = old ?? new ICAL.Component('vevent');
  if (!old) {
    for (const p of master.getAllProperties()) {
      if (['rrule', 'rdate', 'exdate', 'dtstart', 'dtend', 'duration'].includes(p.name)) continue;
      ex.addProperty(ICAL.Property.fromString(p.toICALString()));
    }
    setTime(ex, 'recurrence-id', rid);
    root.addSubcomponent(ex);
  }
  setTime(ex, 'dtstart', timeOf(ev.start, ev.allDay));
  ex.removeAllProperties('duration');
  setTime(ex, 'dtend', timeOf(ev.end, ev.allDay));
  applyFields(ex, ev);
  stamp(ex, now);
  return root.toString();
}

/**
 * Change every occurrence: the master moves by as many days as this occurrence did, takes its
 * new time of day and length, title, place and people.
 */
export function editIcsSeries(ics: string, key: string, ev: EditEvent, now = new Date()) {
  const root = new ICAL.Component(ICAL.parse(ics));
  const { master, rid } = occurrence(root, key);
  const event = new ICAL.Event(master);
  const first = event.startDate.toJSDate();
  const moved = shiftSeries(first, rid.toJSDate(), ev.start, ev.allDay);
  let start: ICAL.Time;
  if (ev.allDay) start = timeOf(moved, true);
  else {
    // Keep the series' own zone; set the new wall-clock time in it.
    start = event.startDate.clone();
    if (start.isDate) start = ICAL.Time.fromJSDate(moved, true);
    else {
      const days = Math.round((startOfLocal(moved) - startOfLocal(first)) / 864e5);
      start.adjust(days, 0, 0, 0);
      start.hour = ev.start.getHours();
      start.minute = ev.start.getMinutes();
      start.second = 0;
    }
  }
  const end = start.clone();
  if (ev.allDay) end.adjust(Math.max(1, Math.round((+ev.end - +ev.start) / 864e5)), 0, 0, 0);
  else end.adjust(0, 0, 0, Math.round((+ev.end - +ev.start) / 1000));
  // Deleted days move with the series; edited single days are folded back into it (their slots
  // no longer exist once the time changes), as the Calendar app does for "all events".
  const days = Math.round((startOfLocal(start.toJSDate()) - startOfLocal(first)) / 864e5);
  for (const prop of master.getAllProperties('exdate')) {
    const t = prop.getFirstValue();
    if (!(t instanceof ICAL.Time)) continue;
    const moved = t.clone();
    moved.adjust(days, 0, 0, 0);
    if (!moved.isDate && !start.isDate) {
      moved.hour = start.hour;
      moved.minute = start.minute;
    }
    prop.setValue(moved);
  }
  for (const v of root.getAllSubcomponents('vevent'))
    if (v.hasProperty('recurrence-id')) root.removeSubcomponent(v);
  setTime(master, 'dtstart', start);
  master.removeAllProperties('duration');
  setTime(master, 'dtend', end);
  applyFields(master, ev);
  stamp(master, now);
  return root.toString();
}

const startOfLocal = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Delete one occurrence: an EXDATE on the master, and any edited copy of it goes too. */
export function excludeIcsOccurrence(ics: string, key: string, now = new Date()) {
  const root = new ICAL.Component(ICAL.parse(ics));
  const { master, rid, vevents } = occurrence(root, key);
  for (const v of vevents) {
    if (v.hasProperty('recurrence-id') && new ICAL.Event(v).recurrenceId?.compare(rid) === 0)
      root.removeSubcomponent(v);
  }
  const prop = master.addPropertyWithValue('exdate', rid);
  const tzid = rid.zone?.tzid;
  if (!rid.isDate && tzid && tzid !== 'UTC' && tzid !== 'floating') prop.setParameter('tzid', tzid);
  stamp(master, now);
  return root.toString();
}
