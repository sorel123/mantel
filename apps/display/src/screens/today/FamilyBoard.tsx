/**
 * The Family board preset: a column per person with their day, tomorrow underneath, and an
 * Everyone column for events nobody is tagged on. Tap a column's header for the day sheet.
 */
import type { CalendarEvent, Person } from '@mantel/shared';
import { addDays, startOfDay } from '@mantel/shared';
import { useBootstrap } from '../../lib/bootstrap';
import { eventsOn, formatTime } from './calendar';
import { Avatar, pc } from './parts';

interface Column {
  key: string;
  name: string;
  color: string;
  person?: Person;
  today: CalendarEvent[];
  tomorrow: CalendarEvent[];
}

export function FamilyBoard({
  now,
  events,
  onDay,
}: {
  now: Date;
  events: CalendarEvent[];
  onDay: (day: Date) => void;
}) {
  const boot = useBootstrap();
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const todays = eventsOn(events, today);
  const tmrw = eventsOn(events, tomorrow);
  const t = now.getTime();

  const cols: Column[] = boot.people.map((p) => ({
    key: p.id,
    name: p.name,
    color: p.color,
    person: p,
    today: todays.filter((e) => e.personIds.includes(p.id)),
    tomorrow: tmrw.filter((e) => e.personIds.includes(p.id)),
  }));
  const loose = (es: CalendarEvent[]) => es.filter((e) => e.personIds.length === 0);
  const everyone: Column = {
    key: 'everyone',
    name: 'Everyone',
    color: 'var(--accent)',
    today: loose(todays),
    tomorrow: loose(tmrw),
  };
  if (cols.length === 0 || everyone.today.length || everyone.tomorrow.length) cols.push(everyone);

  return (
    <div
      className="fam"
      role="list"
      aria-label="Family board"
      style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}
    >
      {cols.map((c) => (
        <section key={c.key} className="card famcol" role="listitem" style={pc(c.color)}>
          <button className="fh" onClick={() => onDay(today)} aria-label={`${c.name}, today`}>
            {c.person ? <Avatar person={c.person} /> : <span className="av all">All</span>}
            <span className="who">{c.name}</span>
            <span className="cnt tnum">
              {c.today.length === 0 ? 'Free' : `${c.today.length} today`}
            </span>
          </button>
          <div className="flist">
            {c.today.length === 0 && <div className="fnone">Nothing planned</div>}
            {c.today.map((e) => (
              <Row key={e.id} event={e} now={t} onTap={() => onDay(today)} />
            ))}
            {c.tomorrow.length > 0 && (
              <>
                <div className="eyebrow fsub">Tomorrow</div>
                {c.tomorrow.map((e) => (
                  <Row key={e.id} event={e} dim onTap={() => onDay(tomorrow)} />
                ))}
              </>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

function Row({
  event: e,
  now,
  dim,
  onTap,
}: {
  event: CalendarEvent;
  now?: number;
  dim?: boolean;
  onTap: () => void;
}) {
  const s = new Date(e.start).getTime();
  const en = new Date(e.end).getTime();
  const state = now === undefined ? undefined : en <= now ? 'past' : s <= now ? 'now' : undefined;
  return (
    <button
      className={`frow${state ? ` ${state}` : ''}${dim ? ' dim' : ''}`}
      style={pc(e.color)}
      onClick={onTap}
      data-testid="event"
    >
      <i />
      <span className="ft">
        <b>{e.allDay ? 'All day' : formatTime(new Date(e.start))}</b>
        {e.title}
        {e.location && <small>{e.location}</small>}
      </span>
    </button>
  );
}
