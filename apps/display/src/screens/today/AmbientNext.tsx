import { addDays, startOfDay } from '@mantel/shared';
import { useNow } from '../../app/Clock';
import { eventsOn, formatTime, useEvents } from './calendar';

/**
 * Ambient's glance at what is next: the next timed event today ("Next · 9:00 am, Team standup"),
 * or tomorrow's first event once today is done. Registered as an Ambient slot by the Today screen.
 */
export function AmbientNextEvent() {
  const now = useNow(30_000);
  const today = startOfDay(now);
  const { events } = useEvents(today, addDays(today, 2));
  const t = now.getTime();
  const next = eventsOn(events, today).find((e) => !e.allDay && new Date(e.start).getTime() > t);
  if (next) {
    return (
      <div className="nx">
        Next · {formatTime(new Date(next.start))}
        <b>{next.title}</b>
      </div>
    );
  }
  const tomorrow = eventsOn(events, addDays(today, 1))[0];
  return (
    <div className="nx">
      Tomorrow
      {tomorrow ? (
        <b>
          {tomorrow.allDay ? '' : `${formatTime(new Date(tomorrow.start))} · `}
          {tomorrow.title}
        </b>
      ) : (
        <b>Nothing planned</b>
      )}
    </div>
  );
}
