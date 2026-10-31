/** Small pieces shared by the Today and Month screens. */
import type { CalendarEvent, Person } from '@mantel/shared';
import type { CSSProperties } from 'react';
import { useBootstrap } from '../../lib/bootstrap';
import { formatTime, spanLabel } from './calendar';
import './calendar.css';

export const pc = (color: string) => ({ '--pc': color }) as CSSProperties;

export function Avatar({ person, small }: { person: Person; small?: boolean }) {
  return (
    <span className={small ? 'av sm' : 'av'} style={pc(person.color)} title={person.name}>
      {person.initial}
    </span>
  );
}

/** Avatars in household order, whatever order the ids come in. */
export function Avatars({ ids, small }: { ids: string[]; small?: boolean }) {
  const boot = useBootstrap();
  return (
    <span className="avs">
      {boot.people
        .filter((p) => ids.includes(p.id))
        .map((p) => (
          <Avatar key={p.id} person={p} small={small} />
        ))}
    </span>
  );
}

/** One row of the timeline or day sheet: times, colour bar, title and place, avatars. */
export function EventRow({
  event,
  day,
  state,
}: {
  event: CalendarEvent;
  day: Date;
  state?: 'past' | 'now';
}) {
  const start = new Date(event.start);
  const end = new Date(event.end);
  const span = spanLabel(event, day);
  return (
    <div className={`ev${state ? ` ${state}` : ''}`} style={pc(event.color)} data-testid="event">
      <div className="t tnum">
        {event.allDay ? (
          <b>All day</b>
        ) : (
          <>
            <b>{formatTime(start)}</b>
            {formatTime(end)}
          </>
        )}
      </div>
      <div className="evbar" />
      <div className="ti">
        {event.title}
        {(event.location || span) && (
          <span>{[span, event.location].filter(Boolean).join(' · ')}</span>
        )}
      </div>
      <Avatars ids={event.personIds} small />
    </div>
  );
}

export const Icon = {
  plus: <path d="M12 5v14M5 12h14" />,
  prev: <path d="M15 6l-6 6 6 6" />,
  next: <path d="M9 6l6 6-6 6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  star: <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />,
  meal: <path d="M7 3v8a2 2 0 0 0 2 2v8M11 3v6M7 7h4M17 3c-1.7 1-3 3.2-3 6v4h3v8" />,
};

export function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  );
}
