/**
 * The family agenda for today and the next days, with the wall's quick add (imported from the
 * Month screen, so changes there arrive here too) and Magic Import for a photographed flyer.
 */
import { addDays, startOfDay, type CalendarEvent } from '@mantel/shared';
import { useState } from 'react';
import { useNow } from '../../../app/Clock';
import { QuickAdd } from '../../month/QuickAdd';
import { dayNames, eventsOn, monthNames, relativeDay, useEvents } from '../../today/calendar';
import { EventRow } from '../../today/parts';
import { MagicImport } from '../MagicImport';

const DAYS_AHEAD = 4;

export function CalendarTab() {
  const now = useNow(60_000);
  const today = startOfDay(now);
  const { events, status } = useEvents(today, addDays(today, DAYS_AHEAD));
  const [adding, setAdding] = useState<Date | null>(null);
  const [importing, setImporting] = useState(false);
  const days = Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today, i));

  if (importing)
    return (
      <section className="card apanel">
        <MagicImport hint="events" onDone={() => undefined} />
        <button type="button" className="alink neutral" onClick={() => setImporting(false)}>
          Back to the calendar
        </button>
      </section>
    );

  if (adding)
    return (
      <section className="card apanel cal phone-qa" aria-label="Quick add">
        <h2 className="h2">{relativeDay(adding, now)}</h2>
        <QuickAdd day={adding} onDone={() => setAdding(null)} onCancel={() => setAdding(null)} />
      </section>
    );

  return (
    <>
      <header className="ahead arow">
        <h1 className="h1">Calendar</h1>
        <div className="arow tight">
          <button
            type="button"
            className="abtn small"
            aria-label="Add an event"
            onClick={() => setAdding(today)}
          >
            + Event
          </button>
          <button
            type="button"
            className="abtn small ghost"
            aria-label="Read a photo into the calendar"
            onClick={() => setImporting(true)}
          >
            Photo
          </button>
        </div>
      </header>
      <div className="cal">
        {days.map((day) => {
          const list: CalendarEvent[] = eventsOn(events, day);
          return (
            <section
              key={day.toISOString()}
              className="card apanel cday"
              aria-label={relativeDay(day, now)}
            >
              <div className="arow">
                <h2 className="h2">
                  {relativeDay(day, now)}
                  <small className="amuted">
                    {' '}
                    {dayNames[day.getDay()]!.slice(0, 3)}, {monthNames[day.getMonth()]!.slice(0, 3)}{' '}
                    {day.getDate()}
                  </small>
                </h2>
                <button
                  type="button"
                  className="ax"
                  aria-label={`Add an event ${relativeDay(day, now).toLowerCase()}`}
                  onClick={() => setAdding(day)}
                >
                  +
                </button>
              </div>
              {list.length ? (
                <div className="list">
                  {list.map((e) => (
                    <EventRow key={e.id} event={e} day={day} />
                  ))}
                </div>
              ) : (
                <p className="amuted">{status === 'loading' ? 'Loading…' : 'Nothing planned.'}</p>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
