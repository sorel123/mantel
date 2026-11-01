import type { CalendarSource } from '@mantel/shared';

/** A calendar as a source reports it, before household preferences apply. */
export interface SourceCalendar {
  /** `google:<calendar id>` or `icloud:<collection path>`. */
  id: string;
  source: CalendarSource;
  name: string;
  color: string;
  readOnly: boolean;
  /** Google's "show in my list" flag; used as the default for `enabled`. */
  selected: boolean;
  primary?: boolean;
  /** Source-specific handle: the Google calendar id or the CalDAV collection URL. */
  ref: string;
  /** CalDAV ctag; unchanged means nothing in the collection changed. */
  ctag?: string;
}

/** An event occurrence as a source reports it. Recurrences are already expanded. */
export interface RawEvent {
  /** Unique per occurrence within its calendar. */
  uid: string;
  calendarId: string;
  title: string;
  /** ISO with offset; for all-day events, local midnight of the first day. */
  start: string;
  /** ISO with offset; for all-day events, local midnight after the last day (exclusive). */
  end: string;
  allDay: boolean;
  location?: string;
  description?: string;
  /** People set explicitly (quick add stores them on the event). */
  personIds?: string[];
}

export interface NewEvent {
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  personIds: string[];
}

/** An edited event: the whole event as it should be. `personIds` and `location` undefined leave them. */
export interface EditEvent {
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location?: string;
  personIds?: string[];
}

/** One upstream account: Google or iCloud. */
export interface Source {
  readonly kind: CalendarSource;
  /** Credentials present and usable. */
  ready(): boolean;
  calendars(): Promise<SourceCalendar[]>;
  events(cal: SourceCalendar, from: Date, to: Date): Promise<RawEvent[]>;
  create(cal: SourceCalendar, event: NewEvent): Promise<RawEvent>;
  /** Change one event (`uid` as `events` reported it). Absent: the source can't edit. */
  update?(cal: SourceCalendar, uid: string, event: EditEvent): Promise<RawEvent>;
  remove?(cal: SourceCalendar, uid: string): Promise<void>;
}

/** Household choices per calendar, edited on the setup page. */
export interface CalendarPref {
  enabled?: boolean;
  name?: string;
  color?: string;
  personIds?: string[];
  isMeals?: boolean;
}

export interface CalendarPrefs {
  calendars: Record<string, CalendarPref>;
  /** Where quick-add events go. */
  defaultCalendarId?: string;
}
