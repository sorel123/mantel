import type { CalendarEvent } from '@mantel/shared';
import type { CSSProperties } from 'react';
import { formatClockTime } from './format';
import { Icon } from './icons';
import type { LeaveBy } from './store';
import './weather.css';

/**
 * "Leave by 7:41 · 14 min, +3 traffic" for one trip. Sits next to the event it is for (see
 * `matchLeaveBy`). Turns to "Leave now" in the warning colour once the time has passed.
 * `color` is the first traveller's colour.
 */
export function LeaveByChip({
  trip,
  now = new Date(),
  color,
  showName = false,
}: {
  trip: LeaveBy;
  now?: Date;
  color?: string;
  showName?: boolean;
}) {
  const late = new Date(trip.leaveBy) <= now;
  const minutesLeft = Math.round((new Date(trip.leaveBy).getTime() - now.getTime()) / 60_000);
  const soon = !late && minutesLeft <= 10;
  return (
    <span
      className="leaveby"
      data-state={late ? 'late' : soon ? 'soon' : undefined}
      style={color ? ({ '--pc': color } as CSSProperties) : undefined}
      role="status"
      aria-label={`${late ? 'Leave now' : `Leave by ${formatClockTime(trip.leaveBy)}`} for ${trip.name}, ${trip.durationMinutes} minute drive`}
    >
      <Icon name="car" />
      <b className="tnum">{late ? 'Leave now' : `Leave by ${formatClockTime(trip.leaveBy)}`}</b>
      <span className="tnum">
        {showName && `${trip.name} · `}
        {trip.durationMinutes} min
        {trip.delayMinutes >= 2 && <em>, +{trip.delayMinutes} traffic</em>}
      </span>
    </span>
  );
}

/**
 * Pairs each trip with the event it is for: the event the server matched, else the first
 * timed event today, shared by one of the travellers, that starts between leaving and an
 * hour after arriving. Returns event id to trip; trips without an event are left out.
 */
export function matchLeaveBy(events: CalendarEvent[], trips: LeaveBy[]): Map<string, LeaveBy> {
  const out = new Map<string, LeaveBy>();
  const timed = events
    .filter((e) => !e.allDay)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  for (const trip of trips) {
    if (trip.eventId && events.some((e) => e.id === trip.eventId)) {
      if (!out.has(trip.eventId)) out.set(trip.eventId, trip);
      continue;
    }
    const from = new Date(trip.leaveBy).getTime();
    const to = new Date(trip.arriveBy).getTime() + 60 * 60_000;
    const event = timed.find((e) => {
      const start = new Date(e.start).getTime();
      return (
        start >= from &&
        start <= to &&
        !out.has(e.id) &&
        (e.personIds.length === 0 || e.personIds.some((p) => trip.personIds.includes(p)))
      );
    });
    if (event) out.set(event.id, trip);
  }
  return out;
}
