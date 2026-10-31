/**
 * The Poster preset's event list: today as a bill, one line per event with a dotted leader,
 * then what is coming up. Pairs with the Poster skin.
 */
import type { CalendarEvent } from '@mantel/shared';
import { startOfDay } from '@mantel/shared';
import { useBootstrap } from '../../lib/bootstrap';
import { Countdowns } from './Agenda';
import { eventsOn, formatTime, spanLabel } from './calendar';
import { Avatars, Icon, Svg, pc } from './parts';

export function Bill({
  now,
  events,
  onAdd,
  onDay,
}: {
  now: Date;
  events: CalendarEvent[];
  onAdd: () => void;
  onDay: (day: Date) => void;
}) {
  const boot = useBootstrap();
  const today = startOfDay(now);
  const todays = eventsOn(events, today);
  const t = now.getTime();
  return (
    <section className="bill" aria-label="Today's bill">
      <div className="brule">
        <span>Today's bill</span>
        <button className="add" aria-label="Add an event today" onClick={onAdd}>
          <Svg>{Icon.plus}</Svg>
        </button>
      </div>
      <div className="blist">
        {todays.length === 0 && <div className="bnone">Nothing on the bill. A free day.</div>}
        {todays.map((e) => {
          const s = new Date(e.start).getTime();
          const en = new Date(e.end).getTime();
          const state = en <= t ? 'past' : s <= t ? 'now' : undefined;
          const span = spanLabel(e, today);
          return (
            <button
              key={e.id}
              className={`brow${state ? ` ${state}` : ''}`}
              style={pc(e.color)}
              onClick={() => onDay(today)}
              data-testid="event"
            >
              <span className="bt tnum">
                {e.allDay ? 'All day' : formatTime(new Date(e.start))}
              </span>
              <span className="bti">
                {e.title}
                {(span || e.location) && (
                  <small>{[span, e.location].filter(Boolean).join(' · ')}</small>
                )}
              </span>
              <span className="leader" aria-hidden="true" />
              <Avatars ids={e.personIds} small />
            </button>
          );
        })}
      </div>
      {boot.flags.countdowns && <Countdowns />}
    </section>
  );
}
